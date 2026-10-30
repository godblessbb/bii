// Canvas helpers (browser only).

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c) {
  return c.getContext('2d', { willReadFrequently: true });
}

// Decode a File/Blob, honouring EXIF orientation (phone photos). Rejects if the browser can't decode it (e.g. HEIC in Chrome).
export async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function loadImage(src, crossOrigin = false) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src;
  });
}

export function sizeOf(img) {
  return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
}

// Draw img into a canvas whose longest side is at most max, stepping down by halves for a clean result.
export function toCanvas(img, max = Infinity) {
  let { width: w, height: h } = sizeOf(img);
  const s = Math.min(1, max / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
  let src = img;
  while (w / 2 > tw && h / 2 > th) {
    w = Math.round(w / 2); h = Math.round(h / 2);
    const step = makeCanvas(w, h);
    const x = step.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, w, h);
    src = step;
  }
  const out = makeCanvas(tw, th);
  const x = out.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, tw, th);
  return out;
}

export async function blobToCanvas(blob, max = Infinity) {
  const img = await decodeImage(blob);
  const c = toCanvas(img, max);
  if (img.close) img.close();
  return c;
}

export function canvasToBlob(c, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode image'))), type, quality);
  });
}

export function rgbaOf(c) {
  return ctx2d(c).getImageData(0, 0, c.width, c.height);
}

// Crop to the non-transparent area.
export function trimCanvas(c, threshold = 8) {
  const { data } = rgbaOf(c);
  const w = c.width, h = c.height;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return c;
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return c;
  const o = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  o.getContext('2d').drawImage(c, -x0, -y0);
  return o;
}

export function readHead(file, n = 32) {
  return file.slice(0, n).arrayBuffer().then((b) => new Uint8Array(b));
}
