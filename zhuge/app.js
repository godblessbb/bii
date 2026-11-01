// 诸葛神数页面交互。起数逻辑全部在 zhuge.js，这里只管界面与仪式动画。
import { strokes, toTrad, isHan, rawNumber, numberFromStrokes, cuts, TOTAL } from './zhuge.js';

const $ = (s, el = document) => el.querySelector(s);
const slots = Array.from(document.querySelectorAll('.slot'));
const inputs = slots.map((s) => $('input', s));
const form = $('#form');
const go = $('#go');
const hint = $('#hint');
const stage = $('#stage');
const calc = $('#calc');
const result = $('#result');
const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = [null, null, null];
let QIAN = null;
let SRC = null; // sources.json：出处与大意（整理者所加），加载失败时只是不显示
let run = null;
let last = null;

document.body.dataset.state = 'loading';

const CN = '零一二三四五六七八九';
function cnNum(n) {
  const h = Math.floor(n / 100), t = Math.floor(n / 10) % 10, u = n % 10;
  let s = '';
  if (h) s += CN[h] + '百';
  if (t) s += (h || t !== 1 ? CN[t] : '') + '十';
  else if (h && u) s += '零';
  if (u) s += CN[u];
  return s;
}

function setMsg(i, text) {
  $('.msg', slots[i]).textContent = text || '';
  slots[i].classList.toggle('bad', !!text);
}

function renderSlot(i) {
  const st = state[i];
  const slot = slots[i];
  const trad = $('.trad', slot);
  const sub = $('.trad-sub', slot);
  const ticks = $('.ticks', slot);
  slot.classList.toggle('ok', !!st);
  if (!st) { trad.innerHTML = ''; sub.textContent = ''; ticks.innerHTML = ''; return; }
  trad.innerHTML = '<span class="trad-ch" lang="zh-Hant"></span><span class="trad-n"></span>';
  $('.trad-ch', trad).textContent = st.trad;
  $('.trad-n', trad).innerHTML = st.n + '<small>画</small>';
  sub.textContent = st.trad !== st.ch ? '繁体写法' : '简繁同形';
  const fast = reduceMQ.matches;
  let html = '';
  for (let k = 0; k < st.n; k++) html += '<i' + (fast ? '' : ' style="animation-delay:' + Math.min(k * 22, 600) + 'ms"') + '></i>';
  ticks.innerHTML = html;
}

function updateGo() {
  const ready = !!QIAN && state.every(Boolean);
  go.disabled = !ready;
  if (!QIAN) return;
  if (ready) hint.textContent = '三字已定，诚心求签。';
  else if (!slots.some((s) => s.classList.contains('bad'))) hint.textContent = '每格写一个汉字，简体繁体都可以。';
}

// 接收一格的输入；多字粘贴时依次落到后面的格子
function accept(i) {
  const raw = inputs[i].value.replace(/\s+/g, '');
  const chars = Array.from(raw);
  if (!chars.length) { state[i] = null; setMsg(i, ''); renderSlot(i); updateGo(); return; }
  if (chars.length > 1 && chars.every(isHan)) {
    for (let k = 0; k < chars.length && i + k < 3; k++) {
      inputs[i + k].value = chars[k];
      settle(i + k, chars[k]);
    }
    if (chars.length > 3 - i) hint.textContent = '每格只收一个字，多出的字没有用上。';
    const next = inputs.findIndex((el, k) => !state[k]);
    (next >= 0 ? inputs[next] : go).focus();
    updateGo();
    return;
  }
  if (chars.length > 1) {
    state[i] = null; renderSlot(i);
    setMsg(i, '每格只收一个汉字，请删到只剩一个。');
    updateGo();
    return;
  }
  const ok = settle(i, chars[0]);
  updateGo();
  if (ok) {
    const next = inputs.findIndex((el, k) => k > i && !state[k]);
    if (next >= 0) inputs[next].focus();
  }
}

function settle(i, ch) {
  if (!isHan(ch)) {
    state[i] = null; renderSlot(i);
    setMsg(i, '「' + ch + '」不是汉字，请写一个汉字。');
    return false;
  }
  const n = strokes(ch);
  if (n == null) {
    state[i] = null; renderSlot(i);
    setMsg(i, '「' + ch + '」不在笔画表里，换一个常用字吧。');
    return false;
  }
  state[i] = { ch, trad: toTrad(ch), n };
  setMsg(i, '');
  renderSlot(i);
  return true;
}

