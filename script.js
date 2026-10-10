// ==========================================================
// DoodleBrick — draw, trace and animate (runs 100% in the browser)
// vision.js holds the computer-vision helpers (edges, score, palette, filters)
// ==========================================================
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const W = 960, H = 540;          // logical canvas size
const EW = 480, EH = 270;        // working size for analysis
const FONT = '"Space Grotesk","DM Sans",system-ui,sans-serif';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

const state = {
  tool: 'brush', assist: true, viewName: 'draw',
  color: '#FE90E8', size: 8, eraserSize: 24, opacity: 1, hardness: 0.7, eraserHard: 0.6,
  shape: 'circle', shapeRadius: 12, fontSize: 24,
  objects: [], selected: null, nextId: 1, bg: '#FFFFFF',
  view: { z: 1, x: 0, y: 0 }, title: 'Untitled canvas', _ink: 0, _lum: []
};

// ---------- toast ----------
const toastEl = $('#toast');
let toastTimer = null;
function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}
$$('[data-toast]').forEach(el => el.addEventListener('click', () => showToast(el.dataset.toast)));

// ---------- generic switches ----------
$$('.switch').forEach(sw => sw.addEventListener('click', () => {
  sw.classList.toggle('on');
  sw.setAttribute('aria-pressed', String(sw.classList.contains('on')));
}));
const isOn = id => { const el = $('#' + id); return !!el && el.classList.contains('on'); };

// ---------- range inputs with live output ----------
function bindRange(inputId, outputId, suffix, onInput) {
  const input = $('#' + inputId), out = $('#' + outputId);
  if (!input) return;
  const sync = () => { if (out) out.textContent = input.value + suffix; };
  input.addEventListener('input', () => { sync(); if (onInput) onInput(Number(input.value)); });
  sync();
}

// ---------- inspector tabs ----------
const tabButtons = $$('.tab'), tabPanels = $$('.tab-panel');
function activateTab(name) {
  tabButtons.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  tabPanels.forEach(p => p.classList.toggle('active', p.dataset.panel === name));
}
tabButtons.forEach(t => t.addEventListener('click', () => activateTab(t.dataset.tab)));

// ---------- shared color picker and palette swatches ----------
const colorHex = document.getElementById('colorHex');
const previewSwatch = document.getElementById('previewSwatch');
const previewHex = document.getElementById('previewHex');
let currentPickedColor = '#FE90E8';

