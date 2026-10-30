import { initChrome, showAlert, hideAlert, markReady, escapeHtml } from './chrome.js';
import { api, getDraft, setDraft, getBlob, storeGeneration, loadPricing, STYLE_IMG } from './state.js';
import { STYLES, styleById } from './filters.js';
import { blobToCanvas } from './imaging.js';
import { renderSticker } from './render.js';

initChrome();

const $ = (s) => document.querySelector(s);
const grid = $('[data-styles]');
const stage = $('[data-stage]');
const err = $('[data-error]');
const next = $('[data-next]');
const left = $('[data-left]');
const PREVIEW_OPTS = { shape: 'diecut', border_in: 0.125, size: '3', finish: 'matte' };

let running = false;
let cutoutUrl = null;

function setLeft(n, total) {
  if (n == null) { left.textContent = ''; return; }
  left.textContent = `${n} of ${total} free tries left for this photo. Failed tries and “Just the photo” don’t count.`;
}

function drawGrid(d) {
  grid.innerHTML = STYLES.map((s) => {
    const src = s.example ? STYLE_IMG + s.example : cutoutUrl;
    const made = d.generations?.[s.id] ? '<span class="done-mark">made</span>' : '';
    const alt = s.example ? `${s.name} example` : 'Your cutout';
    return `<div class="style-opt"><input type="radio" name="style" id="st-${s.id}" value="${s.id}"${d.style_id === s.id ? ' checked' : ''}>` +
      `<label for="st-${s.id}"><img src="${escapeHtml(src || '')}" alt="${alt}" loading="lazy" width="120" height="120">${s.name}${made}</label></div>`;
  }).join('');
}

async function showResult(styleId, generationId) {
  const blob = await getBlob('gen:' + generationId);
  if (!blob) return false;
  const d = getDraft();
  const art = await blobToCanvas(blob);
  const mode = d.cutout?.mode || 'cutout';
  const opts = mode === 'photo' ? { ...PREVIEW_OPTS, shape: 'circle' } : PREVIEW_OPTS;
  const { canvas } = renderSticker(art, opts, 460, { mode, sheen: false });
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Your sticker in the ${styleById(styleId).name} style`);
  canvas.style.maxWidth = '100%';
  const cap = document.createElement('figcaption');
  const sampleExample = d.photo?.source === 'sample' && styleById(styleId).example && api().kind === 'mock';
  cap.textContent = styleById(styleId).name + (api().kind === 'mock' && styleId !== 'original' && !sampleExample ? ' · preview filter (the real style is drawn by our AI once ordering opens)' : '');
  stage.innerHTML = '';
  stage.append(canvas, cap);
  next.setAttribute('aria-disabled', 'false');
  markReady(styleId);
  return true;
}

function progress(styleId) {
  stage.innerHTML = `<div class="busy" role="status" aria-live="polite"><div class="progress" role="progressbar" aria-label="Drawing progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div><span data-progress-text>Drawing your ${escapeHtml(styleById(styleId).name.toLowerCase())} sticker&hellip;</span></div>`;
  const bar = stage.querySelector('.progress');
  const fill = bar.firstElementChild;
  const text = stage.querySelector('[data-progress-text]');
  const t0 = performance.now();
  const expected = api().kind === 'mock' ? 1200 : 15000;
  const timer = setInterval(() => {
    const t = performance.now() - t0;
    const pct = Math.min(95, Math.round(100 * (1 - Math.exp(-t / expected * 1.6))));
    fill.style.width = pct + '%';
    bar.setAttribute('aria-valuenow', String(pct));
    if (t > 4000) text.textContent = `Still drawing… ${Math.round(t / 1000)} s. This can take up to a minute.`;
  }, 200);
  return () => clearInterval(timer);
}

