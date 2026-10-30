// Stand-in for Stripe Checkout while no backend is configured (api_contract.md: without STRIPE_SECRET_KEY
// the backend returns a mock checkout_url pointing at the frontend). Clearly labelled; asks for no details.
import { initChrome, markReady, showAlert, escapeHtml } from './chrome.js';
import { api, loadPricing } from './state.js';
import { formatMoney, describeOptions } from './pricing.js';

initChrome();

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const orderId = params.get('order') || '';
const session = params.get('session_id') || '';

(async () => {
  const p = await loadPricing();
  const pay = $('[data-pay]');
  if (api().kind !== 'mock' || !/^PL-\d+$/.test(orderId)) {
    showAlert($('[data-error]'), 'There’s no demo order here', ' Go back to your cart to check out.');
    markReady('missing');
    return;
  }
  let o;
  try {
    o = await api().getOrder(orderId);
  } catch (e) {
    showAlert($('[data-error]'), 'There’s no demo order here', ' ' + e.message + ' Go back to your cart to check out.');
    markReady('missing');
    return;
  }
  $('[data-order]').hidden = false;
  $('[data-order-id]').textContent = orderId;
  $('[data-lines]').innerHTML = o.lines.map((l) => `<li><span>${l.qty} × ${escapeHtml(describeOptions(p, l))}</span><span>${formatMoney(l.line_cents)}</span></li>`).join('');
  $('[data-ship]').textContent = o.shipping_cents ? formatMoney(o.shipping_cents) : 'Free';
  const grand = $('[data-grand]');
  grand.textContent = formatMoney(o.total_cents);
  grand.dataset.cents = String(o.total_cents);
  pay.href = `success.html?order=${encodeURIComponent(orderId)}&session_id=${encodeURIComponent(session)}`;
  pay.setAttribute('aria-disabled', 'false');
  pay.addEventListener('click', () => api().completeDemoOrder(orderId));
  markReady();
})();
