// Tests for server/server.js. Spawns the real server in several configurations and a FAKE Gemini upstream,
// so we can check the exact request we send and every error path without a real API key or network.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'server', 'server.js');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('FAIL', m); } else console.log('ok  ', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function start(env, port) {
  const p = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(port), AI_PROVIDER: '', COMFYUI_BASE: '', COMFYUI_CHECKPOINT: '', COMFYUI_TIMEOUT_MS: '', GEMINI_API_KEY: '', MOCK_AI: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  return new Promise(res => { const t = setInterval(() => { if (out.includes('running')) { clearInterval(t); res({ port, kill: () => p.kill(), out: () => out }); } }, 30); });
}
const call = (port, p, opt = {}) => fetch(`http://127.0.0.1:${port}${p}`, opt).then(async r => ({ status: r.status, headers: r.headers, text: await r.text() }));
const post = (port, p, body) => call(port, p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const json = r => { try { return JSON.parse(r.text); } catch (e) { return {}; } };

// ---- fake Gemini upstream ----
let upstreamMode = 'ok', lastReq = null;
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; });
  req.on('end', () => {
    lastReq = { url: req.url, key: req.headers['x-goog-api-key'], body: b ? JSON.parse(b) : null };
    if (upstreamMode === 'slow') return; // never answers -> client timeout
    if (upstreamMode === '429') { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'quota' } })); }
    if (upstreamMode === '403') { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'API key not valid: SECRETKEY123' } })); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (upstreamMode === 'noimage') return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'I cannot do that.' }] } }] }));
    if (req.url.includes('flash-image')) return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'here you go' }, { inlineData: { mimeType: 'image/png', data: PNG.split(',')[1] } }] } }] }));
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '- Great circle on the left.\n- Move the ear up.' }] } }] }));
  });
});

