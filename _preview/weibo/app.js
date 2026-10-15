/* 微博碎句集 · 设计稿脚本
   1. 现读 ../../weibo.md，用 vendor/marked 渲染进 [data-weibo-body]，只加样式钩子，不改一个字；
   2. 星空层；
   3. 留声机：YouTube 官方嵌入播放器（youtube-nocookie），首次点击页面任意处开始播放；
      连不上就优雅降级成「去别处听」的链接卡片，不抛错。 */
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

  /* ---------------- 留声机 ---------------- */

  // 歌：The Walters《I Love You So》。只用 YouTube 官方嵌入播放器播放，不在仓库里放任何音频。
  // VIDEO_ID 需要在能上 YouTube 的网络里核对一次（见 DESIGN.md「待核对」）；
  // 预览时可用 ?yt=<视频ID> 临时覆盖。加载后会核对标题 / 频道，不是这首歌就降级，不会放错歌。
  var DEFAULT_VIDEO_ID = 'ZtDDXF_VfZE';
  var LOAD_TIMEOUT = 9000;     // 外网被拦时多久放弃
  var PLAY_CHECK = 2500;       // 调用播放后多久还没响，就判定被浏览器拦了

  var music = doc.querySelector('[data-music]');
  var toggle = doc.querySelector('[data-music-toggle]');
  var statusEl = doc.querySelector('[data-music-status]');
  var playerEl = doc.querySelector('[data-music-player]');
  var offlineEl = doc.querySelector('[data-music-offline]');
  var mini = doc.querySelector('[data-music-mini]');

  var player = null;
  var state = 'idle';           // idle | loading | ready | playing | paused | offline
  var wantPlay = false;          // 用户已经「落针」，等播放器就绪
  var userPaused = false;        // 用户主动暂停后，不再被「点任意处」唤醒
  var loadTimer = null;
  var playTimer = null;

  function videoId() {
    try {
      var q = new URLSearchParams(location.search).get('yt');
      if (q && /^[\w-]{11}$/.test(q)) return q;
    } catch (e) { /* 老浏览器没有 URLSearchParams，用默认 */ }
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
    if (mini) mini.classList.toggle('is-playing', playing);
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
    setStatus(reason || '唱片机连不上，下面有别的去处。');
  }

  function looksLikeTheSong() {
    try {
      var d = player.getVideoData && player.getVideoData();
      if (!d || (!d.title && !d.author)) return true; // 拿不到元数据时不误杀
      var t = (d.title + ' ' + d.author).toLowerCase();
      return t.indexOf('walters') !== -1 || t.indexOf('i love you so') !== -1;
    } catch (e) { return true; }
  }

  function onReady() {
    clearTimeout(loadTimer);
    if (!looksLikeTheSong()) {
      goOffline('嵌入的视频不是这首歌（视频 ID 待核对），先去别处听。');
      return;
    }
    setState('ready');
    setStatus(wantPlay ? '唱针落下……' : '唱针已经备好，轻触页面任意处，歌就开始。');
    if (wantPlay) play();
  }

  function onStateChange(e) {
    var YT = window.YT;
    if (!YT || !YT.PlayerState) return;
    if (e.data === YT.PlayerState.PLAYING) {
      clearTimeout(playTimer);
      setState('playing');
      setStatus('正在播放 · 再点唱片可以暂停');
    } else if (e.data === YT.PlayerState.PAUSED) {
      setState('paused');
      setStatus('暂停了。');
    } else if (e.data === YT.PlayerState.ENDED) {
      setState('paused');
      setStatus('放完了，再点唱片从头听一遍。');
    }
  }

  function onError() {
    goOffline('这首歌在嵌入播放器里放不了，下面有别的去处。');
  }

  function createPlayer() {
    if (!window.YT || !window.YT.Player || !playerEl) { goOffline(); return; }
    var mount = doc.createElement('div');
    playerEl.appendChild(mount);
    try {
      player = new window.YT.Player(mount, {
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '200',
        videoId: videoId(),
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
        events: { onReady: onReady, onStateChange: onStateChange, onError: onError }
      });
    } catch (e) {
      goOffline();
    }
  }

  function loadYouTube() {
    if (state !== 'idle') return;
    setState('loading');
    loadTimer = setTimeout(function () {
      if (state === 'loading') goOffline('等了好一会儿，唱片机还没到（YouTube 可能被网络拦住了）。');
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
    s.onerror = function () { goOffline('YouTube 连不上（可能是网络或地区原因）。'); };
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
      if (state !== 'playing' && state !== 'offline') {
        // 典型情况：iOS Safari 只认在播放器里的直接点击
        setStatus('浏览器拦下了自动播放，请直接点一下右边播放器里的播放键。');
      }
    }, PLAY_CHECK);
  }

  function pause() {
    if (player && player.pauseVideo) { try { player.pauseVideo(); } catch (e) { /* 忽略 */ } }
  }

  function onToggle() {
    if (state === 'offline') {
      setStatus('唱片机连不上，下面有别的去处。');
      var first = offlineEl && offlineEl.querySelector('a');
      if (first) first.focus();
      return;
    }
    if (state === 'playing') {
      userPaused = true;
      pause();
      return;
    }
    userPaused = false;
    wantPlay = true;
    if (state === 'ready' || state === 'paused') play();
    else setStatus('唱片机还在路上，到了就放。');
  }

  // 「进来就放」做不到（浏览器禁止有声自动播放），退而求其次：第一次点页面任意处就落针
  function onFirstGesture(e) {
    if (wantPlay || userPaused || state === 'offline') return;
    var t = e.target;
    if (t && t.closest && t.closest('[data-music-toggle], [data-music-mini], [data-music-offline] a')) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    wantPlay = true;
    if (state === 'ready') play();
    else if (state === 'loading' || state === 'idle') setStatus('唱片机还在路上，到了就放。');
    stopListening();
  }
  function stopListening() {
    doc.removeEventListener('pointerdown', onFirstGesture, true);
    doc.removeEventListener('keydown', onFirstGesture, true);
  }

  function initMusic() {
    if (!music || !toggle) return;
    toggle.addEventListener('click', onToggle);
    if (mini) {
      mini.addEventListener('click', onToggle);
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
          mini.hidden = entries[0].isIntersecting;
        }).observe(music);
      }
    }
    doc.addEventListener('pointerdown', onFirstGesture, true);
    doc.addEventListener('keydown', onFirstGesture, true);
    loadYouTube();
  }

  buildSky();
  loadBody();
  initMusic();
  if (reduceMotion) doc.documentElement.classList.add('reduce-motion');
})();
