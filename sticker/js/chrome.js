// Small shared page behaviour: cart count in the header, step indicator, alerts.
import { cartCountSync } from './state.js';
import { BRAND } from './config.js';

export function refreshCartCount() {
  const n = cartCountSync();
  for (const el of document.querySelectorAll('[data-cart-count]')) el.textContent = String(n);
  for (const el of document.querySelectorAll('[data-cart-link]')) el.setAttribute('aria-label', `Cart, ${n} ${n === 1 ? 'design' : 'designs'}`);
}

const STEPS = [['upload', 'Photo'], ['cutout', 'Cutout'], ['style', 'Style'], ['edit', 'Details'], ['preview', 'Preview']];

export function renderStepper() {
  const el = document.querySelector('[data-stepper]');
  if (!el) return;
  const page = document.body.dataset.page;
  const idx = STEPS.findIndex((s) => s[0] === page);
  el.innerHTML = STEPS.map(([id, label], i) => {
    const cls = i < idx ? 'done' : i === idx ? 'now' : '';
    const state = i < idx ? ' (done)' : '';
    return `<li class="${cls}"${i === idx ? ' aria-current="step"' : ''}><b aria-hidden="true">${i + 1}</b><span>${label}<span class="sr-only">${state}</span></span></li>`;
  }).join('');
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Show a message in an alert box: title + text (+ optional action button). Text is never parsed as HTML.
export function showAlert(box, title, text, action) {
  box.hidden = false;
  box.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = title;
  box.append(strong, document.createTextNode(text || ''));
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link-btn';
    b.textContent = action.label;
    if (action.attr) b.setAttribute(action.attr, '');
    b.addEventListener('click', action.onClick);
    box.append(document.createTextNode(' '), b);
  }
}

export function hideAlert(box) {
  box.hidden = true;
  box.textContent = '';
}

export function markReady(value = '1') {
  document.body.dataset.ready = value;
}

export function initChrome() {
  for (const el of document.querySelectorAll('[data-brand]')) el.textContent = BRAND;
  if (BRAND !== 'Peelings') document.title = document.title.replace('Peelings', BRAND);
  refreshCartCount();
  renderStepper();
  document.addEventListener('peelings:cart', refreshCartCount);
  window.addEventListener('storage', refreshCartCount);
  // Links styled as buttons that are disabled must not navigate (and say why, handled per page)
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[aria-disabled="true"]');
    if (a) e.preventDefault();
  }, true);
}
