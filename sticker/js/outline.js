// Die-cut geometry on plain bitmaps (no DOM): the white border and the cut line are computed here,
// from the artwork's alpha channel, for both the on-screen preview and the 300 dpi print file.
//
//   mask      = alpha > threshold, holes filled
//   border    = dilate(mask, border + r_min) then erode by r_min    (a morphological closing:
//               convex corners get radius >= border, concave corners radius >= r_min; SPEC §6.4)
//   islands   = if the subject falls apart into several pieces, they are joined by their convex hull,
//               because the cutter needs exactly one closed path
//   cut path  = outer boundary of that mask, traced along pixel edges, simplified and smoothed
//
// Distances use an exact Euclidean distance transform (Felzenszwalb & Huttenlocher), so a 1/8 in
// border is 1/8 in in every direction, not an approximation from stamping the image around a circle.

const INF = 1e20;

function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

// Squared Euclidean distance from every pixel to the nearest set pixel of mask.
export function distanceSquared(mask, w, h) {
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = mask[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = g[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[row + x] = d[x];
  }
  return g;
}

export function alphaMask(rgba, w, h, threshold = 16) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = rgba[i * 4 + 3] > threshold ? 1 : 0;
  return m;
}

export function dilate(mask, w, h, r) {
  const d2 = distanceSquared(mask, w, h);
  const out = new Uint8Array(w * h);
  const rr = r * r;
  for (let i = 0; i < w * h; i++) out[i] = d2[i] <= rr ? 1 : 0;
  return out;
}

export function erode(mask, w, h, r) {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
  const d2 = distanceSquared(inv, w, h);
  const out = new Uint8Array(w * h);
  const rr = r * r;
  for (let i = 0; i < w * h; i++) out[i] = mask[i] && d2[i] > rr ? 1 : 0;
  return out;
}

// Background reachable from the image edge (4-connected) stays empty; everything else is filled.
export function fillHoles(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (i) => {
    if (!mask[i] && !seen[i]) { seen[i] = 1; stack[sp++] = i; }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const i = stack[--sp];
    const x = i % w, y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = mask[i] || !seen[i] ? 1 : 0;
  return out;
}

// 8-connected components. Returns { count, labels (1..count), sizes[] }.
export function components(mask, w, h) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const sizes = [0];
  let count = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || labels[s]) continue;
    count++;
    let sp = 0, size = 0;
    labels[s] = count;
    stack[sp++] = s;
    while (sp) {
      const i = stack[--sp];
      size++;
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && !labels[j]) { labels[j] = count; stack[sp++] = j; }
        }
      }
    }
    sizes.push(size);
  }
  return { count, labels, sizes };
}

export function keepLargest(mask, w, h, minFraction = 0) {
  const { count, labels, sizes } = components(mask, w, h);
  if (count <= 1) return mask;
  let best = 1;
  for (let i = 2; i <= count; i++) if (sizes[i] > sizes[best]) best = i;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const l = labels[i];
    if (l && (l === best || sizes[l] >= sizes[best] * minFraction && minFraction > 0)) out[i] = 1;
  }
  return out;
}

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

// Andrew's monotone chain. points: [[x, y], ...]
export function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// Fill pixels whose centre lies inside polygon (even-odd scanline).
export function rasterizePolygon(poly, w, h, out = new Uint8Array(w * h)) {
  const n = poly.length;
  for (let y = 0; y < h; y++) {
    const cy = y + 0.5;
    const xs = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5)), x1 = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = x0; x <= x1; x++) out[y * w + x] = 1;
    }
  }
  return out;
}

// Join separate islands into one shape via the convex hull of all set pixels (corner points, so the hull covers them).
export function joinIslands(mask, w, h) {
  const { count } = components(mask, w, h);
  if (count <= 1) return mask;
  const pts = [];
  for (let y = 0; y < h; y++) {
    let x0 = -1, x1 = -1;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x0 < 0) x0 = x; x1 = x; }
    if (x0 >= 0) pts.push([x0, y], [x0, y + 1], [x1 + 1, y], [x1 + 1, y + 1]);
  }
  const out = Uint8Array.from(mask);
  rasterizePolygon(convexHull(pts), w, h, out);
  return out;
}

export function countSet(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i] ? 1 : 0;
  return n;
}

