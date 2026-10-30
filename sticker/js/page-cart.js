import { initChrome, markReady, showAlert, hideAlert, escapeHtml } from './chrome.js';
import { api, getCart, putCart, getBlob, deleteBlobs, loadPricing } from './state.js';
import { setQty, removeLine, totals, checkoutPayload, newId } from './cart.js';
import { quoteLine, formatMoney, byId, shippingMethod } from './pricing.js';
import { blobToCanvas } from './imaging.js';
import { renderPrintFiles } from './render.js';
import { safeCheckoutUrl } from './api.js';
import { styleById } from './filters.js';

initChrome();

const $ = (s) => document.querySelector(s);
const list = $('[data-lines]');
const summary = $('[data-summary]');
const err = $('[data-error]');
const status = $('[data-status]');
const btn = $('[data-checkout]');
const thumbUrls = new Map();
let p, cart;

async function thumbFor(id) {
  if (thumbUrls.has(id)) return thumbUrls.get(id);
  const b = await getBlob(`line:${id}:thumb`);
  const url = b ? URL.createObjectURL(b) : '';
  thumbUrls.set(id, url);
  return url;
}

async function draw() {
  if (!cart.lines.length) {
    list.innerHTML = '<li class="empty"><p class="serif" style="font-size:24px">Your cart is empty.</p><p class="muted-strong" style="margin:8px 0 18px">Start with a photo you love.</p><a class="btn accent" href="upload.html">Make a sticker</a></li>';
    summary.hidden = true;
    markReady('empty');
    return;
  }
  summary.hidden = false;
  const rows = await Promise.all(cart.lines.map(async (l) => {
    const q = quoteLine(p, l.opts);
    const s = styleById(l.style_id);
    const name = s ? s.name : 'Sticker';
    const thumb = await thumbFor(l.id);
    const meta = `${byId(p.sizes, l.opts.size).label} · ${byId(p.shapes, l.opts.shape).label} · ${byId(p.finishes, l.opts.finish).label} · ${formatMoney(q.unit_cents)} each`;
    const opts = p.quantities.map((n) => `<option value="${n}"${n === l.opts.qty ? ' selected' : ''}>${n}</option>`).join('');
    return `<li class="line" data-line="${escapeHtml(l.id)}">` +
      `<div class="thumb">${thumb ? `<img src="${thumb}" alt="${escapeHtml(name)} sticker preview">` : ''}</div>` +
      `<div><div class="title">${escapeHtml(name)}</div><div class="meta">${meta}</div>` +
      `<div class="qty"><label for="q-${escapeHtml(l.id)}" class="small">Pack of</label><select id="q-${escapeHtml(l.id)}" data-qty="${escapeHtml(l.id)}">${opts}</select>` +
      `<button class="link-btn small rm" type="button" data-rm="${escapeHtml(l.id)}" aria-label="Remove ${escapeHtml(name)} sticker">Remove</button></div></div>` +
      `<div class="price" data-line-cents="${q.line_cents}">${formatMoney(q.line_cents)}</div></li>`;
  }));
  list.innerHTML = rows.join('');
  const t = totals(cart, p);
  const m = shippingMethod(p);
  $('[data-sub]').textContent = formatMoney(t.subtotal_cents);
  $('[data-ship]').textContent = t.shipping_cents ? formatMoney(t.shipping_cents) : 'Free';
  $('[data-ship-hint]').textContent = t.shipping_cents
    ? `Add ${formatMoney(m.free_over_cents - t.subtotal_cents)} more for free shipping`
    : `US only · arrives in about ${m.estimate_business_days.join('–')} business days`;
  const grand = $('[data-grand]');
  grand.textContent = formatMoney(t.total_cents);
  grand.dataset.cents = String(t.total_cents);
  markReady(String(cart.lines.length));
}

