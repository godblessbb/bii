import { initChrome, markReady, escapeHtml } from './chrome.js';
import { getDraft, setDraft, getBlob, loadPricing } from './state.js';
import { quoteLine, formatMoney, byId, defaultOptions, validateOptions, borderOption } from './pricing.js';
import { blobToCanvas } from './imaging.js';
import { renderSticker } from './render.js';

initChrome();

const $ = (s) => document.querySelector(s);
const form = $('[data-form]');
const stage = $('[data-stage]');
const showCut = $('[data-showcut]');
const PREVIEW_PX = 480;

function seg(name, items, current) {
  return items.map((it) => {
    const id = `${name}-${String(it.v).replace('.', '_')}`;
    const checked = String(current) === String(it.v) ? ' checked' : '';
    const off = it.off ? ' disabled' : '';
    return `<input type="radio" name="${name}" id="${id}" value="${it.v}"${checked}${off}><label for="${id}"${it.off ? ' class="off"' : ''}>${it.t}</label>`;
  }).join('');
}

(async () => {
  const d = getDraft();
  if (!d.generation_id) { location.replace(d.photo ? 'style.html' : 'upload.html'); return; }
  const [p, blob] = await Promise.all([loadPricing(), getBlob('gen:' + d.generation_id)]);
  if (!blob) { location.replace('style.html'); return; }
  const art = await blobToCanvas(blob);
  const mode = d.cutout?.mode || 'cutout';
  const o = { ...defaultOptions(p), ...(d.opts || {}) };
  if (mode === 'photo' && o.shape === 'diecut') o.shape = 'circle';
  if (validateOptions(p, o)) Object.assign(o, defaultOptions(p), mode === 'photo' ? { shape: 'circle' } : {});

  form.querySelector('[data-f=shape]').innerHTML = seg('shape', p.shapes.map((s) => ({ v: s.id, t: escapeHtml(s.label), off: s.enabled === false || (mode === 'photo' && s.id === 'diecut') })), o.shape);
  if (mode === 'photo') {
    const note = $('[data-shape-note]');
    note.hidden = false;
    note.textContent = 'Die-cut follows the outline of a cutout. You chose the whole photo, so circle or square.';
  }
  form.querySelector('[data-f=border_in]').innerHTML = seg('border_in', p.borders_in.map((b) => ({ v: b.inches, t: escapeHtml(b.label), off: b.enabled === false })), o.border_in);
  form.querySelector('[data-f=size]').innerHTML = seg('size', p.sizes.map((s) => ({ v: s.id, t: escapeHtml(s.label), off: s.enabled === false })), o.size);
  form.querySelector('[data-f=qty]').innerHTML = seg('qty', p.quantities.map((q) => ({ v: q, t: String(q) })), o.qty);
  form.querySelector('[data-f=finish]').innerHTML = seg('finish', p.finishes.map((f) => ({
    v: f.id, off: f.enabled === false,
    t: escapeHtml(f.label) + (f.enabled === false ? ' <small>coming soon</small>' : f.surcharge_pct ? ` <small>+${f.surcharge_pct}%</small>` : ''),
  })), o.finish);

  let frame = 0;
  function render() {
    const b = borderOption(p, o.border_in);
    const q = quoteLine(p, o);
    const total = $('[data-total]');
    total.textContent = formatMoney(q.line_cents);
    total.dataset.cents = String(q.line_cents);
    const unit = $('[data-unit]');
    unit.textContent = `${o.qty} × ${byId(p.sizes, o.size).label} · ${formatMoney(q.unit_cents)} each`;
    unit.dataset.cents = String(q.unit_cents);
    setDraft({ opts: { ...o } });
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const { canvas, geometry } = renderSticker(art, o, PREVIEW_PX, { mode, sheen: true, showCut: showCut.checked, cacheKey: d.generation_id });
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Sticker preview: ${byId(p.sizes, o.size).label} ${byId(p.shapes, o.shape).label.toLowerCase()}, ${b.label} white border, ${byId(p.finishes, o.finish).label.toLowerCase()}`);
      canvas.dataset.shape = o.shape;
      canvas.dataset.border = String(o.border_in);
      canvas.style.maxWidth = '100%';
      stage.innerHTML = '';
      stage.append(canvas);
      const sizeIn = Number(o.size), longest = Math.max(geometry.width, geometry.height);
      const wIn = (geometry.width / longest) * sizeIn, hIn = (geometry.height / longest) * sizeIn;
      $('[data-dims]').textContent = `About ${wIn.toFixed(1)} × ${hIn.toFixed(1)} in`;
      markReady(`${o.shape}|${o.border_in}|${o.size}|${o.qty}|${o.finish}`);
    });
  }

  form.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.name || t.type !== 'radio') return;
    if (t.name === 'qty') o.qty = Number(t.value);
    else if (t.name === 'border_in') o.border_in = Number(t.value);
    else o[t.name] = t.value;
    render();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  showCut.addEventListener('change', render);
  render();
})();
