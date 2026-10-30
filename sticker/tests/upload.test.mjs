import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sniffType, checkFile, checkDimensions, fitWithin, WORKING_MAX_SIDE } from '../js/upload-check.js';

const P = JSON.parse(readFileSync(new URL('../pricing.json', import.meta.url)));
const L = P.limits;

const bytes = (...xs) => {
  const b = new Uint8Array(16);
  xs.forEach((x, i) => { b[i] = typeof x === 'string' ? x.charCodeAt(0) : x; });
  return b;
};
const ascii = (s, at = 0, b = new Uint8Array(16)) => { [...s].forEach((c, i) => { b[at + i] = c.charCodeAt(0); }); return b; };

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const WEBP = ascii('WEBP', 8, ascii('RIFF'));
const HEIC = ascii('heic', 8, ascii('ftyp', 4));
const GIF = ascii('GIF89a');

test('types are judged by magic bytes', () => {
  assert.equal(sniffType(JPEG), 'image/jpeg');
  assert.equal(sniffType(PNG), 'image/png');
  assert.equal(sniffType(WEBP), 'image/webp');
  assert.equal(sniffType(HEIC), 'image/heic');
  assert.equal(sniffType(GIF), null);
  assert.equal(sniffType(new Uint8Array(3)), null);
  const real = readFileSync(new URL('../assets/sample.jpg', import.meta.url));
  assert.equal(sniffType(new Uint8Array(real.subarray(0, 16))), 'image/jpeg');
});

test('a renamed file is caught by its bytes, not its name or MIME', () => {
  const r = checkFile({ name: 'cat.jpg', size: 1000, type: 'image/jpeg' }, GIF, L);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unsupported_media_type');
  assert.match(r.title, /file type/);
  assert.equal(checkFile({ name: 'notes.txt', size: 10, type: 'text/plain' }, ascii('hello world!'), L).code, 'unsupported_media_type');
  // a phone that reports no MIME type is fine if the bytes are a JPEG
  assert.equal(checkFile({ name: 'IMG_1', size: 1000, type: '' }, JPEG, L).ok, true);
});

test('size limit comes from pricing.json limits', () => {
  assert.equal(checkFile({ name: 'a.png', size: L.max_upload_bytes, type: 'image/png' }, PNG, L).ok, true);
  const big = checkFile({ name: 'a.png', size: L.max_upload_bytes + 1, type: 'image/png' }, PNG, L);
  assert.equal(big.code, 'payload_too_large');
  assert.match(big.message, /20 MB/);
  assert.equal(checkFile({ name: 'a.png', size: 0, type: 'image/png' }, PNG, L).ok, false);
  assert.equal(checkFile(null, null, L).ok, false);
});

test('short side must reach min_short_side_px', () => {
  assert.equal(checkDimensions(L.min_short_side_px, 4000, L).ok, true);
  const small = checkDimensions(320, 240, L);
  assert.equal(small.code, 'image_too_small');
  assert.match(small.message, /320 × 240/);
  assert.equal(checkDimensions(NaN, 900, L).ok, false);
});

test('large photos are shrunk in the browser, small ones are left alone', () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: WORKING_MAX_SIDE, height: 1200, scale: WORKING_MAX_SIDE / 4000 });
  assert.deepEqual(fitWithin(900, 1200), { width: 900, height: 1200, scale: 1 });
  const t = fitWithin(3024, 4032, 1600);
  assert.equal(Math.max(t.width, t.height), 1600);
});
