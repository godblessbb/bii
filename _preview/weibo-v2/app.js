/* 微博碎句 · 第二版设计稿脚本
   1. 现读 ../../weibo.md，用 vendor/marked 渲染进 [data-weibo-body]；只加样式钩子、纸飞机和小画，不改一个字；
   2. 纸飞机：小节标记、章末航迹、阅读进度、回到顶部、音乐开关，全部 <use href="#plane">；
   3. 音乐：沿用第一版——YouTube 官方嵌入，第一次点页面任意处开始，主动暂停后不再唤醒，连不上降级成链接。 */
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

  /* ---------------- 音乐（沿用第一版的方案与代码） ---------------- */

  // 歌：The Walters《I Love You So》。只用 YouTube 官方嵌入播放器播放，不在仓库里放任何音频。
  // 视频 ID 在云端容器里没能用 oEmbed 核实（见 DESIGN.md），预览时可用 ?yt=<视频ID> 临时覆盖；
  // 播放器就绪后会核对标题 / 频道，不是这首歌就降级为链接卡片，不会放错歌。
  var DEFAULT_VIDEO_ID = 'ZtDDXF_VfZE';
  var LOAD_TIMEOUT = 9000;
  var PLAY_CHECK = 2500;

  var music = doc.querySelector('[data-music]');
  var toggle = doc.querySelector('[data-music-toggle]');
  var statusEl = doc.querySelector('[data-music-status]');
  var playerEl = doc.querySelector('[data-music-player]');
  var offlineEl = doc.querySelector('[data-music-offline]');

  var player = null;
  var state = 'idle';           // idle | loading | ready | playing | paused | offline
  var wantPlay = false;
  var userPaused = false;       // 主动暂停后，不再被「点任意处」唤醒
  var loadTimer = null;
  var playTimer = null;

  function videoId() {
    try {
      var q = new URLSearchParams(location.search).get('yt');
      if (q && /^[\w-]{11}$/.test(q)) return q;
    } catch (e) { /* 用默认 */ }
    return DEFAULT_VIDEO_ID;
  }

  function setStatus(text) { if (statusEl) statusEl.textContent = text; }

  function setState(s) {
    state = s;
    if (music) music.setAttribute('data-state', s);
    var playing = s === 'playing';
    if (toggle) {
      toggle.setAttribute('aria-pressed', playing ? 'true' : 'false');
      toggle.setAttribute('aria-label', playing ? '暂停 I Love You So' : '播放 I Love You So');
    }
  }

  function goOffline(reason) {
    clearTimeout(loadTimer);
    clearTimeout(playTimer);
    wantPlay = false;
    if (player && player.destroy) { try { player.destroy(); } catch (e) { /* 忽略 */ } }
    player = null;
    if (playerEl) playerEl.innerHTML = '';
    if (offlineEl) offlineEl.hidden = false;
    setState('offline');
    setStatus(reason || '连不上');
  }

  function looksLikeTheSong() {
    try {
      var d = player.getVideoData && player.getVideoData();
      if (!d || (!d.title && !d.author)) return true;
      var t = (d.title + ' ' + d.author).toLowerCase();
      return t.indexOf('walters') !== -1 || t.indexOf('i love you so') !== -1;
    } catch (e) { return true; }
  }

  function onReady() {
    clearTimeout(loadTimer);
    if (!looksLikeTheSong()) { goOffline('视频不对，去别处听'); return; }
    setState('ready');
    setStatus(wantPlay ? '起飞……' : '轻触页面任意处开始');
    if (wantPlay) play();
  }

  function onStateChange(e) {
    var YT = window.YT;
    if (!YT || !YT.PlayerState) return;
    if (e.data === YT.PlayerState.PLAYING) {
      clearTimeout(playTimer);
      setState('playing');
      setStatus('正在播放');
    } else if (e.data === YT.PlayerState.PAUSED) {
      setState('paused');
      setStatus('暂停了');
    } else if (e.data === YT.PlayerState.ENDED) {
      setState('paused');
      setStatus('放完了');
    }
  }

  function createPlayer() {
    if (!window.YT || !window.YT.Player || !playerEl) { goOffline(); return; }
    var mount = doc.createElement('div');
    playerEl.appendChild(mount);
    try {
      player = new window.YT.Player(mount, {
        host: 'https://www.youtube-nocookie.com',
        width: '200',
        height: '200',
        videoId: videoId(),
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
        events: { onReady: onReady, onStateChange: onStateChange, onError: function () { goOffline('放不了，去别处听'); } }
      });
    } catch (e) { goOffline(); }
  }

  function loadYouTube() {
    if (state !== 'idle') return;
    setState('loading');
    loadTimer = setTimeout(function () {
      if (state === 'loading') goOffline('连不上，去别处听');
    }, LOAD_TIMEOUT);
    if (window.YT && window.YT.Player) { createPlayer(); return; }
    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof prev === 'function') { try { prev(); } catch (e) { /* 忽略 */ } }
      if (state === 'loading') createPlayer();
    };
    var s = doc.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = function () { goOffline('连不上，去别处听'); };
    doc.head.appendChild(s);
  }

  function play() {
    if (!player || !player.playVideo) return;
    try {
      if (player.unMute) player.unMute();
      if (player.setVolume) player.setVolume(70);
      player.playVideo();
    } catch (e) { goOffline(); return; }
    clearTimeout(playTimer);
    playTimer = setTimeout(function () {
      if (state !== 'playing' && state !== 'offline') setStatus('请点一下播放器里的播放键');
    }, PLAY_CHECK);
  }

  function pause() {
    if (player && player.pauseVideo) { try { player.pauseVideo(); } catch (e) { /* 忽略 */ } }
  }

  function onToggle() {
    if (state === 'offline') {
      setStatus('连不上，去别处听');
      var first = offlineEl && offlineEl.querySelector('a');
      if (first) first.focus();
      return;
    }
    if (state === 'playing') { userPaused = true; pause(); return; }
    userPaused = false;
    wantPlay = true;
    if (state === 'ready' || state === 'paused') play();
    else setStatus('还在路上，到了就放');
  }

  // 浏览器禁止有声 autoplay，退而求其次：第一次点页面任意处就开始
  function onFirstGesture(e) {
    if (wantPlay || userPaused || state === 'offline') return;
    var t = e.target;
    if (t && t.closest && t.closest('[data-music-toggle], [data-music-offline] a')) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    wantPlay = true;
    if (state === 'ready') play();
    else if (state === 'loading' || state === 'idle') setStatus('还在路上，到了就放');
    doc.removeEventListener('pointerdown', onFirstGesture, true);
    doc.removeEventListener('keydown', onFirstGesture, true);
  }

  function initMusic() {
    if (!music || !toggle) return;
    toggle.addEventListener('click', onToggle);
    doc.addEventListener('pointerdown', onFirstGesture, true);
    doc.addEventListener('keydown', onFirstGesture, true);
    loadYouTube();
  }

  loadBody();
  initMusic();
  onScroll();
})();
