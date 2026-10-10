/* DoodleBrick — vision.js
   Small, dependency-free computer-vision helpers. Everything runs in the browser.
   Works on plain typed arrays so it can be tested without a DOM. */
(function (root) {
  'use strict';
  const V = {};
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------- basics ---------- */
  V.gray = function (d, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return g;
  };

  function blur3(src, w, h) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const r = y * w;
      for (let x = 0; x < w; x++) tmp[r + x] = (src[r + (x > 0 ? x - 1 : 0)] + src[r + x] + src[r + (x < w - 1 ? x + 1 : x)]) / 3;
    }
    for (let y = 0; y < h; y++) {
      const a = (y > 0 ? y - 1 : 0) * w, b = y * w, c = (y < h - 1 ? y + 1 : y) * w;
      for (let x = 0; x < w; x++) out[b + x] = (tmp[a + x] + tmp[b + x] + tmp[c + x]) / 3;
    }
    return out;
  }
  V.blur = function (g, w, h, passes) { let a = g; for (let i = 0; i < passes; i++) a = blur3(a, w, h); return a; };

  /* Sobel gradient: magnitude + quantised direction (0..3) for non-max suppression. */
  V.sobel = function (g, w, h) {
    const mag = new Float32Array(w * h), dir = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = g[i - w - 1], b = g[i - w], c = g[i - w + 1], d = g[i - 1], f = g[i + 1], gg = g[i + w - 1], hh = g[i + w], ii = g[i + w + 1];
      const gx = (c + 2 * f + ii) - (a + 2 * d + gg), gy = (gg + 2 * hh + ii) - (a + 2 * b + c);
      mag[i] = Math.sqrt(gx * gx + gy * gy);
      let ang = Math.atan2(gy, gx) * 180 / Math.PI; if (ang < 0) ang += 180;
      dir[i] = ang < 22.5 || ang >= 157.5 ? 0 : ang < 67.5 ? 1 : ang < 112.5 ? 2 : 3;
    }
    return { mag, dir };
  };

  /* Thin (1px) edges: threshold + non-maximum suppression. */
  V.thinEdges = function (mag, dir, w, h, thr) {
    const m = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, v = mag[i];
      if (v < thr) continue;
      let n1, n2;
      switch (dir[i]) {
        case 0: n1 = mag[i - 1]; n2 = mag[i + 1]; break;
        case 1: n1 = mag[i - w - 1]; n2 = mag[i + w + 1]; break;
        case 2: n1 = mag[i - w]; n2 = mag[i + w]; break;
        default: n1 = mag[i - w + 1]; n2 = mag[i + w - 1];
      }
      if (v >= n1 && v >= n2) m[i] = 1;
    }
    return m;
  };

  V.dilate = function (m, w, h) {
    const o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) o[ny * w + nx] = 1;
      }
    }
    return o;
  };

  /* 8-connected components. Removes components smaller than minSize. */
  V.cleanComponents = function (mask, w, h, minSize) {
    const out = new Uint8Array(w * h), seen = new Uint8Array(w * h), q = new Int32Array(w * h);
    for (let s = 0; s < mask.length; s++) {
      if (!mask[s] || seen[s]) continue;
      let head = 0, tail = 0; q[tail++] = s; seen[s] = 1;
      while (head < tail) {
        const i = q[head++], x = i % w, y = (i / w) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (mask[j] && !seen[j]) { seen[j] = 1; q[tail++] = j; }
        }
      }
      if (tail >= minSize) for (let k = 0; k < tail; k++) out[q[k]] = 1;
    }
    return out;
  };

  /* Chamfer 3-4 distance transform: distance (px) from every pixel to the nearest set pixel. */
  V.chamfer = function (mask, w, h) {
    const INF = 1e7, d = new Float32Array(w * h);
    for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
      }
      d[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x; let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
      }
      d[i] = v;
    }
    for (let i = 0; i < d.length; i++) d[i] /= 3;
    return d;
  };

  /* ---------- photo -> outline ---------- */
  const DETAIL = {
    simple:   { blur: 3, keep: 0.05, rel: 0.16, minComp: 40 },
    balanced: { blur: 2, keep: 0.08, rel: 0.11, minComp: 22 },
    detailed: { blur: 1, keep: 0.13, rel: 0.07, minComp: 10 }
  };
  V.outline = function (rgba, w, h, detail) {
    const P = DETAIL[detail] || DETAIL.balanced;
    const g = V.blur(V.gray(rgba, w, h), w, h, P.blur);
    const { mag, dir } = V.sobel(g, w, h);
    let max = 0; for (let i = 0; i < mag.length; i++) if (mag[i] > max) max = mag[i];
    if (max < 8) return { edges: new Uint8Array(w * h), count: 0 };
    // percentile threshold (top `keep` of pixels), never below rel*max
    const bins = new Uint32Array(512);
    for (let i = 0; i < mag.length; i++) bins[Math.min(511, (mag[i] / max * 511) | 0)]++;
    let acc = 0, b = 511; const target = P.keep * mag.length;
    for (; b > 0; b--) { acc += bins[b]; if (acc >= target) break; }
    const thr = Math.max(b / 511 * max, P.rel * max);
    let edges = V.thinEdges(mag, dir, w, h, thr);
    edges = V.cleanComponents(edges, w, h, P.minComp);
    let count = 0; for (let i = 0; i < edges.length; i++) count += edges[i];
    return { edges, count };
  };

  /* ---------- accuracy score ----------
     E   = reference edges (1px), dtE = chamfer(E)
     M   = mask of everything the user has drawn
     Recall    : how much of the reference outline has something drawn nearby.
     Precision : how many boundaries of the user's drawing sit near the outline. */
  V.accuracy = function (E, dtE, M, w, h, tol) {
    let nE = 0, nM = 0;
    for (let i = 0; i < E.length; i++) { nE += E[i]; nM += M[i]; }
    if (nE < 30) return null;
    if (nM < 12) return { score: 0, precision: 0, recall: 0, dtM: null };
    const dtM = V.chamfer(M, w, h);
    let rc = 0;
    for (let i = 0; i < E.length; i++) if (E[i] && dtM[i] <= tol) rc++;
    let nD = 0, pc = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (M[i] && (!M[i - 1] || !M[i + 1] || !M[i - w] || !M[i + w])) { nD++; if (dtE[i] <= tol + 3) pc++; }
    }
    const recall = rc / nE, precision = nD ? pc / nD : 0;
    const f = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
    return { score: Math.round(f * 100), precision, recall, dtM };
  };

  /* fraction of reference edge pixels inside bbox that already have drawing nearby */
  V.coverage = function (E, dtM, w, bbox, tol) {
    if (!dtM) return 0;
    let n = 0, c = 0;
    for (let y = bbox.y0; y <= bbox.y1; y++) for (let x = bbox.x0; x <= bbox.x1; x++) {
      const i = y * w + x; if (E[i]) { n++; if (dtM[i] <= tol) c++; }
    }
    return n < 5 ? 0.5 : c / n;
  };

  /* ---------- palette (k-means, deterministic) ---------- */
  const hex2 = n => ('0' + Math.round(clamp(n, 0, 255)).toString(16)).slice(-2);
  V.hex = (r, g, b) => ('#' + hex2(r) + hex2(g) + hex2(b)).toUpperCase();
  V.palette = function (d, w, h, k) {
    const pts = [], step = Math.max(1, Math.floor(w * h / 4000));
    for (let i = 0; i < w * h; i += step) if (d[i * 4 + 3] >= 128) pts.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);
    if (!pts.length) return [];
    const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    const mean = [0, 0, 0]; pts.forEach(p => { mean[0] += p[0]; mean[1] += p[1]; mean[2] += p[2]; });
    mean.forEach((_, i) => { mean[i] /= pts.length; });
    let first = pts[0], fd = Infinity; pts.forEach(p => { const dd = dist(p, mean); if (dd < fd) { fd = dd; first = p; } });
    const cs = [first.slice()];
    while (cs.length < Math.min(k, pts.length)) {
      let best = null, bd = -1;
      pts.forEach(p => { let m = Infinity; cs.forEach(c => { m = Math.min(m, dist(p, c)); }); if (m > bd) { bd = m; best = p; } });
      cs.push(best.slice());
    }
    let counts = new Array(cs.length).fill(0);
    for (let it = 0; it < 8; it++) {
      const sum = cs.map(() => [0, 0, 0, 0]);
      pts.forEach(p => {
        let bi = 0, bd = Infinity; cs.forEach((c, i) => { const dd = dist(p, c); if (dd < bd) { bd = dd; bi = i; } });
        const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
      });
      counts = sum.map(s => s[3]);
      sum.forEach((s, i) => { if (s[3]) cs[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    }
    const out = cs.map((c, i) => ({ rgb: c, share: counts[i] / pts.length })).filter(o => o.share > 0).sort((a, b) => b.share - a.share);
    const merged = [];
    out.forEach(o => { if (!merged.some(m => dist(m.rgb, o.rgb) < 28 * 28)) merged.push(o); });
    return merged.slice(0, k).map(o => ({ hex: V.hex(o.rgb[0], o.rgb[1], o.rgb[2]), share: o.share }));
  };

  /* ---------- shape detection (colour regions -> shape type) ---------- */
  V.classify = function (fill, aspect, cy, bw, bh) {
    if (Math.min(bw, bh) < 0.12 * Math.max(bw, bh)) return 'line';
    if (fill >= 0.93) return Math.abs(aspect - 1) < 0.16 ? 'square' : 'rect';
    if (fill >= 0.86) return 'rounded';
    if (fill >= 0.70) { if (cy > 0.55) return 'semicircle'; return Math.abs(aspect - 1) < 0.16 ? 'circle' : 'ellipse'; }
    if (fill >= 0.58) return cy < 0.5 ? 'heart' : 'cloud';
    if (fill >= 0.40) { if (cy > 0.6) return 'triangle'; return fill > 0.46 ? 'diamond' : 'star'; }
    if (fill >= 0.28 && cy > 0.44 && cy < 0.58) return 'star';
    return null;
  };

  V.regions = function (d, w, h) {
    const n = w * h;
    const ch = [0, 1, 2].map(c => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = d[i * 4 + c]; return V.blur(a, w, h, 1); });
    const q = new Uint8Array(n);
    for (let i = 0; i < n; i++) q[i] = (Math.min(3, (ch[0][i] / 64) | 0) << 4) | (Math.min(3, (ch[1][i] / 64) | 0) << 2) | Math.min(3, (ch[2][i] / 64) | 0);
    const seen = new Uint8Array(n), queue = new Int32Array(n), out = [];
    for (let s = 0; s < n; s++) {
      if (seen[s]) continue;
      let head = 0, tail = 0; queue[tail++] = s; seen[s] = 1;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, sy = 0, r = 0, g = 0, b = 0, border = 0;
      while (head < tail) {
        const i = queue[head++], x = i % w, y = (i / w) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        sy += y; r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2];
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border++;
        if (x > 0 && !seen[i - 1] && q[i - 1] === q[i]) { seen[i - 1] = 1; queue[tail++] = i - 1; }
        if (x < w - 1 && !seen[i + 1] && q[i + 1] === q[i]) { seen[i + 1] = 1; queue[tail++] = i + 1; }
        if (y > 0 && !seen[i - w] && q[i - w] === q[i]) { seen[i - w] = 1; queue[tail++] = i - w; }
        if (y < h - 1 && !seen[i + w] && q[i + w] === q[i]) { seen[i + w] = 1; queue[tail++] = i + w; }
      }
      const area = tail; if (area < n * 0.004) continue;
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (bw >= w * 0.85 && bh >= h * 0.85) continue;           // background
      if (border > (w + h) * 0.5 && area > n * 0.3) continue;   // big region hugging the borders
      const type = V.classify(area / (bw * bh), bw / bh, (sy / area - y0) / bh, bw, bh);
      if (!type) continue;
      out.push({ type, x: x0, y: y0, w: bw, h: bh, area, color: V.hex(r / area, g / area, b / area) });
    }
    return out.sort((a, b) => b.area - a.area).slice(0, 8);
  };

  /* ---------- style filters (RGBA in -> new RGBA out) ---------- */
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function boxBlurRGBA(src, w, h, r) {
    if (r < 1) return new Uint8ClampedArray(src);
    const tmp = new Float32Array(src.length), out = new Uint8ClampedArray(src.length), win = 2 * r + 1;
    for (let y = 0; y < h; y++) for (let c = 0; c < 4; c++) {
      let sum = 0; const row = y * w;
      for (let x = -r; x <= r; x++) sum += src[(row + clamp(x, 0, w - 1)) * 4 + c];
      for (let x = 0; x < w; x++) {
        tmp[(row + x) * 4 + c] = sum / win;
        sum += src[(row + clamp(x + r + 1, 0, w - 1)) * 4 + c] - src[(row + clamp(x - r, 0, w - 1)) * 4 + c];
      }
    }
    for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[(clamp(y, 0, h - 1) * w + x) * 4 + c];
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = sum / win;
        sum += tmp[(clamp(y + r + 1, 0, h - 1) * w + x) * 4 + c] - tmp[(clamp(y - r, 0, h - 1) * w + x) * 4 + c];
      }
    }
    return out;
  }
  V.boxBlurRGBA = boxBlurRGBA;
  function edgeMag(rgba, w, h) { return V.sobel(V.blur(V.gray(rgba, w, h), w, h, 1), w, h).mag; }

  V.stylize = function (style, rgba, w, h, seed) {
    const rnd = mulberry(seed || 1), n = w * h, out = new Uint8ClampedArray(rgba.length);
    const finish = () => { for (let i = 3; i < out.length; i += 4) out[i] = 255; return out; };
    if (style === 'Cartoon') {
      const sm = boxBlurRGBA(rgba, w, h, 2), mag = edgeMag(sm, w, h);
      for (let i = 0; i < n; i++) {
        const j = i * 4, m = (sm[j] + sm[j + 1] + sm[j + 2]) / 3;
        for (let c = 0; c < 3; c++) {
          let v = m + (sm[j + c] - m) * 1.28;
          v = Math.round(clamp(v, 0, 255) / 255 * 4) / 4 * 255;
          out[j + c] = mag[i] > 70 ? 25 : v;
        }
      }
      return finish();
    }
    if (style === 'Anime') {
      const sm = boxBlurRGBA(rgba, w, h, 1), mag = edgeMag(sm, w, h), bloom = boxBlurRGBA(sm, w, h, 7);
      for (let i = 0; i < n; i++) {
        const j = i * 4, L = (0.299 * sm[j] + 0.587 * sm[j + 1] + 0.114 * sm[j + 2]) / 255 || 0.001;
        const Lq = (Math.floor(L * 5) + 0.5) / 5, k = (Lq * 0.75 + L * 0.25) / L;
        const bl = Math.max(0, (0.299 * bloom[j] + 0.587 * bloom[j + 1] + 0.114 * bloom[j + 2]) / 255 - 0.75) * 90;
        for (let c = 0; c < 3; c++) {
          const m = L * 255, v = (m + (sm[j + c] - m) * 1.18) * k + bl;
          out[j + c] = mag[i] > 110 ? 43 + c * 2 : clamp(v, 0, 255);
        }
      }
      return finish();
    }
    if (style === 'Watercolor') {
      const base = boxBlurRGBA(rgba, w, h, 2), wide = boxBlurRGBA(rgba, w, h, 5), mag = edgeMag(base, w, h);
      const gx = Math.ceil(w / 12) + 2, gy = Math.ceil(h / 12) + 2, grid = new Float32Array(gx * gy * 2);
      for (let i = 0; i < grid.length; i++) grid[i] = (rnd() - 0.5) * 6;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const fx = x / 12, fy = y / 12, ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
        const gi = (iy * gx + ix) * 2, gj = gi + gx * 2;
        const ox = (grid[gi] * (1 - tx) + grid[gi + 2] * tx) * (1 - ty) + (grid[gj] * (1 - tx) + grid[gj + 2] * tx) * ty;
        const oy = (grid[gi + 1] * (1 - tx) + grid[gi + 3] * tx) * (1 - ty) + (grid[gj + 1] * (1 - tx) + grid[gj + 3] * tx) * ty;
        const sx = clamp((x + ox) | 0, 0, w - 1), sy = clamp((y + oy) | 0, 0, h - 1), s = (sy * w + sx) * 4, j = (y * w + x) * 4;
        const grain = (rnd() - 0.5) * 12, dark = 1 - Math.min(0.28, mag[y * w + x] / 900);
        for (let c = 0; c < 3; c++) {
          let v = base[s + c] * 0.62 + wide[s + c] * 0.38;
          v = Math.round(v / 255 * 9) / 9 * 255;
          out[j + c] = clamp((v * 0.9 + 25.5) * dark + grain, 0, 255);
        }
      }
      return finish();
    }
    /* Pencil sketch: colour-dodge of gray over blurred inverted gray */
    const gray = new Uint8ClampedArray(rgba.length);
    for (let i = 0; i < n; i++) {
      const j = i * 4, g = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
      gray[j] = gray[j + 1] = gray[j + 2] = g; gray[j + 3] = 255;
    }
    const inv = new Uint8ClampedArray(gray);
    for (let i = 0; i < inv.length; i += 4) inv[i] = inv[i + 1] = inv[i + 2] = 255 - gray[i];
    const bl = boxBlurRGBA(inv, w, h, 5);
    for (let i = 0; i < n; i++) {
      const j = i * 4, v = Math.min(255, gray[j] * 255 / (255 - bl[j] + 1)), t = clamp((v - 20) * 1.12, 0, 255), gr = (rnd() - 0.5) * 14;
      out[j] = clamp(t * 0.99 + gr, 0, 255); out[j + 1] = clamp(t * 0.98 + gr, 0, 255); out[j + 2] = clamp(t * 0.94 + gr, 0, 255);
    }
    return finish();
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = V; else root.Vision = V;
})(typeof window !== 'undefined' ? window : globalThis);
