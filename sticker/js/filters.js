// Mock style provider: deterministic pixel filters standing in for the AI styles (SPEC §6.2).
// Same input -> same output, no network, no cost. Works on { data, width, height } (ImageData-shaped).
// The real styles come from the backend (api_contract.md §3); the ids here are the contract's ids.

export const STYLES = [
  { id: 'original', name: 'Just the photo', example: null, ai: false },
  { id: 'sunny', name: 'Sunny cartoon', example: '1.png', ai: true },
  { id: 'ink', name: 'Ink comic', example: '2.png', ai: true },
  { id: 'line', name: 'Line art', example: '3.png', ai: true },
  { id: 'badge', name: 'Vintage badge', example: '4.png', ai: true },
  { id: 'pastel', name: 'Pastel doodle', example: '5.png', ai: true },
  { id: 'wash', name: 'Soft wash', example: '6.png', ai: true },
  { id: 'clay', name: 'Clay figure', example: '7.png', ai: true },
  { id: 'pop', name: 'Pop sticker', example: '8.png', ai: true },
];

export const STYLE_IDS = STYLES.map((s) => s.id);

export function styleById(id) {
  return STYLES.find((s) => s.id === id) || null;
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

function luminance(d, n) {
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return L;
}

// 3x3 box blur of a single channel (used to calm noise before posterizing / edge finding)
function blur(src, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        s += src[yy * w + xx];
        n++;
      }
    }
    out[y * w + x] = s / n;
  }
  return out;
}

// Sobel magnitude on luminance; also counts the alpha edge so outlines hug the silhouette.
function edges(L, alpha, w, h) {
  const e = new Float32Array(w * h);
  const v = (x, y) => {
    x = x < 0 ? 0 : x >= w ? w - 1 : x;
    y = y < 0 ? 0 : y >= h ? h - 1 : y;
    const i = y * w + x;
    return alpha[i] > 16 ? L[i] : 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = v(x + 1, y - 1) + 2 * v(x + 1, y) + v(x + 1, y + 1) - v(x - 1, y - 1) - 2 * v(x - 1, y) - v(x - 1, y + 1);
    const gy = v(x - 1, y + 1) + 2 * v(x, y + 1) + v(x + 1, y + 1) - v(x - 1, y - 1) - 2 * v(x, y - 1) - v(x + 1, y - 1);
    e[y * w + x] = Math.sqrt(gx * gx + gy * gy) / 4;
  }
  return e;
}

const SETTINGS = {
  sunny: { levels: 5, sat: 1.35, warm: 18, lift: 10, outline: 34, ink: [42, 30, 22] },
  ink: { levels: 3, sat: 0.55, warm: 0, lift: 0, outline: 24, ink: [18, 18, 20], contrast: 1.35 },
  line: { line: true, outline: 20, ink: [30, 28, 26] },
  badge: { duotone: [[58, 40, 24], [244, 222, 176]], levels: 4, outline: 40, ink: [58, 40, 24] },
  pastel: { levels: 6, sat: 0.7, mixWhite: 0.42, outline: 46, ink: [120, 104, 132] },
  wash: { levels: 9, sat: 0.85, mixWhite: 0.3, paper: [250, 243, 228], outline: 0 },
  clay: { levels: 7, sat: 1.25, warm: 10, lift: 6, shade: 0.22, outline: 0 },
  pop: { levels: 3, sat: 1.95, warm: 0, lift: 0, outline: 30, ink: [20, 20, 24], contrast: 1.15 },
};

export function stylize(src, styleId) {
  const { width: w, height: h } = src;
  const n = w * h;
  const out = new Uint8ClampedArray(src.data);
  if (styleId === 'original') return { data: out, width: w, height: h };
  const cfg = SETTINGS[styleId];
  if (!cfg) throw new Error(`unknown style ${styleId}`);
  const d = src.data;
  const alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) alpha[i] = d[i * 4 + 3];
  const L = blur(luminance(d, n), w, h);
  const E = cfg.outline || cfg.line ? edges(L, alpha, w, h) : null;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    let r = d[p], g = d[p + 1], b = d[p + 2];
    if (cfg.line) {
      const on = E[i] > cfg.outline;
      r = on ? cfg.ink[0] : 255; g = on ? cfg.ink[1] : 253; b = on ? cfg.ink[2] : 248;
    } else if (cfg.duotone) {
      const t = Math.round((L[i] / 255) * (cfg.levels - 1)) / (cfg.levels - 1);
      const [a0, a1] = cfg.duotone;
      r = a0[0] + (a1[0] - a0[0]) * t; g = a0[1] + (a1[1] - a0[1]) * t; b = a0[2] + (a1[2] - a0[2]) * t;
    } else {
      const m = (r + g + b) / 3;
      r = m + (r - m) * (cfg.sat ?? 1); g = m + (g - m) * (cfg.sat ?? 1); b = m + (b - m) * (cfg.sat ?? 1);
      if (cfg.contrast) { r = (r - 128) * cfg.contrast + 128; g = (g - 128) * cfg.contrast + 128; b = (b - 128) * cfg.contrast + 128; }
      if (cfg.warm) { r += cfg.warm; b -= cfg.warm * 0.6; }
      if (cfg.lift) { r += cfg.lift; g += cfg.lift; b += cfg.lift; }
      if (cfg.mixWhite) { const k = cfg.mixWhite; const pw = cfg.paper || [255, 255, 255]; r = r * (1 - k) + pw[0] * k; g = g * (1 - k) + pw[1] * k; b = b * (1 - k) + pw[2] * k; }
      if (cfg.shade) { const s = 1 - cfg.shade + cfg.shade * 2 * (L[i] / 255); r *= s; g *= s; b *= s; }
      const step = 255 / (cfg.levels - 1);
      r = Math.round(clamp(r) / step) * step; g = Math.round(clamp(g) / step) * step; b = Math.round(clamp(b) / step) * step;
      if (E && cfg.outline && E[i] > cfg.outline) { r = cfg.ink[0]; g = cfg.ink[1]; b = cfg.ink[2]; }
    }
    out[p] = clamp(Math.round(r)); out[p + 1] = clamp(Math.round(g)); out[p + 2] = clamp(Math.round(b));
  }
  return { data: out, width: w, height: h };
}
