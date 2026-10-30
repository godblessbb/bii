import { initChrome, showAlert, hideAlert, markReady, escapeHtml } from './chrome.js';
import { loadPricing, getDraft, setDraft, resetDraft, putBlob, getBlob, SAMPLE_PHOTO } from './state.js';
import { checkFile, checkDimensions, ACCEPT_ATTR, DECODE_FAILED, WORKING_MAX_SIDE } from './upload-check.js';
import { decodeImage, loadImage, toCanvas, canvasToBlob, sizeOf, readHead } from './imaging.js';

initChrome();

const $ = (s) => document.querySelector(s);
const input = $('[data-file]');
const camera = $('[data-camera]');
const zone = $('[data-dropzone]');
const err = $('[data-error]');
const okBox = $('[data-ok]');
const rights = $('[data-rights]');
const next = $('[data-next]');
const thumb = $('[data-thumb]');
input.setAttribute('accept', ACCEPT_ATTR);

let hasPhoto = false;
let busy = false;

function gate() {
  next.setAttribute('aria-disabled', hasPhoto && rights.checked && !busy ? 'false' : 'true');
}

function fail(r) {
  showAlert(err, r.title, ' ' + r.message);
  okBox.hidden = true;
}

async function showPhoto(blob, info) {
  const url = URL.createObjectURL(blob);
  thumb.innerHTML = '';
  const img = document.createElement('img');
  img.className = 'photo-thumb';
  img.alt = 'Your photo';
  img.src = url;
  img.dataset.w = info.width;
  img.dataset.h = info.height;
  thumb.append(img);
  hideAlert(err);
  okBox.hidden = false;
  const resized = info.origWidth && (info.origWidth !== info.width || info.origHeight !== info.height);
  okBox.innerHTML = `<strong>Photo ready</strong>${escapeHtml(info.name)}${resized ? ` &middot; resized from ${info.origWidth} × ${info.origHeight} to ${info.width} × ${info.height} in your browser` : ''}`;
}

// Shrink in the browser, store in IndexedDB, start a fresh design.
async function accept(source, name, canvasLike, orig) {
  const c = toCanvas(canvasLike, WORKING_MAX_SIDE);
  const blob = await canvasToBlob(c, 'image/jpeg', 0.9);
  await resetDraft();
  await putBlob('draft:photo', blob);
  const info = { name, source, width: c.width, height: c.height, origWidth: orig.width, origHeight: orig.height };
  setDraft({ photo: info, rights: rights.checked });
  hasPhoto = true;
  await showPhoto(blob, info);
}

async function handle(file) {
  if (!file || busy) return;
  const p = await loadPricing();
  busy = true;
  gate();
  okBox.hidden = false;
  okBox.innerHTML = '<strong>Reading your photo&hellip;</strong>';
  try {
    const head = await readHead(file);
    const r = checkFile(file, head, p.limits);
    if (!r.ok) return fail(r);
    let img;
    try { img = await decodeImage(file); } catch { return fail(DECODE_FAILED); }
    const size = sizeOf(img);
    const dim = checkDimensions(size.width, size.height, p.limits);
    if (!dim.ok) return fail(dim);
    await accept('upload', file.name || 'Photo', img, size);
    if (img.close) img.close();
  } finally {
    busy = false;
    gate();
  }
}

input.addEventListener('change', () => { handle(input.files[0]); input.value = ''; });
camera.addEventListener('change', () => { handle(camera.files[0]); camera.value = ''; });
zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
zone.addEventListener('drop', (e) => {
  e.preventDefault();
  zone.classList.remove('drag');
  handle(e.dataTransfer.files[0]);
});
$('[data-sample]').addEventListener('click', async () => {
  const img = await loadImage(SAMPLE_PHOTO);
  await accept('sample', 'Sample photo', img, sizeOf(img));
  gate();
});
rights.addEventListener('change', () => {
  setDraft({ rights: rights.checked });
  if (rights.checked && hasPhoto) hideAlert(err);
  gate();
});
next.addEventListener('click', () => {
  if (next.getAttribute('aria-disabled') !== 'true') return;
  if (busy) return;
  if (!hasPhoto) fail({ title: 'Add a photo first', message: 'Pick a photo, take one, or use our sample photo.' });
  else fail({ title: 'One more thing', message: 'Please confirm you have the right to use this photo.' });
});

loadPricing().then((p) => {
  $('[data-max-mb]').textContent = String(Math.round(p.limits.max_upload_bytes / 1048576));
});

// Coming back to this step: show the photo already chosen.
(async () => {
  const d = getDraft();
  if (d.photo) {
    const blob = await getBlob('draft:photo');
    if (blob) {
      hasPhoto = true;
      rights.checked = !!d.rights;
      await showPhoto(blob, d.photo);
    }
  }
  gate();
  markReady();
})();
