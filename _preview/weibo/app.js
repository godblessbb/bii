/* 微博碎句集 · 设计稿脚本
   1. 现读 ../../weibo.md，用 vendor/marked 渲染进 [data-weibo-body]，只加样式钩子，不改一个字；
   2. 星空层。 */
(function () {
  'use strict';

  var doc = document;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- 正文 ---------------- */

  var body = doc.querySelector('[data-weibo-body]');
  var ART = [ // 插在第 n 个编号小节之后
    { after: 2, src: 'art/baobab.svg', w: 420, h: 340 },
    { after: 4, src: 'art/fox.svg', w: 420, h: 260 },
    { after: 7, src: 'art/lamp.svg', w: 420, h: 310 }
  ];

  function isBlankParagraph(p) {
    return p.textContent.replace(/[\s ]/g, '') === '';
  }

  // 把 h2 及其后面的兄弟节点包成 <section class="chapter">，节点原样搬，不碰文字
  function decorate(root) {
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
      if (isBlankParagraph(p)) { p.classList.add('spacer'); p.setAttribute('aria-hidden', 'true'); }
    });

    var toc = [];
    var num = 0;
    chapters.forEach(function (sec, i) {
      var h = sec.querySelector('h2');
      var id = 'sec-' + i;
      sec.id = id;
      if (i === 0 && h && h.textContent.trim() === '按') {
        sec.classList.add('is-preface');
        return;
      }
      num += 1;
      toc.push({ id: id, n: num, title: h ? h.textContent.trim() : '' });
      ART.forEach(function (a) {
        if (a.after !== num) return;
        var fig = doc.createElement('figure');
        fig.className = 'interlude';
        var img = doc.createElement('img');
        img.src = a.src;
        img.width = a.w;
        img.height = a.h;
        img.alt = '';           // 装饰性插画，不进入正文文字
        img.decoding = 'async';
        fig.setAttribute('aria-hidden', 'true');
        fig.appendChild(img);
        sec.parentNode.insertBefore(fig, sec.nextSibling);
      });
    });
    buildToc(toc);
  }

  var CN = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  function cnNum(n) {
    if (n <= 10) return CN[n];
    if (n < 20) return '十' + CN[n - 10];
    return String(n);
  }

  function buildToc(items) {
    var nav = doc.querySelector('[data-toc]');
    if (!nav || !items.length) return;
    var ol = doc.createElement('ol');
    items.forEach(function (it) {
      var li = doc.createElement('li');
      var a = doc.createElement('a');
      a.href = '#' + it.id;
      var n = doc.createElement('span');
      n.className = 'toc-n';
      n.textContent = '其' + cnNum(it.n);
      a.appendChild(n);
      a.appendChild(doc.createTextNode(it.title));
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
    p.textContent = '本子没能翻开（' + msg + '）。可以直接看原文：';
    var a = doc.createElement('a');
    a.href = '../../weibo.md';
    a.textContent = 'weibo.md';
    p.appendChild(a);
    body.appendChild(p);
    body.setAttribute('aria-busy', 'false');
  }

  function loadBody() {
    if (!body) return;
    if (!window.marked || typeof window.marked.parse !== 'function') {
      renderError('Markdown 渲染器没加载上');
      return;
    }
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
        if (location.hash && location.hash.length > 1) {
          var t = doc.getElementById(location.hash.slice(1));
          if (t) t.scrollIntoView();
        }
      })
      .catch(function (e) { renderError(e && e.message ? e.message : '网络错误'); });
  }

  /* ---------------- 星空 ---------------- */

  function buildSky() {
    var sky = doc.querySelector('[data-sky]');
    if (!sky) return;
    var seed = 20120601;
    function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    var frag = doc.createDocumentFragment();
    for (var i = 0; i < 46; i++) {
      var s = doc.createElement('i');
      var size = 1 + rnd() * 2.2;
      if (i % 9 === 0) s.className = 'spark';
      s.style.left = (rnd() * 100).toFixed(2) + '%';
      s.style.top = (Math.pow(rnd(), 1.4) * 100).toFixed(2) + '%';
      s.style.setProperty('--s', size.toFixed(1) + 'px');
      s.style.setProperty('--d', (3.5 + rnd() * 5).toFixed(1) + 's');
      s.style.setProperty('--delay', (-rnd() * 8).toFixed(1) + 's');
      frag.appendChild(s);
    }
    sky.appendChild(frag);
  }

  buildSky();
  loadBody();
  if (reduceMotion) doc.documentElement.classList.add('reduce-motion');
})();
