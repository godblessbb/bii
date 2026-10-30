// Success page skeleton. Stripe sends people here with ?order=PL-…&session_id=… (api_contract.md §6).
// T4 replaces the static text with GET /v1/orders/{id}?token=… (token kept in sessionStorage by the cart page).
import { initChrome, markReady } from './chrome.js';
import { getCart, putCart, deleteBlobs, loadPricing, resetDraft } from './state.js';
import { removeLine } from './cart.js';
import { shippingMethod } from './pricing.js';

initChrome();

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const orderId = params.get('order') || '';
const session = params.get('session_id') || '';

(async () => {
  const p = await loadPricing();
  $('[data-eta]').textContent = shippingMethod(p).estimate_business_days.join('–');
  if (/^PL-[A-Za-z0-9]+$/.test(orderId)) $('[data-order-id]').textContent = orderId;
  if (session.startsWith('cs_demo_')) {
    $('[data-demo-note]').hidden = false;
    $('[data-headline]').textContent = 'Demo order finished';
    $('[data-receipt]').textContent = 'In the real shop, a receipt and a private tracking link would go to the email you gave at checkout.';
  }
  // The order is placed: take its designs out of the cart (only the ones that went to checkout).
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem('peelings.pending_order') || 'null'); } catch { pending = null; }
  if (pending && pending.order_id === orderId) {
    let { cart } = await getCart();
    for (const id of pending.line_ids) cart = removeLine(cart, id);
    putCart(cart);
    await deleteBlobs(pending.line_ids.flatMap((id) => [`line:${id}:art`, `line:${id}:thumb`]));
    await resetDraft();
    try { sessionStorage.removeItem('peelings.pending_order'); sessionStorage.removeItem('peelings.checkout_key'); } catch { /* ignore */ }
  }
  markReady();
})();
