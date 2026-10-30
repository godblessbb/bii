// Local stand-in for the backend with the same surface as api.js (SPEC §8 T2 item 4).
// Used whenever no API base is configured: nothing leaves the browser, nothing is charged.
// It behaves like the contract says the server will: free tries per design, failed tries not
// counted, options checked against pricing.json, and the order re-priced from pricing.json
// (client amounts are ignored). Checkout "redirects" to the demo page on this site.
import { ApiError } from './api.js';
import { validateOptions, quoteCart } from './pricing.js';
import { STYLE_IDS } from './filters.js';
import { newId } from './cart.js';

export const MOCK_KEY = 'peelings.mockapi.v1';

const PRICE_KEYS = /price|amount|cents|total/i;

function stripPrices(obj) {
  if (Array.isArray(obj)) return obj.map(stripPrices);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) if (!PRICE_KEYS.test(k)) out[k] = stripPrices(v);
    return out;
  }
  return obj;
}

// stylizeImpl(designId, styleId) -> Promise<{ blob, width, height }>   (browser: canvas filters)
// failGenerations: number of upcoming generations to fail with provider_timeout (demo of the retry path)
export function createMockApi({ storage, loadPricing, stylizeImpl, delay = (ms) => new Promise((r) => setTimeout(r, ms)), latencyMs = 900, failGenerations = 0, random = Math.random } = {}) {
  function state() {
    let s = null;
    try { s = JSON.parse(storage.getItem(MOCK_KEY) || 'null'); } catch { s = null; }
    return s && typeof s === 'object' ? { designs: s.designs || {}, uploads: s.uploads || {}, orders: s.orders || {} } : { designs: {}, uploads: {}, orders: {} };
  }
  function save(s) {
    try { storage.setItem(MOCK_KEY, JSON.stringify(s)); } catch { /* storage full or blocked: the session still works */ }
  }
  let failLeft = failGenerations;

  return {
    kind: 'mock',
    base: '',

    async getPricing() {
      const { cost_model, ...pub } = await loadPricing();
      void cost_model;
      return pub;
    },

    async createDesign(cutoutBlob, meta) {
      const p = await loadPricing();
      if (!meta || meta.rights_confirmed !== true) {
        throw new ApiError({ status: 422, code: 'rights_not_confirmed', message: 'Please confirm you have the right to use this photo.' });
      }
      if (cutoutBlob && cutoutBlob.size > p.limits.max_upload_bytes) {
        throw new ApiError({ status: 413, code: 'payload_too_large', message: 'That image is too large.' });
      }
      const s = state();
      const id = newId('dsg_mock_');
      const tries = p.ai.free_tries_per_photo;
      s.designs[id] = { tries_left: tries, created_at: new Date().toISOString(), generations: [] };
      save(s);
      return { design_id: id, cutout_url: null, tries_left: tries, expires_at: new Date(Date.now() + 30 * 864e5).toISOString() };
    },

    async generate(designId, styleId) {
      const s = state();
      const dsg = s.designs[designId];
      if (!dsg) throw new ApiError({ status: 404, code: 'not_found', message: 'This design has expired. Please upload the photo again.' });
      if (!STYLE_IDS.includes(styleId)) throw new ApiError({ status: 400, code: 'bad_request', message: 'Unknown style.', field: 'style_id' });
      const costs = styleId !== 'original';
      if (costs && dsg.tries_left <= 0) {
        throw new ApiError({ status: 429, code: 'generation_quota_exceeded', message: 'You’ve used the free tries for this photo.', extra: { tries_left: 0 } });
      }
      await delay(styleId === 'original' ? latencyMs / 3 : latencyMs);
      if (costs && failLeft > 0) {
        failLeft--;
        throw new ApiError({ status: 504, code: 'provider_timeout', message: 'The style generator timed out.', retryable: true, extra: { tries_left: dsg.tries_left } });
      }
      const img = await stylizeImpl(designId, styleId);
      const s2 = state();
      const d2 = s2.designs[designId] || dsg;
      if (costs) d2.tries_left = Math.max(0, d2.tries_left - 1);
      const gen = { generation_id: newId('gen_mock_'), style_id: styleId, created_at: new Date().toISOString() };
      d2.generations = [...(d2.generations || []), gen].slice(-20);
      s2.designs[designId] = d2;
      save(s2);
      return { ...gen, image_url: null, blob: img.blob, width: img.width, height: img.height, provider: 'mock', tries_left: d2.tries_left };
    },

    async upload(uploadId, blob, contentType) {
      if (!/^upl_[0-9a-f-]{36}$/.test(uploadId)) throw new ApiError({ status: 400, code: 'bad_request', message: 'Bad upload id.' });
      const s = state();
      s.uploads[uploadId] = { bytes: blob.size, type: contentType, at: Date.now() };
      // keep the mock store small
      const ids = Object.keys(s.uploads);
      for (const k of ids.slice(0, Math.max(0, ids.length - 40))) delete s.uploads[k];
      save(s);
      return { upload_id: uploadId, bytes: blob.size };
    },

    async quote(payload) {
      const p = await loadPricing();
      const lines = stripPrices(payload).lines || [];
      const q = quoteCart(p, lines);
      return { pricing_version: p.version, lines: lines.map((l, i) => ({ ...l, ...q.lines[i] })), subtotal_cents: q.subtotal_cents, shipping_cents: q.shipping_cents, total_cents: q.total_cents, currency: p.currency };
    },

    async checkout(payload, idempotencyKey) {
      const p = await loadPricing();
      const body = stripPrices(payload); // the server ignores any client amount; so do we
      const s = state();
      if (idempotencyKey) {
        const prev = Object.values(s.orders).find((o) => o.idempotency_key === idempotencyKey);
        if (prev) return prev.response;
      }
      if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > p.limits.max_lines_per_order) {
        throw new ApiError({ status: 400, code: 'bad_request', message: 'Your cart is empty or too large.' });
      }
      if (body.rights_confirmed !== true) throw new ApiError({ status: 422, code: 'rights_not_confirmed', message: 'Please confirm you have the right to use these photos.' });
      if (body.pricing_version !== p.version) {
        throw new ApiError({ status: 409, code: 'pricing_version_mismatch', message: 'Prices were updated. Please review your cart.', retryable: true, extra: { quote: await this.quote(body) } });
      }
      body.lines.forEach((l, i) => {
        const bad = validateOptions(p, l);
        if (bad) throw new ApiError({ status: 422, code: 'invalid_option', message: bad.message, field: `lines[${i}].${bad.field}` });
        if (!s.uploads[l.print_upload_id] || !s.uploads[l.cut_upload_id]) throw new ApiError({ status: 400, code: 'bad_request', message: 'Print files are missing. Please try again.' });
      });
      const q = quoteCart(p, body.lines);
      const orderId = 'PL-' + String(1000 + Math.floor(random() * 9000));
      const session = 'cs_demo_' + newId('').replace(/-/g, '').slice(0, 16);
      const response = {
        order_id: orderId,
        checkout_url: `checkout-demo.html?order=${orderId}&session_id=${session}`,
        total_cents: q.total_cents,
        order_token: newId('otk_'),
      };
      s.orders[orderId] = {
        idempotency_key: idempotencyKey || null,
        response,
        lines: body.lines.map((l, i) => ({ ...l, unit_cents: q.lines[i].unit_cents, line_cents: q.lines[i].line_cents })),
        subtotal_cents: q.subtotal_cents, shipping_cents: q.shipping_cents, total_cents: q.total_cents,
        status: 'pending', created_at: new Date().toISOString(),
      };
      const ids = Object.keys(s.orders);
      for (const k of ids.slice(0, Math.max(0, ids.length - 10))) delete s.orders[k];
      save(s);
      return response;
    },

    // demo checkout page only (the real thing is GET /v1/orders/{id}?token=… for T4)
    async getOrder(orderId) {
      const o = state().orders[orderId];
      if (!o) throw new ApiError({ status: 404, code: 'not_found', message: 'We couldn’t find that order.' });
      return { order_id: orderId, ...o };
    },

    async completeDemoOrder(orderId) {
      const s = state();
      if (s.orders[orderId]) { s.orders[orderId].status = 'demo_complete'; save(s); }
    },
  };
}
