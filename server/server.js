// DoodleBrick server — serves the app and proxies the optional AI features.
//   • Generate with AI  -> local ComfyUI (AI_PROVIDER=comfyui) or Google Gemini (AI_PROVIDER=gemini / key only)
//   • AI coach          -> Google Gemini, whenever GEMINI_API_KEY is set (works together with ComfyUI)
// API keys stay here on the server. Nothing needs `npm install`.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ---------- .env (simple parser; real environment variables always win) ----------
try {
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).forEach(line => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) return;
    let v = m[2]; if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  });
} catch (e) { /* no .env file: fine */ }

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const num = (k, d) => { const n = Number(env(k, '')); return Number.isFinite(n) && n > 0 ? n : d; };
const PORT = num('PORT', 8787);
const GEMINI_KEY = env('GEMINI_API_KEY', '');
const GEMINI_BASE = env('GEMINI_BASE', 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const IMAGE_MODEL = env('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image');
const TEXT_MODEL = env('GEMINI_TEXT_MODEL', 'gemini-2.5-flash');
const COMFY_BASE = env('COMFYUI_BASE', 'http://127.0.0.1:8188').replace(/\/$/, '');
const COMFY_CKPT = env('COMFYUI_CHECKPOINT', 'v1-5-pruned-emaonly-fp16.safetensors');
const COMFY_TIMEOUT = num('COMFYUI_TIMEOUT_MS', 180000);
const COMFY_MAX_SIDE = num('COMFYUI_MAX_SIDE', 512);
const UPSTREAM_TIMEOUT = num('UPSTREAM_TIMEOUT_MS', 60000);
const MOCK = env('MOCK_AI', '') === '1';
const ALLOWED_ORIGIN = env('ALLOWED_ORIGIN', '');
const RATE_PER_MINUTE = num('RATE_PER_MINUTE', 12);
const MAX_DAILY_CALLS = num('MAX_DAILY_CALLS', 300);
const MAX_BODY = num('MAX_BODY_BYTES', 6 * 1024 * 1024);

// Which engine draws the picture, and who gives the coach tips.
const wantsComfy = env('AI_PROVIDER', '') === 'comfyui';
const GEN_PROVIDER = MOCK ? 'mock' : wantsComfy ? 'comfyui' : GEMINI_KEY ? 'gemini' : null;
const COACH_ON = MOCK || !!GEMINI_KEY;

// ---------- helpers ----------
const redact = s => { let t = String(s); if (GEMINI_KEY) t = t.split(GEMINI_KEY).join('***'); return t; };
const log = (...a) => console.log('[ai]', ...a.map(redact));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(data), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...extra });
  res.end(data);
}
const fail = (res, status, error) => send(res, status, { error });

function corsHeaders(req) {
  const origin = req.headers.origin, h = { Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (!ALLOWED_ORIGIN) h['Access-Control-Allow-Origin'] = '*';
  else if (origin && origin === ALLOWED_ORIGIN) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

// ---------- abuse protection ----------
const hits = new Map(); let daily = { day: '', n: 0 };
function limited(req) {
  const ip = req.socket.remoteAddress || '?', now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now); hits.set(ip, list);
  return list.length > RATE_PER_MINUTE;
}
function dailyExceeded() {
  const day = new Date().toISOString().slice(0, 10);
  if (daily.day !== day) daily = { day, n: 0 };
  daily.n++; return daily.n > MAX_DAILY_CALLS;
}

function readJson(req) {
  return new Promise(resolve => {
    let size = 0, tooBig = false; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY * 4) { req.destroy(); return; } if (!tooBig && size <= MAX_BODY) chunks.push(c); else tooBig = true; });
    req.on('error', () => resolve({ error: 400 }));
    req.on('end', () => {
      if (tooBig) return resolve({ error: 413 });
      try { resolve({ body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }); } catch (e) { resolve({ error: 400 }); }
    });
  });
}

// ---------- prompts ----------
const cleanStyle = s => String(s || 'cartoon').replace(/[^A-Za-z ]/g, '').trim().slice(0, 30) || 'cartoon';
const cleanPrompt = s => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
function imagePrompt(style, extra) {
  return `Redraw this simple drawing as a polished ${style.toLowerCase()} style illustration. Keep the same shapes, layout and colors so it is clearly the same picture. Friendly and suitable for all ages.${extra ? ' Extra direction: ' + extra : ''}`;
}
function coachPrompt(metrics) {
  const m = metrics && typeof metrics === 'object' ? metrics : {};
  const safe = { accuracy: m.accuracy, recall: m.recall, precision: m.precision, level: m.level, recipe: String(m.recipe || '').slice(0, 120) };
  return `You are a kind drawing coach for beginners and kids. The image shows the learner's drawing with a faint outline of the photo they are tracing. ` +
    `Here are the app's measured numbers (accuracy is out of 100; recall = how much of the outline is covered; precision = how much of the drawing sits on the outline): ${JSON.stringify(safe)}. ` +
    `Do NOT invent a score. Give 2 or 3 short bullet points in plain words: one thing they did well, then the most useful next step. Under 60 words total.`;
}