export function bbox(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

// The die-cut sticker body (white border included) for an artwork whose alpha is given.
// The caller pads the artwork so the border fits inside w x h.
export function dieCutMask(mask, w, h, borderPx, minRadiusPx) {
  let m = fillHoles(mask, w, h);
  m = dilate(m, w, h, borderPx + minRadiusPx);
  if (minRadiusPx > 0) m = erode(m, w, h, minRadiusPx);
  m = joinIslands(m, w, h);
  return fillHoles(m, w, h);
}

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // E S W N (y grows downward)

// Outer boundary of the component containing the first set pixel in raster order, traced along
// pixel edges with the shape on the right. Vertices are pixel-corner coordinates, corners only.
// For a single hole-free 8-connected component its area equals the pixel count.
export function traceContour(mask, w, h) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  let start = -1;
  for (let i = 0; i < w * h; i++) if (mask[i]) { start = i; break; }
  if (start < 0) return [];
  const x0 = start % w, y0 = (start - x0) / w;
  const right = (x, y, d) => (d === 0 ? at(x, y) : d === 1 ? at(x - 1, y) : d === 2 ? at(x - 1, y - 1) : at(x, y - 1));
  const left = (x, y, d) => (d === 0 ? at(x, y - 1) : d === 1 ? at(x, y) : d === 2 ? at(x - 1, y) : at(x - 1, y - 1));
  const pts = [[x0, y0]];
  let x = x0 + 1, y = y0, d = 0;
  const limit = 4 * (w + 1) * (h + 1);
  for (let guard = 0; !(x === x0 && y === y0); guard++) {
    if (guard > limit) throw new Error('contour did not close');
    let nd;
    if (left(x, y, d)) nd = (d + 3) % 4;
    else if (right(x, y, d)) nd = d;
    else nd = (d + 1) % 4;
    if (nd !== d) pts.push([x, y]);
    d = nd;
    x += DIRS[d][0];
    y += DIRS[d][1];
  }
  return pts;
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  let t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = a[0] + t * dx - p[0], ey = a[1] + t * dy - p[1];
  return Math.sqrt(ex * ex + ey * ey);
}

function rdpOpen(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let best = -1, bi = -1;
    for (let i = s + 1; i < e; i++) {
      const dd = segDist(pts[i], pts[s], pts[e]);
      if (dd > best) { best = dd; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([s, bi], [bi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Ramer-Douglas-Peucker on a closed polygon.
export function simplifyClosed(poly, eps) {
  if (poly.length < 4) return poly.slice();
  let far = 0, best = -1;
  for (let i = 1; i < poly.length; i++) {
    const dd = Math.hypot(poly[i][0] - poly[0][0], poly[i][1] - poly[0][1]);
    if (dd > best) { best = dd; far = i; }
  }
  const a = rdpOpen(poly.slice(0, far + 1), eps);
  const b = rdpOpen(poly.slice(far).concat([poly[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

// Chaikin corner cutting on a closed polygon.
export function smoothClosed(poly, iterations = 2) {
  let p = poly;
  for (let k = 0; k < iterations; k++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    p = q;
  }
  return p;
}

// Traced, simplified, smoothed cut line of a die-cut mask. Same function for preview and print.
export function cutPath(mask, w, h, { epsilon = 0.9, smooth = 2 } = {}) {
  const raw = traceContour(mask, w, h);
  if (raw.length < 3) return raw;
  return smoothClosed(simplifyClosed(raw, epsilon), smooth);
}

function fmt(n) {
  return (Math.round(n * 100) / 100).toString();
}

export function polygonToPathD(poly, scale = 1, dx = 0, dy = 0) {
  if (!poly.length) return '';
  return poly.map((p, i) => `${i ? 'L' : 'M'}${fmt(p[0] * scale + dx)} ${fmt(p[1] * scale + dy)}`).join(' ') + ' Z';
}

export function circlePathD(cx, cy, r) {
  return `M${fmt(cx - r)} ${fmt(cy)} A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx + r)} ${fmt(cy)} A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx - r)} ${fmt(cy)} Z`;
}

export function roundedRectPathD(x, y, w, h, r) {
  return `M${fmt(x + r)} ${fmt(y)} L${fmt(x + w - r)} ${fmt(y)} A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + w)} ${fmt(y + r)} ` +
    `L${fmt(x + w)} ${fmt(y + h - r)} A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + w - r)} ${fmt(y + h)} ` +
    `L${fmt(x + r)} ${fmt(y + h)} A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x)} ${fmt(y + h - r)} ` +
    `L${fmt(x)} ${fmt(y + r)} A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + r)} ${fmt(y)} Z`;
}

export const SQUARE_CORNER = 0.09; // corner radius as a fraction of the side (SPEC §6.4)

// cut.svg: one closed path named CutContour, in a document sized in inches that lines up 1:1
// with print.png's pixels (viewBox in px, width/height in inches).
export function cutSvg(pathD, widthPx, heightPx, dpi) {
  const win = fmt(widthPx / dpi), hin = fmt(heightPx / dpi);
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${win}in" height="${hin}in" viewBox="0 0 ${widthPx} ${heightPx}">\n` +
    `  <g id="CutContourLayer">\n` +
    `    <path id="CutContour" d="${pathD}" fill="none" stroke="#ff00ff" stroke-width="1"/>\n` +
    `  </g>\n</svg>\n`;
}
