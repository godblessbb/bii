import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyCart, addLine, setQty, removeLine, loadCart, saveCart, parseCart, checkoutPayload, CART_KEY, CartError, totals } from '../js/cart.js';
import { quoteLine } from '../js/pricing.js';

const P = JSON.parse(readFileSync(new URL('../pricing.json', import.meta.url)));

class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

const line = (id, opts = {}) => ({
  id, design_id: 'dsg_1', generation_id: 'gen_' + id, style_id: 'sunny', rights_confirmed: true,
  opts: { shape: 'diecut', border_in: 0.125, size: '3', qty: 10, finish: 'glossy', ...opts },
});

test('add, change quantity, remove', () => {
  let c = emptyCart();
  c = addLine(c, line('a'), P);
  c = addLine(c, line('b', { size: '4', qty: 25, finish: 'matte' }), P);
  assert.equal(c.lines.length, 2);
  c = setQty(c, 'a', 50, P);
  assert.equal(c.lines[0].opts.qty, 50);
  const t = totals(c, P);
  assert.equal(t.subtotal_cents, quoteLine(P, { size: '3', qty: 50, finish: 'glossy' }).line_cents + quoteLine(P, { size: '4', qty: 25, finish: 'matte' }).line_cents);
  c = removeLine(c, 'a');
  assert.deepEqual(c.lines.map((l) => l.id), ['b']);
});

test('functions do not mutate the previous state', () => {
  const c0 = addLine(emptyCart(), line('a'), P);
  const snapshot = JSON.stringify(c0);
  setQty(c0, 'a', 25, P);
  removeLine(c0, 'a');
  addLine(c0, line('b'), P);
  assert.equal(JSON.stringify(c0), snapshot);
});

test('invalid options, missing rights and a full cart are refused', () => {
  assert.throws(() => addLine(emptyCart(), line('a', { qty: 7 }), P), CartError);
  assert.throws(() => addLine(emptyCart(), { ...line('a'), rights_confirmed: false }, P), /right to use/);
  const off = P.finishes.find((f) => f.enabled === false);
  if (off) assert.throws(() => addLine(emptyCart(), line('a', { finish: off.id }), P), /not available/);
  let c = emptyCart();
  for (let i = 0; i < P.limits.max_lines_per_order; i++) c = addLine(c, line('l' + i), P);
  assert.throws(() => addLine(c, line('one-more'), P), (e) => e.code === 'cart_full');
  assert.throws(() => setQty(addLine(emptyCart(), line('a'), P), 'a', 3, P), CartError);
});

test('survives a save / load round trip (what a page refresh does)', () => {
  const s = new MemStorage();
  let c = addLine(emptyCart(), line('a'), P);
  c = addLine(c, line('b', { shape: 'circle' }), P);
  assert.ok(saveCart(s, c));
  const { cart, dropped } = loadCart(s, P);
  assert.deepEqual(cart, c);
  assert.equal(dropped.length, 0);
});

test('corrupt or stale storage never breaks the page', () => {
  const s = new MemStorage();
  s.setItem(CART_KEY, '{not json');
  assert.deepEqual(loadCart(s, P).cart.lines, []);
  s.setItem(CART_KEY, JSON.stringify({ version: 1, lines: [line('ok'), { ...line('bad'), opts: { ...line('bad').opts, size: '9' } }, null] }));
  const { cart, dropped } = loadCart(s, P);
  assert.deepEqual(cart.lines.map((l) => l.id), ['ok']);
  assert.equal(dropped.length, 2);
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadCart(throwing, P).cart.lines, []);
  assert.equal(saveCart(throwing, emptyCart()), false);
  assert.deepEqual(parseCart(JSON.stringify({ version: 99, lines: [line('x')] }), P).cart.lines, []);
});

test('checkout payload carries designs and options only, never prices', () => {
  let c = addLine(emptyCart(), line('a'), P);
  c = addLine(c, line('b', { size: '2', qty: 50 }), P);
  const uploads = { a: { print_upload_id: 'upl_1', cut_upload_id: 'upl_2' }, b: { print_upload_id: 'upl_3', cut_upload_id: 'upl_4' } };
  const body = checkoutPayload(c, P, uploads);
  assert.deepEqual(Object.keys(body).sort(), ['lines', 'pricing_version', 'rights_confirmed']);
  assert.equal(body.pricing_version, P.version);
  assert.equal(body.rights_confirmed, true);
  assert.deepEqual(Object.keys(body.lines[0]).sort(), ['border_in', 'cut_upload_id', 'finish', 'generation_id', 'print_upload_id', 'qty', 'shape', 'size']);
  assert.deepEqual(body.lines[1], { generation_id: 'gen_b', size: '2', qty: 50, finish: 'glossy', shape: 'diecut', border_in: 0.125, print_upload_id: 'upl_3', cut_upload_id: 'upl_4' });
  assert.doesNotMatch(JSON.stringify(body), /cents|amount|"price|total/);
  assert.throws(() => checkoutPayload(emptyCart(), P, {}), /empty/);
});