// ---------- Gemini ----------
async function gemini(model, parts, generationConfig) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT);
  let r;
  try {
    r = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({ contents: [{ parts }], generationConfig }), signal: ctl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw { status: 504, msg: 'The AI took too long. Please try again.' };
    log('network error:', e.message); throw { status: 502, msg: 'Could not reach the AI service.' };
  }
  clearTimeout(timer);
  if (!r.ok) {
    let detail = ''; try { detail = (await r.text()).slice(0, 300); } catch (e) { /* ignore */ }
    log(`Gemini HTTP ${r.status}:`, detail);
    if (r.status === 429) throw { status: 429, msg: 'The AI is busy or out of quota right now. Please try again in a minute.' };
    throw { status: 502, msg: `The AI service returned an error (HTTP ${r.status}).` };
  }
  return r.json();
}
const partsOf = j => (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];

async function generateGemini(img, style, prompt) {
  const j = await gemini(IMAGE_MODEL, [{ text: imagePrompt(style, prompt) }, { inline_data: { mime_type: img.mime, data: img.b64 } }], { responseModalities: ['TEXT', 'IMAGE'] });
  const p = partsOf(j).find(x => (x.inlineData || x.inline_data));
  if (!p) throw { status: 502, msg: 'The AI did not return an image. Try a different drawing or prompt.' };
  const d = p.inlineData || p.inline_data;
  return { image: `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`, provider: `gemini:${IMAGE_MODEL}` };
}
async function coachGemini(img, metrics) {
  const j = await gemini(TEXT_MODEL, [{ text: coachPrompt(metrics) }, { inline_data: { mime_type: img.mime, data: img.b64 } }], { temperature: 0.6, maxOutputTokens: 400 });
  const text = partsOf(j).map(p => p.text || '').join('').trim();
  if (!text) throw { status: 502, msg: 'The coach had nothing to say. Please try again.' };
  return { text };
}

