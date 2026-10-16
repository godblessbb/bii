/* 微博碎句 · 第二版设计稿脚本
   1. 现读 ../../weibo.md，用 vendor/marked 渲染进 [data-weibo-body]；只加样式钩子、纸飞机和小画，不改一个字；
   2. 纸飞机：小节标记、章末航迹、阅读进度、回到顶部，全部 <use href="#plane">。 */
(function () {
  'use strict';

  var doc = document;
  var SVG = 'http://www.w3.org/2000/svg';
  var body = doc.querySelector('[data-weibo-body]');

  /* ---------------- 跟着句子走的小画 ----------------
     frag 是 weibo.md 里那一行的连续原文（去空白后匹配），画放在那条碎句旁边。 */
  var SKETCHES = [
    { frag: '机场出发大厅比婚礼现场见证了更多真挚的拥抱', src: 'art/airport-hug.svg' },
    { frag: '上穷游看堪察加半岛落满积雪的火山', src: 'art/kamchatka-volcano.svg' },
    { frag: '我在树下坐了一天', src: 'art/tree-sitting.svg' },
    { frag: '喜欢一个遥不可及的人就像喜欢富士山', src: 'art/fuji-walk.svg' },
    { frag: '洒落地球上的星光是遥远星辰的往事', src: 'art/starlight.svg' },
    { frag: '滚油泼到辣椒和鲜肉上', src: 'art/sizzling-pot.svg' },
    { frag: '中国最诚实的卖场就是股市', src: 'art/stock-drop.svg' },
    { frag: '网上买了一只正宗顺德酥皮烧鹅', src: 'art/roast-goose.svg' },
    { frag: '到巷尾你手上就拎满了手打柠檬茶', src: 'art/lemon-tea.svg' },
    { frag: '耳畔别着一朵白玉兰', src: 'art/magnolia-basket.svg' },
    { frag: '你站在下雪的阳台，像一幅我买不起的油画', src: 'art/snow-balcony.svg' },
    { frag: '她在这张纸上歪歪斜斜地写满了我的名字', src: 'art/name-paper.svg' }
  ];

  function squash(s) { return s.replace(/\s+/g, ''); }

  function plane(cls, motif, viewBox, useAttrs, extra) {
    var svg = doc.createElementNS(SVG, 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('data-motif', motif);
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('aria-hidden', 'true');
    if (extra) extra(svg);
    var use = doc.createElementNS(SVG, 'use');
    use.setAttribute('href', '#plane');
    Object.keys(useAttrs || {}).forEach(function (k) { use.setAttribute(k, useAttrs[k]); });
    svg.appendChild(use);
    return svg;
  }

  function trail() {
    return plane('trail', 'trail', '0 0 150 44', { x: '108', y: '16', width: '20', height: '20' }, function (svg) {
      var p = doc.createElementNS(SVG, 'path');
      p.setAttribute('d', 'M6 8 C 40 6, 58 40, 106 28');
      svg.appendChild(p);
    });
  }

  function decorate(root) {
    // 把 h2 及其后面的兄弟节点包成 <section class="chapter">，节点原样搬，不碰文字
    var nodes = Array.prototype.slice.call(root.childNodes);
    var frag = doc.createDocumentFragment();
    var chapter = null;
    var chapters = [];
    nodes.forEach(function (n) {
      if (n.nodeType === 1 && n.tagName === 'H2') {
        chapter = doc.createElement('section');
        chapter.className = 'chapter';
        frag.appendChild(chapter);
        chapters.push(chapter);
      }
      (chapter || frag).appendChild(n);
    });
    root.appendChild(frag);

    Array.prototype.forEach.call(root.querySelectorAll('p'), function (p) {
      if (p.textContent.replace(/[\s ]/g, '') === '') { p.className = 'spacer'; p.setAttribute('aria-hidden', 'true'); }
    });

    var toc = [];
    chapters.forEach(function (sec, i) {
      var h = sec.querySelector('h2');
      var title = h ? h.textContent.trim() : '';
      sec.id = 'sec-' + i;
      if (i === 0 && title === '按') { sec.classList.add('is-preface'); return; }
      sec.insertBefore(plane('mark', 'section', '0 0 24 24'), h);
      sec.appendChild(trail());
      toc.push({ id: sec.id, title: title });
    });

    Array.prototype.forEach.call(root.querySelectorAll('li'), function (li) {
      li.setAttribute('data-entry', '');
    });

    var entries = Array.prototype.slice.call(root.querySelectorAll('[data-entry]'));
    var keyed = entries.map(function (li) { return squash(li.textContent); });
    var side = 0;
    SKETCHES.forEach(function (s) {
      var idx = keyed.findIndex(function (t) { return t.indexOf(s.frag) !== -1; });
      if (idx === -1) return;   // 原文里找不到就不放，绝不改字去凑
      var img = doc.createElement('img');
      img.className = 'sketch ' + (side++ % 2 ? 'l' : 'r');
      img.src = s.src;
      img.width = 160;
      img.height = 160;
      img.alt = '';              // 点缀性插画，不进入正文文字
      img.decoding = 'async';
      img.setAttribute('data-illustrates', s.frag);
      entries[idx].appendChild(img);
    });

    buildToc(toc);
  }

  function buildToc(items) {
    var nav = doc.querySelector('[data-toc]');
    if (!nav || !items.length) return;
    var ol = doc.createElement('ol');
    items.forEach(function (it) {
      var li = doc.createElement('li');
      var a = doc.createElement('a');
      a.href = '#' + it.id;
      a.textContent = it.title;
      li.appendChild(a);
      ol.appendChild(li);
    });
    nav.appendChild(ol);
    nav.hidden = false;
  }

  function renderError(msg) {
    body.innerHTML = '';
    var p = doc.createElement('p');
    p.className = 'weibo-error';
    p.textContent = '没能翻开（' + msg + '）：';
    var a = doc.createElement('a');
    a.href = '../../weibo.md';
    a.textContent = 'weibo.md';
    p.appendChild(a);
    body.appendChild(p);
    body.setAttribute('aria-busy', 'false');
  }

  function loadBody() {
    if (!body) return;
    if (!window.marked || typeof window.marked.parse !== 'function') { renderError('渲染器没加载上'); return; }
    fetch('../../weibo.md', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (md) {
        body.innerHTML = window.marked.parse(md, { gfm: true, breaks: false });
        decorate(body);
        body.setAttribute('aria-busy', 'false');
        body.setAttribute('data-ready', 'true');
        onScroll();
        if (location.hash && location.hash.length > 1) {
          var t = doc.getElementById(location.hash.slice(1));
          if (t) t.scrollIntoView();
        }
      })
      .catch(function (e) { renderError(e && e.message ? e.message : '网络错误'); });
  }

  /* ---------------- 阅读进度 & 回到顶部 ---------------- */

  var line = doc.querySelector('[data-progress-line]');
  var planeEl = doc.querySelector('[data-progress-plane]');
  var toTop = doc.querySelector('[data-to-top]');
  var ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var max = doc.documentElement.scrollHeight - window.innerHeight;
      var r = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      var w = doc.documentElement.clientWidth;
      if (line) line.style.width = (r * 100).toFixed(2) + '%';
      if (planeEl) planeEl.style.transform = 'translateX(' + Math.round(r * (w - 22)) + 'px)';
      if (toTop) toTop.classList.toggle('is-shown', window.scrollY > window.innerHeight);
    });
  }

  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo(0, 0);
      var m = doc.getElementById('weibo');
      if (m) m.focus({ preventScroll: true });
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);

  loadBody();
  onScroll();
})();