inputs.forEach((el, i) => {
  let composing = false;
  el.addEventListener('compositionstart', () => { composing = true; });
  el.addEventListener('compositionend', () => { composing = false; accept(i); });
  el.addEventListener('input', (e) => { if (!composing && !e.isComposing) accept(i); });
  el.addEventListener('focus', () => el.select());
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !el.value && i > 0) { inputs[i - 1].focus(); e.preventDefault(); }
  });
});

/* ---------- 仪式 ---------- */
function sleep(ms) {
  return new Promise((res) => {
    if (!run || run.skipped) return res();
    const t = setTimeout(res, ms);
    run.wake.push(() => { clearTimeout(t); res(); });
  });
}

function skip() {
  if (!run || run.skipped) return;
  run.skipped = true;
  run.wake.splice(0).forEach((f) => f());
}

function compute() {
  const [a, b, c] = state.map((s) => s.n);
  const raw = rawNumber(a, b, c);
  const n = numberFromStrokes(a, b, c);
  const k = cuts(raw);
  let eq = '= ' + raw;
  if (!k) eq += '，不过 ' + TOTAL + '，照数取签';
  else eq += '，减 ' + TOTAL + ' 共 ' + k + ' 次 → ' + n + (n === TOTAL ? '（整除取第 ' + TOTAL + ' 签）' : '');
  return { raw, n, eq, parts: [a * 100, b * 10, c] };
}

async function ceremony() {
  const r = compute();
  last = { n: r.n, chars: state.map((s) => s.ch).join(''), text: QIAN[r.n - 1].text, src: SRC ? SRC.get(r.n) : null };
  document.body.dataset.state = 'running';
  inputs.forEach((el) => { el.disabled = true; });
  go.disabled = true;
  run = { skipped: reduceMQ.matches, wake: [] };

  if (!run.skipped) {
    result.hidden = true;
    stage.hidden = false;
    stage.classList.remove('shake', 'up');
    $('#stickN').textContent = '';
    calc.innerHTML = '<span class="digits"><span>·</span><i>+</i><span>·</span><i>+</i><span>·</span></span><span class="eq"></span>';
    stage.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const ds = calc.querySelectorAll('.digits span');
    // 一：上字笔画作百、中字作十、下字作一
    for (let i = 0; i < 3; i++) {
      ds[i].textContent = r.parts[i];
      ds[i].classList.add('on');
      await sleep(230);
    }
    await sleep(250);
    // 二：相加，过 215 则反复减 215
    calc.querySelector('.eq').textContent = r.eq;
    await sleep(650);
    // 三：摇签筒
    $('#stickN').textContent = String(r.n);
    stage.classList.add('shake');
    await sleep(800);
    stage.classList.remove('shake');
    stage.classList.add('up');
    await sleep(700);
  }
  showResult(r, !run.skipped);
}

function showResult(r, animate) {
  stage.hidden = true;
  stage.classList.remove('shake', 'up');
  $('#qn').textContent = cnNum(r.n);
  result.dataset.n = String(r.n);
  const poem = $('#poem');
  poem.innerHTML = '';
  const parts = last.text.match(/[^，。；：、！？]+[，。；：、！？]*/g) || [last.text];
  for (const p of parts) {
    const s = document.createElement('span');
    s.textContent = p;
    poem.appendChild(s);
  }
  poem.dataset.text = last.text;
  const from = state.map((s) => '<b lang="zh-Hant"></b> ' + s.n + ' 画').join(' · ');
  $('#from').innerHTML = from + ' · ' + r.raw + (r.raw !== r.n ? ' → ' + r.n : '');
  $('#from').querySelectorAll('b').forEach((b, i) => { b.textContent = state[i].trad; });
  renderGloss(last.src);
  $('#copyMsg').textContent = '';
  $('#copyMsg').classList.remove('err');
  result.classList.toggle('unfold', animate);
  result.hidden = false;
  if (animate) result.scrollIntoView({ block: 'start', behavior: 'smooth' });
  else result.scrollIntoView({ block: 'start' });
  document.body.dataset.state = 'done';
  run = null;
}

/* ---------- 出处与大意 ---------- */
// A：签中有整句与原典逐字相同 →「出自」；B：化用典故 →「典出 …（化用）」；C：没有 refs，不显示出处
function sortedRefs(e) {
  return e && Array.isArray(e.refs) ? e.refs.slice().sort((a, b) => (a.kind === 'A' ? 0 : 1) - (b.kind === 'A' ? 0 : 1)) : [];
}