// ---------- local ComfyUI (SD 1.5 image-to-image) ----------
async function comfy(pathAndQuery, opt = {}, ms = 30000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(COMFY_BASE + pathAndQuery, { ...opt, signal: ctl.signal }); }
  catch (e) {
    if (e.name === 'AbortError') throw { status: 504, msg: 'Local ComfyUI took too long. Check its window, then try again.' };
    throw { status: 502, msg: `Could not reach ComfyUI at ${COMFY_BASE}. Is it running?` };
  } finally { clearTimeout(timer); }
}
const snap8 = v => Math.max(64, Math.round(v / 8) * 8);
function workflow(imageName, w, h, style, prompt) {
  const pos = `${style.toLowerCase()} style illustration, clean shapes, bright colors, high quality${prompt ? ', ' + prompt : ''}`;
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: COMFY_CKPT } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: pos, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'low quality, blurry, deformed, extra limbs, text, watermark', clip: ['1', 1] } },
    '4': { class_type: 'LoadImage', inputs: { image: imageName } },
    '5': { class_type: 'ImageScale', inputs: { image: ['4', 0], upscale_method: 'lanczos', width: w, height: h, crop: 'center' } },
    '6': { class_type: 'VAEEncode', inputs: { pixels: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'KSampler', inputs: { model: ['1', 0], seed: Math.floor(Math.random() * 2 ** 31), steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', positive: ['2', 0], negative: ['3', 0], latent_image: ['6', 0], denoise: 0.82 } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['1', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'doodlebrick' } }
  };
}
async function generateComfy(img, width, height, style, prompt) {
  let w = Number(width) || 512, h = Number(height) || 384;
  const k = Math.min(1, COMFY_MAX_SIDE / Math.max(w, h)); w = snap8(w * k); h = snap8(h * k);
  const fd = new FormData();
  fd.append('image', new Blob([Buffer.from(img.b64, 'base64')], { type: img.mime }), 'doodlebrick.' + (img.mime === 'image/png' ? 'png' : img.mime === 'image/webp' ? 'webp' : 'jpg'));
  fd.append('overwrite', 'true');
  const up = await comfy('/upload/image', { method: 'POST', body: fd });
  if (!up.ok) throw { status: 502, msg: 'ComfyUI refused the drawing upload.' };
  const upj = await up.json(), name = (upj.subfolder ? upj.subfolder + '/' : '') + upj.name;
  const q = await comfy('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow(name, w, h, style, prompt) }) });
  if (!q.ok) {
    let t = ''; try { t = (await q.text()).slice(0, 300); } catch (e) { /* ignore */ }
    log('ComfyUI rejected the workflow:', t);
    throw { status: 502, msg: 'ComfyUI rejected the request. Check that the checkpoint name in .env matches a file in ComfyUI\'s models/checkpoints folder.' };
  }
  const id = (await q.json()).prompt_id, t0 = Date.now();
  while (Date.now() - t0 < COMFY_TIMEOUT) {
    const hr = await comfy('/history/' + encodeURIComponent(id));
    if (hr.ok) {
      const entry = (await hr.json())[id], outs = entry && entry.outputs;
      const image = outs && Object.values(outs).flatMap(o => o.images || [])[0];
      if (image) {
        const vr = await comfy(`/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder || '')}&type=${encodeURIComponent(image.type || 'output')}`);
        if (!vr.ok) throw { status: 502, msg: 'ComfyUI made the image but it could not be read.' };
        return { image: 'data:image/png;base64,' + Buffer.from(await vr.arrayBuffer()).toString('base64'), provider: 'ComfyUI local' };
      }
    }
    await sleep(500);
  }
  throw { status: 504, msg: 'Local ComfyUI took too long. Check its window, then try again.' };
}

// ---------- API routes ----------
function health() { return { ok: true, provider: GEN_PROVIDER, generate: !!GEN_PROVIDER, coach: COACH_ON, live: GEN_PROVIDER === 'gemini', mock: MOCK }; }

async function aiRoute(req, res, kind) {
  if (req.method !== 'POST') return fail(res, 405, 'Use POST.');
  if (limited(req)) return fail(res, 429, 'Too many requests — please wait a minute and try again.');
  const { body, error } = await readJson(req);
  if (error === 413) return fail(res, 413, 'That drawing is too large.');
  if (error || !body || typeof body !== 'object') return fail(res, 400, 'Invalid request.');
  const m = DATA_URL.exec(String(body.image || ''));
  if (!m) return fail(res, 400, 'Send the drawing as an image data URL.');
  const img = { mime: m[1], b64: m[2] };
  try {
    if (kind === 'generate') {
      if (!GEN_PROVIDER) return fail(res, 503, 'AI generation is not configured on this server.');
      const style = cleanStyle(body.style), prompt = cleanPrompt(body.prompt);
      if (GEN_PROVIDER === 'mock') return send(res, 200, { image: body.image, provider: 'mock' });
      if (GEN_PROVIDER === 'comfyui') return send(res, 200, await generateComfy(img, body.width, body.height, style, prompt));
      if (dailyExceeded()) return fail(res, 429, 'The daily AI limit was reached. Try again tomorrow.');
      return send(res, 200, await generateGemini(img, style, prompt));
    }
    if (!COACH_ON) return fail(res, 503, 'The AI coach is not configured on this server.');
    if (MOCK) return send(res, 200, { text: '(mock coach) Nice start! Try covering the outline on the left next.' });
    if (dailyExceeded()) return fail(res, 429, 'The daily AI limit was reached. Try again tomorrow.');
    return send(res, 200, await coachGemini(img, body.metrics));
  } catch (e) {
    if (e && e.status) return fail(res, e.status, e.msg);
    log('unexpected error:', e && e.message); return fail(res, 500, 'Something went wrong on the server.');
  }
}

// ---------- static files (only the app itself) ----------
const STATIC = { 'index.html': 'text/html; charset=utf-8', 'style.css': 'text/css; charset=utf-8', 'script.js': 'text/javascript; charset=utf-8', 'vision.js': 'text/javascript; charset=utf-8', 'config.js': 'text/javascript; charset=utf-8' };
function serveStatic(req, res, pathname) {
  let p; try { p = decodeURIComponent(pathname); } catch (e) { return fail(res, 400, 'Bad path.'); }
  if (p.includes('..') || p.includes('\\') || p.includes('\0')) return fail(res, 404, 'Not found.');
  const file = p === '/' ? 'index.html' : p.replace(/^\//, '');
  if (!Object.prototype.hasOwnProperty.call(STATIC, file)) return fail(res, 404, 'Not found.');
  fs.readFile(path.join(ROOT, file), (err, data) => err ? fail(res, 404, 'Not found.') : send(res, 200, data, STATIC[file], { 'Cache-Control': 'no-cache' }));
}

const server = http.createServer(async (req, res) => {
  const cors = corsHeaders(req), _wh = res.writeHead.bind(res);
  res.writeHead = (status, headers) => _wh(status, { ...cors, ...(headers || {}) });
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (pathname === '/api/health') return send(res, 200, health());
  if (pathname === '/api/generate') return aiRoute(req, res, 'generate');
  if (pathname === '/api/coach') return aiRoute(req, res, 'coach');
  if (pathname.startsWith('/api/')) return fail(res, 404, 'Unknown API route.');
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed.');
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`DoodleBrick running at http://localhost:${PORT}`);
  console.log(`AI: ${MOCK ? 'TEST mode (no real model)' : GEN_PROVIDER === 'comfyui' ? `local ComfyUI (${COMFY_CKPT})` : GEN_PROVIDER === 'gemini' ? `Google Gemini (${IMAGE_MODEL})` : 'not configured (on-device features only)'}`);
  console.log(`Coach: ${COACH_ON ? (MOCK ? 'test mode' : `Google Gemini (${TEXT_MODEL})`) : 'on-device tips only (add GEMINI_API_KEY to .env for the AI coach)'}`);
});