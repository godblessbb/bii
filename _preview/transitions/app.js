/* 转场效果对比 · 页面逻辑
   - 舞台 [data-stage]：data-page = 当前页（A/B），data-state = idle / running。
   - 点 [data-effect] 按钮：用这个效果从当前页转到另一页；点舞台本身：用上次选的效果、从点击处开始。
   - ?effect=<键>&progress=<0..1>：冻结帧，不播放，0 = 干净的 A，1 = 干净的 B（可加 &x=&y= 指定起点，0..1）。
   - 系统开「减少动态效果」或 WebGL 不可用：直接换页。 */
(function () {
  'use strict';

  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }   // 主站 gl.js 的 ease()
  function linear(x) { return x; }

  /* progress = 视觉进度；live 播放时 progress = ease(时间比例)。
     burn 用主站的 cubic-out（前段很快），其余效果的节奏写在各自着色器里，这里线性给时间。 */
  var EFFECTS = {
    burn: { dur: 620, ease: easeOutCubic },
    ink: { dur: 1000, ease: linear },
    brush: { dur: 900, ease: linear },
    tear: { dur: 1050, ease: linear },
    pixel: { dur: 850, ease: linear },
    iris: { dur: 700, ease: linear },
    mist: { dur: 400, ease: linear },
    plane: { dur: 1150, ease: linear }
  };
  var KEYS = Object.keys(EFFECTS);

  var I18N = {
    zh: {
      title: '转场效果对比',
      note: '<b>火烧</b>是主站现在用的转场（照抄 js/gl.js），其余七个是候选。点下面的按钮，舞台会用该效果从当前页转到另一页（A ⇄ B）；也可以直接点舞台，从点击处开始。' +
        '看冻结帧：网址后面加 <code>?effect=ink&amp;progress=0.5</code>（progress 0 是 A、1 是 B），例如 <a href="?effect=plane&amp;progress=0.5">纸飞机飞到一半</a>。',
      exit: '退出冻结', effects: '效果',
      n_burn: '火烧', tag_burn: '现状 0.62s', n_ink: '墨水晕开', n_brush: '水墨扫过', n_tear: '纸张撕开',
      n_pixel: '像素消散', n_iris: '光圈收放', n_mist: '雾散', n_plane: '纸飞机',
      stage: '演示舞台：两张示意页 A（首页）和 B（文章页）',
      freeze: '冻结帧', noGL: '这台设备拿不到 WebGL：已回退为直接换页。', reduced: '系统开了「减少动态效果」：点击直接换页，不播动画。',
      info: {
        burn: '<b>火烧 · 现状</b> 0.62 秒。主站 js/gl.js 的噪声遮罩：先整块盖住，再从上往下溶解，边缘一圈荧光绿 + 一圈余烬橙。',
        ink: '<b>墨水晕开</b> 1.0 秒。墨滴从起点洇开，外缘是毛细渗出的放射状毛边；盖住后底下换页，再从里往外被纸吸干，留一圈潮痕。',
        brush: '<b>水墨扫过</b> 0.9 秒。一笔粗毛笔从左往右横扫，笔毛快慢不一拖出飞白，湿墨挂在笔头；扫过处露出新页。',
        tear: '<b>纸张撕开</b> 1.05 秒。锯齿线从上往下撕开，撕口露出白纤维，纸边往上卷看得见纸背，两半滑开露出新页。',
        pixel: '<b>像素消散</b> 0.85 秒。方块按随机先后一顿一顿地翻走，翻的时候打马赛克、降色阶、加 8-bit 抖动颗粒。',
        iris: '<b>光圈收放</b> 0.7 秒。圆形光圈从起点张开，边缘像透镜一样轻微折射，红绿蓝错开成一圈色散。',
        mist: '<b>雾散</b> 0.4 秒。一层低对比的雾漫上来又退掉，没有硬边，最克制。',
        plane: '<b>纸飞机</b> 1.15 秒。主站同款纸飞机从左下飞向右上，机尾拖出越拉越宽的尾流，尾流里就是新页，中线是虚线航迹。'
      }
    },
    en: {
      title: 'Transition lab',
      note: '<b>Burn</b> is what the site uses today (copied from js/gl.js); the other seven are candidates. Press a button and the stage moves from the current page to the other one (A ⇄ B) with that effect, or tap the stage to start from that point. ' +
        'Frozen frames: add <code>?effect=ink&amp;progress=0.5</code> to the address (progress 0 is A, 1 is B), e.g. <a href="?effect=plane&amp;progress=0.5">the paper plane halfway</a>.',
      exit: 'Exit freeze', effects: 'Effects',
      n_burn: 'Burn', tag_burn: 'now 0.62s', n_ink: 'Ink', n_brush: 'Brush', n_tear: 'Tear',
      n_pixel: 'Pixels', n_iris: 'Iris', n_mist: 'Mist', n_plane: 'Plane',
      stage: 'Demo stage: two sample pages, A (home) and B (writing)',
      freeze: 'Frozen', noGL: 'WebGL is not available here, so pages switch instantly.', reduced: 'Reduce motion is on: pages switch instantly, no animation.',
      info: {
        burn: '<b>Burn · current</b> 0.62 s. The noise veil from js/gl.js: covers everything, then dissolves top to bottom with a lime edge and an ember-orange edge.',
        ink: '<b>Ink bloom</b> 1.0 s. A drop spreads from the start point with capillary, fibrous edges; the page swaps underneath, then the paper soaks the ink up from the inside out, leaving a tide line.',
        brush: '<b>Brush sweep</b> 0.9 s. One fat brush stroke sweeps left to right; slow bristles drag dry-brush streaks, wet ink sits on the tip, and the new page shows where it has passed.',
        tear: '<b>Paper tear</b> 1.05 s. A jagged tear runs down the page, white fibres at the rip, edges curling up to show the back of the paper, and the halves slide away.',
        pixel: '<b>Pixels</b> 0.85 s. Blocks flip away in stepped, toy-like frames, going mosaic, low-colour and dithered as they turn.',
        iris: '<b>Iris</b> 0.7 s. A circular aperture opens from the start point; its rim refracts slightly and splits red, green and blue.',
        mist: '<b>Mist</b> 0.4 s. A low-contrast mist rolls in and out. No hard edges; the quietest of the set.',
        plane: '<b>Paper plane</b> 1.15 s. The site&#39;s paper plane flies bottom-left to top-right; its widening wake is the new page, with the dashed flight trail down the middle.'
      }
    }
  };

  var root = document.documentElement;
  var stage = document.querySelector('[data-stage]');
  var cA = stage.querySelector('[data-pg="A"]');
  var cB = stage.querySelector('[data-pg="B"]');
  var cFx = stage.querySelector('.fx');
  var btns = Array.prototype.slice.call(document.querySelectorAll('[data-effect]'));
  var info = document.querySelector('[data-info]');
  var freezeBar = document.querySelector('[data-freeze]');
  var freezeRange = document.querySelector('[data-freeze-range]');
  var freezeValue = document.querySelector('[data-freeze-value]');
  var freezeLabel = document.querySelector('[data-freeze-label]');
  var LANG_KEY = 'datode-lang';

  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function reduced() { return !!mqReduce.matches; }
  function lang() { return root.lang === 'en' ? 'en' : 'zh'; }
  function S() { return I18N[lang()]; }

  var page = 'A';
  var selected = 'burn';
  var running = false;
  var size = { w: 0, h: 0, dpr: 1, fxDpr: 1 };
  var glOk = FX.init(cFx);

  /* ---- 冻结帧参数 ---- */
  var qs = new URLSearchParams(location.search);
  var frozen = null;
  (function () {
    var k = qs.get('effect'), p = parseFloat(qs.get('progress'));
    if (k && EFFECTS[k] && !isNaN(p)) {
      var x = parseFloat(qs.get('x')), y = parseFloat(qs.get('y'));
      frozen = { key: k, p: Math.min(1, Math.max(0, p)), x: isNaN(x) ? 0.5 : x, y: isNaN(y) ? 0.5 : y, seed: parseFloat(qs.get('seed')) || 1 };
      selected = k;
    }
  })();

  /* ---- 尺寸 / 画页 ---- */
  function layout() {
    var r = stage.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var small = w < 640;
    var fxDpr = small ? Math.min(dpr, 1.5) : dpr;
    var changed = w !== size.w || h !== size.h || dpr !== size.dpr || size.lang !== lang();
    if (!changed) return;
    size = { w: w, h: h, dpr: dpr, fxDpr: fxDpr, lang: lang() };
    Pages.draw(cA, 'A', w, h, dpr, lang());
    Pages.draw(cB, 'B', w, h, dpr, lang());
    if (glOk && FX.ok) {
      FX.resize(Math.round(w * fxDpr), Math.round(h * fxDpr));
      FX.upload(cA, cB);
    }
    if (frozen) showFrozen();
  }

  function setPage(p) { page = p; stage.setAttribute('data-page', p); }
  function fxOn(on) { if (on) stage.setAttribute('data-fx', ''); else stage.removeAttribute('data-fx'); }

  /* 冻结帧用的确定性时间：按 progress 反推时间比例，再换成秒 */
  function timeFor(key, prog) {
    var e = EFFECTS[key].ease, lo = 0, hi = 1;
    for (var i = 0; i < 30; i++) { var m = (lo + hi) / 2; if (e(m) < prog) lo = m; else hi = m; }
    return 3.7 + (lo + hi) / 2 * EFFECTS[key].dur / 1000;
  }

  function draw(key, fromA, prog, k, o, seed) {
    return FX.render(key, fromA, prog, 3.7 + k * EFFECTS[key].dur / 1000, [o[0] * size.fxDpr, o[1] * size.fxDpr], seed, size.fxDpr);
  }

  function showFrozen() {
    var f = frozen;
    stage.setAttribute('data-state', 'idle');
    stage.setAttribute('data-frozen', f.key);
    if (f.p <= 0) { setPage('A'); fxOn(false); return; }
    if (f.p >= 1) { setPage('B'); fxOn(false); return; }
    setPage('A');
    if (!glOk || !FX.ok) { if (f.p >= 0.5) setPage('B'); fxOn(false); return; }
    var t = timeFor(f.key, f.p);
    FX.render(f.key, true, f.p, t, [f.x * size.w * size.fxDpr, f.y * size.h * size.fxDpr], f.seed, size.fxDpr);
    fxOn(true);
  }

  /* ---- 播放 ---- */
  function play(key, o) {
    if (running) return;
    selected = key;
    markSelected();
    var from = page, to = page === 'A' ? 'B' : 'A';
    if (reduced() || !glOk || !FX.ok) { setPage(to); return; }
    var fx = EFFECTS[key];
    var seed = 1 + Math.floor(Math.random() * 97);
    var fromA = from === 'A';
    var t0 = performance.now();
    running = true;
    stage.setAttribute('data-state', 'running');
    if (!draw(key, fromA, fx.ease(0), 0, o, seed)) { finish(); return; }
    fxOn(true);
    function finish() {
      running = false;
      setPage(to);
      fxOn(false);
      stage.setAttribute('data-state', 'idle');
      layout();
    }
    function tick(now) {
      var k = Math.min(1, (now - t0) / fx.dur);
      if (k >= 1 || !FX.ok) { finish(); return; }
      if (!draw(key, fromA, fx.ease(k), k, o, seed)) { finish(); return; }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function markSelected() {
    btns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-effect') === selected ? 'true' : 'false'); });
    var s = S();
    var extra = '';
    if (!glOk || !FX.ok) extra = ' ' + s.noGL;
    else if (reduced()) extra = ' ' + s.reduced;
    info.innerHTML = s.info[selected] + (extra ? '<br>' + extra : '');
    if (frozen) {
      freezeLabel.textContent = s.freeze + ' · ' + frozen.key;
      freezeRange.value = String(frozen.p);
      freezeValue.textContent = frozen.p.toFixed(2);
    }
  }

  function updateUrl() {
    var u = new URL(location.href);
    u.searchParams.set('effect', frozen.key);
    u.searchParams.set('progress', String(Math.round(frozen.p * 100) / 100));
    try { history.replaceState(null, '', u.pathname + u.search); } catch (e) {}
  }

  btns.forEach(function (b) {
    b.addEventListener('click', function () {
      var key = b.getAttribute('data-effect');
      if (frozen) { frozen.key = key; selected = key; markSelected(); updateUrl(); showFrozen(); return; }
      play(key, [size.w / 2, size.h / 2]);
    });
  });

  stage.addEventListener('click', function (e) {
    if (frozen) return;
    var r = stage.getBoundingClientRect();
    play(selected, [e.clientX - r.left, e.clientY - r.top]);
  });

  if (freezeRange) freezeRange.addEventListener('input', function () {
    if (!frozen) return;
    frozen.p = parseFloat(freezeRange.value) || 0;
    freezeValue.textContent = frozen.p.toFixed(2);
    updateUrl();
    showFrozen();
  });

  /* ---- 语言：跟主站同一个 localStorage 键 ---- */
  function applyLang() {
    var s = S();
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) {
      var v = s[el.getAttribute('data-i18n')]; if (v != null) el.textContent = v;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-html]'), function (el) {
      var v = s[el.getAttribute('data-i18n-html')]; if (v != null) el.innerHTML = v;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-aria]'), function (el) {
      var v = s[el.getAttribute('data-i18n-aria')]; if (v != null) el.setAttribute('aria-label', v);
    });
    stage.setAttribute('aria-label', s.stage);
    var lb = document.querySelector('[data-lang-toggle]');
    if (lb) lb.setAttribute('aria-label', lang() === 'en' ? '切换到中文' : 'Switch to English');
    document.title = (lang() === 'en' ? 'Transition lab · Crispy Caihua (preview)' : '转场效果对比 · 香又脆的菜花（预览）');
    markSelected();
  }
  var langBtn = document.querySelector('[data-lang-toggle]');
  if (langBtn) langBtn.addEventListener('click', function () {
    if (running) return;
    var next = lang() === 'en' ? 'zh' : 'en';
    root.lang = next === 'en' ? 'en' : 'zh-CN';
    try { localStorage.setItem(LANG_KEY, next); } catch (e) {}
    applyLang();
    layout();
  });

  if (frozen) freezeBar.hidden = false;
  if (mqReduce.addEventListener) mqReduce.addEventListener('change', markSelected);
  applyLang();
  layout();
  if (window.ResizeObserver) new ResizeObserver(function () { if (!running) layout(); }).observe(stage);
  else window.addEventListener('resize', function () { if (!running) layout(); });
  // 系统字体有时晚一拍才就绪：就绪后重画一次
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { size.w = 0; layout(); });
})();
