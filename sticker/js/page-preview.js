import { initChrome, markReady, showAlert } from './chrome.js';
import { getDraft, getBlob, putBlob, loadPricing, getCart, putCart } from './state.js';
import { quoteLine, formatMoney, describeOptions, validateOptions } from './pricing.js';
import { addLine, newId } from './cart.js';
import { blobToCanvas, canvasToBlob } from './imaging.js';
import { renderSticker } from './render.js';
import { styleById } from './filters.js';

initChrome();

const $ = (s) => document.querySelector(s);
const LAPTOP_W_IN = 11.97; // 13-inch laptop lid (SPEC §4.1 step 6)
const BOTTLE_W_IN = 2.9;

(async () => {
  const d = getDraft();
  if (!d.generation_id || !d.opts) { location.replace(d.generation_id ? 'edit.html' : 'style.html'); return; }
  const [p, blob] = await Promise.all([loadPricing(), getBlob('gen:' + d.generation_id)]);
  if (!blob || validateOptions(p, d.opts)) { location.replace('edit.html'); return; }
  const o = d.opts;
  const mode = d.cutout?.mode || 'cutout';
  const art = await blobToCanvas(blob);
  const longest = 600;
  const { canvas, geometry } = renderSticker(art, o, longest, { mode, sheen: true, cacheKey: d.generation_id });
  const url = URL.createObjectURL(await canvasToBlob(canvas));
  const sizeIn = Number(o.size);
  // the rendered PNG includes a shadow margin: scale so the sticker body itself is to scale
  const bodyFrac = Math.max(geometry.width, geometry.height) / Math.max(canvas.width, canvas.height);
  const sticker = (cls, widthPct, style) => {
    const img = document.createElement('img');
    img.className = cls;
    img.alt = '';
    img.src = url;
    img.style.cssText = `width:${widthPct}%;${style}`;
    return img;
  };
  const landscape = geometry.width >= geometry.height;
  const widthIn = landscape ? sizeIn : (sizeIn * geometry.width) / geometry.height;
  $('[data-laptop]').append(sticker('placed', ((widthIn / LAPTOP_W_IN) * 100) / bodyFrac, 'left:60%;top:16%;transform:rotate(-6deg)'));
  $('[data-bottle]').append(sticker('placed', Math.min(140, ((widthIn / BOTTLE_W_IN) * 100) / bodyFrac), 'left:50%;top:40%;transform:translateX(-50%) rotate(3deg)'));
  const hand = $('[data-hand]');
  const big = document.createElement('img');
  big.src = url;
  big.alt = `Your ${styleById(d.style_id)?.name.toLowerCase() || ''} sticker, ${describeOptions(p, o)}`;
  big.style.maxHeight = '440px';
  big.style.width = 'auto';
  hand.append(big);

  const q = quoteLine(p, o);
  $('[data-desc]').textContent = `${o.qty} × ${describeOptions(p, o)}`;
  const total = $('[data-total]');
  total.textContent = formatMoney(q.line_cents);
  total.dataset.cents = String(q.line_cents);
  $('[data-unit]').textContent = `${formatMoney(q.unit_cents)} each · shipping included`;

  const add = $('[data-add]');
  add.addEventListener('click', async () => {
    add.disabled = true;
    add.setAttribute('aria-busy', 'true');
    try {
      const id = newId('ln_');
      const thumb = renderSticker(art, o, 200, { mode, sheen: true, cacheKey: d.generation_id }).canvas;
      await putBlob(`line:${id}:art`, blob);
      await putBlob(`line:${id}:thumb`, await canvasToBlob(thumb));
      const { cart } = await getCart();
      const next = addLine(cart, { id, design_id: d.design_id, generation_id: d.generation_id, style_id: d.style_id, opts: o, rights_confirmed: !!d.rights, mode }, p);
      putCart(next);
      location.href = 'cart.html';
    } catch (e) {
      showAlert($('[data-error]'), 'Couldn’t add this to your cart', ' ' + (e.message || 'Please try again.'));
      add.disabled = false;
      add.removeAttribute('aria-busy');
    }
  });
  markReady();
})();
