// Mock providers (cutout, styles) and the API layer, all without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { segmentSubject } from '../js/cutout.js';
import { stylize, STYLES, STYLE_IDS } from '../js/filters.js';
import { createHttpApi, ApiError, safeCheckoutUrl } from '../js/api.js';
import { createMockApi } from '../js/api-mock.js';

const P = JSON.parse(readFileSync(new URL('../pricing.json', import.meta.url)));

function synthPhoto(w, h, truth = null) {
  // warm grey background with a gentle gradient, an orange "pet" disc and a darker body ellipse
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4;
    const g = 214 + Math.round((y / h) * 18);
    let c = [g, g - 6, g - 14], subject = 0;
    if ((x - w / 2) ** 2 + (y - h * 0.4) ** 2 <= (w * 0.22) ** 2) { c = [228, 128, 52]; subject = 1; }
    if (((x - w / 2) / (w * 0.26)) ** 2 + ((y - h * 0.72) / (h * 0.18)) ** 2 <= 1) { c = [70, 96, 140]; subject = 1; }
    d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
    if (truth) truth[y * w + x] = subject;
  }
  return d;
}

test('mock cutout finds the subject on a plain background', () => {
  const w = 160, h = 200;
  const truth = new Uint8Array(w * h);
  const rgba = synthPhoto(w, h, truth);
  const { mask, fallback, coverage } = segmentSubject(rgba, w, h);
  assert.equal(fallback, false);
  let hit = 0, total = 0, leak = 0;
  for (let i = 0; i < w * h; i++) {
    if (truth[i]) { total++; hit += mask[i]; } else if (mask[i]) leak++;
  }
  assert.ok(hit / total > 0.98, `subject recall ${hit / total}`);
  assert.ok(leak / (w * h) < 0.01, `background leak ${leak}`);
  assert.ok(coverage > 0.1 && coverage < 0.5);
});

test('mock cutout admits defeat on a photo with no subject', () => {
  const w = 60, h = 60;
  const flat = new Uint8ClampedArray(w * h * 4).fill(200);
  const r = segmentSubject(flat, w, h);
  assert.equal(r.fallback, true);
});

test('mock styles: nine contract ids, deterministic, alpha untouched', () => {
  assert.deepEqual(STYLE_IDS, ['original', 'sunny', 'ink', 'line', 'badge', 'pastel', 'wash', 'clay', 'pop']);
  assert.equal(STYLES.filter((s) => s.ai).length, 8);
  const w = 40, h = 50;
  const src = { data: synthPhoto(w, h), width: w, height: h };
  for (let i = 0; i < w * h; i += 7) src.data[i * 4 + 3] = i % 3 ? 255 : 0;
  const seen = new Set();
  for (const id of STYLE_IDS) {
    const a = stylize(src, id), b = stylize(src, id);
    assert.deepEqual(a.data, b.data, `${id} is deterministic`);
    for (let i = 0; i < w * h; i++) assert.equal(a.data[i * 4 + 3], src.data[i * 4 + 3]);
    seen.add(Buffer.from(a.data).toString('base64'));
  }
  assert.equal(seen.size, STYLE_IDS.length, 'every style looks different');
  assert.deepEqual(stylize(src, 'original').data, src.data);
  assert.throws(() => stylize(src, 'nope'));
});

// ---- HTTP client against a fake fetch ----
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    const r = await handler(url, init);
    return new Response(r.body == null ? '' : JSON.stringify(r.body), { status: r.status || 200, headers: { 'Content-Type': 'application/json' } });
  };
  f.calls = calls;
  return f;
}

test('http client: checkout sends JSON with Idempotency-Key and returns the server response', async () => {
  const f = fakeFetch(() => ({ status: 201, body: { order_id: 'PL-1', checkout_url: 'https://checkout.stripe.com/c/pay/x', total_cents: 3900, order_token: 'otk_1' } }));
  const api = createHttpApi('http://127.0.0.1:8787/', { fetchImpl: f });
  const body = { pricing_version: P.version, rights_confirmed: true, lines: [] };
  const res = await api.checkout(body, 'key-1');
  assert.equal(res.order_id, 'PL-1');
  const c = f.calls[0];
  assert.equal(c.url, 'http://127.0.0.1:8787/v1/checkout');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers['Idempotency-Key'], 'key-1');
  assert.match(c.init.headers['Content-Type'], /^application\/json/);
  assert.deepEqual(JSON.parse(c.init.body), body);
});

