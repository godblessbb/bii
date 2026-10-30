import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quoteLine, quoteCart, unitCents, validateOptions, lowestPack, priceTable, formatMoney, formatMoneyShort, roundHalfUpDiv100, defaultOptions } from '../js/pricing.js';

const P = JSON.parse(readFileSync(new URL('../pricing.json', import.meta.url)));

// Independent re-implementation of the contract rule, with decimal rounding done by hand.
function expectedUnit(p, size, qty, finishId) {
  const base = p.unit_price_cents[size][String(qty)];
  const pct = p.finishes.find((f) => f.id === finishId).surcharge_pct;
  const exact = (base * (100 + pct)) / 100;
  const floor = Math.floor(exact);
  return exact - floor >= 0.5 ? floor + 1 : floor;
}

test('every size x qty x finish matches the pricing.json rule', () => {
  let n = 0;
  for (const s of P.sizes) for (const q of P.quantities) for (const f of P.finishes) {
    const got = quoteLine(P, { size: s.id, qty: q, finish: f.id });
    const unit = expectedUnit(P, s.id, q, f.id);
    assert.equal(got.unit_cents, unit, `${s.id}/${q}/${f.id}`);
    assert.equal(got.line_cents, unit * q);
    n++;
  }
  assert.equal(n, P.sizes.length * P.quantities.length * P.finishes.length);
});

test('round half up is exact integer math (no float drift)', () => {
  assert.equal(roundHalfUpDiv100(50), 1);
  assert.equal(roundHalfUpDiv100(49), 0);
  assert.equal(roundHalfUpDiv100(390 * 135), 527); // 526.5 -> 527
  assert.equal(roundHalfUpDiv100(0), 0);
  // a synthetic surcharge that lands exactly on .5
  const p = { ...P, finishes: [{ id: 'x', label: 'X', surcharge_pct: 50 }] };
  p.unit_price_cents = { 3: { 10: 101 } };
  assert.equal(unitCents(p, { size: '3', qty: 10, finish: 'x' }), 152); // 151.5 -> 152
});

test('cart totals: subtotal is the sum of lines, shipping from pricing.json', () => {
  const lines = [
    { opts: { size: '3', qty: 10, finish: 'glossy' } },
    { opts: { size: '4', qty: 25, finish: 'matte' } },
  ];
  const t = quoteCart(P, lines);
  const sub = expectedUnit(P, '3', 10, 'glossy') * 10 + expectedUnit(P, '4', 25, 'matte') * 25;
  assert.equal(t.subtotal_cents, sub);
  const m = P.shipping.methods[0];
  const ship = sub >= m.free_over_cents ? 0 : m.price_cents;
  assert.equal(t.shipping_cents, ship);
  assert.equal(t.total_cents, sub + ship);
  assert.deepEqual(quoteCart(P, []), { lines: [], subtotal_cents: 0, shipping_cents: 0, total_cents: 0, currency: P.currency });
});

test('options outside pricing.json, or disabled, are rejected', () => {
  const ok = defaultOptions(P);
  assert.equal(validateOptions(P, ok), null);
  assert.equal(validateOptions(P, { ...ok, size: '5' }).field, 'size');
  assert.equal(validateOptions(P, { ...ok, qty: 11 }).field, 'qty');
  assert.equal(validateOptions(P, { ...ok, shape: 'star' }).field, 'shape');
  assert.equal(validateOptions(P, { ...ok, border_in: 0.3 }).field, 'border_in');
  const disabled = P.finishes.find((f) => f.enabled === false);
  if (disabled) assert.equal(validateOptions(P, { ...ok, finish: disabled.id }).field, 'finish');
});

test('home page numbers come from the same rule', () => {
  const low = lowestPack(P);
  let min = Infinity;
  for (const s of P.sizes) for (const q of P.quantities) min = Math.min(min, expectedUnit(P, s.id, q, 'glossy') * q);
  assert.equal(low.cents, min);
  const t = priceTable(P);
  assert.equal(t.rows.length, P.sizes.length);
  assert.equal(t.rows[0].cells.length, P.display_quantities.length);
  assert.equal(t.rows[1].cells[0].line_cents, expectedUnit(P, P.sizes[1].id, P.display_quantities[0], 'glossy') * P.display_quantities[0]);
});

test('money formatting', () => {
  assert.equal(formatMoney(3900), '$39.00');
  assert.equal(formatMoney(18200), '$182.00');
  assert.equal(formatMoney(123456), '$1,234.56');
  assert.equal(formatMoney(5), '$0.05');
  assert.equal(formatMoneyShort(3200), '$32');
  assert.equal(formatMoneyShort(3250), '$32.50');
});