function normalizeHex(value){
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if(!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map(digit => digit + digit).join('') : match[1];
  return `#${digits.toUpperCase()}`;
}

function hexToHsv(color){
  const red = parseInt(color.slice(1, 3), 16) / 255;
  const green = parseInt(color.slice(3, 5), 16) / 255;
  const blue = parseInt(color.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if(delta){
    if(maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if(maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return {h: (hue + 360) % 360, s: maximum ? delta / maximum * 100 : 0, v: maximum * 100};
}

function hsvToHex(hue, saturation, value){
  const h = ((hue % 360) + 360) % 360;
  const s = saturation / 100;
  const v = value / 100;
  const chroma = v * s;
  const secondary = chroma * (1 - Math.abs((h / 60) % 2 - 1));
  let rgb;
  if(h < 60) rgb = [chroma, secondary, 0];
  else if(h < 120) rgb = [secondary, chroma, 0];
  else if(h < 180) rgb = [0, chroma, secondary];
  else if(h < 240) rgb = [0, secondary, chroma];
  else if(h < 300) rgb = [secondary, 0, chroma];
  else rgb = [chroma, 0, secondary];
  const offset = v - chroma;
  return `#${rgb.map(channel => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function updateColorDisplay(color, clearSelection = false, source = null){
  currentPickedColor = color;
  onColorChange(color);
  const textOwner = source && source.closest && source.closest('[data-text-color]');
  const selectedText = textOwner && sel();
  if (selectedText && selectedText.type === 'text') {
    if (!sliderUndo) { pushUndo(); sliderUndo = true; }
    selectedText.color = color.toUpperCase(); requestRender(); scheduleSave();
  }
  if(colorHex) colorHex.value = color;
  if(previewSwatch) previewSwatch.style.background = color;
  if(previewHex) previewHex.textContent = color;
  if(clearSelection) document.querySelectorAll('.swatch-card.selected').forEach(card => card.classList.remove('selected'));
  const hsv = hexToHsv(color);
  document.querySelectorAll('[data-color-chip]').forEach(chip => chip.style.background = color);
  document.querySelectorAll('[data-color-label]').forEach(label => label.textContent = color);
  document.querySelectorAll('[data-color-widget]').forEach(widget => {
    const field = widget.querySelector('[data-color-sv]');
    const hueInput = widget.querySelector('[data-color-hue]');
    const hueOutput = widget.querySelector('[data-color-hue-out]');
    if(field){
      field.style.setProperty('--picker-hue', `${hsv.h}deg`);
      field.style.setProperty('--picker-saturation', `${hsv.s}%`);
      field.style.setProperty('--picker-value-top', `${100 - hsv.v}%`);
      field.setAttribute('aria-valuenow', String(Math.round(hsv.s)));
      field.setAttribute('aria-valuetext', `${Math.round(hsv.s)}% saturation, ${Math.round(hsv.v)}% brightness`);
    }
    if(hueInput) hueInput.value = String(Math.round(hsv.h));
    if(hueOutput) hueOutput.textContent = `${Math.round(hsv.h)}°`;
  });
}

document.querySelectorAll('.palette-grid').forEach(group => {
  group.addEventListener('click', event => {
    const card = event.target.closest('.swatch-card');
    if(!card || !group.contains(card)) return;
    group.querySelectorAll('.swatch-card').forEach(swatch => swatch.classList.toggle('selected', swatch === card));
    const color = normalizeHex(card.dataset.color);
    if(color) {
      updateColorDisplay(color, false, group);
      if (group.closest('[data-text-color]')) finishTextColorEdit();
    }
  });
});

document.querySelectorAll('[data-color-widget]').forEach(widget => {
  const field = widget.querySelector('[data-color-sv]');
  const hueInput = widget.querySelector('[data-color-hue]');
  if(field && hueInput){
    const pickAt = (clientX, clientY) => {
      const bounds = field.getBoundingClientRect();
      const saturation = Math.max(0, Math.min(100, (clientX - bounds.left) / bounds.width * 100));
      const value = Math.max(0, Math.min(100, (1 - (clientY - bounds.top) / bounds.height) * 100));
      const nextColor = hsvToHex(Number(hueInput.value), saturation, value);
      updateColorDisplay(nextColor, true, widget);
      if (widget.closest('#pixelCustomControls')) {
        syncPixelCustomColor(nextColor);
      }
    };
    field.addEventListener('pointerdown', event => {
      event.preventDefault();
      field.setPointerCapture(event.pointerId);
      pickAt(event.clientX, event.clientY);
    });
    field.addEventListener('pointermove', event => {
      if(event.buttons === 1) pickAt(event.clientX, event.clientY);
    });
    field.addEventListener('keydown', event => {
      if(!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const hsv = hexToHsv(currentPickedColor);
      const saturation = Math.max(0, Math.min(100, hsv.s + (event.key === 'ArrowRight' ? 2 : event.key === 'ArrowLeft' ? -2 : 0)));
      const value = Math.max(0, Math.min(100, hsv.v + (event.key === 'ArrowUp' ? 2 : event.key === 'ArrowDown' ? -2 : 0)));
      const nextColor = hsvToHex(Number(hueInput.value), saturation, value);
      updateColorDisplay(nextColor, true, widget);
      if (widget.closest('#pixelCustomControls')) {
        syncPixelCustomColor(nextColor);
      }
    });
    hueInput.addEventListener('input', () => {
      const hsv = hexToHsv(currentPickedColor);
      const nextColor = hsvToHex(Number(hueInput.value), hsv.s, hsv.v);
      updateColorDisplay(nextColor, true, widget);
      if (widget.closest('#pixelCustomControls')) {
        syncPixelCustomColor(nextColor);
      }
    });
    if (widget.closest('[data-text-color]')) {
      field.addEventListener('pointerup', finishTextColorEdit);
      hueInput.addEventListener('change', finishTextColorEdit);
    }
  }
});

document.querySelectorAll('[data-color-toggle]').forEach(button => {
  button.addEventListener('click', () => {
    const popover = document.getElementById(button.getAttribute('aria-controls'));
    if(!popover) return;
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    popover.classList.toggle('hidden', expanded);
  });
});

if(colorHex){
  colorHex.addEventListener('input', () => colorHex.removeAttribute('aria-invalid'));
  colorHex.addEventListener('change', () => {
    const color = normalizeHex(colorHex.value);
    if(!color){
      colorHex.value = currentPickedColor;
      colorHex.setAttribute('aria-invalid', 'true');
      showToast('Enter a valid HEX color, such as #FE90E8.');
      return;
    }
    updateColorDisplay(color, true);
  });
}

updateColorDisplay(currentPickedColor);

const addColorBtn = document.getElementById('addColorBtn');
if(addColorBtn){
  addColorBtn.addEventListener('click', () => {
    document.querySelectorAll('.palette-grid').forEach(group => {
      let card = [...group.querySelectorAll('.swatch-card')].find(swatch => normalizeHex(swatch.dataset.color) === currentPickedColor);
      if(!card){
        card = document.createElement('button');
        card.className = 'swatch-card';
        card.dataset.color = currentPickedColor;
        card.style.background = currentPickedColor;
        const label = document.createElement('span');
        label.textContent = currentPickedColor;
        card.appendChild(label);
        group.appendChild(card);
      }
      group.querySelectorAll('.swatch-card').forEach(swatch => swatch.classList.toggle('selected', swatch === card));
    });
    updateColorDisplay(currentPickedColor);
    showToast(`Added ${currentPickedColor} to both palettes.`);
  });
}


// called by the color picker code every time the colour changes
function onColorChange(color) { state.color = color; }

// ==========================================================
// CANVAS ENGINE
// ==========================================================
const board = $('#board'), refC = $('#refCanvas'), drawC = $('#drawCanvas'), fxC = $('#fxCanvas');
[refC, drawC, fxC].forEach(c => { c.width = W; c.height = H; });
const refX = refC.getContext('2d', { willReadFrequently: true });
const ctx = drawC.getContext('2d', { willReadFrequently: true });
const fx = fxC.getContext('2d');

const SHAPE_LABEL = {
  square: 'Square', rect: 'Rectangle', rounded: 'Rounded box', circle: 'Circle', ellipse: 'Ellipse', triangle: 'Triangle',
  diamond: 'Diamond', hexagon: 'Hexagon', star: 'Star', heart: 'Heart', cloud: 'Cloud', semicircle: 'Half circle',
  line: 'Line', arrow: 'Arrow', curve: 'Curve', wave: 'Wave'
};
const LINE_TYPES = new Set(['line', 'arrow', 'curve', 'wave']);
const counters = {};
const nextName = label => { counters[label] = (counters[label] || 0) + 1; return `${label} ${counters[label]}`; };
const newObj = props => ({ id: state.nextId++, alpha: 1, ...props });
const sel = () => state.objects.find(o => o.id === state.selected) || null;

// ---------- shape paths (centred on 0,0) ----------
function roundedRectPath(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r); c.closePath();
}
function shapePath(c, type, w, h, o) {
  const x = -w / 2, y = -h / 2, PI = Math.PI;
  c.beginPath();
  switch (type) {
    case 'square': case 'rect': case 'rounded': roundedRectPath(c, x, y, w, h, o && o.radius != null ? o.radius : 0); break;
    case 'circle': case 'ellipse': c.ellipse(0, 0, Math.max(w / 2, 0.5), Math.max(h / 2, 0.5), 0, 0, PI * 2); break;
    case 'triangle': c.moveTo(0, y); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath(); break;
    case 'diamond': c.moveTo(0, y); c.lineTo(x + w, 0); c.lineTo(0, y + h); c.lineTo(x, 0); c.closePath(); break;
    case 'hexagon':
      c.moveTo(x + w * 0.25, y); c.lineTo(x + w * 0.75, y); c.lineTo(x + w, 0); c.lineTo(x + w * 0.75, y + h); c.lineTo(x + w * 0.25, y + h); c.lineTo(x, 0); c.closePath(); break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -PI / 2 + i * PI / 5, r = i % 2 ? 0.42 : 1;
        const px = Math.cos(a) * r * w / 2 / 0.951, py = (Math.sin(a) * r + 0.19) * h / 2 / 0.905;
        i ? c.lineTo(px, py) : c.moveTo(px, py);
      }
      c.closePath(); break;
    case 'heart':
      c.moveTo(0, h * 0.5); c.bezierCurveTo(-w * 0.55, h * 0.1, -w * 0.5, -h * 0.5, 0, -h * 0.15);
      c.bezierCurveTo(w * 0.5, -h * 0.5, w * 0.55, h * 0.1, 0, h * 0.5); c.closePath(); break;
    case 'cloud': {
      const r = Math.min(h * 0.25, w * 0.2);
      c.moveTo(x + w * 0.25, y + h * 0.9);
      c.arc(x + w * 0.25, y + h * 0.65, r, PI / 2, PI * 1.5);
      c.arc(x + w * 0.48, y + h * 0.4, r * 1.1, PI * 1.1, PI * 1.9);
      c.arc(x + w * 0.75, y + h * 0.65, r, PI * 1.4, PI * 2.5);
      c.closePath(); break;
    }
    case 'semicircle': c.ellipse(0, h / 2, Math.max(w / 2, 0.5), Math.max(h, 1), 0, PI, 0); c.closePath(); break;
    case 'line': c.moveTo(x, y); c.lineTo(x + w, y + h); break;
    case 'arrow': {
      const len = Math.max(14, (o && o.size ? o.size : 6) * 2.6), ang = Math.atan2(h, w) || 0;
      c.moveTo(x, y); c.lineTo(x + w, y + h);
      c.moveTo(x + w - Math.cos(ang - 0.5) * len, y + h - Math.sin(ang - 0.5) * len); c.lineTo(x + w, y + h);
      c.lineTo(x + w - Math.cos(ang + 0.5) * len, y + h - Math.sin(ang + 0.5) * len); break;
    }
    case 'curve': c.moveTo(x, y + h); c.quadraticCurveTo(x, y, x + w, y); break;
    case 'wave':
      for (let i = 0; i <= 40; i++) { const t = i / 40, px = x + w * t, py = Math.sin(t * PI * 4) * h / 2; i ? c.lineTo(px, py) : c.moveTo(px, py); }
      break;
    default: c.rect(x, y, w, h);
  }
}

// ---------- draw one object ----------
function drawStroke(c, o) {
  const p = o.pts; if (!p.length) return;
  c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = o.size; c.strokeStyle = o.color; c.fillStyle = o.color;
  if (o.erase) c.globalCompositeOperation = 'destination-out';
  const soft = (1 - (o.hard == null ? 1 : o.hard)) * o.size * 0.55;
  if (soft > 0.6) { c.shadowBlur = soft; c.shadowColor = o.erase ? '#000' : o.color; }
  if (p.length === 1) { c.beginPath(); c.arc(p[0].x, p[0].y, o.size / 2, 0, Math.PI * 2); c.fill(); return; }
  c.beginPath(); c.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length - 1; i++) c.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
  c.lineTo(p[p.length - 1].x, p[p.length - 1].y); c.stroke();
}
function drawShape(c, o) {
  c.translate(o.x + o.w / 2, o.y + o.h / 2); c.rotate(o.rot || 0); c.scale(o.fx || 1, o.fy || 1);
  shapePath(c, o.type, o.w, o.h, o);
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (LINE_TYPES.has(o.type)) { c.lineWidth = o.size || 6; c.strokeStyle = o.color; c.stroke(); }
  else { c.fillStyle = o.color; c.fill(); c.lineWidth = 2.5; c.strokeStyle = '#000'; c.stroke(); }
}
function drawObject(c, o, pose) {
  if (o.hidden) return;
  c.save();
  c.globalAlpha = o.erase ? 1 : (o.alpha == null ? 1 : o.alpha);
  if (pose) {
    const b = bbox(o), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    c.translate(cx + pose.dx, cy + pose.dy); c.rotate(pose.r * Math.PI / 180); c.scale(pose.s, pose.s); c.translate(-cx, -cy);
  }
  if (o.type === 'stroke') drawStroke(c, o);
  else if (o.type === 'bitmap') { c.imageSmoothingEnabled = !o.pixelated; c.drawImage(o.img, o.x, o.y, o.w, o.h); }
  else if (o.type === 'text') { c.fillStyle = o.color; c.font = `700 ${o.size}px ${FONT}`; c.textBaseline = 'top'; c.fillText(o.text, o.x, o.y); }
  else drawShape(c, o);
  c.restore();
}

// ---------- geometry ----------
function rawBounds(o) {
  if (o._r) return o._r;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of o.pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return (o._r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}
function bbox(o) {
  if (o.type === 'stroke') { const r = rawBounds(o); return { x: r.x - o.size / 2, y: r.y - o.size / 2, w: r.w + o.size, h: r.h + o.size }; }
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}
const canRotate = o => o && o.type !== 'stroke' && o.type !== 'bitmap' && o.type !== 'text';
function measureText(o) { ctx.save(); ctx.font = `700 ${o.size}px ${FONT}`; o.w = Math.max(10, ctx.measureText(o.text).width); o.h = o.size * 1.25; ctx.restore(); }
function moveBy(o, dx, dy) {
  if (o.type === 'stroke') { o.pts = o.pts.map(p => ({ x: p.x + dx, y: p.y + dy })); o._r = null; } else { o.x += dx; o.y += dy; }
}
function setBox(o, nb) {
  nb = { x: nb.x, y: nb.y, w: Math.max(4, nb.w), h: Math.max(4, nb.h) };
  if (o.type === 'stroke') {
    const r = rawBounds(o), pad = o.size / 2, sx = (nb.w - o.size) / Math.max(r.w, 1), sy = (nb.h - o.size) / Math.max(r.h, 1);
    o.pts = o.pts.map(p => ({ x: nb.x + pad + (p.x - r.x) * sx, y: nb.y + pad + (p.y - r.y) * sy })); o._r = null;
  } else if (o.type === 'text') {
    o.size = Math.max(8, o.size * nb.h / Math.max(o.h, 1)); measureText(o); o.x = nb.x; o.y = nb.y;
  } else { o.x = nb.x; o.y = nb.y; o.w = nb.w; o.h = nb.h; }
}
function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  let t = l ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l : 0; t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function hit(o, p) {
  if (o.type === 'stroke') {
    const t = o.size / 2 + 6, pts = o.pts;
    if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= t;
    for (let i = 0; i < pts.length - 1; i++) if (distToSeg(p, pts[i], pts[i + 1]) <= t) return true;
    return false;
  }
  if (o.type === 'bitmap') {
    const ix = Math.floor((p.x - o.x) / o.w * o.img.width), iy = Math.floor((p.y - o.y) / o.h * o.img.height);
    if (ix < 0 || iy < 0 || ix >= o.img.width || iy >= o.img.height) return false;
    return o.img.getContext('2d').getImageData(ix, iy, 1, 1).data[3] > 8;
  }
  const b = bbox(o), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  let dx = p.x - cx, dy = p.y - cy;
  if (o.rot) { const cs = Math.cos(-o.rot), sn = Math.sin(-o.rot); [dx, dy] = [dx * cs - dy * sn, dx * sn + dy * cs]; }
  const pad = LINE_TYPES.has(o.type) ? 10 : 0;
  return Math.abs(dx) <= b.w / 2 + pad && Math.abs(dy) <= b.h / 2 + pad;
}
function hitObject(p) {
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const o = state.objects[i]; if (o.hidden || o.erase) continue;
    if (hit(o, p)) return o;
  }
  return null;
}

// ---------- undo / redo ----------
let undoStack = [], redoStack = [];
const snap = () => state.objects.map(o => ({ ...o }));
function pushUndo() { undoStack.push(snap()); if (undoStack.length > 60) undoStack.shift(); redoStack.length = 0; }
function fixSelection() { if (state.selected && !sel()) state.selected = null; }
function undo() {
  if (!undoStack.length) { showToast('Nothing to undo.'); return; }
  redoStack.push(snap()); state.objects = undoStack.pop(); fixSelection(); changed(); showToast('Undid last action.');
}
function redo() {
  if (!redoStack.length) { showToast('Nothing to redo.'); return; }
  undoStack.push(snap()); state.objects = redoStack.pop(); fixSelection(); changed(); showToast('Redid last action.');
}

// ---------- rendering ----------
let smudgeLive = null, renderQueued = false;
function requestRender() {
  if (renderQueued) return; renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}
function render() {
  ctx.clearRect(0, 0, W, H);
  if (smudgeLive) ctx.drawImage(smudgeLive.flat, 0, 0); else state.objects.forEach(o => drawObject(ctx, o));
  renderFx();
}
let hover = null, guides = [];
const screenScale = () => fxC.getBoundingClientRect().width / W || 1;
function renderFx() {
  fx.clearRect(0, 0, W, H);
  const k = screenScale();
  // reference outline
  if (trace.outlineC && isOn('tgOutline')) {
    const peek = performance.now() < trace.peekUntil, a = peek ? 0.95 : LEVEL[level()].alpha;
    if (a > 0) { fx.save(); fx.globalAlpha = a; fx.drawImage(trace.outlineC, 0, 0, W, H); fx.restore(); }
  }
  // ghost hint
  if (trace.ghost) {
    const g = trace.ghost; fx.save();
    if (g.areaHint) {
      fx.beginPath(); g.points.forEach(p => { fx.moveTo(p.x, p.y); fx.lineTo(p.x + 1.5 / k, p.y); });
      fx.strokeStyle = '#FE0D9B'; fx.lineWidth = 4 / k; fx.lineCap = 'round'; fx.stroke();
    } else {
      fx.translate(g.x + g.w / 2, g.y + g.h / 2);
      shapePath(fx, g.type, g.w, g.h, { radius: 10, size: 6 });
      fx.globalAlpha = 0.25; fx.fillStyle = g.color; if (!LINE_TYPES.has(g.type)) fx.fill();
      fx.globalAlpha = 1; fx.setLineDash([10 / k, 7 / k]); fx.lineWidth = 3 / k; fx.strokeStyle = '#7a3cff'; fx.stroke();
    }
    fx.restore();
  }
  // selection
  const o = sel();
  if (o && !o.hidden && effTool() === 'select') {
    const b = bbox(o); fx.save(); fx.translate(b.x + b.w / 2, b.y + b.h / 2); fx.rotate(o.rot || 0);
    fx.lineWidth = 2 / k; fx.strokeStyle = '#000'; fx.setLineDash([6 / k, 4 / k]); fx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h); fx.setLineDash([]);
    const hs = 10 / k; fx.fillStyle = '#C0F7FE'; fx.lineWidth = 2 / k;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => { fx.fillRect(sx * b.w / 2 - hs / 2, sy * b.h / 2 - hs / 2, hs, hs); fx.strokeRect(sx * b.w / 2 - hs / 2, sy * b.h / 2 - hs / 2, hs, hs); });
    if (canRotate(o)) {
      fx.beginPath(); fx.moveTo(0, -b.h / 2); fx.lineTo(0, -b.h / 2 - 26 / k); fx.stroke();
      fx.beginPath(); fx.arc(0, -b.h / 2 - 26 / k, 6 / k, 0, Math.PI * 2); fx.fillStyle = '#FE90E8'; fx.fill(); fx.stroke();
    }
    fx.restore();
  }
  // snap guides
  if (guides.length) {
    fx.save(); fx.strokeStyle = '#FE0D9B'; fx.lineWidth = 1.5 / k; fx.setLineDash([5 / k, 4 / k]);
    guides.forEach(g => { fx.beginPath(); if (g.axis === 'x') { fx.moveTo(g.v, 0); fx.lineTo(g.v, H); } else { fx.moveTo(0, g.v); fx.lineTo(W, g.v); } fx.stroke(); });
    fx.restore();
  }
  // brush cursor
  const t = effTool();
  if (hover && (t === 'brush' || t === 'erase' || t === 'smudge') && !drag) {
    const r = (t === 'erase' ? state.eraserSize : t === 'smudge' ? Number($('#smudgeRadius').value) * 2 : state.size) / 2;
    fx.save(); fx.lineWidth = 1.5 / k; fx.strokeStyle = '#fff'; fx.beginPath(); fx.arc(hover.x, hover.y, r + 0.8 / k, 0, Math.PI * 2); fx.stroke();
    fx.strokeStyle = '#000'; fx.beginPath(); fx.arc(hover.x, hover.y, r, 0, Math.PI * 2); fx.stroke(); fx.restore();
  }
}

// something about the drawing changed (commit)
function changed() { requestRender(); scheduleAnalysis(); scheduleSave(); renderLayers(); updateSelectionPanel(); if (state.viewName === 'animate') { renderTimeline(); renderAnim(); } }

// ---------- zoom / pan ----------
function applyView() {
  const v = state.view;
  board.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
  const tag = $('#zoomTag'); if (tag) tag.textContent = Math.round(v.z * 100) + '%';
  requestRender();
}
const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3];
$('#zoomTag').addEventListener('click', () => {
  const z = state.view.z, next = ZOOMS.find(v => v > z + 0.01) || ZOOMS[0];
  state.view.z = next; if (next === 1) { state.view.x = 0; state.view.y = 0; } applyView();
});
$('#zoomTag').addEventListener('dblclick', () => { state.view = { z: 1, x: 0, y: 0 }; applyView(); });
$('#zoomTag').title = 'Click to change zoom · double-click to reset · Ctrl+scroll to zoom';
$('.artboard').addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault(); state.view.z = clamp(state.view.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.4, 4); applyView();
}, { passive: false });

// background colour
const BGS = ['#FFFFFF', '#FBF9EF', '#C0F7FE', '#FFDC8B', '#2B2B3A'];
function applyBg() { board.style.background = state.bg; }
$('#bgBtn').addEventListener('click', () => { state.bg = BGS[(BGS.indexOf(state.bg) + 1) % BGS.length]; applyBg(); scheduleSave(); showToast('Background ' + state.bg); });

// ==========================================================
// TOOLS
// ==========================================================
const railButtons = $$('.rail-btn'), dockButtons = $$('.dock-tool[data-tool]');
const detailsTag = $('#detailsTag'), aiAssist = $('#aiAssist');
const toolLabel = {
  select: 'SELECT', brush: 'BRUSH', erase: 'ERASER', smudge: 'SMUDGE', picker: 'COLOR PICKER', pan: 'PAN & NAVIGATE',
  shapes: 'SHAPES', fill: 'FILL', text: 'TEXT', trace: 'PHOTO-TO-TRACE', motion: 'ANIMATE & EDIT'
};
const effTool = () => (state.tool === 'trace' ? 'brush' : state.tool === 'motion' ? 'select' : state.tool);
const CURSORS = { brush: 'crosshair', erase: 'crosshair', smudge: 'crosshair', picker: 'crosshair', fill: 'cell', text: 'text', shapes: 'crosshair', pan: 'grab', select: 'default' };

function selectTool(tool, opts = {}) {
  state.tool = tool; state.assist = !!opts.assist;
  railButtons.forEach(b => { const on = b.dataset.tool === tool && !state.assist; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  dockButtons.forEach(b => { const on = b.dataset.tool === tool; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  activateTab('details');
  $$('.tab-panel[data-panel="details"] .panel-section').forEach(s => s.classList.toggle('hidden', state.assist || s.dataset.section !== tool));
  if (detailsTag) { detailsTag.textContent = state.assist ? '' : toolLabel[tool] || tool.toUpperCase(); detailsTag.classList.toggle('hidden', state.assist); }
  if (aiAssist) aiAssist.classList.toggle('hidden', !state.assist);
  fxC.style.cursor = CURSORS[effTool()] || 'default';
  // the dock slider shows the size of whichever tool is active
  const ds = $('#dockSize'); if (ds) { ds.value = tool === 'erase' ? state.eraserSize : state.size; $('#dockSizeVal').textContent = ds.value; }
  if (tool === 'motion') setView('animate'); else if (state.viewName !== 'draw' && !opts.keepView) setView('draw');
  updateSelectionPanel(); requestRender();
}
railButtons.forEach(btn => btn.addEventListener('click', () => {
  const t = btn.dataset.tool;
  if (state.tool === t && !state.assist) selectTool('brush', { assist: true }); else selectTool(t);
}));
dockButtons.forEach(btn => btn.addEventListener('click', () => selectTool(btn.dataset.tool)));

// dock sliders
const dockSize = $('#dockSize'), dockOpacity = $('#dockOpacity');
dockSize.addEventListener('input', () => {
  const v = Number(dockSize.value); $('#dockSizeVal').textContent = v;
  if (state.tool === 'erase') { state.eraserSize = v; $('#eraserSize').value = v; $('#eraserSizeOut').textContent = v + 'px'; } else state.size = v;
});
dockOpacity.addEventListener('input', () => { state.opacity = Number(dockOpacity.value) / 100; $('#dockOpacityVal').textContent = dockOpacity.value; });
state.size = Number(dockSize.value); state.opacity = Number(dockOpacity.value) / 100;
bindRange('brushHardness', 'brushHardnessOut', '%', v => { state.hardness = v / 100; });
bindRange('eraserSize', 'eraserSizeOut', 'px', v => { state.eraserSize = v; if (state.tool === 'erase') { dockSize.value = v; $('#dockSizeVal').textContent = v; } });
bindRange('eraserHardness', 'eraserHardnessOut', '%', v => { state.eraserHard = v / 100; });
bindRange('smudgeStrength', 'smudgeStrengthOut', '%');
bindRange('smudgeRadius', 'smudgeRadiusOut', 'px');
bindRange('fillTolerance', 'fillToleranceOut', '%');
bindRange('fontSize', 'fontSizeOut', 'px', v => { state.fontSize = v; });
bindRange('shapeRadius', 'shapeRadiusOut', 'px', v => { state.shapeRadius = v; });
state.hardness = Number($('#brushHardness').value) / 100;
state.eraserSize = Number($('#eraserSize').value); state.eraserHard = Number($('#eraserHardness').value) / 100;
state.fontSize = Number($('#fontSize').value); state.shapeRadius = Number($('#shapeRadius').value);

// shape tiles
$$('.shape-tile').forEach(tile => {
  tile.setAttribute('draggable', 'true');
  tile.addEventListener('click', () => {
    $$('.shape-tile').forEach(t => { t.classList.toggle('active', t === tile); t.setAttribute('aria-pressed', String(t === tile)); });
    state.shape = tile.dataset.shape;
  });
  tile.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'shape:' + tile.dataset.shape); e.dataTransfer.effectAllowed = 'copy'; });
});

// ---------- shape creation ----------
function defaultSize(type) {
  if (type === 'line' || type === 'arrow') return { w: 220, h: 1 };
  if (type === 'curve') return { w: 200, h: 120 };
  if (type === 'wave') return { w: 240, h: 60 };
  if (type === 'rect' || type === 'rounded' || type === 'ellipse' || type === 'cloud' || type === 'semicircle') return { w: 200, h: 130 };
  return { w: 150, h: 150 };
}
function makeShape(type, box, color, extra = {}) {
  return newObj({
    type, x: box.x, y: box.y, w: Math.max(box.w, 1), h: Math.max(box.h, 1), rot: 0, fx: 1, fy: 1, color: color || state.color,
    size: Math.max(3, state.size), alpha: state.opacity,
    radius: type === 'rounded' ? Math.max(state.shapeRadius, 8) : 0, name: nextName(SHAPE_LABEL[type] || type), ...extra
  });
}
function addShapeAt(type, c, color) {
  const s = defaultSize(type); pushUndo();
  const o = makeShape(type, { x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h }, color);
  state.objects.push(o); selectObj(o.id); selectTool('select'); changed(); return o;
}
board.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
board.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) { loadPhotoFile(file); return; }
  const t = e.dataTransfer.getData('text/plain');
  if (t.startsWith('shape:')) addShapeAt(t.slice(6), pt(e));
});

// ---------- selection ----------
function selectObj(id) { state.selected = id; updateSelectionPanel(); renderLayersSelection(); requestRender(); }

// ---------- pointer helpers ----------
function pt(e) { const r = fxC.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
let drag = null, spaceDown = false, textInput = null;

function handleAt(p) {
  const o = sel(); if (!o || o.hidden) return null;
  const k = screenScale(), b = bbox(o), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  let dx = p.x - cx, dy = p.y - cy;
  if (o.rot) { const cs = Math.cos(-o.rot), sn = Math.sin(-o.rot); [dx, dy] = [dx * cs - dy * sn, dx * sn + dy * cs]; }
  const r = 12 / k;
  if (canRotate(o) && Math.hypot(dx, dy + b.h / 2 + 26 / k) < r) return { kind: 'rot' };
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) if (Math.hypot(dx - sx * b.w / 2, dy - sy * b.h / 2) < r) return { kind: 'resize', sx, sy };
  return null;
}

// snap a moving bounding box to canvas centre/edges and other objects
function snapMove(o, b, dx, dy) {
  guides = []; if (!isOn('tgSnap')) return { dx, dy };
  const k = screenScale(), th = 7 / k, xs = [0, W / 2, W], ys = [0, H / 2, H];
  state.objects.forEach(q => { if (q === o || q.hidden || q.erase) return; const qb = bbox(q); xs.push(qb.x, qb.x + qb.w / 2, qb.x + qb.w); ys.push(qb.y, qb.y + qb.h / 2, qb.y + qb.h); });
  const nb = { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
  let bestX = null, bestY = null;
  [nb.x, nb.x + nb.w / 2, nb.x + nb.w].forEach(m => xs.forEach(t => { const d = t - m; if (Math.abs(d) < th && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, t }; }));
  [nb.y, nb.y + nb.h / 2, nb.y + nb.h].forEach(m => ys.forEach(t => { const d = t - m; if (Math.abs(d) < th && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, t }; }));
  if (bestX) { dx += bestX.d; guides.push({ axis: 'x', v: bestX.t }); }
  if (bestY) { dy += bestY.d; guides.push({ axis: 'y', v: bestY.t }); }
  return { dx, dy };
}

// ---------- pointer events ----------
fxC.style.touchAction = 'none';
fxC.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  closeTextInput();
  fxC.setPointerCapture(e.pointerId);
  const p = pt(e), tool = effTool();
  if (spaceDown || tool === 'pan') {
    if (isOn('tgLock')) { showToast('Canvas position is locked.'); return; }
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y }; fxC.style.cursor = 'grabbing'; return;
  }
  if (tool === 'brush' || tool === 'erase') {
    if (tool === 'erase' && isOn('tgEraseLayer')) {
      const o = hitObject(p); if (o) { pushUndo(); state.objects = state.objects.filter(q => q !== o); fixSelection(); changed(); showToast(`Erased ${o.name}.`); } return;
    }
    pushUndo();
    const er = tool === 'erase';
    const o = newObj({ type: 'stroke', pts: [p], color: er ? '#000' : state.color, size: er ? state.eraserSize : state.size, alpha: er ? 1 : state.opacity, hard: er ? state.eraserHard : state.hardness, erase: er, name: er ? nextName('Eraser') : nextName('Stroke') });
    state.objects.push(o); drag = { kind: 'stroke', o }; requestRender(); return;
  }
  if (tool === 'select') {
    const h = handleAt(p), o = sel();
    if (h && o) {
      pushUndo(); const b = bbox(o);
      drag = { kind: h.kind, h, o, orig: { ...o }, ob: b, c0: { x: b.x + b.w / 2, y: b.y + b.h / 2 } }; return;
    }
    const target = hitObject(p);
    if (target) { selectObj(target.id); pushUndo(); drag = { kind: 'move', o: target, orig: { ...target }, start: p, moved: false }; }
    else selectObj(null);
    return;
  }
  if (tool === 'shapes') { drag = { kind: 'shape', start: p, o: null }; return; }
  if (tool === 'fill') { doFill(p); return; }
  if (tool === 'picker') { pickColor(p); return; }
  if (tool === 'text') { startText(p); return; }
  if (tool === 'smudge') { startSmudge(p); return; }
});

fxC.addEventListener('pointermove', e => {
  const p = pt(e); hover = p;
  if (!drag) { if (effTool() === 'select') { const h = handleAt(p); fxC.style.cursor = h ? (h.kind === 'rot' ? 'grab' : 'nwse-resize') : hitObject(p) ? 'move' : 'default'; } requestRender(); return; }
  const o = drag.o;
  switch (drag.kind) {
    case 'pan': state.view.x = drag.vx + (e.clientX - drag.sx); state.view.y = drag.vy + (e.clientY - drag.sy); applyView(); break;
    case 'stroke': {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      (evs.length ? evs : [e]).forEach(ev => {
        const q = pt(ev), last = o.pts[o.pts.length - 1];
        if (Math.hypot(q.x - last.x, q.y - last.y) >= 1.2) o.pts.push(q);
      });
      o._r = null; requestRender(); break;
    }
    case 'move': {
      let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) < 2) break; drag.moved = true;
      const s = snapMove(o, bbox(drag.orig.type === 'stroke' ? { ...drag.orig, _r: drag.orig._r } : drag.orig), dx, dy); dx = s.dx; dy = s.dy;
      Object.assign(o, drag.orig); if (o.type === 'stroke') o._r = null; moveBy(o, dx, dy); requestRender(); updateSelectionPanel(); break;
    }
    case 'resize': {
      const { sx, sy } = drag.h, ob = drag.ob, rot = drag.orig.rot || 0;
      const cs = Math.cos(-rot), sn = Math.sin(-rot);
      let lx = (p.x - drag.c0.x) * cs - (p.y - drag.c0.y) * sn, ly = (p.x - drag.c0.x) * sn + (p.y - drag.c0.y) * cs;
      const ox = -sx * ob.w / 2, oy = -sy * ob.h / 2;
      let nw = Math.max(8, (lx - ox) * sx), nh = Math.max(8, (ly - oy) * sy);
      if (e.shiftKey) { const r = ob.w / ob.h; if (nw / nh > r) nw = nh * r; else nh = nw / r; }
      const lcx = ox + sx * nw / 2, lcy = oy + sy * nh / 2, cr = Math.cos(rot), sr = Math.sin(rot);
      const gcx = drag.c0.x + lcx * cr - lcy * sr, gcy = drag.c0.y + lcx * sr + lcy * cr;
      Object.assign(o, drag.orig); if (o.type === 'stroke') o._r = null;
      setBox(o, { x: gcx - nw / 2, y: gcy - nh / 2, w: nw, h: nh }); requestRender(); updateSelectionPanel(); break;
    }
    case 'rot': {
      let a = Math.atan2(p.y - drag.c0.y, p.x - drag.c0.x) + Math.PI / 2;
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      o.rot = a; requestRender(); break;
    }
    case 'shape': {
      const s = drag.start, dx = p.x - s.x, dy = p.y - s.y;
      if (!drag.o) { if (Math.hypot(dx, dy) < 5) break; pushUndo(); drag.o = makeShape(state.shape, { x: s.x, y: s.y, w: 2, h: 2 }); state.objects.push(drag.o); }
      const sh = drag.o; let w = Math.abs(dx), h = Math.abs(dy);
      if (state.shape === 'square' || state.shape === 'circle' || state.shape === 'star' || state.shape === 'heart' || e.shiftKey) { w = h = Math.max(w, h); }
      sh.x = dx < 0 ? s.x - w : s.x; sh.y = dy < 0 ? s.y - h : s.y; sh.w = Math.max(w, 1); sh.h = Math.max(h, 1);
      if (LINE_TYPES.has(sh.type)) { sh.fx = dx < 0 ? -1 : 1; sh.fy = dy < 0 ? -1 : 1; }
      requestRender(); break;
    }
    case 'smudge': smudgeMove(p); break;
  }
});

function endDrag(e) {
  if (!drag) return;
  const d = drag; drag = null; guides = [];
  fxC.style.cursor = CURSORS[effTool()] || 'default';
  switch (d.kind) {
    case 'pan': break;
    case 'stroke': d.o._r = null; if (d.o.pts.length > 3 && !d.o.erase) d.o.pts = simplify(d.o.pts, 0.35); changed(); break;
    case 'move': if (!d.moved) { undoStack.pop(); } changed(); break;
    case 'resize': case 'rot': changed(); break;
    case 'shape':
      if (!d.o) { const o = addShapeAt(state.shape, d.start); showToast(`${o.name} added — drag to move, corners to resize.`); }
      else { selectObj(d.o.id); selectTool('select'); changed(); }
      break;
    case 'smudge': endSmudge(); break;
  }
}
fxC.addEventListener('pointerup', endDrag);
fxC.addEventListener('pointercancel', endDrag);
fxC.addEventListener('pointerleave', () => { hover = null; if (!drag) requestRender(); });

// ---------- stroke clean-up ----------
function simplify(pts, eps) {   // Ramer–Douglas–Peucker
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = distToSeg(pts[i], pts[a], pts[b]); if (d > md) { md = d; mi = i; } }
    if (md > eps && mi > -1) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function smoothPts(pts) {
  if (pts.length < 4) return pts;
  let a = pts;
  for (let pass = 0; pass < 2; pass++) a = a.map((p, i) => (i === 0 || i === a.length - 1) ? p : { x: (a[i - 1].x + p.x * 2 + a[i + 1].x) / 4, y: (a[i - 1].y + p.y * 2 + a[i + 1].y) / 4 });
  return simplify(a, 0.6);
}

// ---------- colour picker tool ----------
const hexOf = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
function pickColor(p) {
  const x = clamp(p.x | 0, 0, W - 1), y = clamp(p.y | 0, 0, H - 1);
  let d = ctx.getImageData(x, y, 1, 1).data, hex;
  if (d[3] > 10) hex = hexOf(d[0], d[1], d[2]);
  else if (trace.has) { d = refX.getImageData(x, y, 1, 1).data; hex = hexOf(d[0], d[1], d[2]); }
  else hex = state.bg.toUpperCase();
  updateColorDisplay(hex, true); showToast(`Picked ${hex}`);
}

// ---------- bucket fill ----------
function doFill(p) {
  const x0 = clamp(Math.round(p.x), 0, W - 1), y0 = clamp(Math.round(p.y), 0, H - 1);
  const comp = mk(W, H), c = comp.getContext('2d', { willReadFrequently: true });
  c.fillStyle = state.bg; c.fillRect(0, 0, W, H);
  if (trace.outlineC) c.drawImage(trace.outlineC, 0, 0, W, H);   // outline lines act as walls
  c.drawImage(drawC, 0, 0);
  const d = c.getImageData(0, 0, W, H).data, s = (y0 * W + x0) * 4, sr = d[s], sg = d[s + 1], sb = d[s + 2];
  const tol = Number($('#fillTolerance').value) * 2.55;
  const diff = i => { const j = i * 4; return (Math.abs(d[j] - sr) + Math.abs(d[j + 1] - sg) + Math.abs(d[j + 2] - sb)) / 3; };
  const same = i => diff(i) <= tol;
  const mask = new Uint8Array(W * H);
  if (isOn('tgFillAll')) { for (let i = 0; i < mask.length; i++) if (same(i)) mask[i] = 1; }
  else {
    const stack = [[x0, y0]];
    while (stack.length) {
      const [x, y] = stack.pop(), row = y * W;
      if (mask[row + x] || !same(row + x)) continue;
      let xl = x, xr = x;
      while (xl > 0 && !mask[row + xl - 1] && same(row + xl - 1)) xl--;
      while (xr < W - 1 && !mask[row + xr + 1] && same(row + xr + 1)) xr++;
      for (let xx = xl; xx <= xr; xx++) mask[row + xx] = 1;
      for (const ny of [y - 1, y + 1]) {
        if (ny < 0 || ny >= H) continue; let span = false;
        for (let xx = xl; xx <= xr; xx++) { const j = ny * W + xx; if (!mask[j] && same(j)) { if (!span) { stack.push([xx, ny]); span = true; } } else span = false; }
      }
    }
  }
  // grow 1px into anti-aliased edges (but never into dark lines)
  const grown = new Uint8Array(mask);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!mask[i] && (mask[i - 1] || mask[i + 1] || mask[i - W] || mask[i + W]) && diff(i) < 130) grown[i] = 1;
  }
  let n = 0; for (let i = 0; i < grown.length; i++) n += grown[i];
  if (!n) { showToast('Nothing to fill there.'); return; }
  const cv = mk(W, H), cx = cv.getContext('2d'), img = cx.createImageData(W, H);
  const rgb = [1, 3, 5].map(k => parseInt(state.color.slice(k, k + 2), 16));
  for (let i = 0; i < grown.length; i++) if (grown[i]) { img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = 255; }
  cx.putImageData(img, 0, 0);
  pushUndo();
  state.objects.push(newObj({ type: 'bitmap', img: cv, x: 0, y: 0, w: W, h: H, alpha: state.opacity, color: state.color, name: nextName('Fill') }));
  changed();
}

// ---------- text tool ----------
function closeTextInput() { if (textInput) { textInput.blur(); } }
function startText(p) {
  const k = board.offsetWidth / W, inp = document.createElement('input');
  inp.className = 'text-edit'; inp.placeholder = 'Type…'; inp.setAttribute('aria-label', 'Canvas text');
  inp.style.left = p.x * k + 'px'; inp.style.top = p.y * k + 'px'; inp.style.fontSize = state.fontSize * k + 'px'; inp.style.color = state.color;
  board.appendChild(inp); textInput = inp; setTimeout(() => inp.focus(), 0);
  inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = ''; inp.blur(); } });
  inp.addEventListener('blur', () => {
    const v = inp.value.trim(); inp.remove(); textInput = null;
    if (!v) return;
    pushUndo();
    const o = newObj({ type: 'text', text: v, x: p.x, y: p.y, size: state.fontSize, color: state.color, alpha: state.opacity, name: `Text “${v.slice(0, 14)}”` });
    measureText(o); state.objects.push(o); selectObj(o.id); changed();
  }, { once: true });
}

// ---------- smudge ----------
function startSmudge(p) {
  const flat = mk(W, H), fc = flat.getContext('2d', { willReadFrequently: true });
  state.objects.forEach(o => drawObject(fc, o));
  const r = Number($('#smudgeRadius').value), carry = mk(r * 2, r * 2), cc = carry.getContext('2d');
  cc.drawImage(flat, p.x - r, p.y - r, r * 2, r * 2, 0, 0, r * 2, r * 2);
  const mask = mk(r * 2, r * 2), mc = mask.getContext('2d'), g = mc.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); mc.fillStyle = g; mc.fillRect(0, 0, r * 2, r * 2);
  pushUndo(); smudgeLive = { flat, fc, carry, cc, mask, r, last: p, tmp: mk(r * 2, r * 2) };
  drag = { kind: 'smudge', o: null };
}
function smudgeMove(p) {
  const s = smudgeLive; if (!s) return;
  const strength = Number($('#smudgeStrength').value) / 100, dist = Math.hypot(p.x - s.last.x, p.y - s.last.y), step = Math.max(2, s.r / 3);
  const n = Math.max(1, Math.ceil(dist / step)), tc = s.tmp.getContext('2d');
  for (let i = 1; i <= n; i++) {
    const q = { x: s.last.x + (p.x - s.last.x) * i / n, y: s.last.y + (p.y - s.last.y) * i / n };
    tc.globalCompositeOperation = 'source-over'; tc.clearRect(0, 0, s.r * 2, s.r * 2); tc.drawImage(s.carry, 0, 0);
    tc.globalCompositeOperation = 'destination-in'; tc.drawImage(s.mask, 0, 0);
    s.fc.globalAlpha = strength * 0.8; s.fc.drawImage(s.tmp, q.x - s.r, q.y - s.r); s.fc.globalAlpha = 1;
    s.cc.globalAlpha = 0.3; s.cc.drawImage(s.flat, q.x - s.r, q.y - s.r, s.r * 2, s.r * 2, 0, 0, s.r * 2, s.r * 2); s.cc.globalAlpha = 1;
  }
  s.last = p; requestRender();
}
function endSmudge() {
  const s = smudgeLive; smudgeLive = null; if (!s) return;
  state.objects = [newObj({ type: 'bitmap', img: s.flat, x: 0, y: 0, w: W, h: H, alpha: 1, name: 'Smudged art' })]; state.selected = null; changed();
  showToast('Smudge blends your layers into one (Ctrl+Z to undo).');
}

// ---------- keyboard ----------
const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable) && a.type !== 'range'; };
const KEYS = { v: 'select', b: 'brush', e: 'erase', i: 'picker', h: 'pan', g: 'fill', t: 'text', s: 'shapes', m: 'smudge' };
document.addEventListener('keydown', e => {
  if (typing()) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (e.code === 'Space' && state.viewName === 'draw') { if (!spaceDown) { spaceDown = true; fxC.style.cursor = 'grab'; } e.preventDefault(); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
  if (mod || state.viewName !== 'draw') return;
  const o = sel();
  if ((k === 'delete' || k === 'backspace') && o) { e.preventDefault(); deleteSelected(); return; }
  if (k === 'escape') { selectObj(null); return; }
  if (o && k.startsWith('arrow')) {
    e.preventDefault(); const st = e.shiftKey ? 10 : 1; pushUndo();
    moveBy(o, k === 'arrowleft' ? -st : k === 'arrowright' ? st : 0, k === 'arrowup' ? -st : k === 'arrowdown' ? st : 0); changed(); return;
  }
  if (KEYS[k]) selectTool(KEYS[k]);
});
document.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; fxC.style.cursor = CURSORS[effTool()] || 'default'; } });

function deleteSelected() { const o = sel(); if (!o) return; pushUndo(); state.objects = state.objects.filter(q => q !== o); state.selected = null; changed(); }
function duplicateSelected() {
  const o = sel(); if (!o) { showToast('Select something first.'); return; }
  pushUndo(); const c = { ...o, id: state.nextId++, name: o.name + ' copy', _r: null };
  if (c.pts) c.pts = c.pts.map(p => ({ ...p })); if (c.keys) c.keys = c.keys.map(k => ({ ...k }));
  moveBy(c, 24, 24); state.objects.push(c); selectObj(c.id); changed();
}

// ---------- selection panel ----------
const selInputs = { x: $('#selX'), y: $('#selY'), w: $('#selW'), h: $('#selH') };
let sliderUndo = false;
function finishTextColorEdit() { if (sliderUndo) { sliderUndo = false; changed(); } }
function updateSelectionPanel() {
  const o = sel(), on = !!o;
  $('#selName').textContent = on ? o.name : 'Nothing selected';
  Object.values(selInputs).forEach(i => { i.disabled = !on; });
  ['propOpacity', 'propRadius', 'propColor'].forEach(id => { $('#' + id).disabled = !on; });
  if (!on) return;
  const b = bbox(o);
  if (document.activeElement !== selInputs.x) selInputs.x.value = Math.round(b.x);
  if (document.activeElement !== selInputs.y) selInputs.y.value = Math.round(b.y);
  if (document.activeElement !== selInputs.w) selInputs.w.value = Math.round(b.w);
  if (document.activeElement !== selInputs.h) selInputs.h.value = Math.round(b.h);
  $('#propOpacity').value = Math.round((o.alpha == null ? 1 : o.alpha) * 100); $('#propOpacityOut').textContent = $('#propOpacity').value + '%';
  $('#propRadius').value = o.radius || 0; $('#propRadiusOut').textContent = (o.radius || 0) + ' px';
  if (o.color && /^#[0-9a-f]{6}$/i.test(o.color)) $('#propColor').value = o.color.toLowerCase();
}
Object.entries(selInputs).forEach(([key, input]) => input.addEventListener('input', () => {
  const o = sel(); if (!o) return;
  if (!sliderUndo) { pushUndo(); sliderUndo = true; }
  const b = bbox(o), v = Number(input.value); if (Number.isNaN(v)) return;
  const nb = { x: b.x, y: b.y, w: b.w, h: b.h }; nb[key] = v;
  if (key === 'x' || key === 'y') moveBy(o, nb.x - b.x, nb.y - b.y); else setBox(o, nb);
  requestRender(); scheduleSave();
}));
Object.values(selInputs).forEach(i => i.addEventListener('change', () => { sliderUndo = false; changed(); }));
$('#propOpacity').addEventListener('input', e => { const o = sel(); if (!o) return; if (!sliderUndo) { pushUndo(); sliderUndo = true; } o.alpha = Number(e.target.value) / 100; $('#propOpacityOut').textContent = e.target.value + '%'; requestRender(); });
$('#propRadius').addEventListener('input', e => { const o = sel(); if (!o) return; if (!sliderUndo) { pushUndo(); sliderUndo = true; } o.radius = Number(e.target.value); $('#propRadiusOut').textContent = e.target.value + ' px'; requestRender(); });
$('#propColor').addEventListener('input', e => { const o = sel(); if (!o) return; if (!sliderUndo) { pushUndo(); sliderUndo = true; } o.color = e.target.value.toUpperCase(); requestRender(); });
['propOpacity', 'propRadius', 'propColor'].forEach(id => $('#' + id).addEventListener('change', () => { sliderUndo = false; changed(); }));
$('#selDelete').addEventListener('click', deleteSelected);
$('#textDeleteBtn').addEventListener('click', () => {
  const t = sel();
  if (!t || t.type !== 'text') { showToast('Select a text object first.'); return; }
  deleteSelected();
});
$('#selDuplicate').addEventListener('click', duplicateSelected);
$$('#alignGroup .align-btn').forEach(btn => btn.addEventListener('click', () => {
  const o = sel(); if (!o) { showToast('Select something to align.'); return; }
  $$('#alignGroup .align-btn').forEach(b => b.classList.toggle('active', b === btn));
  pushUndo(); const b = bbox(o), a = btn.dataset.align;
  if (a === 'left') moveBy(o, -b.x, 0); else if (a === 'center') moveBy(o, (W - b.w) / 2 - b.x, 0); else if (a === 'right') moveBy(o, W - b.w - b.x, 0); else moveBy(o, 0, (H - b.h) / 2 - b.y);
  changed();
}));

// ==========================================================
// PHOTO-TO-TRACE  (everything on-device: nothing is uploaded)
// ==========================================================
const trace = {
  has: false, detail: 'balanced', levelMode: 'medium', E: null, dtE: null, outlineC: null, regions: [],
  skipped: new Set(), dtM: null, lastScore: null, peekUntil: 0, ghost: null
};
const LEVEL = { easy: { tol: 16, alpha: 0.9 }, medium: { tol: 9, alpha: 0.55 }, hard: { tol: 5, alpha: 0 } };
function level() {
  if (trace.levelMode !== 'auto') return trace.levelMode;
  const g = loadGallery().filter(x => typeof x.score === 'number').slice(0, 3);
  if (!g.length) return 'easy';
  const avg = g.reduce((a, b) => a + b.score, 0) / g.length;
  return avg < 45 ? 'easy' : avg < 70 ? 'medium' : 'hard';
}

// ---------- loading a photo ----------
function setPhoto(src, sw, sh) {
  const s = Math.min(W / sw, H / sh), dw = sw * s, dh = sh * s;
  refX.fillStyle = '#fff'; refX.fillRect(0, 0, W, H); refX.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  trace.has = true; trace.skipped.clear(); trace.ghost = null; trace.lastScore = null; trace.label = null;
  analysePhoto(); updateGhostBar();
}
async function loadPhotoFile(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) { showToast('Please choose an image file (PNG, JPG, WEBP…).'); return; }
  if (file.size > 20 * 1024 * 1024) { showToast('That photo is over 20 MB — try a smaller one.'); return; }
  try {
    const bmp = await createImageBitmap(file);
    setPhoto(bmp, bmp.width, bmp.height);
    showToast('Photo loaded. It stays on your device.');
  } catch (err) { showToast('Could not read that image.'); }
}
$('#uploadBtn').addEventListener('click', () => $('#photoInput').click());
$('#photoInput').addEventListener('change', e => { loadPhotoFile(e.target.files[0]); e.target.value = ''; });

// ---------- built-in sample references (drawn with code, so the demo never needs a file) ----------
const SAMPLES = {
  cat(c) {
    c.fillStyle = '#FFF4D6'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#F4A259';
    c.beginPath(); c.moveTo(330, 200); c.lineTo(300, 50); c.lineTo(450, 130); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(630, 200); c.lineTo(660, 50); c.lineTo(510, 130); c.closePath(); c.fill();
    c.beginPath(); c.arc(480, 310, 195, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2E7D32'; [415, 545].forEach(x => { c.beginPath(); c.arc(x, 290, 34, 0, Math.PI * 2); c.fill(); });
    c.fillStyle = '#F28DA6'; c.beginPath(); c.moveTo(450, 345); c.lineTo(510, 345); c.lineTo(480, 380); c.closePath(); c.fill();
  },
  house(c) {
    c.fillStyle = '#BFEFFF'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#7BC96F'; c.fillRect(0, 440, W, 100);
    c.fillStyle = '#E4572E'; c.fillRect(290, 250, 380, 200);
    c.fillStyle = '#F7CB46'; c.beginPath(); c.moveTo(250, 255); c.lineTo(480, 100); c.lineTo(710, 255); c.closePath(); c.fill();
    c.fillStyle = '#6B4226'; c.fillRect(440, 330, 80, 120);
    c.fillStyle = '#FFFFFF'; c.fillRect(325, 285, 75, 75);
    c.fillStyle = '#FFD23F'; c.beginPath(); c.arc(840, 100, 55, 0, Math.PI * 2); c.fill();
  },
  flower(c) {
    c.fillStyle = '#E8F7E0'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#3C9D3C'; c.fillRect(470, 300, 22, 240);
    c.beginPath(); c.ellipse(560, 420, 70, 28, -0.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#FE90E8';
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5 - Math.PI / 2; c.beginPath(); c.arc(481 + Math.cos(a) * 95, 200 + Math.sin(a) * 95, 62, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#FFD23F'; c.beginPath(); c.arc(481, 200, 58, 0, Math.PI * 2); c.fill();
  }
};
$$('.sample-chip').forEach(chip => chip.addEventListener('click', () => {
  const cv = mk(W, H); SAMPLES[chip.dataset.sample](cv.getContext('2d')); setPhoto(cv, W, H);
  showToast(`Sample “${chip.textContent.trim()}” loaded — start tracing!`);
}));

// ---------- analysis of the photo ----------
function analysePhoto() {
  computeOutline();
  // colour regions -> shape suggestions
  const t = mk(160, 90), tc = t.getContext('2d', { willReadFrequently: true }); tc.drawImage(refC, 0, 0, 160, 90);
  const sc = W / 160;
  trace.regions = Vision.regions(tc.getImageData(0, 0, 160, 90).data, 160, 90).map(r => ({
    type: r.type, x: r.x * sc, y: r.y * sc, w: r.w * sc, h: r.h * sc, color: r.color, key: `${r.type}${r.x}:${r.y}`
  }));
  markSuggestedTiles(); applyShapeFilter(); updateRecipe();
  const p = photoPalette(); if (p.length) applyPalette(p);
  updateTraceUI(); scheduleAnalysis(0);
}
function computeOutline() {
  const t = mk(EW, EH), tc = t.getContext('2d', { willReadFrequently: true }); tc.drawImage(refC, 0, 0, EW, EH);
  const res = Vision.outline(tc.getImageData(0, 0, EW, EH).data, EW, EH, trace.detail);
  trace.E = res.edges; trace.dtE = Vision.chamfer(res.edges, EW, EH);
  const thick = Vision.dilate(res.edges, EW, EH), oc = mk(EW, EH), ox = oc.getContext('2d'), oi = ox.createImageData(EW, EH);
  for (let i = 0; i < thick.length; i++) if (thick[i]) { oi.data[i * 4] = 27; oi.data[i * 4 + 1] = 27; oi.data[i * 4 + 2] = 46; oi.data[i * 4 + 3] = 255; }
  ox.putImageData(oi, 0, 0); trace.outlineC = oc; trace.edgeCount = res.count;
}
function photoPalette() {
  const t = mk(120, 68), tc = t.getContext('2d', { willReadFrequently: true }); tc.drawImage(refC, 0, 0, 120, 68);
  return Vision.palette(tc.getImageData(0, 0, 120, 68).data, 120, 68, 6).map(p => p.hex);
}
function applyPalette(list) {
  $$('.palette-grid').forEach(grid => {
    grid.textContent = '';
    list.forEach((hex, i) => {
      const card = document.createElement('button'); card.className = 'swatch-card' + (i === 0 ? ' selected' : ''); card.dataset.color = hex; card.style.background = hex;
      const L = parseInt(hex.slice(1, 3), 16) * 0.299 + parseInt(hex.slice(3, 5), 16) * 0.587 + parseInt(hex.slice(5, 7), 16) * 0.114;
      if (L < 110) card.classList.add('dark');
      const sp = document.createElement('span'); sp.textContent = hex; card.appendChild(sp); grid.appendChild(card);
    });
  });
  updateColorDisplay(list[0]);
}
function markSuggestedTiles() {
  const types = new Set(trace.regions.slice(0, 4).map(r => r.type));
  $$('.shape-tile').forEach(t => t.classList.toggle('suggested', types.has(t.dataset.shape)));
}

// ---------- controls ----------
$$('[data-detail]').forEach(chip => chip.addEventListener('click', () => {
  $$('[data-detail]').forEach(c => c.classList.toggle('active', c === chip)); trace.detail = chip.dataset.detail;
  if (trace.has) { computeOutline(); scheduleAnalysis(0); requestRender(); showToast(`Outline detail: ${chip.textContent.trim()}`); }
}));
$$('[data-level]').forEach(chip => chip.addEventListener('click', () => {
  $$('[data-level]').forEach(c => c.classList.toggle('active', c === chip)); trace.levelMode = chip.dataset.level;
  const L = level(); showToast(trace.levelMode === 'auto' ? `Adaptive mode picked ${L.toUpperCase()} from your recent scores.` : `${L.toUpperCase()}: ${L === 'hard' ? 'outline hidden — use Peek if you get stuck' : L === 'medium' ? 'faint outline, tighter scoring' : 'bold outline, forgiving scoring'}.`);
  scheduleAnalysis(0); requestRender();
}));
bindRange('refOpacity', 'refOpacityOut', '%', v => { refC.style.opacity = v / 100; });
refC.style.opacity = Number($('#refOpacity').value) / 100;
$('#tgOutline').addEventListener('click', () => requestRender());
$('#peekBtn').addEventListener('click', () => {
  if (!trace.has) { showToast('Load a photo or sample first.'); return; }
  trace.peekUntil = performance.now() + 2500; requestRender(); setTimeout(requestRender, 2600);
});
$('#removePhotoBtn').addEventListener('click', () => {
  refX.clearRect(0, 0, W, H); Object.assign(trace, { has: false, E: null, dtE: null, outlineC: null, regions: [], dtM: null, ghost: null, lastScore: null });
  markSuggestedTiles(); applyShapeFilter(); clearAiOutputs(); updateRecipe(); updateTraceUI(); updateGhostBar(); requestRender(); showToast('Photo removed.');
});
function updateTraceUI() {
  $('#accReadout').textContent = trace.lastScore == null ? '—' : trace.lastScore + '%';
  $('#accBadge').classList.toggle('hidden', !trace.has);
  $('#accBadgeText').textContent = trace.lastScore == null ? 'Tracing accuracy —' : `Tracing accuracy ${trace.lastScore}%`;
  $('#traceInfo').textContent = trace.has
    ? `${trace.regions.length} shape${trace.regions.length === 1 ? '' : 's'} detected · outline ${trace.edgeCount > 0 ? 'ready' : 'empty (try “Detailed”)'}`
    : 'No photo yet? Upload one or try a sample.';
}

// ---------- analysis (debounced): accuracy + composition ----------
let analysisTimer = null;
function scheduleAnalysis(delay = 280) { clearTimeout(analysisTimer); analysisTimer = setTimeout(analyze, delay); }
const smallC = mk(EW, EH), smallX = smallC.getContext('2d', { willReadFrequently: true });
function analyze() {
  smallX.clearRect(0, 0, EW, EH); smallX.drawImage(drawC, 0, 0, EW, EH);
  const d = smallX.getImageData(0, 0, EW, EH).data, M = new Uint8Array(EW * EH), lum = [];
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < M.length; i++) if (d[i * 4 + 3] > 40) {
    M[i] = 1; n++; sx += i % EW; sy += (i / EW) | 0;
    if (n % 6 === 0) lum.push(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
  }
  state._ink = n; state._lum = lum;
  // ---- accuracy against the traced outline ----
  if (trace.E) {
    const res = Vision.accuracy(trace.E, trace.dtE, M, EW, EH, LEVEL[level()].tol / (W / EW));
    trace.dtM = res ? res.dtM : null; trace.lastScore = res ? res.score : null; trace.lastP = res ? res.precision : null; trace.lastR = res ? res.recall : null;
  }
  updateTraceUI();
  // ---- composition ----
  const set = (id, v) => { $('#' + id + 'Bar').style.width = (v == null ? 0 : v) + '%'; $('#' + id + 'Val').textContent = v == null ? '—' : v + '%'; };
  if (n < 60) { set('bal', null); set('con', null); set('ali', null); $('#scoreValue').textContent = '—'; }
  else {
    const dx = (sx / n / EW - 0.5) * 2, dy = (sy / n / EH - 0.5) * 2;
    const balance = Math.round(100 * (1 - clamp(Math.hypot(dx, dy), 0, 1)));
    const mean = lum.reduce((a, b) => a + b, 0) / lum.length, std = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
    const bgL = parseInt(state.bg.slice(1, 3), 16) * 0.299 + parseInt(state.bg.slice(3, 5), 16) * 0.587 + parseInt(state.bg.slice(5, 7), 16) * 0.114;
    const contrast = Math.round(100 * (0.6 * clamp(Math.abs(mean - bgL) / 128, 0, 1) + 0.4 * clamp(std / 64, 0, 1)));
    const shapes = state.objects.filter(o => !o.hidden && !o.erase && o.type !== 'stroke' && o.type !== 'bitmap');
    let align = null;
    if (shapes.length) {
      const cs = shapes.map(o => { const b = bbox(o); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; });
      const ok = cs.filter((c, i) => Math.abs(c.x - W / 2) < 8 || Math.abs(c.y - H / 2) < 8 || cs.some((q, j) => j !== i && (Math.abs(q.x - c.x) < 8 || Math.abs(q.y - c.y) < 8))).length;
      align = Math.round(100 * ok / cs.length);
    }
    set('bal', balance); set('con', contrast); set('ali', align);
    const parts = [balance, contrast, align].filter(v => v != null);
    $('#scoreValue').textContent = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) + '%';
  }
  if (state.viewName === 'ai') studioMetrics();
}

// ---------- next-shape suggestion (ghost) ----------
const ghostBar = $('#ghostBar');
function updateGhostBar() {
  const g = trace.ghost; ghostBar.classList.toggle('hidden', !g);
  if (g) {
    $('#ghostLabel').textContent = g.areaHint ? `Trace the pink line on the ${g.label}` : `Next: ${SHAPE_LABEL[g.type] || g.type}`;
    $('#ghostAccept').textContent = g.areaHint ? 'Done' : 'Accept';
  } else $('#ghostAccept').textContent = 'Accept';
  requestRender();
}
function suggestNext() {
  state.assist && selectTool('brush', { assist: true });
  if (trace.has && trace.E && trace.edgeCount) {
    const cols = 3, rows = 3, cells = Array.from({ length: cols * rows }, () => []);
    const tol = LEVEL[level()].tol / (W / EW);
    for (let i = 0; i < trace.E.length; i++) {
      if (!trace.E[i] || (trace.dtM && trace.dtM[i] <= tol)) continue;
      const x = i % EW, y = (i / EW) | 0;
      const col = clamp(Math.floor(x / EW * cols), 0, cols - 1), row = clamp(Math.floor(y / EH * rows), 0, rows - 1);
      cells[row * cols + col].push({ x: (x + 0.5) * W / EW, y: (y + 0.5) * H / EH });
    }
    const names = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
    const best = cells.map((points, i) => ({ points, i, key: `outline-${i}` })).filter(cell => !trace.skipped.has(cell.key)).sort((a, b) => b.points.length - a.points.length)[0];
    if (!best || best.points.length < 4) { trace.ghost = null; updateGhostBar(); showToast('The outline is covered closely enough. Check your accuracy score or choose another area.'); return; }
    trace.ghost = { areaHint: true, points: best.points.slice(0, 4000), label: names[best.i], key: best.key };
    showToast(`Follow the pink line on the ${names[best.i]}.`);
  } else if (!trace.has) {
    // no photo: suggest a shape in the emptiest part of the canvas
    const cells = Array.from({ length: 9 }, () => 0);
    state.objects.forEach(o => { if (o.hidden || o.erase) return; const b = bbox(o); cells[clamp(Math.floor((b.y + b.h / 2) / H * 3), 0, 2) * 3 + clamp(Math.floor((b.x + b.w / 2) / W * 3), 0, 2)]++; });
    const empty = cells.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || Math.abs(a.i - 4) - Math.abs(b.i - 4))[0].i;
    const used = new Set(state.objects.map(o => o.type)), pool = ['circle', 'triangle', 'star', 'rect', 'heart', 'cloud', 'diamond'];
    const type = state.objects.length ? (pool.find(t => !used.has(t)) || 'circle') : 'circle', big = !state.objects.length;
    const w = big ? 300 : 150, h = big ? 300 : 150, cx = (empty % 3 + 0.5) * W / 3, cy = (Math.floor(empty / 3) + 0.5) * H / 3;
    trace.ghost = { type, x: cx - w / 2, y: cy - h / 2, w, h, color: state.color, key: 'free' };
    showToast(big ? 'Start with a big body shape — then add details around it.' : `Add a ${SHAPE_LABEL[type].toLowerCase()} in the empty area.`);
  } else {
    trace.ghost = null; updateGhostBar(); showToast('No clear outline was detected. Try a simpler photo or increase outline detail.'); return;
  }
  updateGhostBar();
}
$('#suggestNextBtn').addEventListener('click', suggestNext);
$('#ghostAccept').addEventListener('click', () => {
  const g = trace.ghost; if (!g) return;
  if (g.areaHint) { trace.skipped.add(g.key); trace.ghost = null; suggestNext(); return; }
  pushUndo(); const o = makeShape(g.type, g, g.key === 'free' ? state.color : g.color); state.objects.push(o);
  trace.ghost = null; selectObj(o.id); updateGhostBar(); changed(); showToast(`${o.name} placed. Fine-tune it with Select.`);
});
$('#ghostSkip').addEventListener('click', () => { if (trace.ghost) trace.skipped.add(trace.ghost.key); trace.ghost = null; suggestNext(); });

// ---------- other AI-assist buttons ----------
function harmony(hex) {
  const { h, s, v } = hexToHsv(hex), S = Math.max(s, 45), V = Math.max(v, 70);
  return [hex, hsvToHex(h + 180, S, V), hsvToHex(h + 30, S, V), hsvToHex(h - 30, S, V), hsvToHex(h + 120, S, V), hsvToHex(h, 25, 100)];
}
$('#autoPaletteBtn').addEventListener('click', () => {
  if (trace.has) { applyPalette(photoPalette()); showToast('Palette picked from your photo.'); }
  else { applyPalette(harmony(state.color)); showToast('Harmonious palette built from your current colour.'); }
});
$('#cleanLinesBtn').addEventListener('click', () => {
  const strokes = state.objects.filter(o => o.type === 'stroke' && !o.erase && o.pts.length > 4);
  if (!strokes.length) { showToast('Draw some freehand lines first.'); return; }
  pushUndo(); strokes.forEach(o => { o.pts = smoothPts(o.pts); o._r = null; }); changed(); showToast(`Smoothed ${strokes.length} line${strokes.length > 1 ? 's' : ''}.`);
});
$('#suggestSizeBtn').addEventListener('click', () => {
  let size;
  if (trace.regions.length) { const m = trace.regions.reduce((a, r) => a + Math.min(r.w, r.h), 0) / trace.regions.length; size = clamp(Math.round(m / 14), 3, 40); }
  else size = clamp(Math.round(10 / state.view.z), 2, 40);
  state.size = size; dockSize.value = size; $('#dockSizeVal').textContent = size;
  showToast(trace.regions.length ? `${size}px suits the shapes in your photo.` : `${size}px works well at this zoom. Upload a photo for a smarter suggestion.`);
});
$('#captionBtn').addEventListener('click', () => {
  const lines = ['My brick-built buddy!', 'Made with DoodleBrick', 'Shape by shape ✦', 'Doodle of the day', 'Built, not drawn!', 'Tiny shapes, big ideas'];
  pushUndo(); const v = lines[Math.floor(Math.random() * lines.length)];
  const o = newObj({ type: 'text', text: v, x: 0, y: H - 70, size: 30, color: state.color, name: `Text “${v.slice(0, 14)}”` }); measureText(o); o.x = (W - o.w) / 2;
  state.objects.push(o); selectObj(o.id); changed();
});
$('#openAnimBtn').addEventListener('click', () => setView('animate'));
$('#kfAddBtn').addEventListener('click', () => {
  const o = sel() || [...state.objects].reverse().find(q => !q.erase);
  if (!o) { showToast('Draw or select something first.'); return; }
  setView('animate'); pushUndo(); addKey(o, anim.t); changed(); showToast(`Keyframe added to ${o.name}.`);
});
$('#playPreviewBtn').addEventListener('click', () => { setView('animate'); setT(0); startPlay(); });

// ==========================================================
// VIEW SWITCHING
// ==========================================================
function setView(name) {
  state.viewName = name;
  $$('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
  if (name === 'animate') { renderTimeline(); setT(anim.t); }
  if (name === 'ai') renderStudio();
  if (name === 'draw') requestRender();
  if (name !== 'animate') stopPlay();
}
$$('.mode-btn').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));

// ==========================================================
// LAYERS  (every object on the canvas is a layer)
// ==========================================================
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/><path class="eye-slash" d="m4 20 16-16"/></svg>';
function renderLayers() {
  const list = $('#layerList'); list.textContent = '';
  const items = [...state.objects].reverse();
  if (!items.length) { const p = document.createElement('p'); p.className = 'hint-text'; p.textContent = 'No layers yet. Draw a stroke or drop a shape and it will appear here.'; list.appendChild(p); return; }
  items.forEach(o => {
    const row = document.createElement('div'); row.className = 'layer-row' + (o.id === state.selected ? ' selected' : ''); row.dataset.id = o.id; row.tabIndex = 0;
    const eye = document.createElement('button'); eye.className = 'eye' + (o.hidden ? ' off' : ''); eye.innerHTML = EYE; eye.title = o.hidden ? 'Show layer' : 'Hide layer'; eye.setAttribute('aria-label', eye.title);
    eye.addEventListener('click', ev => { ev.stopPropagation(); pushUndo(); o.hidden = !o.hidden; changed(); });
    const name = document.createElement('span'); name.className = 'lname'; name.textContent = o.name + (o.keys && o.keys.length ? ' ◆' : ''); name.title = 'Double-click to rename';
    name.addEventListener('dblclick', ev => { ev.stopPropagation(); const v = prompt('Layer name', o.name); if (v && v.trim()) { pushUndo(); o.name = v.trim().slice(0, 40); changed(); } });
    const btns = document.createElement('span'); btns.className = 'lbtns';
    const mkBtn = (txt, title, fn) => { const b = document.createElement('button'); b.className = 'lbtn'; b.textContent = txt; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', ev => { ev.stopPropagation(); fn(); }); return b; };
    btns.append(
      mkBtn('▲', 'Bring forward', () => moveLayer(o, 1)),
      mkBtn('▼', 'Send backward', () => moveLayer(o, -1)),
      mkBtn('✕', 'Delete layer', () => { pushUndo(); state.objects = state.objects.filter(q => q !== o); fixSelection(); changed(); })
    );
    row.append(eye, name, btns);
    row.addEventListener('click', () => { if (o.erase) { showToast('Eraser strokes cut through the layers below them.'); return; } selectObj(o.id); selectTool('select', { keepView: true }); });
    list.appendChild(row);
  });
}
function renderLayersSelection() {
  $$('#layerList .layer-row').forEach(r => {
    const on = Number(r.dataset.id) === state.selected; r.classList.toggle('selected', on);
    if (on) r.scrollIntoView({ block: 'nearest' });
  });
}
function moveLayer(o, dir) {
  const i = state.objects.indexOf(o), j = i + dir; if (j < 0 || j >= state.objects.length) return;
  pushUndo(); state.objects.splice(i, 1); state.objects.splice(j, 0, o); changed();
}
function colorName(hex) {
  const { h, s, v } = hexToHsv(hex);
  if (s < 14 || v < 18) return v < 25 ? 'Black' : v > 88 ? 'White' : 'Gray';
  if (v < 45 && h > 10 && h < 50) return 'Brown';
  const names = [[15, 'Red'], [45, 'Orange'], [70, 'Yellow'], [165, 'Green'], [200, 'Teal'], [260, 'Blue'], [290, 'Purple'], [335, 'Pink'], [361, 'Red']];
  return names.find(n => h < n[0])[1];
}
function strokeKind(o) {
  const p = o.pts; if (p.length < 3) return 'dot';
  const r = rawBounds(o), diag = Math.hypot(r.w, r.h) || 1, gap = Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y);
  let len = 0; for (let i = 1; i < p.length; i++) len += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  if (gap < diag * 0.3 && len > diag * 1.8) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = p.map(q => Math.hypot(q.x - cx, q.y - cy)), m = rad.reduce((a, b) => a + b, 0) / rad.length;
    const sd = Math.sqrt(rad.reduce((a, b) => a + (b - m) ** 2, 0) / rad.length);
    return sd / m < 0.2 ? 'circle' : 'loop';
  }
  return gap / len > 0.85 ? 'line' : 'squiggle';
}
$('#autoNameBtn').addEventListener('click', () => {
  if (!state.objects.length) { showToast('Nothing to name yet.'); return; }
  pushUndo(); const used = {};
  state.objects.forEach(o => {
    if (o.erase) { o.name = 'Eraser'; return; }
    const kind = o.type === 'stroke' ? strokeKind(o) : o.type === 'bitmap' ? 'fill' : o.type === 'text' ? 'text' : (SHAPE_LABEL[o.type] || o.type).toLowerCase();
    const base = `${colorName(o.color || '#888888')} ${kind}`; used[base] = (used[base] || 0) + 1; o.name = base + (used[base] > 1 ? ' ' + used[base] : '');
  });
  changed(); showToast('Layers named from their colour and shape.');
});

// ==========================================================
// ANIMATION  (keyframes live on each layer: o.keys = [{t,dx,dy,s,r}])
// ==========================================================
const DUR = 4;
const anim = { t: 0, playing: false, last: 0, raf: 0, sel: null, recording: false, onEnd: null };
const animC = $('#animCanvas'), ax = animC.getContext('2d'), animLayer = mk(W, H), alx = animLayer.getContext('2d');
animC.width = W; animC.height = H;
const IDENT = { dx: 0, dy: 0, s: 1, r: 0 };
function poseAt(o, t) {
  const ks = (o.keys || []).slice().sort((a, b) => a.t - b.t); if (!ks.length) return null;
  const arr = []; if (ks[0].t > 0) arr.push({ ...IDENT, t: 0 }); arr.push(...ks); if (arr[arr.length - 1].t < 1) arr.push({ ...IDENT, t: 1 });
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i], b = arr[i + 1];
    if (t <= b.t) { const u = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t), e = u * u * (3 - 2 * u), L = (x, y) => x + (y - x) * e; return { dx: L(a.dx, b.dx), dy: L(a.dy, b.dy), s: L(a.s, b.s), r: L(a.r, b.r) }; }
  }
  const l = arr[arr.length - 1]; return { dx: l.dx, dy: l.dy, s: l.s, r: l.r };
}
function renderAnim() {
  alx.clearRect(0, 0, W, H);
  state.objects.forEach(o => drawObject(alx, o, o.keys && o.keys.length ? poseAt(o, anim.t) : null));
  ax.fillStyle = state.bg; ax.fillRect(0, 0, W, H); ax.drawImage(animLayer, 0, 0);
}
function addKey(o, t) {
  const p = poseAt(o, t) || IDENT, k = { t: Math.round(clamp(t, 0, 1) * 1000) / 1000, dx: p.dx, dy: p.dy, s: p.s, r: p.r };
  o.keys = [...(o.keys || []), k].sort((a, b) => a.t - b.t); anim.sel = { id: o.id, i: o.keys.indexOf(k) }; return k;
}
const fmtTime = t => { const s = t * DUR; return `00:0${Math.floor(s)}.${String(Math.floor((s % 1) * 10))} / 00:0${DUR}`; };
function setT(t) {
  anim.t = clamp(t, 0, 1); $$('.lane-head').forEach(h => { h.style.left = anim.t * 100 + '%'; });
  $('#playbackTime').textContent = fmtTime(anim.t); renderAnim();
}
function startPlay() {
  if (anim.playing) return; if (anim.t >= 1) setT(0);
  anim.playing = true; anim.last = performance.now(); $('#playBtn').classList.add('playing'); $('#playBtn').setAttribute('aria-label', 'Pause');
  anim.raf = requestAnimationFrame(playTick);
}
function stopPlay() { anim.playing = false; cancelAnimationFrame(anim.raf); const b = $('#playBtn'); if (b) { b.classList.remove('playing'); b.setAttribute('aria-label', 'Play'); } }
function playTick(ts) {
  if (!anim.playing) return;
  const dt = (ts - anim.last) / 1000; anim.last = ts; let t = anim.t + dt / DUR;
  if (t >= 1) {
    if (isOn('tgLoop') && !anim.recording) t = t % 1;
    else { setT(1); stopPlay(); if (anim.onEnd) { const f = anim.onEnd; anim.onEnd = null; f(); } return; }
  }
  setT(t); anim.raf = requestAnimationFrame(playTick);
}
$('#playBtn').addEventListener('click', () => anim.playing ? stopPlay() : startPlay());

function renderTimeline() {
  const wrap = $('#timelineTracks'); wrap.textContent = '';
  const scrub = document.createElement('div'); scrub.className = 'track-row';
  const sl = document.createElement('div'); sl.className = 'track-label'; sl.textContent = 'Playhead';
  const sLane = document.createElement('div'); sLane.className = 'track-lane scrub';
  for (let i = 0; i <= DUR; i++) { const tk = document.createElement('span'); tk.className = 'tick'; tk.style.left = i / DUR * 100 + '%'; tk.textContent = i + 's'; sLane.appendChild(tk); }
  const sh = document.createElement('div'); sh.className = 'lane-head main'; sLane.appendChild(sh); scrub.append(sl, sLane); wrap.appendChild(scrub);
  sLane.addEventListener('pointerdown', e => {
    sLane.setPointerCapture(e.pointerId); stopPlay();
    const mv = ev => { const r = sLane.getBoundingClientRect(); setT((ev.clientX - r.left) / r.width); };
    mv(e); sLane.onpointermove = mv; sLane.onpointerup = () => { sLane.onpointermove = null; };
  });
  const objs = [...state.objects].reverse().filter(o => !o.erase).slice(0, 8);
  if (!objs.length) { const p = document.createElement('p'); p.className = 'hint-text'; p.textContent = 'Draw something on the canvas first — each layer becomes a track you can animate.'; wrap.appendChild(p); }
  objs.forEach(o => {
    const row = document.createElement('div'); row.className = 'track-row';
    const lab = document.createElement('div'); lab.className = 'track-label' + (o.id === state.selected ? ' sel' : ''); lab.textContent = o.name; lab.title = o.name;
    lab.addEventListener('click', () => { selectObj(o.id); renderTimeline(); });
    const lane = document.createElement('div'); lane.className = 'track-lane'; lane.dataset.id = o.id; lane.title = 'Click to add a keyframe';
    (o.keys || []).forEach((k, i) => {
      const kf = document.createElement('div'); kf.className = 'keyframe' + (anim.sel && anim.sel.id === o.id && anim.sel.i === i ? ' sel' : ''); kf.style.left = k.t * 100 + '%'; kf.dataset.i = i;
      kf.style.background = ['var(--pink)', 'var(--gold)', 'var(--green)', 'var(--mint)'][o.id % 4]; kf.title = `${(k.t * DUR).toFixed(1)}s — drag to retime`;
      lane.appendChild(kf);
    });
    const head = document.createElement('div'); head.className = 'lane-head'; lane.appendChild(head);
    lane.addEventListener('pointerdown', e => laneDown(e, o, lane));
    row.append(lab, lane); wrap.appendChild(row);
  });
  $$('.lane-head').forEach(h => { h.style.left = anim.t * 100 + '%'; });
  updateKeyEditor();
}
function laneDown(e, o, lane) {
  const kf = e.target.closest('.keyframe'), r = lane.getBoundingClientRect();
  if (kf) {
    const i = Number(kf.dataset.i); anim.sel = { id: o.id, i }; selectObj(o.id); pushUndo();
    const key = o.keys[i]; lane.setPointerCapture(e.pointerId); let moved = false, nt = key.t;
    $$('.keyframe.sel').forEach(k => k.classList.remove('sel')); kf.classList.add('sel'); updateKeyEditor();
    lane.onpointermove = ev => {
      moved = true; nt = Math.round(clamp((ev.clientX - r.left) / r.width, 0, 1) * 100) / 100;
      kf.style.left = nt * 100 + '%'; setT(nt);
    };
    lane.onpointerup = () => {
      lane.onpointermove = null; lane.onpointerup = null;
      if (!moved) { undoStack.pop(); return; }
      const moved2 = { ...key, t: nt };
      o.keys = o.keys.map(k => k === key ? moved2 : k).sort((a, b) => a.t - b.t); anim.sel = { id: o.id, i: o.keys.indexOf(moved2) }; changed();
    };
    return;
  }
  stopPlay(); pushUndo(); selectObj(o.id);
  addKey(o, clamp((e.clientX - r.left) / r.width, 0, 1)); setT(o.keys[anim.sel.i].t); changed();
}
function selKey() { const s = anim.sel; if (!s) return null; const o = state.objects.find(q => q.id === s.id); return o && o.keys && o.keys[s.i] ? { o, k: o.keys[s.i] } : null; }
const KF = { kfX: 'dx', kfY: 'dy', kfS: 's', kfR: 'r' };
function updateKeyEditor() {
  const s = selKey(), box = $('#kfEditor'); box.classList.toggle('disabled', !s);
  $('#kfHint').textContent = s ? `Editing ${s.o.name} @ ${(s.k.t * DUR).toFixed(1)}s` : 'Click a lane to add a keyframe · drag ◆ to retime · select one to edit it';
  Object.entries(KF).forEach(([id, prop]) => { const inp = $('#' + id); inp.disabled = !s; if (s) { inp.value = prop === 's' ? Math.round(s.k.s * 100) : Math.round(s.k[prop]); $('#' + id + 'Out').textContent = inp.value + (prop === 's' ? '%' : prop === 'r' ? '°' : ''); } });
}
let kfUndo = false;
Object.entries(KF).forEach(([id, prop]) => {
  const inp = $('#' + id);
  inp.addEventListener('input', () => {
    const s = selKey(); if (!s) return; if (!kfUndo) { pushUndo(); kfUndo = true; }
    const v = prop === 's' ? Number(inp.value) / 100 : Number(inp.value); const idx = anim.sel.i;
    s.o.keys = s.o.keys.map((k, i) => i === idx ? { ...k, [prop]: v } : k); $('#' + id + 'Out').textContent = inp.value + (prop === 's' ? '%' : prop === 'r' ? '°' : '');
    setT(s.k.t); scheduleSave();
  });
  inp.addEventListener('change', () => { kfUndo = false; changed(); });
});
$('#kfDelete').addEventListener('click', () => {
  const s = selKey(); if (!s) return; pushUndo(); const idx = anim.sel.i; s.o.keys = s.o.keys.filter((_, i) => i !== idx); anim.sel = null; changed(); renderAnim();
});
$('#clearKeysBtn').addEventListener('click', () => {
  const o = sel(); if (!o || !o.keys || !o.keys.length) { showToast('Select a layer that has keyframes.'); return; }
  pushUndo(); o.keys = []; anim.sel = null; changed(); renderAnim();
});
const PRESETS = {
  bob: [[0.25, { dy: -26 }], [0.5, {}], [0.75, { dy: -26 }]], spin: [[0.5, { r: 180 }], [1, { r: 360 }]], pulse: [[0.25, { s: 1.18 }], [0.5, {}], [0.75, { s: 1.18 }]],
  wiggle: [[0.125, { r: 9 }], [0.375, { r: -9 }], [0.625, { r: 9 }], [0.875, { r: -9 }]], drift: [[0.5, { dx: 46 }]]
};
const PRESET_FOR = { circle: 'bob', ellipse: 'bob', heart: 'bob', semicircle: 'bob', star: 'spin', square: 'pulse', rect: 'pulse', rounded: 'pulse', text: 'pulse', triangle: 'wiggle', diamond: 'wiggle', hexagon: 'spin', cloud: 'drift', stroke: 'wiggle', bitmap: 'pulse' };
function suggestAnim() {
  const o = sel() || [...state.objects].reverse().find(q => !q.erase);
  if (!o) { showToast('Draw something first, then I can suggest a motion.'); return; }
  const name = PRESET_FOR[o.type] || (LINE_TYPES.has(o.type) ? 'wiggle' : 'bob');
  pushUndo(); o.keys = PRESETS[name].map(([t, v]) => ({ t, ...IDENT, ...v })); anim.sel = { id: o.id, i: 0 }; selectObj(o.id);
  changed(); setView('animate'); setT(0); startPlay();
  showToast(`Suggested a ${name} loop for ${o.name}. Tweak the keyframes!`);
}
$('#suggestAnimBtn').addEventListener('click', suggestAnim);
$('#suggestAnimBtn2').addEventListener('click', suggestAnim);
$('#exportVideoBtn').addEventListener('click', () => {
  if (!window.MediaRecorder || !animC.captureStream) { showToast('Video export is not supported in this browser — try Chrome or Edge.'); return; }
  stopPlay(); setT(0);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(animC.captureStream(30), mime ? { mimeType: mime, videoBitsPerSecond: 4e6 } : undefined), chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => { download(new Blob(chunks, { type: 'video/webm' }), `${fileName()}.webm`); anim.recording = false; showToast('Animation exported as WebM video.'); };
  anim.recording = true; rec.start(); showToast('Recording one loop…');
  anim.onEnd = () => setTimeout(() => rec.stop(), 250); startPlay();
});

// ==========================================================
// AI STUDIO  — style filters (pure canvas maths, no API)
// ==========================================================
const studio = { style: 'Cartoon', seed: 1, last: null, busy: false };
const composite = () => { const c = mk(W, H), x = c.getContext('2d'); x.fillStyle = state.bg; x.fillRect(0, 0, W, H); x.drawImage(drawC, 0, 0); return c; };
function renderStudio() {
  studio.mode = 'local';
  $$('.style-chip').forEach(c => c.classList.toggle('active', c.dataset.style === studio.style));
  const bC = $('#studioBefore'), aC = $('#studioAfter'), bx = bC.getContext('2d'), aX = aC.getContext('2d');
  let src = null;
  if (state._ink > 20) src = composite(); else if (trace.has) { src = mk(W, H); src.getContext('2d').drawImage(refC, 0, 0); }
  $('#afterTag').textContent = `After · ${studio.style}`;
  if (!src) {
    [bx, aX].forEach(x => { x.fillStyle = '#f1efe6'; x.fillRect(0, 0, W, H); x.fillStyle = '#555'; x.font = `600 34px ${FONT}`; x.textAlign = 'center'; x.fillText('Draw something or load a photo,', W / 2, H / 2 - 10); x.fillText('then pick a style.', W / 2, H / 2 + 36); });
    studio.last = null; studioMetrics(); return;
  }
  bx.drawImage(src, 0, 0); $('#studioNote').textContent = 'Applying style…';
  setTimeout(() => {
    const id = src.getContext('2d').getImageData(0, 0, W, H), out = Vision.stylize(studio.style, id.data, W, H, studio.seed);
    const res = new ImageData(out, W, H); aX.putImageData(res, 0, 0); studio.last = res;
    $('#studioNote').textContent = `${studio.style} filter applied on your device. “Apply finish” replaces your layers with this look (Ctrl+Z undoes it).`;
  }, 30);
  studioMetrics();
}
$$('.style-chip').forEach(chip => chip.addEventListener('click', () => { studio.style = chip.dataset.style; studio.seed = 1; setView('ai'); }));
$('#regenBtn').addEventListener('click', () => { studio.seed++; renderStudio(); });
$('#revertBtn').addEventListener('click', () => { if (undoStack.length) undo(); else showToast('Nothing to revert.'); renderStudio(); });
$('#applyBtn').addEventListener('click', () => {
  if (!studio.last) { showToast('Nothing to apply yet.'); return; }
  const cv = mk(W, H); cv.getContext('2d').putImageData(studio.last, 0, 0);
  pushUndo(); state.objects = [newObj({ type: 'bitmap', img: cv, x: 0, y: 0, w: W, h: H, alpha: 1, name: `${studio.mode === 'ai' ? 'AI ' : ''}${studio.style} finish` })]; state.selected = null;
  changed(); showToast(`${studio.style} finish applied to the canvas. Use Revert to go back.`);
});
function studioMetrics() {
  const set = (id, v) => { $('#' + id).textContent = v == null ? '—' : v + '%'; };
  // line quality: how smooth freehand strokes are (low turning angle between segments)
  const strokes = state.objects.filter(o => o.type === 'stroke' && !o.erase && !o.hidden && o.pts.length > 5);
  let line = null;
  if (strokes.length) {
    let tot = 0, n = 0;
    strokes.forEach(o => { for (let i = 2; i < o.pts.length; i++) { const a = o.pts[i - 2], b = o.pts[i - 1], c = o.pts[i]; let d = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)); if (d > Math.PI) d = 2 * Math.PI - d; tot += d; n++; } });
    line = Math.round(100 * (1 - clamp(tot / n / 0.9, 0, 1)));
  } else if (state.objects.some(o => !o.erase && o.type !== 'bitmap')) line = 100;
  // colour harmony: share of colour pairs that are not clashing
  const hs = state.objects.filter(o => !o.erase && !o.hidden && o.color).map(o => hexToHsv(o.color)).filter(c => c.s > 20 && c.v > 25).map(c => c.h);
  let harmony = null;
  if (hs.length) {
    if (hs.length === 1) harmony = 100; else { let bad = 0, n = 0; for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) { let d = Math.abs(hs[i] - hs[j]); if (d > 180) d = 360 - d; n++; if (d > 60 && d < 150) bad++; } harmony = Math.round(100 - 70 * bad / n); }
  }
  // shading: spread of brightness among painted pixels
  let shade = null; const L = state._lum.slice().sort((a, b) => a - b);
  if (L.length > 30) shade = Math.round(clamp((L[Math.floor(L.length * 0.95)] - L[Math.floor(L.length * 0.05)]) / 200, 0, 1) * 100);
  set('qLine', line); set('qHarmony', harmony); set('qShade', shade);
}

// ==========================================================
// PIXEL BUILDER
// ==========================================================
const pix = { n: 16, data: [], color: '#FE90E8', hist: [], painting: false };
const pixelGrid = $('#pixelGrid');
const pixelCustomButton = $('#pixelCustom');
const pixelCustomPopover = $('#pixelCustomControls');
function syncPixelCustomColor(color) {
  if (!pixelCustomButton) return;
  const safeColor = normalizeHex(color) || color;
  pixelCustomButton.dataset.pcolor = safeColor;
  pixelCustomButton.style.setProperty('--sw', safeColor);
  const label = pixelCustomButton.querySelector('span:last-child');
  if (label && safeColor !== 'transparent') label.textContent = 'Custom';
  pix.color = safeColor;
}
function buildPixelGrid(n) {
  pix.n = n; pix.data = new Array(n * n).fill(null); pix.hist = [];
  pixelGrid.style.setProperty('--n', n); pixelGrid.style.aspectRatio = '2 / 1'; pixelGrid.textContent = '';
  for (let i = 0; i < n * n; i++) { const c = document.createElement('div'); c.className = 'pixel-cell'; c.dataset.i = i; pixelGrid.appendChild(c); }
}
function paintCell(cell) {
  if (!cell || !cell.classList.contains('pixel-cell')) return;
  const i = Number(cell.dataset.i), v = pix.color === 'transparent' ? null : pix.color;
  if (pix.data[i] === v) return; pix.data[i] = v; cell.style.background = v || '';
}
pixelGrid.style.touchAction = 'none';
pixelGrid.addEventListener('pointerdown', e => { e.preventDefault(); pix.painting = true; pix.hist.push(pix.data.slice()); if (pix.hist.length > 40) pix.hist.shift(); paintCell(e.target); });
pixelGrid.addEventListener('pointermove', e => { if (pix.painting) paintCell(document.elementFromPoint(e.clientX, e.clientY)); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => pixelGrid.addEventListener(ev, () => { pix.painting = false; }));
function refreshPixelCells() { $$('.pixel-cell', pixelGrid).forEach((c, i) => { c.style.background = pix.data[i] || ''; }); }
$$('.pixel-color-tool').forEach(btn => btn.addEventListener('click', () => {
  $$('.pixel-color-tool').forEach(b => { b.classList.toggle('active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
  if (btn === pixelCustomButton) {
    const color = normalizeHex(currentPickedColor) || currentPickedColor;
    syncPixelCustomColor(color);
  } else {
    if (pixelCustomPopover) {
      pixelCustomButton.setAttribute('aria-expanded', 'false');
      pixelCustomPopover.classList.add('hidden');
    }
    pix.color = btn.dataset.pcolor;
  }
}));
$('#pixelUseColor').addEventListener('click', () => {
  syncPixelCustomColor(state.color);
  $$('.pixel-color-tool').forEach(x => { x.classList.toggle('active', x === pixelCustomButton); x.setAttribute('aria-pressed', String(x === pixelCustomButton)); });
  showToast(`Pixel brush set to ${state.color}.`);
});
$$('[data-psize]').forEach(chip => chip.addEventListener('click', () => {
  $$('[data-psize]').forEach(c => c.classList.toggle('active', c === chip)); buildPixelGrid(Number(chip.dataset.psize));
}));
$('#pixelClear').addEventListener('click', () => { pix.hist.push(pix.data.slice()); pix.data.fill(null); refreshPixelCells(); showToast('Grid cleared.'); });
$('#pixelUndo').addEventListener('click', () => { const h = pix.hist.pop(); if (!h) { showToast('Nothing to undo.'); return; } pix.data = h; refreshPixelCells(); });
$('#pixelSend').addEventListener('click', () => {
  if (!pix.data.some(Boolean)) { showToast('Paint some pixels first.'); return; }
  const cv = mk(pix.n, pix.n), c = cv.getContext('2d');
  pix.data.forEach((col, i) => { if (col) { c.fillStyle = col; c.fillRect(i % pix.n, (i / pix.n) | 0, 1, 1); } });
  pushUndo(); const s = 340;
  const o = newObj({ type: 'bitmap', img: cv, x: (W - s) / 2, y: (H - s) / 2, w: s, h: s, alpha: 1, pixelated: true, name: nextName('Pixel art') });
  state.objects.push(o); selectObj(o.id); changed(); setView('draw'); selectTool('select'); showToast('Pixel art sent to the canvas — move and resize it!');
});

// ==========================================================
// SAVE · LOAD · EXPORT · GALLERY
// ==========================================================
const AKEY = 'doodlebrick:autosave:v1', GKEY = 'doodlebrick:gallery:v1';
const fileName = () => (state.title || 'doodlebrick').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'doodlebrick';
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
function serialize() {
  return JSON.stringify({
    title: state.title, bg: state.bg, nextId: state.nextId,
    objects: state.objects.map(o => { const c = { ...o }; delete c._r; if (c.type === 'bitmap') c.img = o.img.toDataURL('image/png'); return c; })
  });
}
function deserialize(json) {
  return new Promise(resolve => {
    const data = JSON.parse(json); let pending = 0; const objs = data.objects || [];
    objs.forEach(o => { if (o.type === 'bitmap' && typeof o.img === 'string') { pending++; const im = new Image(); im.onload = () => { const cv = mk(im.width, im.height); cv.getContext('2d').drawImage(im, 0, 0); o.img = cv; if (!--pending) fin(); }; im.onerror = () => { o.hidden = true; o.img = mk(1, 1); if (!--pending) fin(); }; im.src = o.img; } });
    const fin = () => { state.objects = objs; state.title = data.title || 'Untitled canvas'; state.bg = data.bg || '#FFFFFF'; state.nextId = Math.max(data.nextId || 1, ...objs.map(o => o.id + 1), 1); state.selected = null; $('#projTitle').textContent = state.title; applyBg(); resolve(); };
    if (!pending) fin();
  });
}
let saveTimer = null;
function setSaveTag(t, bad) { const el = $('#saveTag'); el.textContent = t; el.classList.toggle('warn', !!bad); }
function scheduleSave() { setSaveTag('Saving…'); clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(AKEY, serialize()); setSaveTag('Saved'); } catch (e) { setSaveTag('Not saved', true); } }, 800); }
function loadGallery() { try { return JSON.parse(localStorage.getItem(GKEY)) || []; } catch (e) { return []; } }
function saveGalleryList(list) { try { localStorage.setItem(GKEY, JSON.stringify(list)); return true; } catch (e) { return false; } }

function exportPng() {
  composite().toBlob(b => { download(b, `${fileName()}.png`); showToast(`Exported ${fileName()}.png`); }, 'image/png');
}
$$('.hbtn[data-action]').forEach(btn => btn.addEventListener('click', () => {
  const a = btn.dataset.action; if (a === 'undo') undo(); else if (a === 'redo') redo(); else if (a === 'export') exportPng();
}));

$('#projTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } e.stopPropagation(); });
$('#projTitle').addEventListener('blur', e => { state.title = e.target.textContent.trim().slice(0, 40) || 'Untitled canvas'; e.target.textContent = state.title; scheduleSave(); });

// gallery popover
const galleryBtn = $('#galleryBtn'), galleryPop = $('#galleryPop');
galleryBtn.addEventListener('click', e => { e.stopPropagation(); galleryPop.classList.toggle('open'); if (galleryPop.classList.contains('open')) renderGallery(); });
document.addEventListener('click', e => { if (!galleryPop.contains(e.target) && e.target !== galleryBtn && !galleryBtn.contains(e.target)) galleryPop.classList.remove('open'); });
function streakOf(list) {
  const day = d => new Date(d).toLocaleDateString('en-CA'), days = new Set(list.map(x => day(x.date)));
  let s = 0, d = new Date(); if (!days.has(day(d))) d.setDate(d.getDate() - 1);
  while (days.has(day(d))) { s++; d.setDate(d.getDate() - 1); } return s;
}
function renderGallery() {
  const list = loadGallery(), scored = list.filter(x => typeof x.score === 'number');
  const stat = $('#galleryStat'), strip = $('#galleryStrip'), note = $('#galleryNote');
  if (scored.length >= 2) { const d = scored[0].score - scored[1].score; stat.querySelector('strong').textContent = (d >= 0 ? '+' : '') + d + '%'; stat.querySelector('span').textContent = 'accuracy vs your previous traced drawing'; }
  else if (scored.length === 1) { stat.querySelector('strong').textContent = scored[0].score + '%'; stat.querySelector('span').textContent = 'latest trace accuracy — save another to see progress'; }
  else { stat.querySelector('strong').textContent = list.length; stat.querySelector('span').textContent = list.length === 1 ? 'drawing saved' : 'drawings saved'; }
  strip.textContent = '';
  list.slice(0, 4).forEach(item => {
    const t = document.createElement('button'); t.className = 'g-tile'; t.title = `${item.title}${typeof item.score === 'number' ? ' · ' + item.score + '%' : ''} — click to open`;
    t.style.backgroundImage = `url(${item.thumb})`; t.style.backgroundSize = 'cover'; t.setAttribute('aria-label', 'Open ' + item.title);
    t.addEventListener('click', async () => { if (!item.data) { showToast('This save only kept a thumbnail.'); return; } pushUndo(); await deserialize(item.data); changed(); galleryPop.classList.remove('open'); showToast(`Opened “${item.title}”.`); });
    strip.appendChild(t);
  });
  for (let i = list.slice(0, 4).length; i < 4; i++) { const t = document.createElement('div'); t.className = 'g-tile empty'; strip.appendChild(t); }
  const st = streakOf(list); note.textContent = list.length ? `${st}-day streak · ${list.length} saved` : 'Nothing saved yet — hit “Save drawing”.';
}
$('#saveGalleryBtn').addEventListener('click', () => {
  if (state._ink < 20 && !state.objects.length) { showToast('Draw something first.'); return; }
  const th = mk(240, 135), tx = th.getContext('2d'); tx.drawImage(composite(), 0, 0, 240, 135);
  const entry = { id: Date.now(), title: state.title, thumb: th.toDataURL('image/jpeg', 0.7), score: trace.has && trace.lastScore != null ? trace.lastScore : null, level: trace.has ? level() : null, date: new Date().toISOString(), data: serialize() };
  let list = [entry, ...loadGallery()].slice(0, 8);
  while (!saveGalleryList(list) && list.length > 1) { list.pop(); }
  if (list.length === 1 && !saveGalleryList(list)) { entry.data = null; saveGalleryList([entry]); }
  renderGallery(); showToast(entry.score != null ? `Saved to gallery · accuracy ${entry.score}%` : 'Saved to gallery.');
});
$('#newCanvasBtn').addEventListener('click', () => {
  if (state.objects.length && !confirm('Start a new canvas? You can still undo with Ctrl+Z.')) return;
  pushUndo(); state.objects = []; state.selected = null; state.title = 'Untitled canvas'; $('#projTitle').textContent = state.title; trace.ghost = null; changed(); updateGhostBar(); galleryPop.classList.remove('open');
});

// ==========================================================
// AI SERVICES
//   • On-device image classifier (TensorFlow.js MobileNet) — identifies the photo, no upload
//   • Generative restyle + AI coach — through the server (/api/*), so API keys never live in the browser
//   • Every AI call is opt-in (consent prompt), has loading / error / retry states and an on-device fallback
// ==========================================================
const API_BASE = String(window.DOODLEBRICK_API || '').replace(/\/$/, '');
const ai = { health: null, consented: false, coachConsented: false, busy: false };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const loadImage = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('The AI returned an image the browser could not read.')); im.src = src; });

function setAiStatus() {
  const h = ai.health; let t;
  if (!h) t = 'AI server not connected — on-device features still work. Start ComfyUI and the DoodleBrick server for local image generation.';
  else if (h.mock) t = 'AI server connected in TEST mode (no real model is called).';
  else if (h.provider === 'comfyui') t = '';
  else if (h.live) t = 'AI server connected ✓ Your drawing is only sent when you click an AI button.';
  else t = 'AI server is running, but it has no API key yet.';
  $('#aiStatus').textContent = t;
}
async function checkHealth() {
  try { const r = await fetch(API_BASE + '/api/health', { cache: 'no-store' }); ai.health = r.ok ? await r.json() : null; } catch (e) { ai.health = null; }
  setAiStatus(); return ai.health;
}
async function postJson(path, body) {
  const ctl = new AbortController(), timeout = ai.health && ai.health.provider === 'comfyui' ? 200000 : 70000, timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(API_BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    let j = {}; try { j = await r.json(); } catch (e) { /* non-JSON */ }
    if (!r.ok) throw Object.assign(new Error(j.error || `Server error (${r.status}).`), { status: r.status });
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The AI took too long. Please try again.');
    if (e.status) throw e;
    throw new Error('Could not reach the AI server.');
  } finally { clearTimeout(timer); }
}
function ensureConsent(kind = 'generate') {
  const coach = kind === 'coach', flag = coach ? 'coachConsented' : 'consented';
  if (ai[flag]) return true;
  const local = !coach && ai.health && ai.health.provider === 'comfyui';
  const what = coach ? 'Your drawing and the faint outline you are tracing are sent. Your original photo is never sent.' : 'Only your drawing is processed. Your original photo is never sent.';
  const destination = local ? 'It is processed by ComfyUI on this computer and is not sent to a cloud AI service.' : 'It goes through this app’s server to Google’s Gemini model.';
  ai[flag] = confirm(`Process your drawing with AI?\n\n• ${what}\n• ${destination}\n• Nothing is processed until you press an AI button.\n\nIf you are under 13, please ask a parent or teacher first.\n\nContinue?`);
  return ai[flag];
}

// ---------- on-device classifier ----------
const TFJS_SRC = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0';
const MOBILENET_SRC = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1';
let mobilenetModel = null;
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
async function identifyPhoto() {
  if (!trace.has) { showToast('Load a photo first.'); return; }
  const out = $('#photoLabel'), btn = $('#identifyBtn'); btn.disabled = true;
  try {
    if (!mobilenetModel) {
      out.textContent = 'Loading the photo helper for the first time…';
      if (!window.tf) await loadScript(TFJS_SRC);
      if (!window.mobilenet) await loadScript(MOBILENET_SRC);
      mobilenetModel = await window.mobilenet.load({ version: 2, alpha: 1.0 });
    }
    out.textContent = 'Looking at your photo…';
    const preds = await mobilenetModel.classify(refC, 3);
    trace.label = preds.map(p => ({ name: p.className.split(',')[0].trim(), prob: p.probability }));
    out.textContent = 'Looks like: ' + trace.label.map(l => `${l.name} (${Math.round(l.prob * 100)}%)`).join(' · ');
    if (state.title === 'Untitled canvas' && trace.label[0]) { state.title = `${cap(trace.label[0].name)} trace`.slice(0, 40); $('#projTitle').textContent = state.title; scheduleSave(); }
    updateRecipe();
  } catch (e) {
    out.textContent = 'Couldn’t identify this photo. You can still trace it.';
  } finally { btn.disabled = false; }
}
$('#identifyBtn').addEventListener('click', identifyPhoto);

// ---------- lesson recipe + photo-matched shape library ----------
function recipeText() {
  if (!trace.regions.length) return '';
  const counts = {}; trace.regions.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
  return Object.entries(counts).map(([t, n]) => {
    const l = (SHAPE_LABEL[t] || t).toLowerCase();
    return `${n} ${n > 1 ? (/(x|s)$/.test(l) ? l + 'es' : l + 's') : l}`;
  }).join(', ');
}
function updateRecipe() {
  const el = $('#lessonRecipe'), btn = $('#lessonBtn'), t = recipeText();
  if (!trace.has || !trace.edgeCount) { el.textContent = ''; btn.classList.add('hidden'); return; }
  el.textContent = ` ${t ? `Rough shape guesses: ${t}.` : ''}`;
  btn.classList.remove('hidden');
}
$('#lessonBtn').addEventListener('click', () => { trace.skipped.clear(); suggestNext(); showToast('Follow the pink line. Press Done when you’re finished.'); });
function applyShapeFilter() {
  const on = isOn('tgPhotoShapes') && trace.has && trace.regions.length > 0, types = new Set(trace.regions.map(r => r.type));
  $$('.shape-tile').forEach(t => t.classList.toggle('hidden', on && !types.has(t.dataset.shape) && t.dataset.shape !== 'line'));
  const cur = $$('.shape-tile').find(t => t.dataset.shape === state.shape);
  if (cur && cur.classList.contains('hidden')) { const first = $$('.shape-tile').find(t => !t.classList.contains('hidden')); if (first) first.click(); }
}
$('#tgPhotoShapes').addEventListener('click', applyShapeFilter);
function clearAiOutputs() {
  trace.label = null; $('#photoLabel').textContent = 'Try to name what’s in your photo. It stays on your device.';
  $('#coachBox').classList.add('hidden'); $('#coachText').textContent = '';
}

// ---------- generative restyle (AI Studio) ----------
const setGen = (msg, bad) => { const el = $('#genStatus'); el.textContent = msg; el.classList.toggle('warn', !!bad); };
async function generateAI() {
  if (ai.busy) return;
  if (state._ink < 20) { setGen('Draw something first — the AI restyles your drawing.', true); return; }
  if (!ai.health || !ai.health.generate) { await checkHealth(); }
  if (!ai.health || !ai.health.generate) { setGen('AI server not connected — showing the on-device filter instead. (See README to connect it.)', true); renderStudio(); return; }
  if (!ensureConsent()) { setGen('Cancelled — nothing was sent.'); return; }
  ai.busy = true; $('#genBtn').disabled = true; setGen(ai.health.provider === 'comfyui' ? `Generating locally with ${studio.style}… the first image may take a minute.` : `Generating a ${studio.style} version with AI… this can take 10–30 seconds.`);
  try {
    const res = await postJson('/api/generate', { image: composite().toDataURL('image/jpeg', 0.9), width: W, height: H, style: studio.style, prompt: $('#genPrompt').value });
    const img = await loadImage(res.image), aX = $('#studioAfter').getContext('2d');
    aX.fillStyle = '#fff'; aX.fillRect(0, 0, W, H);
    const s = Math.min(W / img.width, H / img.height), dw = img.width * s, dh = img.height * s; aX.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    studio.last = aX.getImageData(0, 0, W, H); studio.mode = 'ai';
    $('#afterTag').textContent = `After · AI ${studio.style}`;
    $('#studioNote').textContent = 'AI-generated version. “Apply finish” keeps it, “Revert” goes back (Ctrl+Z also works).';
    setGen(`Done — generated by ${res.provider}.`);
  } catch (e) {
    setGen(`${e.message} Showing the on-device ${studio.style} filter instead. Press Generate to retry.`, true);
    studio.mode = 'local'; renderStudio();
  } finally { ai.busy = false; $('#genBtn').disabled = false; }
}
$('#genBtn').addEventListener('click', generateAI);

// ---------- AI coach (explains the score; the score itself stays deterministic) ----------
function localTip() {
  if (trace.lastScore == null) return 'Load a photo or sample first, then trace it with shapes.';
  const p = trace.lastP, r = trace.lastR;
  if (r != null && r < 0.4) return 'Much of the outline is still uncovered. Press “Guide to missing outline” to find the biggest missing part.';
  if (p != null && p < 0.4) return 'Some shapes sit away from the outline. Nudge or resize them so they hug the grey lines.';
  if (trace.lastScore < 75) return 'Close! Fine-tune the small shapes along the edges to push your score up.';
  return 'Great match! Try a harder level, or add colour from the photo palette.';
}
const setCoach = (text, bad) => { $('#coachBox').classList.remove('hidden'); const el = $('#coachText'); el.textContent = text; el.classList.toggle('warn', !!bad); };
async function askCoach() {
  if (ai.busy) return;
  if (state._ink < 20) { showToast('Draw something first, then ask the coach.'); return; }
  if (!ai.health || !ai.health.coach) { await checkHealth(); }
  if (!ai.health || !ai.health.coach) { setCoach(`Tip: ${localTip()}`); return; }
  if (!ensureConsent('coach')) { setCoach('Cancelled — nothing was sent.'); return; }
  ai.busy = true; $('#coachBtn').disabled = true; setCoach('The coach is looking at your drawing…');
  try {
    const ov = mk(W, H), x = ov.getContext('2d'); x.fillStyle = state.bg; x.fillRect(0, 0, W, H);
    if (trace.outlineC) { x.globalAlpha = 0.35; x.drawImage(trace.outlineC, 0, 0, W, H); x.globalAlpha = 1; }
    x.drawImage(drawC, 0, 0);
    const res = await postJson('/api/coach', { image: ov.toDataURL('image/jpeg', 0.85), metrics: { accuracy: trace.lastScore, recall: trace.lastR, precision: trace.lastP, level: trace.has ? level() : '', recipe: recipeText() } });
    setCoach(res.text);
  } catch (e) { setCoach(`${e.message} On-device tip: ${localTip()}`, true); }
  finally { ai.busy = false; $('#coachBtn').disabled = false; }
}
$('#coachBtn').addEventListener('click', askCoach);

// ---------- first-run welcome ----------
function initWelcome() {
  try { if (localStorage.getItem('doodlebrick:welcomed')) return; } catch (e) { /* storage blocked: show it */ }
  const w = $('#welcome'); w.classList.remove('hidden');
  const close = () => { w.classList.add('hidden'); try { localStorage.setItem('doodlebrick:welcomed', '1'); } catch (e) { /* ignore */ } };
  $('#welcomeSkip').addEventListener('click', close);
  $('#welcomeSample').addEventListener('click', () => { close(); selectTool('trace'); const chip = $$('.sample-chip').find(c => c.dataset.sample === 'cat'); if (chip) chip.click(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !w.classList.contains('hidden')) close(); });
  setTimeout(() => $('#welcomeSample').focus(), 0);
}

// ==========================================================
// INIT
// ==========================================================
(async function init() {
  applyBg(); applyView(); buildPixelGrid(16);
  try { const saved = localStorage.getItem(AKEY); if (saved) await deserialize(saved); } catch (e) { /* ignore corrupt autosave */ }
  selectTool('brush', { assist: true });
  renderLayers(); updateSelectionPanel(); updateTraceUI(); renderGallery(); render(); scheduleAnalysis(100); setSaveTag('Saved');
  window.addEventListener('resize', requestRender);
  checkHealth(); initWelcome();
})();