test('http client: generation and design calls follow the contract', async () => {
  const f = fakeFetch((url) => (url.endsWith('/designs') ? { status: 201, body: { design_id: 'dsg_1', tries_left: 6 } } : { status: 201, body: { generation_id: 'gen_1', image_url: 'https://x/y.png', tries_left: 5 } }));
  const api = createHttpApi('https://api.example', { fetchImpl: f });
  await api.createDesign(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), { rights_confirmed: true, source: 'upload', width: 10, height: 10 });
  const fd = f.calls[0].init.body;
  assert.ok(fd instanceof FormData);
  assert.equal(JSON.parse(fd.get('meta')).rights_confirmed, true);
  assert.equal(fd.get('cutout').type, 'image/png');
  await api.generate('dsg_1', 'sunny');
  assert.equal(f.calls[1].url, 'https://api.example/v1/designs/dsg_1/generations');
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { style_id: 'sunny' });
});

test('http client: contract error bodies become ApiError with retryable flag', async () => {
  const f = fakeFetch(() => ({ status: 504, body: { error: { code: 'provider_timeout', message: 'Timed out.', retryable: true, tries_left: 4 } } }));
  const api = createHttpApi('https://api.example', { fetchImpl: f });
  await assert.rejects(api.generate('d', 'ink'), (e) => e instanceof ApiError && e.code === 'provider_timeout' && e.retryable && e.extra.tries_left === 4);
  const down = createHttpApi('https://api.example', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(down.checkout({}, 'k'), (e) => e.code === 'network_error' && e.retryable);
});

test('checkout redirect must be https or this site', () => {
  const page = 'https://datode.com/sticker/cart.html';
  assert.equal(safeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_1', page), 'https://checkout.stripe.com/c/pay/cs_1');
  assert.equal(safeCheckoutUrl('checkout-demo.html?order=PL-1', page), 'https://datode.com/sticker/checkout-demo.html?order=PL-1');
  assert.equal(safeCheckoutUrl('javascript:alert(1)', page), null);
  assert.equal(safeCheckoutUrl('http://evil.example/', page), null);
});

// ---- local mock backend ----
class MemStorage { constructor() { this.m = new Map(); } getItem(k) { return this.m.get(k) ?? null; } setItem(k, v) { this.m.set(k, String(v)); } }

function mockApi(extra = {}) {
  return createMockApi({
    storage: new MemStorage(), loadPricing: async () => P, delay: async () => {},
    stylizeImpl: async () => ({ blob: new Blob(['x']), width: 10, height: 10 }), ...extra,
  });
}

test('mock backend: free tries are counted, failures and "Just the photo" are not', async () => {
  const api = mockApi({ failGenerations: 1 });
  await assert.rejects(api.createDesign(new Blob(['x']), { rights_confirmed: false }), (e) => e.code === 'rights_not_confirmed');
  const d = await api.createDesign(new Blob(['x']), { rights_confirmed: true });
  assert.equal(d.tries_left, P.ai.free_tries_per_photo);
  await assert.rejects(api.generate(d.design_id, 'ink'), (e) => e.code === 'provider_timeout' && e.extra.tries_left === P.ai.free_tries_per_photo);
  const o = await api.generate(d.design_id, 'original');
  assert.equal(o.tries_left, P.ai.free_tries_per_photo);
  let last;
  for (let i = 0; i < P.ai.free_tries_per_photo; i++) last = await api.generate(d.design_id, 'sunny');
  assert.equal(last.tries_left, 0);
  await assert.rejects(api.generate(d.design_id, 'pop'), (e) => e.status === 429 && e.code === 'generation_quota_exceeded');
});

test('mock backend: checkout re-prices from pricing.json and ignores client amounts', async () => {
  const api = mockApi();
  const ids = ['upl_00000000-0000-4000-8000-000000000001', 'upl_00000000-0000-4000-8000-000000000002'];
  for (const id of ids) await api.upload(id, new Blob(['x']), 'image/png');
  const line = { generation_id: 'gen_1', size: '4', qty: 25, finish: 'matte', shape: 'diecut', border_in: 0.25, print_upload_id: ids[0], cut_upload_id: ids[1] };
  const res = await api.checkout({ pricing_version: P.version, rights_confirmed: true, lines: [{ ...line, unit_cents: 1, line_cents: 1 }], total_cents: 1 }, 'k1');
  const unit = P.unit_price_cents['4']['25'];
  assert.equal(res.total_cents, unit * 25);
  assert.match(res.checkout_url, /^checkout-demo\.html\?order=PL-\d{4}&session_id=cs_demo_/);
  assert.deepEqual(await api.checkout({ pricing_version: P.version, rights_confirmed: true, lines: [line] }, 'k1'), res, 'idempotent');
  await assert.rejects(api.checkout({ pricing_version: 'old', rights_confirmed: true, lines: [line] }, 'k2'), (e) => e.status === 409 && e.extra.quote.total_cents === unit * 25);
  await assert.rejects(api.checkout({ pricing_version: P.version, rights_confirmed: true, lines: [{ ...line, finish: 'holographic' }] }, 'k3'), (e) => e.code === 'invalid_option' && e.field === 'lines[0].finish');
});
