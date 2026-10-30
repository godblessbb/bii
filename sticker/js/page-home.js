import { initChrome, markReady } from './chrome.js';
import { loadPricing } from './state.js';
import { priceTable, lowestPack, formatMoney, formatMoneyShort, shippingMethod } from './pricing.js';

initChrome();

loadPricing().then((p) => {
  const t = priceTable(p);
  const table = document.querySelector('[data-price-table]');
  const caption = table.querySelector('caption');
  const head = `<thead><tr><th scope="col">Size</th>${t.quantities.map((q) => `<th scope="col">${q} stickers</th>`).join('')}</tr></thead>`;
  const body = t.rows.map((r) => `<tr><th scope="row">${r.size.label}</th>${r.cells.map((c) => `<td>${formatMoney(c.line_cents)}<span class="each">${formatMoney(c.unit_cents)} each</span></td>`).join('')}</tr>`).join('');
  table.innerHTML = head + `<tbody>${body}</tbody>`;
  if (caption) table.prepend(caption);
  const low = lowestPack(p);
  document.querySelector('[data-from]').textContent = `from ${formatMoneyShort(low.cents)} for ${low.qty}`;
  const m = shippingMethod(p);
  const finishes = p.finishes.filter((f) => f.enabled !== false && !f.surcharge_pct).map((f) => f.label.toLowerCase());
  document.querySelector('[data-ship-note]').textContent =
    `Prices include ${m.label.replace(/^Free/, 'free')} (about ${m.estimate_business_days.join('–')} business days door to door). ` +
    `${finishes.join(' or ').replace(/^./, (c) => c.toUpperCase())}, any shape, same price.`;
  markReady();
}).catch(() => {
  document.querySelector('[data-ship-note]').textContent = 'Prices could not be loaded right now. Please refresh the page.';
});