async function ensureDesign() {
  const d = getDraft();
  if (d.design_id) return d.design_id;
  const blob = await getBlob('draft:cutout');
  if (!blob) { location.replace('cutout.html'); throw new Error('no cutout'); }
  const res = await api().createDesign(blob, { rights_confirmed: !!d.rights, source: d.photo?.source === 'sample' ? 'sample' : 'upload', width: d.cutout?.width, height: d.cutout?.height });
  setDraft({ design_id: res.design_id, tries_left: res.tries_left });
  return res.design_id;
}

async function run(styleId) {
  if (running) return;
  const d = getDraft();
  hideAlert(err);
  // already made in this session: switch back without spending a try
  if (d.generations?.[styleId]) {
    setDraft({ style_id: styleId, generation_id: d.generations[styleId] });
    if (await showResult(styleId, d.generations[styleId])) return;
  }
  running = true;
  next.setAttribute('aria-disabled', 'true');
  delete document.body.dataset.ready;
  const stop = progress(styleId);
  const p = await loadPricing();
  try {
    const designId = await ensureDesign();
    const gen = await api().generate(designId, styleId);
    await storeGeneration(gen);
    const cur = getDraft();
    setDraft({ style_id: styleId, generation_id: gen.generation_id, tries_left: gen.tries_left, generations: { ...(cur.generations || {}), [styleId]: gen.generation_id } });
    setLeft(gen.tries_left, p.ai.free_tries_per_photo);
    stop();
    await showResult(styleId, gen.generation_id);
    drawGrid(getDraft());
    grid.querySelector(`#st-${styleId}`)?.focus({ preventScroll: true });
  } catch (e) {
    stop();
    stage.innerHTML = '<p class="muted">No result for that style yet.</p>';
    if (e.extra && typeof e.extra.tries_left === 'number') setDraft({ tries_left: e.extra.tries_left });
    const cur = getDraft();
    setLeft(cur.tries_left, p.ai.free_tries_per_photo);
    if (e.code === 'generation_quota_exceeded') {
      showAlert(err, 'You’ve used the free tries for this photo', ' Pick one of the styles you already made, choose “Just the photo”, or start over with a new photo.');
    } else if (e.code === 'content_rejected') {
      showAlert(err, 'We can’t print this photo', ` ${e.message} We only print photos you took or have permission to use.`);
    } else if (e.code === 'not_found') {
      setDraft({ design_id: null, generations: {} });
      showAlert(err, 'This design expired', ' Please try again; we’ll set it up fresh.', { label: 'Try again', attr: 'data-retry', onClick: () => run(styleId) });
    } else {
      const counted = e.retryable || e.code === 'network_error' ? ' This try wasn’t counted.' : '';
      showAlert(err, 'That one didn’t come out right', ` ${e.message}${counted}`, { label: 'Try again', attr: 'data-retry', onClick: () => run(styleId) });
    }
    // keep a previously made style usable
    const prev = cur.generation_id && cur.style_id;
    if (prev) {
      next.setAttribute('aria-disabled', 'false');
      const r = grid.querySelector(`#st-${cur.style_id}`);
      if (r) r.checked = true;
    }
    markReady('error');
  } finally {
    running = false;
  }
}

(async () => {
  const d = getDraft();
  if (!d.photo || !d.rights) { location.replace('upload.html'); return; }
  const cut = await getBlob('draft:cutout');
  if (!cut) { location.replace('cutout.html'); return; }
  cutoutUrl = URL.createObjectURL(cut);
  drawGrid(d);
  const p = await loadPricing();
  setLeft(d.tries_left ?? p.ai.free_tries_per_photo, p.ai.free_tries_per_photo);
  grid.addEventListener('change', (e) => { if (e.target.name === 'style') run(e.target.value); });
  next.addEventListener('click', () => {
    if (next.getAttribute('aria-disabled') === 'true' && !running) showAlert(err, 'Pick a style first', ' Tap any style to draw your sticker. “Just the photo” keeps it as it is.');
  });
  if (d.style_id && d.generation_id && (await showResult(d.style_id, d.generation_id))) return;
  markReady('none');
})();
