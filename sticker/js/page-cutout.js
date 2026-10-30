import { initChrome, showAlert, hideAlert, markReady } from './chrome.js';
import { getDraft, setDraft, getBlob, putBlob, deleteBlobs, waitFrame } from './state.js';
import { segmentSubject } from './cutout.js';
import { blobToCanvas, toCanvas, makeCanvas, ctx2d, canvasToBlob, trimCanvas } from './imaging.js';
import { renderSticker } from './render.js';

initChrome();

const $ = (s) => document.querySelector(s);
const stage = $('[data-stage]');
const next = $('[data-next]');
const warn = $('[data-fallback]');
const modeSwitch = $('[data-mode-switch]');
const CUTOUT_MAX = 1200;
const SEGMENT_MAX = 360;

const PREVIEW_OPTS = { shape: 'diecut', border_in: 0.125, size: '3', finish: 'matte' };

async function makeCutout(photo) {
  const small = toCanvas(photo, SEGMENT_MAX);
  const { data } = ctx2d(small).getImageData(0, 0, small.width, small.height);
  const seg = segmentSubject(data, small.width, small.height);
  const m = makeCanvas(small.width, small.height);
  const mx = ctx2d(m);
  const im = mx.createImageData(small.width, small.height);
  for (let i = 0; i < seg.mask.length; i++) im.data[i * 4 + 3] = seg.mask[i] ? 255 : 0;
  mx.putImageData(im, 0, 0);
  const full = toCanvas(photo, CUTOUT_MAX);
  const fx = full.getContext('2d');
  fx.globalCompositeOperation = 'destination-in';
  fx.imageSmoothingQuality = 'high';
  fx.drawImage(m, 0, 0, full.width, full.height); // smooth upscale = soft edge
  return { canvas: trimCanvas(full), fallback: seg.fallback };
}

function show(canvas, mode, fallback) {
  const opts = mode === 'photo' ? { ...PREVIEW_OPTS, shape: 'circle' } : PREVIEW_OPTS;
  const { canvas: c } = renderSticker(canvas, opts, 440, { mode, sheen: false });
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', mode === 'photo' ? 'Your whole photo as a round sticker' : 'Your photo, cut out, with a white sticker border');
  c.style.maxWidth = '100%';
  stage.innerHTML = '';
  const cap = document.createElement('figcaption');
  cap.textContent = mode === 'photo' ? 'Whole photo: you can pick circle or square next' : fallback ? 'We couldn’t find a clear outline, so this is a soft oval' : 'Cut out in your browser';
  stage.append(c, cap);
  if (fallback && mode === 'cutout') {
    showAlert(warn, 'This photo is hard to cut out', ' The background is busy or close in color to the subject. You can keep the oval, use the whole photo as a circle or square sticker, or try a photo with a plainer background.');
  } else {
    hideAlert(warn);
  }
  modeSwitch.textContent = '';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'link-btn';
  b.dataset.switchMode = mode === 'photo' ? 'cutout' : 'photo';
  b.textContent = mode === 'photo' ? 'Use the cutout instead' : 'Skip the cutout and use the whole photo (circle or square)';
  b.addEventListener('click', () => run(b.dataset.switchMode, true));
  modeSwitch.append(b);
  next.setAttribute('aria-disabled', 'false');
  markReady(mode);
}

async function run(mode, force = false) {
  const d = getDraft();
  next.setAttribute('aria-disabled', 'true');
  delete document.body.dataset.ready;
  const existing = !force && d.cutout && d.cutout.mode === mode ? await getBlob('draft:cutout') : null;
  if (existing) {
    show(await blobToCanvas(existing), mode, d.cutout.fallback);
    return;
  }
  stage.innerHTML = '<div class="busy" role="status"><div class="spinner" aria-hidden="true"></div>Finding the subject&hellip;</div>';
  await waitFrame();
  const photoBlob = await getBlob('draft:photo');
  if (!photoBlob) { location.replace('upload.html'); return; }
  const photo = await blobToCanvas(photoBlob);
  let canvas, fallback = false, blob;
  if (mode === 'photo') {
    canvas = toCanvas(photo, CUTOUT_MAX);
    blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  } else {
    ({ canvas, fallback } = await makeCutout(photo));
    blob = await canvasToBlob(canvas, 'image/png');
  }
  // a new cutout means a new design on the backend; earlier styles no longer apply
  const old = Object.values(d.generations || {}).map((g) => 'gen:' + g);
  await deleteBlobs(old);
  await putBlob('draft:cutout', blob);
  const keepShape = mode === 'photo' && d.opts?.shape === 'diecut' ? { ...d.opts, shape: 'circle' } : d.opts;
  setDraft({ cutout: { mode, fallback, width: canvas.width, height: canvas.height }, design_id: null, tries_left: null, generations: {}, style_id: null, generation_id: null, opts: keepShape });
  show(canvas, mode, fallback);
}

const d = getDraft();
if (!d.photo) location.replace('upload.html');
else if (!d.rights) location.replace('upload.html');
else run(d.cutout?.mode || 'cutout');