list.addEventListener('change', (e) => {
  const id = e.target.dataset.qty;
  if (!id) return;
  try {
    cart = setQty(cart, id, Number(e.target.value), p);
    putCart(cart);
    hideAlert(err);
    draw().then(() => document.getElementById(e.target.id)?.focus());
  } catch (x) {
    showAlert(err, 'Couldn’t change that', ' ' + x.message);
  }
});

list.addEventListener('click', async (e) => {
  const id = e.target.dataset.rm;
  if (!id) return;
  cart = removeLine(cart, id);
  putCart(cart);
  await deleteBlobs([`line:${id}:art`, `line:${id}:thumb`]);
  await draw();
  status.textContent = 'Removed from your cart.';
  (list.querySelector('select') || $('h1')).focus?.();
});

// Same idempotency key while the cart is unchanged, so a double tap or a retry can't create two orders.
function idempotencyKey(body) {
  const sig = JSON.stringify(body.lines.map((l) => [l.generation_id, l.size, l.qty, l.finish, l.shape, l.border_in]));
  try {
    const saved = JSON.parse(sessionStorage.getItem('peelings.checkout_key') || 'null');
    if (saved && saved.sig === sig) return saved.key;
    const key = newId('');
    sessionStorage.setItem('peelings.checkout_key', JSON.stringify({ sig, key }));
    return key;
  } catch {
    return newId('');
  }
}

async function checkout() {
  hideAlert(err);
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    const uploads = {};
    let i = 0;
    for (const l of cart.lines) {
      i++;
      status.textContent = `Preparing print files (${i} of ${cart.lines.length})…`;
      const blob = await getBlob(`line:${l.id}:art`);
      if (!blob) throw Object.assign(new Error('One design lost its image (browser storage was cleared). Please remove it and make it again.'), { code: 'missing_art' });
      const art = await blobToCanvas(blob);
      const files = await renderPrintFiles(art, l.opts, l.mode || 'cutout');
      const printId = newId('upl_'), cutId = newId('upl_');
      status.textContent = `Uploading print files (${i} of ${cart.lines.length})…`;
      await api().upload(printId, files.png, 'image/png');
      await api().upload(cutId, new Blob([files.svg], { type: 'image/svg+xml' }), 'image/svg+xml');
      uploads[l.id] = { print_upload_id: printId, cut_upload_id: cutId };
    }
    status.textContent = 'Opening secure checkout…';
    const body = checkoutPayload(cart, p, uploads);
    const res = await api().checkout(body, idempotencyKey(body));
    const url = safeCheckoutUrl(res.checkout_url, location.href);
    if (!url) throw new Error('The checkout link we got back doesn’t look right. Please try again.');
    try {
      sessionStorage.setItem(`peelings.order_token.${res.order_id}`, res.order_token || '');
      sessionStorage.setItem('peelings.pending_order', JSON.stringify({ order_id: res.order_id, line_ids: cart.lines.map((l) => l.id) }));
    } catch { /* the success page copes without it */ }
    markReady('redirect');
    location.assign(url);
  } catch (e) {
    status.textContent = '';
    if (e.code === 'pricing_version_mismatch') {
      p = await loadPricing(true);
      ({ cart } = await getCart());
      await draw();
      showAlert(err, 'Prices were just updated', ' Please check the new total, then tap Check out again.');
    } else {
      showAlert(err, 'Checkout didn’t start', ' ' + (e.message || 'Please try again.') + (e.retryable ? ' Nothing was charged.' : ''));
    }
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    markReady('error');
  }
}

(async () => {
  p = await loadPricing();
  const loaded = await getCart();
  cart = loaded.cart;
  if (loaded.dropped.length) {
    putCart(cart);
    showAlert($('[data-dropped]'), 'Something in your cart changed', ` ${loaded.dropped.length === 1 ? 'One design was' : `${loaded.dropped.length} designs were`} removed because that option is no longer available.`);
  }
  if (new URLSearchParams(location.search).get('canceled')) $('[data-canceled]').hidden = false;
  $('[data-demo-note]').hidden = api().kind !== 'mock';
  btn.addEventListener('click', checkout);
  await draw();
})();