(async () => {
  await new Promise(r => fake.listen(18799, r));

  // 1) no key, no mock
  let s = await start({}, 18731);
  let r = await call(s.port, '/api/health'); ok(r.status === 200 && json(r).generate === false, 'health: AI reported unavailable without key');
  r = await post(s.port, '/api/generate', { image: PNG }); ok(r.status === 503, 'generate -> 503 when not configured');
  r = await call(s.port, '/'); ok(r.status === 200 && /text\/html/.test(r.headers.get('content-type')) && r.text.includes('DoodleBrick'), 'serves index.html');
  r = await call(s.port, '/script.js'); ok(r.status === 200 && /javascript/.test(r.headers.get('content-type')), 'serves script.js');
  s.kill();

  // 2) mock mode + hardening
  s = await start({ MOCK_AI: '1', RATE_PER_MINUTE: '4', MAX_BODY_BYTES: '20000' }, 18732);
  r = await call(s.port, '/api/health'); ok(json(r).generate === true && json(r).mock === true, 'health: mock mode on');
  r = await post(s.port, '/api/generate', { image: PNG, style: 'Cartoon' }); ok(r.status === 200 && json(r).image === PNG && json(r).provider === 'mock', 'mock generate returns image');
  r = await post(s.port, '/api/coach', { image: PNG, metrics: { accuracy: 55 } }); ok(r.status === 200 && /mock coach/.test(json(r).text), 'mock coach returns text');
  r = await post(s.port, '/api/generate', { image: 'http://evil.example/x.png' }); ok(r.status === 400, 'rejects non-data-URL image');
  r = await post(s.port, '/api/generate', 'not json'); ok(r.status === 400, 'rejects invalid JSON');
  r = await call(s.port, '/api/generate'); ok(r.status === 405, 'GET on /api/generate -> 405');
  r = await call(s.port, '/api/nope', { method: 'POST' }); ok(r.status === 404, 'unknown API route -> 404');
  r = await call(s.port, '/.env'); ok(r.status === 404, '/.env is not served');
  r = await call(s.port, '/server/server.js'); ok(r.status === 404, 'server source is not served');
  r = await call(s.port, '/tests/test_server.js'); ok(r.status === 404, 'tests are not served');
  r = await call(s.port, '/..%2f.env'); ok(r.status === 404 || r.status === 403, 'path traversal blocked');
  r = await call(s.port, '/api/health', { method: 'OPTIONS', headers: { Origin: 'https://x.github.io' } }); ok(r.status === 204 && r.headers.get('access-control-allow-origin') === '*', 'CORS preflight OK');
  r = await post(s.port, '/api/generate', { image: 'data:image/png;base64,' + 'A'.repeat(40000) }); ok(r.status === 413 || r.status === 429, 'oversized body rejected (413)');
  let limited = false; for (let i = 0; i < 6; i++) { r = await post(s.port, '/api/generate', { image: PNG }); if (r.status === 429) limited = true; }
  ok(limited, 'per-IP rate limit returns 429');
  s.kill();

  // 3) live mode against the fake upstream
  const live = { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'SECRETKEY123', GEMINI_BASE: 'http://127.0.0.1:18799/v1beta', UPSTREAM_TIMEOUT_MS: '500', RATE_PER_MINUTE: '100', ALLOWED_ORIGIN: 'https://team.github.io' };
  s = await start(live, 18733);
  r = await call(s.port, '/api/health'); ok(json(r).live === true && json(r).generate === true, 'health: live mode');
  ok(!r.text.includes('SECRETKEY123'), 'health never leaks the key');
  upstreamMode = 'ok';
  r = await post(s.port, '/api/generate', { image: PNG, style: 'Watercolor', prompt: 'make the sky purple' });
  ok(r.status === 200 && json(r).image.startsWith('data:image/png;base64,') && /gemini:gemini-2.5-flash-image/.test(json(r).provider), 'generate parses inlineData image from Gemini');
  ok(lastReq.url === '/v1beta/models/gemini-2.5-flash-image:generateContent', 'calls the documented generateContent path/model');
  ok(lastReq.key === 'SECRETKEY123', 'sends key in x-goog-api-key header (server-side only)');
  const parts = lastReq.body.contents[0].parts;
  ok(parts[0].text.includes('watercolor') && parts[0].text.includes('make the sky purple'), 'prompt includes style + user direction');
  ok(parts[1].inline_data.mime_type === 'image/png' && parts[1].inline_data.data === PNG.split(',')[1], 'drawing sent as inline_data');
  ok(lastReq.body.generationConfig.responseModalities.includes('IMAGE'), 'requests IMAGE modality');
  r = await post(s.port, '/api/coach', { image: PNG, metrics: { accuracy: 61, recall: 0.7, precision: 0.5, level: 'medium', recipe: '1 circle, 2 triangles' } });
  ok(r.status === 200 && json(r).text.includes('Great circle'), 'coach returns Gemini text');
  ok(lastReq.url.includes('gemini-2.5-flash:generateContent') && lastReq.body.contents[0].parts[0].text.includes('"accuracy":61'), 'coach prompt carries deterministic metrics');
  r = await call(s.port, '/api/health', { headers: { Origin: 'https://team.github.io' } }); ok(r.headers.get('access-control-allow-origin') === 'https://team.github.io', 'CORS allows only the configured origin');
  r = await call(s.port, '/api/health', { headers: { Origin: 'https://evil.example' } }); ok(!r.headers.get('access-control-allow-origin'), 'CORS blocks other origins');
  upstreamMode = '429'; r = await post(s.port, '/api/generate', { image: PNG }); ok(r.status === 429 && /busy|quota/i.test(json(r).error), 'upstream 429 -> friendly 429');
  upstreamMode = '403'; r = await post(s.port, '/api/generate', { image: PNG }); ok(r.status === 502 && !r.text.includes('SECRETKEY123'), 'upstream 403 -> 502 without leaking details/key');
  upstreamMode = 'noimage'; r = await post(s.port, '/api/generate', { image: PNG }); ok(r.status === 502 && /did not return an image/.test(json(r).error), 'no image returned -> clear 502');
  upstreamMode = 'slow'; r = await post(s.port, '/api/generate', { image: PNG }); ok(r.status === 504, 'slow upstream -> 504 timeout');
  await sleep(100); ok(s.out().includes('[ai]') && !s.out().includes('SECRETKEY123'), 'server log records the error but redacts the key');
  s.kill();

  let localWorkflow = null;
  const localFake = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/upload/image') {
      req.resume(); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ name: 'doodlebrick.png', subfolder: '', type: 'input' })); });
      return;
    }
    if (req.method === 'POST' && req.url === '/prompt') {
      let body = ''; req.on('data', c => { body += c; });
      req.on('end', () => { localWorkflow = JSON.parse(body).prompt; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ prompt_id: 'local-test-id' })); });
      return;
    }
    if (req.method === 'GET' && req.url === '/history/local-test-id') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 'local-test-id': { outputs: { '9': { images: [{ filename: 'generated.png', subfolder: '', type: 'output' }] } } } }));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/view?')) {
      res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.from(PNG.split(',')[1], 'base64')); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => localFake.listen(18800, r));
  s = await start({ AI_PROVIDER: 'comfyui', COMFYUI_BASE: 'http://127.0.0.1:18800', COMFYUI_CHECKPOINT: 'fixture.safetensors', COMFYUI_TIMEOUT_MS: '2000' }, 18734);
  r = await call(s.port, '/api/health'); ok(json(r).provider === 'comfyui' && json(r).generate && !json(r).coach, 'health: local image mode does not use cloud coach');
  r = await post(s.port, '/api/generate', { image: PNG, width: 512, height: 384, style: 'Cartoon', prompt: 'make it into a cat' });
  ok(r.status === 200 && json(r).image.startsWith('data:image/png;base64,') && json(r).provider === 'ComfyUI local', 'local generate returns ComfyUI image');
  ok(localWorkflow['1'].inputs.ckpt_name === 'fixture.safetensors' && localWorkflow['5'].inputs.width === 512 && localWorkflow['5'].inputs.height === 384, 'local workflow uses configured checkpoint and scaled canvas');
  ok(localWorkflow['2'].inputs.text.includes('cartoon') && localWorkflow['2'].inputs.text.includes('make it into a cat') && localWorkflow['7'].inputs.denoise === 0.82, 'local workflow carries style, direction and image-to-image strength');
  r = await post(s.port, '/api/coach', { image: PNG }); ok(r.status === 503, 'local image mode does not call cloud coach');
  s.kill(); localFake.close(); fake.close();
  console.log(failed ? `\n${failed} FAILED` : '\nSERVER TESTS: ALL GOOD'); process.exit(failed ? 1 : 0);
})();
