// Mock cutout provider (SPEC §6.3): finds the subject by growing the background in from the photo's
// edges (colour close to its neighbour and to the typical edge colour), then keeps the main subject.
// Runs in the browser on a downscaled copy; works well on plain or soft backgrounds. When it can't find
// a believable subject it says so (fallback: true) and returns a soft centred oval, and the UI offers
// circle / square stickers of the whole photo instead.
import { fillHoles, keepLargest, erode, dilate, countSet } from './outline.js';

function median(values) {
  const s = Float64Array.from(values).sort();
  return s.length ? s[s.length >> 1] : 0;
}

function dist(d, i, r, g, b) {
  const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function ovalMask(w, h) {
  const m = new Uint8Array(w * h);
  const cx = w / 2, cy = h / 2, rx = w * 0.44, ry = h * 0.46;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry;
    m[y * w + x] = u * u + v * v <= 1 ? 1 : 0;
  }
  return m;
}

// rgba: Uint8ClampedArray (w*h*4). Returns { mask: Uint8Array (1 = subject), fallback, coverage }.
export function segmentSubject(rgba, w, h, { neighbourTol = 22, backgroundTol = 70 } = {}) {
  const edge = [];
  for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);
  const rs = [], gs = [], bs = [];
  for (const i of edge) { rs.push(rgba[i * 4]); gs.push(rgba[i * 4 + 1]); bs.push(rgba[i * 4 + 2]); }
  const br = median(rs), bg = median(gs), bb = median(bs);
  // spread of the edge colours: a busy background widens the tolerance a little
  const spread = median(edge.map((i) => dist(rgba, i * 4, br, bg, bb)));
  const bgTol = backgroundTol + Math.min(40, spread);

  const isBg = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  for (const i of edge) {
    if (!isBg[i] && dist(rgba, i * 4, br, bg, bb) < bgTol) { isBg[i] = 1; stack[sp++] = i; }
  }
  while (sp) {
    const i = stack[--sp];
    const x = i % w, y = (i - x) / w;
    const p = i * 4;
    const tryN = (j) => {
      if (isBg[j]) return;
      const q = j * 4;
      if (dist(rgba, q, rgba[p], rgba[p + 1], rgba[p + 2]) < neighbourTol && dist(rgba, q, br, bg, bb) < bgTol) {
        isBg[j] = 1;
        stack[sp++] = j;
      }
    };
    if (x > 0) tryN(i - 1);
    if (x < w - 1) tryN(i + 1);
    if (y > 0) tryN(i - w);
    if (y < h - 1) tryN(i + w);
  }
  let m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = isBg[i] ? 0 : 1;
  // remove specks and thin bridges to the frame, keep the main subject (plus big secondary pieces, e.g. two people)
  const r = Math.max(1, Math.round(Math.min(w, h) / 160));
  m = dilate(erode(m, w, h, r), w, h, r);
  m = keepLargest(m, w, h, 0.25);
  m = fillHoles(m, w, h);
  const coverage = countSet(m) / (w * h);
  if (coverage < 0.04 || coverage > 0.92) return { mask: ovalMask(w, h), fallback: true, coverage };
  return { mask: m, fallback: false, coverage };
}
