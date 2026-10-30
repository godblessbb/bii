// Site-wide settings. The brand name lives here only (SPEC §2.3 / §9 D5: "Peelings" is a working name).
export const BRAND = 'Peelings';

// Backend base URL (api_contract.md §0). Empty = no backend yet: the local mock in api-mock.js is used,
// nothing leaves the browser and checkout ends on a clearly labelled demo page.
// T4 sets this to the deployed Worker, e.g. 'https://api.datode.com'.
export const API_BASE = '';

// For local development and the end-to-end check, ?api=http://127.0.0.1:8787 points this browser at a
// local Worker (kept in localStorage), ?api=mock goes back to the mock. Only loopback URLs are accepted,
// so a link can never send someone's cart to a third-party server.
const DEV_KEY = 'peelings.api_base.dev';
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?\/?$/;

export function isLoopbackApi(url) {
  return LOOPBACK.test(String(url || ''));
}

export function resolveApiBase(search, storage, configured = API_BASE) {
  const q = new URLSearchParams(search || '').get('api');
  try {
    if (q !== null) {
      if (q === 'mock' || q === '') storage.setItem(DEV_KEY, 'mock');
      else if (q === 'default') storage.removeItem(DEV_KEY);
      else if (isLoopbackApi(q)) storage.setItem(DEV_KEY, q.replace(/\/$/, ''));
    }
    const dev = storage.getItem(DEV_KEY);
    if (dev === 'mock') return '';
    if (dev && isLoopbackApi(dev)) return dev;
  } catch { /* storage blocked: use the configured value */ }
  return configured;
}
