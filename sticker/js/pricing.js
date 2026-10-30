// Pricing: the only place the storefront turns options into money.
// Every number comes from sticker/pricing.json; nothing here hard-codes a price.
// Rule (SPEC §3.1, api_contract.md §0), identical on the server:
//   unit_cents = round_half_up(unit_price_cents[size][qty] * (100 + finish.surcharge_pct) / 100)
//   line_cents = unit_cents * qty;  subtotal = sum(line_cents);  total = subtotal + shipping
// The browser only *displays* these numbers. The checkout request never carries them.

export function byId(list, id) {
  for (const it of list || []) if (it.id === id) return it;
  return null;
}

// round_half_up(n / 100) for a non-negative integer n, in exact integer math.
export function roundHalfUpDiv100(n) {
  return Math.floor((n + 50) / 100);
}

export function borderOption(p, inches) {
  for (const b of p.borders_in || []) if (Math.abs(b.inches - Number(inches)) < 1e-9) return b;
  return null;
}

// Returns null when the options are orderable, otherwise { field, message } (shape of the API's invalid_option).
export function validateOptions(p, o) {
  if (!o) return { field: 'options', message: 'Missing sticker options.' };
  const size = byId(p.sizes, String(o.size));
  if (!size || size.enabled === false) return { field: 'size', message: 'That size is not available.' };
  if (!p.quantities.includes(Number(o.qty))) return { field: 'qty', message: 'That pack size is not available.' };
  const fin = byId(p.finishes, o.finish);
  if (!fin) return { field: 'finish', message: 'That finish is not available.' };
  if (fin.enabled === false) return { field: 'finish', message: `${fin.label} finish is not available yet.` };
  const shape = byId(p.shapes, o.shape);
  if (!shape || shape.enabled === false) return { field: 'shape', message: 'That shape is not available.' };
  const b = borderOption(p, o.border_in);
  if (!b || b.enabled === false) return { field: 'border_in', message: 'That border width is not available.' };
  if (p.unit_price_cents?.[size.id]?.[String(o.qty)] == null) return { field: 'qty', message: 'That pack size is not available.' };
  return null;
}

export function unitCents(p, o) {
  const base = p.unit_price_cents?.[String(o.size)]?.[String(o.qty)];
  const fin = byId(p.finishes, o.finish);
  if (base == null || !fin) throw new Error('invalid option');
  return roundHalfUpDiv100(base * (100 + fin.surcharge_pct));
}

export function quoteLine(p, o) {
  const unit = unitCents(p, o);
  return { unit_cents: unit, line_cents: unit * Number(o.qty) };
}

export function shippingMethod(p) {
  return p.shipping.methods[0];
}

// lines: [{ opts }] or plain option objects
export function quoteCart(p, lines) {
  let subtotal = 0;
  const out = lines.map((l) => {
    const q = quoteLine(p, l.opts || l);
    subtotal += q.line_cents;
    return q;
  });
  const m = shippingMethod(p);
  const shipping = lines.length === 0 ? 0 : subtotal >= m.free_over_cents ? 0 : m.price_cents;
  return { lines: out, subtotal_cents: subtotal, shipping_cents: shipping, total_cents: subtotal + shipping, currency: p.currency };
}

export function formatMoney(cents) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${neg ? '-' : ''}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

// "$32" instead of "$32.00" for headline copy
export function formatMoneyShort(cents) {
  return formatMoney(cents).replace(/\.00$/, '');
}

export function defaultFinish(p) {
  return p.finishes.find((f) => f.enabled !== false);
}

export function lowestPack(p) {
  let best = null;
  const fin = defaultFinish(p);
  for (const s of p.sizes) {
    for (const q of p.quantities) {
      const o = { size: s.id, qty: q, finish: fin.id };
      const c = quoteLine(p, o).line_cents;
      if (!best || c < best.cents) best = { cents: c, size: s.id, qty: q };
    }
  }
  return best;
}

// Rows for the home-page price table (default finish, display quantities).
export function priceTable(p) {
  const fin = defaultFinish(p);
  const qs = p.display_quantities || p.quantities;
  return {
    quantities: qs,
    rows: p.sizes.map((s) => ({
      size: s,
      cells: qs.map((q) => ({ qty: q, ...quoteLine(p, { size: s.id, qty: q, finish: fin.id }) })),
    })),
  };
}

export function defaultOptions(p) {
  const mid = p.sizes[Math.floor((p.sizes.length - 1) / 2)] || p.sizes[0];
  const border = p.borders_in.find((b) => Math.abs(b.inches - 0.125) < 1e-9) || p.borders_in[0];
  return { shape: p.shapes[0].id, border_in: border.inches, size: mid.id, qty: p.quantities[0], finish: defaultFinish(p).id };
}

export function describeOptions(p, o) {
  const size = byId(p.sizes, String(o.size));
  const shape = byId(p.shapes, o.shape);
  const fin = byId(p.finishes, o.finish);
  return `${size ? size.label : o.size + ' in'} ${shape ? shape.label.toLowerCase() : o.shape}, ${fin ? fin.label.toLowerCase() : o.finish}`;
}
