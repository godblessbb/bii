// Shared browser state: pricing, the current design (draft), the cart and the API adapter.
import { resolveApiBase } from './config.js';
import { createHttpApi } from './api.js';
import { createMockApi } from './api-mock.js';
import { loadCart, saveCart, emptyCart } from './cart.js';
import { styleById, stylize } from './filters.js';
import { getBlob, putBlob, deleteBlobs } from './idb.js';
import { blobToCanvas, loadImage, toCanvas, canvasToBlob, makeCanvas, ctx2d } from './imaging.js';

const DRAFT_KEY = 'peelings.draft.v1';
export const STYLE_IMG = 'src/img/style/';
export const SAMPLE_PHOTO = 'assets/sample.jpg';
export const ART_MAX = 1024; // mock style output size (a real provider returns about 1 MP too)

function storage() {
  try { return window.localStorage; } catch { return memStorage; }
}
const memStorage = { m: new Map(), getItem(k) { return this.m.get(k) ?? null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };

// ---------- pricing ----------
let pricingPromise = null;
export function loadPricing(fresh = false) {
  if (!pricingPromise || fresh) {
    pricingPromise = fetch('pricing.json', { cache: fresh ? 'reload' : 'default' }).then((r) => {
      if (!r.ok) throw new Error(`pricing.json ${r.status}`);
      return r.json();
    });
    pricingPromise.catch(() => { pricingPromise = null; });
  }
  return pricingPromise;
}

// ---------- draft (the design being made) ----------
export function getDraft() {
  try { return JSON.parse(storage().getItem(DRAFT_KEY) || 'null') || {}; } catch { return {}; }
}
export function setDraft(patch) {
  const d = { ...getDraft(), ...patch };
  try { storage().setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* quota: keep going */ }
  return d;
}
export async function resetDraft() {
  const d = getDraft();
  const keys = ['draft:photo', 'draft:cutout', ...Object.values(d.generations || {}).map((g) => 'gen:' + g)];
  try { storage().removeItem(DRAFT_KEY); } catch { /* ignore */ }
  await deleteBlobs(keys);
}

// ---------- cart ----------
export async function getCart() {
  const p = await loadPricing();
  return loadCart(storage(), p);
}
export function putCart(cart) {
  saveCart(storage(), cart);
  document.dispatchEvent(new CustomEvent('peelings:cart', { detail: cart }));
}
export function cartCountSync() {
  try {
    const raw = JSON.parse(storage().getItem('peelings.cart.v1') || 'null');
    return raw && Array.isArray(raw.lines) ? raw.lines.length : 0;
  } catch { return 0; }
}
export { emptyCart };

// ---------- API adapter ----------
// Resolved on every page load, so ?api=… on any page (the home page included) takes effect.
const apiBase = resolveApiBase(location.search, storage());
let apiInstance = null;
export function api() {
  if (apiInstance) return apiInstance;
  const base = apiBase;
  if (base) {
    apiInstance = createHttpApi(base);
  } else {
    const failFirst = new URLSearchParams(location.search).get('sim') === 'aifail' ? 1 : 0;
    apiInstance = createMockApi({ storage: storage(), loadPricing, stylizeImpl: mockStylize, failGenerations: failFirst });
  }
  return apiInstance;
}

// Mock style provider (SPEC §8 T2 item 3): the sample photo returns the real example images,
// any other photo gets the deterministic canvas filters from filters.js.
async function mockStylize(designId, styleId) {
  const d = getDraft();
  const style = styleById(styleId);
  let canvas;
  if (d.photo?.source === 'sample' && style?.example) {
    canvas = toCanvas(await loadImage(STYLE_IMG + style.example), ART_MAX);
  } else {
    const blob = await getBlob('draft:cutout');
    if (!blob) throw new Error('cutout missing');
    const src = await blobToCanvas(blob, ART_MAX);
    const im = ctx2d(src).getImageData(0, 0, src.width, src.height);
    const out = stylize(im, styleId);
    canvas = makeCanvas(out.width, out.height);
    ctx2d(canvas).putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
  }
  return { blob: await canvasToBlob(canvas, 'image/png'), width: canvas.width, height: canvas.height };
}

// Generation result -> image blob stored under gen:<id>
export async function storeGeneration(gen) {
  const blob = gen.blob || (await api().fetchImage(gen.image_url));
  await putBlob('gen:' + gen.generation_id, blob);
  return blob;
}

export { getBlob, putBlob, deleteBlobs };

export function waitFrame() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}
