// Upload validation, DOM-free so it can be unit tested.
// Types are judged by the file's first bytes (what the server does too, api_contract.md 415),
// falling back to the browser-reported MIME type only when the bytes are unavailable.

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';
export const WORKING_MAX_SIDE = 1600; // photos are shrunk to this in the browser before anything else happens

const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];

export function sniffType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  const ascii = (i, n) => String.fromCharCode(...b.slice(i, i + n));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (HEIF_BRANDS.includes(brand)) return brand.startsWith('he') ? 'image/heic' : 'image/heif';
  }
  return null;
}

function mb(bytes) {
  return Math.round(bytes / 1024 / 1024);
}

// file: { name, size, type }; head: Uint8Array of the first bytes (>= 12) or null
// limits: pricing.json "limits"
export function checkFile(file, head, limits) {
  if (!file) return { ok: false, code: 'bad_request', title: 'Add a photo first', message: 'Pick a photo from your device, or use our sample photo.' };
  if (file.size === 0) return { ok: false, code: 'bad_request', title: 'That file is empty', message: 'Try picking the photo again.' };
  const sniffed = head ? sniffType(head) : null;
  const type = sniffed || (head ? null : ACCEPTED_TYPES.includes(file.type) ? file.type : null);
  if (!type) {
    return {
      ok: false, code: 'unsupported_media_type', title: 'That file type won’t work',
      message: `Use a JPG, PNG, WebP or HEIC photo. ${file.name ? `“${file.name}”` : 'That file'} isn’t one of those.`,
    };
  }
  if (file.size > limits.max_upload_bytes) {
    return {
      ok: false, code: 'payload_too_large', title: 'That photo is too large',
      message: `The limit is ${mb(limits.max_upload_bytes)} MB and this one is ${mb(file.size)} MB. Try sharing a smaller copy from your phone.`,
    };
  }
  return { ok: true, type };
}

export function checkDimensions(width, height, limits) {
  const short = Math.min(width, height);
  if (!(short >= limits.min_short_side_px)) {
    return {
      ok: false, code: 'image_too_small', title: 'That photo is too small to print sharply',
      message: `We need at least ${limits.min_short_side_px} px on the short side; this one is ${width} × ${height}. The original from your camera roll usually works.`,
    };
  }
  return { ok: true };
}

// Size to shrink an image to so its longest side is at most max (never enlarges).
export function fitWithin(width, height, max = WORKING_MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

export function isHeic(type) {
  return type === 'image/heic' || type === 'image/heif';
}

export const DECODE_FAILED = {
  ok: false, code: 'decode_failed', title: 'We couldn’t open that photo',
  message: 'The file may be damaged. If it is an HEIC photo, this browser can’t read it: on iPhone, pick it with “Choose photo” (not Files), or export it as JPG first.',
};
