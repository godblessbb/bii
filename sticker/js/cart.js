// Cart state: plain data + pure functions, persisted through any Storage-like object
// ({ getItem, setItem, removeItem }). Images live in IndexedDB keyed by line id (see idb.js);
// this module only keeps the small JSON part, so it can be unit tested without a browser.
import { validateOptions, quoteCart } from './pricing.js';

export const CART_KEY = 'peelings.cart.v1';
export const CART_VERSION = 1;

export function emptyCart() {
  return { version: CART_VERSION, lines: [] };
}

function cleanOpts(o) {
  return { shape: o.shape, border_in: Number(o.border_in), size: String(o.size), qty: Number(o.qty), finish: o.finish };
}

export class CartError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// line: { id, design_id, generation_id, style_id, opts, rights_confirmed }
export function addLine(cart, line, pricing) {
  const max = pricing.limits?.max_lines_per_order ?? 10;
  if (cart.lines.length >= max) throw new CartError('cart_full', `A cart holds up to ${max} designs. Check out these first, then start another order.`);
  if (!line.id || !line.generation_id) throw new CartError('bad_line', 'This design is missing its image. Please make it again.');
  if (!line.rights_confirmed) throw new CartError('rights_not_confirmed', 'Please confirm you have the right to use this photo.');
  const opts = cleanOpts(line.opts || {});
  const bad = validateOptions(pricing, opts);
  if (bad) throw new CartError('invalid_option', bad.message);
  const clean = {
    id: String(line.id),
    design_id: line.design_id ? String(line.design_id) : null,
    generation_id: String(line.generation_id),
    style_id: String(line.style_id || 'original'),
    mode: line.mode === 'photo' ? 'photo' : 'cutout', // 'photo' = whole photo, no cutout (circle / square)
    opts,
    rights_confirmed: true,
    added_at: line.added_at || new Date().toISOString(),
  };
  return { ...cart, lines: [...cart.lines.filter((l) => l.id !== clean.id), clean] };
}

export function setQty(cart, id, qty, pricing) {
  return {
    ...cart,
    lines: cart.lines.map((l) => {
      if (l.id !== id) return l;
      const opts = { ...l.opts, qty: Number(qty) };
      const bad = validateOptions(pricing, opts);
      if (bad) throw new CartError('invalid_option', bad.message);
      return { ...l, opts };
    }),
  };
}

export function removeLine(cart, id) {
  return { ...cart, lines: cart.lines.filter((l) => l.id !== id) };
}

export function itemCount(cart) {
  return cart.lines.length;
}

export function totals(cart, pricing) {
  return quoteCart(pricing, cart.lines);
}

// Parse what's in storage. Lines whose options are no longer sold (e.g. pricing.json changed) are dropped
// and reported, so a stale cart can never send an invalid order.
export function parseCart(json, pricing) {
  let raw;
  try { raw = JSON.parse(json || 'null'); } catch { raw = null; }
  if (!raw || raw.version !== CART_VERSION || !Array.isArray(raw.lines)) return { cart: emptyCart(), dropped: [] };
  const lines = [], dropped = [];
  for (const l of raw.lines) {
    if (!l || typeof l.id !== 'string' || typeof l.generation_id !== 'string' || !l.opts) { dropped.push(l); continue; }
    const opts = cleanOpts(l.opts);
    if (pricing && validateOptions(pricing, opts)) { dropped.push(l); continue; }
    lines.push({ ...l, opts });
  }
  return { cart: { version: CART_VERSION, lines }, dropped };
}

export function serializeCart(cart) {
  return JSON.stringify({ version: CART_VERSION, lines: cart.lines });
}

export function loadCart(storage, pricing) {
  let json = null;
  try { json = storage.getItem(CART_KEY); } catch { json = null; }
  return parseCart(json, pricing);
}

export function saveCart(storage, cart) {
  try { storage.setItem(CART_KEY, serializeCart(cart)); return true; } catch { return false; }
}

// Body of POST /v1/checkout (api_contract.md §6). Designs and options only: no prices, no amounts.
// uploads: { [lineId]: { print_upload_id, cut_upload_id } }
export function checkoutPayload(cart, pricing, uploads) {
  if (!cart.lines.length) throw new CartError('empty', 'Your cart is empty.');
  return {
    pricing_version: pricing.version,
    rights_confirmed: cart.lines.every((l) => l.rights_confirmed === true),
    lines: cart.lines.map((l) => ({
      generation_id: l.generation_id,
      size: String(l.opts.size),
      qty: Number(l.opts.qty),
      finish: l.opts.finish,
      shape: l.opts.shape,
      border_in: Number(l.opts.border_in),
      print_upload_id: uploads[l.id].print_upload_id,
      cut_upload_id: uploads[l.id].cut_upload_id,
    })),
  };
}

export function newId(prefix) {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return prefix + c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${prefix}${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
