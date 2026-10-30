// White border and cut line, checked on synthetic bitmaps against exact geometry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceSquared, dilate, erode, fillHoles, components, dieCutMask, traceContour, polygonArea,
  cutPath, pointInPolygon, countSet, polygonToPathD, cutSvg, circlePathD, alphaMask, joinIslands,
} from '../js/outline.js';

function blank(w, h) { return new Uint8Array(w * h); }
function disk(w, h, cx, cy, r, m = blank(w, h)) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * w + x] = 1;
  return m;
}
function rect(w, h, x0, y0, x1, y1, m = blank(w, h)) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * w + x] = 1;
  return m;
}
// brute-force distance from (x, y) to the nearest set pixel
function bruteDist(m, w, h, x, y) {
  let best = Infinity;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (m[j * w + i]) best = Math.min(best, (i - x) ** 2 + (j - y) ** 2);
  return Math.sqrt(best);
}

test('distance transform is exact Euclidean (vs brute force)', () => {
  const w = 40, h = 30;
  const m = blank(w, h);
  m[5 * w + 7] = 1; m[22 * w + 31] = 1; m[14 * w + 3] = 1;
  const d2 = distanceSquared(m, w, h);
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
    assert.ok(Math.abs(Math.sqrt(d2[y * w + x]) - bruteDist(m, w, h, x, y)) < 1e-9, `(${x},${y})`);
  }
});

test('dilating a disk by b gives a disk of radius r + b', () => {
  const w = 120, h = 120, r = 20, b = 12;
  const grown = dilate(disk(w, h, 60, 60, r), w, h, b);
  const area = countSet(grown);
  const ideal = Math.PI * (r + b) ** 2;
  assert.ok(Math.abs(area - ideal) / ideal < 0.03, `area ${area} vs ${ideal.toFixed(0)}`);
  assert.equal(grown[60 * w + (60 + r + b - 1)], 1);
  assert.equal(grown[60 * w + (60 + r + b + 2)], 0);
});

test('die-cut border is the requested width all the way round', () => {
  const w = 100, h = 100, b = 8;
  const art = rect(w, h, 30, 35, 69, 64); // 40 x 30 block
  const cut = dieCutMask(art, w, h, b, 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = bruteDist(art, w, h, x, y);
    if (d <= b) assert.equal(cut[y * w + x], 1, `inside border at (${x},${y}) d=${d.toFixed(2)}`);
    if (d > b + 1.5) assert.equal(cut[y * w + x], 0, `outside border at (${x},${y}) d=${d.toFixed(2)}`);
  }
});

test('closing rounds a narrow notch (no cutter-catching inner corners)', () => {
  const w = 90, h = 90;
  const art = rect(w, h, 20, 20, 69, 69);
  rect(w, h, 43, 20, 46, 50, art).fill(0, 0, 0); // no-op guard
  for (let y = 20; y <= 50; y++) for (let x = 43; x <= 46; x++) art[y * w + x] = 0; // 4px-wide slot from the top
  const plain = dilate(art, w, h, 0);
  assert.equal(plain[30 * w + 44], 0, 'slot is open before closing');
  const cut = dieCutMask(art, w, h, 1, 3);
  assert.equal(cut[30 * w + 44], 1, 'slot (narrower than 2 x r_min) is bridged');
});

test('holes inside the subject are filled (one solid backing)', () => {
  const w = 80, h = 80;
  const ring = disk(w, h, 40, 40, 25);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - 40) ** 2 + (y - 40) ** 2 <= 100) ring[y * w + x] = 0;
  assert.equal(fillHoles(ring, w, h)[40 * w + 40], 1);
  assert.equal(dieCutMask(ring, w, h, 3, 1)[40 * w + 40], 1);
});

test('separate islands become one shape (cutter needs a single closed path)', () => {
  const w = 160, h = 80;
  const two = disk(w, h, 35, 40, 15);
  disk(w, h, 125, 40, 15, two);
  assert.equal(components(two, w, h).count, 2);
  const cut = dieCutMask(two, w, h, 4, 1);
  assert.equal(components(cut, w, h).count, 1);
  assert.equal(cut[40 * w + 80], 1, 'the gap between them is bridged');
  assert.equal(components(joinIslands(two, w, h), w, h).count, 1);
});

test('traced contour encloses exactly the pixels (area = pixel count)', () => {
  const w = 70, h = 60;
  const shapes = [rect(w, h, 10, 12, 29, 31), disk(w, h, 35, 30, 17), dieCutMask(rect(w, h, 20, 20, 40, 30), w, h, 6, 2)];
  // an L shape
  const L = rect(w, h, 10, 10, 19, 49); rect(w, h, 10, 40, 49, 49, L); shapes.push(L);
  for (const m of shapes) {
    const poly = traceContour(m, w, h);
    assert.ok(poly.length >= 4);
    assert.equal(Math.abs(polygonArea(poly)), countSet(m));
  }
  const sq = traceContour(rect(w, h, 10, 12, 29, 31), w, h);
  assert.deepEqual(sq, [[10, 12], [30, 12], [30, 32], [10, 32]]);
});

test('smoothed cut line stays outside the artwork and inside the border', () => {
  const w = 120, h = 120, b = 10;
  const art = disk(w, h, 50, 55, 22);
  rect(w, h, 60, 30, 85, 50, art); // a blob with a corner
  const cut = dieCutMask(art, w, h, b, 2);
  const poly = cutPath(cut, w, h);
  assert.ok(poly.length > 12);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (art[y * w + x]) assert.ok(pointInPolygon(x + 0.5, y + 0.5, poly), `art pixel (${x},${y}) is inside the cut`);
    else if (bruteDist(art, w, h, x, y) > b + 3) assert.ok(!pointInPolygon(x + 0.5, y + 0.5, poly), `(${x},${y}) beyond the border is outside the cut`);
  }
});

test('cut.svg is one closed CutContour path sized in inches', () => {
  const w = 60, h = 60;
  const cut = dieCutMask(disk(w, h, 30, 30, 15), w, h, 5, 1);
  const d = polygonToPathD(cutPath(cut, w, h));
  const svg = cutSvg(d, 600, 900, 300);
  assert.equal((svg.match(/<path /g) || []).length, 1);
  assert.match(svg, /id="CutContour"/);
  assert.match(svg, /width="2in" height="3in" viewBox="0 0 600 900"/);
  assert.equal((d.match(/M/g) || []).length, 1);
  assert.ok(d.trim().endsWith('Z'));
  const c = circlePathD(50, 50, 40);
  assert.equal((c.match(/M/g) || []).length, 1);
  assert.ok(c.endsWith('Z'));
});

test('alpha threshold and erosion behave', () => {
  const w = 4, h = 1;
  const rgba = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 17, 0, 0, 0, 255]);
  assert.deepEqual([...alphaMask(rgba, w, h, 16)], [0, 0, 1, 1]);
  const W = 30, H = 30;
  const e = erode(rect(W, H, 5, 5, 24, 24), W, H, 3);
  assert.equal(countSet(e), 14 * 14);
});
