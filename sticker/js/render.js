// Sticker renderer (browser): one code path for the on-screen preview and the 300 dpi print file.
// The die-cut white border and cut line are computed from the artwork's alpha by outline.js —
// the white shape that is painted IS the cut path, so preview, print.png and cut.svg agree.
import { makeCanvas, ctx2d, canvasToBlob } from './imaging.js';
import { alphaMask, dieCutMask, cutPath, polygonToPathD, circlePathD, roundedRectPathD, cutSvg, SQUARE_CORNER } from './outline.js';

export const PRINT_DPI = 300;
export const BLEED_IN = 1 / 16;      // SPEC §6.4
export const MIN_INNER_RADIUS_IN = 1 / 32;

function bounds(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}

const geometryCache = new Map();

// Geometry of one sticker at a given scale, in "body" coordinates where the sticker's bounding box starts at 0,0.
// mode: 'cutout' (transparent artwork) or 'photo' (whole rectangular photo, circle / square only)
export function stickerGeometry(art, opts, longestPx, mode = 'cutout', cacheKey = null) {
  const key = cacheKey && `${cacheKey}|${opts.shape}|${opts.border_in}|${opts.size}|${longestPx}|${mode}`;
  if (key && geometryCache.has(key)) return geometryCache.get(key);
  const sizeIn = Number(opts.size);
  const pxPerIn = longestPx / sizeIn;
  const bp = Number(opts.border_in) * pxPerIn;
  const aw = art.width, ah = art.height;
  let g;
  if (opts.shape === 'diecut' && mode === 'cutout') {
    const rmin = MIN_INNER_RADIUS_IN * pxPerIn;
    const s = (longestPx - 2 * bp) / Math.max(aw, ah);
    const dw = aw * s, dh = ah * s;
    const P = Math.ceil(bp + rmin + 2);
    const mw = Math.ceil(dw + 2 * P), mh = Math.ceil(dh + 2 * P);
    const mc = makeCanvas(mw, mh);
    const mx = ctx2d(mc);
    mx.drawImage(art, P, P, dw, dh);
    const mask = alphaMask(mx.getImageData(0, 0, mw, mh).data, mw, mh, 24);
    const body = dieCutMask(mask, mw, mh, bp, rmin);
    const poly = cutPath(body, mw, mh, { epsilon: Math.max(0.6, pxPerIn / 400), smooth: 2 });
    const b = bounds(poly);
    const shifted = poly.map(([x, y]) => [x - b.x0, y - b.y0]);
    g = {
      width: b.x1 - b.x0, height: b.y1 - b.y0, poly: shifted,
      pathD: (dx = 0, dy = 0) => polygonToPathD(shifted, 1, dx, dy),
      art: { x: P - b.x0, y: P - b.y0, w: dw, h: dh, clip: false },
    };
  } else {
    const W = longestPx, H = longestPx;
    const inner = longestPx - 2 * bp;
    let artBox;
    if (mode === 'photo') {
      const s = Math.max(inner / aw, inner / ah); // cover
      artBox = { x: (W - aw * s) / 2, y: (H - ah * s) / 2, w: aw * s, h: ah * s, clip: true };
    } else {
      const s = opts.shape === 'circle' ? (inner * 0.97) / Math.hypot(aw, ah) : (inner * 0.94) / Math.max(aw, ah);
      artBox = { x: (W - aw * s) / 2, y: (H - ah * s) / 2, w: aw * s, h: ah * s, clip: false };
    }
    const r = SQUARE_CORNER * W;
    g = {
      width: W, height: H, poly: null,
      pathD: opts.shape === 'circle'
        ? (dx = 0, dy = 0) => circlePathD(W / 2 + dx, H / 2 + dy, W / 2)
        : (dx = 0, dy = 0) => roundedRectPathD(dx, dy, W, H, r),
      innerD: opts.shape === 'circle'
        ? (dx = 0, dy = 0) => circlePathD(W / 2 + dx, H / 2 + dy, W / 2 - bp)
        : (dx = 0, dy = 0) => roundedRectPathD(dx + bp, dy + bp, inner, inner, Math.max(2, r - bp)),
      art: artBox,
    };
  }
  if (key) {
    if (geometryCache.size > 40) geometryCache.clear();
    geometryCache.set(key, g);
  }
  return g;
}

// Draw a sticker. Returns { canvas, geometry, pad }.
// options: { mode, white, shadow, sheen, showCut, pad, background, cacheKey }
export function renderSticker(art, opts, longestPx, o = {}) {
  const mode = o.mode || 'cutout';
  const g = stickerGeometry(art, opts, longestPx, mode, o.cacheKey);
  const pad = o.pad ?? Math.ceil(longestPx * 0.05);
  const c = makeCanvas(Math.ceil(g.width + 2 * pad), Math.ceil(g.height + 2 * pad));
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  if (o.background) { x.fillStyle = o.background; x.fillRect(0, 0, c.width, c.height); }
  const body = new Path2D(g.pathD(pad, pad));
  x.save();
  if (o.shadow !== false) {
    x.shadowColor = 'rgba(30,29,26,.24)';
    x.shadowBlur = Math.max(2, longestPx * 0.035);
    x.shadowOffsetY = Math.max(1, longestPx * 0.012);
  }
  x.fillStyle = o.white || '#fffdf8';
  x.fill(body);
  x.restore();
  x.save();
  x.clip(body);
  if (g.art.clip && g.innerD) x.clip(new Path2D(g.innerD(pad, pad)));
  x.drawImage(art, g.art.x + pad, g.art.y + pad, g.art.w, g.art.h);
  x.restore();
  if (o.sheen && (opts.finish === 'glossy' || opts.finish === 'holographic')) {
    x.save();
    x.clip(body);
    x.fillStyle = 'rgba(255,255,255,0.18)';
    x.beginPath();
    x.moveTo(pad, pad);
    x.lineTo(pad + g.width * 0.6, pad);
    x.lineTo(pad, pad + g.height * 0.6);
    x.closePath();
    x.fill();
    x.restore();
  }
  if (o.showCut) {
    x.save();
    x.setLineDash([Math.max(3, longestPx / 90), Math.max(3, longestPx / 110)]);
    x.lineWidth = Math.max(1, longestPx / 320);
    x.strokeStyle = '#c23d23';
    x.stroke(body);
    x.restore();
  }
  return { canvas: c, geometry: g, pad };
}

// Print files (SPEC §6.4, api_contract.md §6): print.png at 300 dpi on solid white with 1/16 in bleed,
// and cut.svg with one closed CutContour path lined up with print.png pixel for pixel.
export async function renderPrintFiles(art, opts, mode = 'cutout') {
  const longest = Math.round(Number(opts.size) * PRINT_DPI);
  const bleed = Math.round(BLEED_IN * PRINT_DPI);
  const { canvas, geometry } = renderSticker(art, opts, longest, { mode, white: '#ffffff', shadow: false, sheen: false, showCut: false, pad: bleed, background: '#ffffff' });
  const png = await canvasToBlob(canvas, 'image/png');
  const svg = cutSvg(geometry.pathD(bleed, bleed), canvas.width, canvas.height, PRINT_DPI);
  return { png, svg, width: canvas.width, height: canvas.height };
}