function srcLabel(ref) {
  return ref.kind === 'A' ? '出自' : '典出';
}

function srcWork(ref) {
  return ref.work + (ref.kind === 'A' ? '' : '（化用）');
}

function renderGloss(e) {
  const box = $('#gloss');
  const list = $('#srcs');
  list.innerHTML = '';
  const refs = sortedRefs(e);
  for (const ref of refs) {
    const p = document.createElement('p');
    p.className = 'src';
    p.dataset.kind = ref.kind;
    const k = document.createElement('span');
    k.className = 'src-k';
    k.textContent = srcLabel(ref);
    const w = document.createElement('a');
    w.className = 'src-w';
    w.href = ref.url;
    w.target = '_blank';
    w.rel = 'noopener';
    w.textContent = srcWork(ref);
    const q = document.createElement('span');
    q.className = 'src-q';
    // 原句里与签文相同的那一整句标亮（quote_s 与 quote 逐字对应）
    const at = ref.kind === 'A' && ref.match_raw && ref.quote_s.length === ref.quote.length ? ref.quote.indexOf(ref.match_raw) : -1;
    if (at >= 0) {
      const m = document.createElement('mark');
      m.textContent = ref.quote_s.slice(at, at + ref.match_raw.length);
      q.append('「' + ref.quote_s.slice(0, at), m, ref.quote_s.slice(at + ref.match_raw.length) + '」');
    } else {
      q.textContent = '「' + ref.quote_s + '」';
    }
    p.append(k, w, q);
    if (ref.note) {
      const n = document.createElement('span');
      n.className = 'src-n';
      n.textContent = ref.note;
      p.appendChild(n);
    }
    list.appendChild(p);
  }
  const gist = e && e.gist ? e.gist.trim() : '';
  $('#gistT').textContent = gist;
  $('#gist').hidden = !gist;
  box.hidden = !gist && !refs.length;
}

function srcLine(e) {
  const refs = sortedRefs(e);
  if (!refs.length) return '';
  return '出处（整理者注）：' + refs.map((r) => srcLabel(r) + ' ' + srcWork(r) + '「' + r.quote_s + '」').join('；');
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (run) return;
  if (!state.every(Boolean)) {
    hint.textContent = '三个格子都写好一个汉字才能求签。';
    const k = state.findIndex((s) => !s);
    if (k >= 0) inputs[k].focus();
    return;
  }
  ceremony();
});
stage.addEventListener('click', skip);
document.addEventListener('keydown', (e) => { if (run && (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); skip(); } });

/* ---------- 复制 / 再求 ---------- */
function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
  ta.remove();
  return ok;
}

$('#copy').addEventListener('click', async () => {
  if (!last) return;
  const msg = $('#copyMsg');
  const line = srcLine(last.src);
  const text = '诸葛神数（巧连神数）第' + last.n + '签（报字：' + last.chars + '）\n' + last.text + (line ? '\n' + line : '');
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; }
  } catch (err) { ok = false; }
  if (!ok) ok = legacyCopy(text);
  msg.classList.toggle('err', !ok);
  msg.textContent = ok ? '已复制签文。' : '复制没有成功，请长按或选中签文手动复制。';
});

$('#again').addEventListener('click', () => {
  result.hidden = true;
  stage.hidden = true;
  last = null;
  document.body.dataset.state = 'idle';
  for (let i = 0; i < 3; i++) {
    inputs[i].disabled = false;
    inputs[i].value = '';
    state[i] = null;
    setMsg(i, '');
    renderSlot(i);
  }
  updateGo();
  window.scrollTo({ top: 0 });
  inputs[0].focus();
});

/* ---------- 签文数据 ---------- */
// 出处表与签文并行加载；出处表出错不影响求签
const srcLoad = fetch('sources.json')
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((d) => { SRC = new Map(d.entries.map((e) => [e.n, e])); })
  .catch(() => { SRC = null; });
fetch('qian.json')
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((d) => srcLoad.then(() => d))
  .then((d) => {
    if (!d || !Array.isArray(d.qian) || d.qian.length !== TOTAL) throw new Error('bad data');
    QIAN = d.qian;
    document.body.dataset.state = 'idle';
    inputs.forEach((el, i) => { if (el.value) accept(i); });
    updateGo();
  })
  .catch(() => {
    document.body.dataset.state = 'error';
    hint.textContent = '签文数据没有加载出来，请刷新页面再试。';
  });
