/* 香又脆的菜花 · 沉浸式 WebGL 版
   纯静态单页：hash 路由 + 浏览器内渲染 Markdown（vendor/marked.min.js）。
   背景场景与转场在 js/gl.js。 */
(function () {
  'use strict';

  /* 内容根：站点根目录。文章 .md、头像、工具页、rapstar/ 都从这里出发。 */
  var CONTENT_ROOT = './';
  function C(path) { return CONTENT_ROOT + path; }

  var root = document.documentElement;
  var view = document.getElementById('view');
  var LANG_KEY = 'datode-lang';

  function mq(q) { return window.matchMedia ? window.matchMedia(q) : { matches: false }; }
  var mqReduce = mq('(prefers-reduced-motion: reduce)');
  var mqFine = mq('(hover: hover) and (pointer: fine)');
  var mqSmall = mq('(max-width: 760px), (pointer: coarse)');
  function reduced() { return !!mqReduce.matches; }
  function small() { return !!mqSmall.matches; }
  function onChange(m, fn) { if (m.addEventListener) m.addEventListener('change', fn); else if (m.addListener) m.addListener(fn); }

  /* ---------------- 内容数据 ---------------- */
  var ARTICLES = [
    { path: 'weibo', cat: 'weibo', date: '2012–2022',
      zh: '微博合辑（2012–2022）', en: 'Weibo anthology, 2012–2022',
      dzh: '十年老号被炸之后，挑了一百来条原创碎碎念留作纪念。', den: 'A hundred-odd original posts saved from a decade-old account that was shut down.' },
    { path: 'baibian', cat: 'weibo', date: '2025–2026',
      zh: '百变动态合集', en: 'Baibian posts, 2025–2026',
      dzh: '在百变里发过的一百多条动态，从新到旧。', den: 'A hundred-odd posts from Baibian, newest first.' },
    { path: '_study/docsify', cat: 'study',
      zh: 'Docsify + Github 五分钟搭建一个博客网站', en: 'Build a blog in five minutes with Docsify and GitHub',
      dzh: '微博炸号以后，建站变成了刚需。', den: 'After losing the Weibo account, a website became a necessity.' },
    { path: '_study/vpn', cat: 'study',
      zh: '如何在一分钟之内搭建一个VPN', en: 'Spin up a personal virtual private network in one minute',
      dzh: '一台境外服务器加 Docker，给梯子续命。', den: 'One overseas server plus Docker, and you are never locked out again.' },
    { path: '_study/Docker上手体验', cat: 'study',
      zh: 'Docker 上手体验，使用 Docker 运行你的 Python 脚本', en: 'First steps with Docker: running your Python scripts in a container',
      dzh: '让 Python 脚本在服务器上稳稳驻留。', den: 'Keeping Python scripts alive on a server, reliably.' },
    { path: '_study/Python+TGbot+Docker实现自动续签进京证', cat: 'study',
      zh: 'Python + TG bot + Docker 实现自动续签进京证', en: 'Auto-renewing the Beijing entry permit with Python, a Telegram bot and Docker',
      dzh: '手里拿着锤子，满世界找钉子。', den: 'When you hold a hammer, everything looks like a nail.' },
    { path: '_works/《无名之辈》观后：一场悲凉的烟花散场', cat: 'works',
      zh: '《无名之辈》观后：一场悲凉的烟花散场', en: 'On “A Cool Fish”: the fireworks fade, and it is sad',
      dzh: '一部包裹着苦涩生活的美丽糖果。', den: 'A pretty candy wrapped around a bitter life.' },
    { path: '_works/普通人如何去拥有富士山呢', cat: 'works', date: '2025.10.13',
      zh: '普通人如何去拥有富士山呢？', en: 'How does an ordinary person come to own Mount Fuji?',
      dzh: '写给一场单恋，和一座不属于自己的山。', den: 'On unrequited love, and a mountain that was never yours.' },
    // hidden: true —— 不进文章列表、角标、首页篇数和上一篇 / 下一篇，直达链接照旧能打开。删掉 hidden 这一行即可恢复显示。
    { path: '_works/周宇新：毛泽东一生谋的都是权', cat: 'works',
      hidden: true,
      zh: '【转载】周宇新：毛泽东一生谋的都是权', en: 'Repost — Zhou Yuxin: all Mao ever sought was power',
      dzh: '一篇转载的长文。', den: 'A long essay, reposted.' },
    // 同上：删掉 hidden 这一行即可恢复显示。
    { path: '_works/户口壁垒：现代中国的身份鸿沟', cat: 'works',
      hidden: true,
      zh: '户口壁垒：现代中国的“身份鸿沟”', en: 'The hukou barrier: the “identity gap” in modern China',
      dzh: '一个延续六十余年的人口管理制度。', den: 'A household registration system, more than sixty years on.' }
  ];
  // 列表、角标、篇数、上一篇 / 下一篇只用这一份；findMeta 仍查全部 ARTICLES，所以隐藏的文章直达链接还在
  var LISTED = ARTICLES.filter(function (a) { return !a.hidden; });
  // 不在列表里、但旧链接仍要能打开
  var EXTRA = [
    { path: '_weibo/weibo0', cat: 'weibo', zh: '微博存档 · 生活手账', en: 'Weibo archive: life notes' },
    { path: 'README', cat: 'about', zh: '关于我', en: 'About me' }
  ];

  var ICONS = {
    stock: '<polyline points="6,36 16,25 24,30 41,12"/><polyline points="32,12 41,12 41,21"/>',
    sticker: '<circle cx="24" cy="24" r="15"/><circle cx="19" cy="21" r="1.6"/><circle cx="29" cy="21" r="1.6"/><path d="M17 28q7 7 14 0"/>',
    todo: '<rect x="10" y="10" width="28" height="28" rx="5"/><polyline points="16,24 22,30 33,17"/>',
    note: '<path d="M12 13h24M12 21h24M12 29h15M12 37h21"/>',
    loan: '<path d="M14 11l10 13 10-13M24 24v15M16 28h16M16 34h16"/>',
    fish: '<path d="M8 24c8-10 20-10 28 0-8 10-20 10-28 0z"/><path d="M36 24l7-7v14z"/><circle cx="16" cy="22" r="1.4"/>',
    clock: '<circle cx="24" cy="24" r="16"/><path d="M24 14v10l7 5"/>',
    hourglass: '<path d="M15 8h18l-9 16 9 16H15l9-16z"/><path d="M19 36h10"/>',
    clip: '<path d="M10 18h26l-6-6M38 30H12l6 6"/>'
  };

  // x / y：在空间画廊平面上的位置（%），d：景深（越大越近、越大、漂得越快）
  var TOOLS = [
    { slug: 'stock', href: 'stock/', x: 14, y: 22, d: 1.25, zh: '美股百强看板', en: 'Top 100 stocks board',
      dzh: '表现最好的一百只美股，带筛选与个股详情页。', den: 'The hundred best-performing American stocks, with filters and a detail page for each.' },
    { slug: 'sticker', href: 'sticker/', x: 41, y: 12, d: 0.85, zh: '智能贴纸工坊', en: 'Generative sticker studio',
      dzh: '用一句话生成你自己的表情贴纸。', den: 'Describe it in a sentence, get your own sticker.' },
    { slug: 'todo', href: 'todo.html', x: 67, y: 20, d: 1.1, zh: '待办便签', en: 'Docket notes',
      dzh: '轻量待办清单，数据只存在你的浏览器里。', den: 'A light to-do list that lives only in your browser.' },
    { slug: 'note', href: 'note.html', x: 88, y: 36, d: 0.75, zh: '极简文本排版', en: 'Minimal text typesetter',
      dzh: '粘贴一段文字，排成好看的版式。', den: 'Paste some text, get a tidy, good-looking layout.' },
    { slug: 'loan', href: 'loan.html', x: 30, y: 52, d: 0.95, zh: '贷款比较计算器', en: 'Loan comparison calculator',
      dzh: '先息后本、等额本息，一张表算清楚。', den: 'Compare repayment plans side by side, with totals.' },
    { slug: 'fish', href: 'fish.html', x: 56, y: 47, d: 1.3, zh: '动态鱼缸', en: 'Living fish tank',
      dzh: '一缸会游的鱼，适合发呆。', den: 'A tank of swimming fish, made for zoning out.' },
    { slug: 'clock', href: 'clock.html', x: 12, y: 74, d: 0.8, zh: '指针时钟', en: 'Analog clock',
      dzh: '带日期的模拟时钟，放在副屏刚好。', den: 'An analog clock with the date, made for a second screen.' },
    { slug: 'hourglass', href: 'hourglass.html', x: 44, y: 82, d: 1.05, zh: '沙漏计时器', en: 'Hourglass timer',
      dzh: '会翻转的沙漏，专注一段时间。', den: 'A flipping hourglass for one focused stretch of time.' },
    { slug: 'clip', href: 'https://clip.gpubuy.com', external: true, x: 76, y: 72, d: 1.2, zh: '共享剪贴板', en: 'Shared clipboard',
      dzh: '共享剪贴板与文件中转，手机电脑之间传东西。', den: 'A shared clipboard and file relay between your phone and computer.' }
  ];

  var RAPSTAR = {
    slug: 'rapstar', href: 'rapstar/',
    tracks: [
      { id: 'payphone', name: 'Payphone', sub: 'Wiz Khalifa verse cover', audio: 'rapstar/payphone-cover.mp3', page: 'rapstar/payphone-cover.html' },
      { id: 'baby', name: 'Baby', sub: 'Cover', audio: 'rapstar/baby-cover11.mp3', page: 'rapstar/baby-cover.html' }
    ]
  };

  var CATS = {
    study: { zh: '学习笔记', en: 'Study notes' },
    works: { zh: '随笔杂文', en: 'Essays' },
    weibo: { zh: '动态存档', en: 'Posts archive' },
    about: { zh: '关于', en: 'About' }
  };

  /* ---------------- 界面文字 ---------------- */
  var STR = {
    zh: {
      title: '香又脆的菜花',
      brand: '香又脆的菜花',
      fbGlyph: '菜花',
      skip: '跳到正文',
      navLabel: '主导航',
      'nav.articles': '文章', 'nav.tools': '工具', 'nav.works': '作品', 'nav.about': '关于',
      langAria: 'Switch to English',
      'foot.big': '菜花还在生长',
      'foot.note': '香又脆的菜花 · 北京 · 四海为家',
      'foot.weibo': '微博', 'foot.top': '回到顶部',
      modes: { home: '场景 · 菜花', articles: '场景 · 星野', tools: '场景 · 漂流', works: '场景 · 声环', about: '场景 · 肖像', reading: '阅读', frame: '外框', '': '场景 · 迷路' },
      particles: function (n) { return n.toLocaleString('zh-CN') + ' 颗粒子'; },
      heroKicker: 'datode.com · 起居注 · 食货志 · 自 2012 年起',
      heroTitle: '香又脆的菜花',
      heroSub: '一个社会“闲达”的起居注和食货志',
      heroHint: '动一动鼠标，搅一搅菜花',
      heroHintTouch: '往下滑，菜花会散开',
      scroll: '向下滚动',
      manifestoKicker: '这里记三件事',
      manifesto: ['记录 Python、AI 和算法学习心得', '记录读书笔记、游记和影评食评', '记录出海业务搞钱思路和实践'],
      portalsKicker: '四个入口',
      sec: {
        articles: ['文章', '学习笔记、随笔杂文与动态存档'],
        tools: ['工具', '自己写来用的小工具，漂在空间里'],
        works: ['作品', 'Rapstar：一座说唱翻唱站'],
        about: ['关于', '从哪里讲起呢……']
      },
      portraitKicker: '粒子聚成的这位，就是我',
      portraitTitle: '本人，大概',
      quote: '人的一生就是“I have a bright future ahead”里的每个字逐个拿掉的过程。',
      quoteCite: '—— 摘自微博存档',
      meet: '认识一下',
      articlesLede: '学习笔记、随笔杂文和动态存档。正文保持原样；阅读时背景会安静下来。',
      toolsLede: '自己写来用的小工具，漂在一片空间里。拖动画布四处看看，悬停会折射，点一下就在站内外框里打开。',
      toolsLedeTouch: '自己写来用的小工具，随滚动漂流。点一下就在站内外框里打开。',
      dragHint: '按住拖动 · 浏览空间',
      worksKicker: '唯一的一件作品',
      worksLede: '一座说唱翻唱曲目站：每首歌一张封面卡、一段音频、一页歌词。下面可以直接听——声音默认关着，点了才响。',
      aboutLede: '互联网个体户，base 北京，经常出差，四海为家。',
      aboutMeta: '自述',
      all: '全部',
      count: function (n) { return n + ' 篇'; },
      countItems: function (n) { return n + ' 件'; },
      openHere: '在这里打开',
      openNew: '新窗口打开',
      visit: '前往',
      back: '返回',
      readTime: function (m) { return '约 ' + m + ' 分钟读完'; },
      chars: function (n) { return n.toLocaleString('zh-CN') + ' 字'; },
      toc: '本文目录',
      prev: '上一篇', next: '下一篇',
      endMark: '（完）',
      backToList: '回到文章列表',
      loading: '正在排版……',
      notFound: '这一页走丢了',
      notFoundText: '链接可能已经改名或者被删掉了。',
      goHome: '回到首页',
      loadError: '文章加载失败，请检查网络后刷新。',
      avatarAlt: '菜花的头像',
      portrait: '本人近照（大概）',
      frameNote: '工具运行在站内外框中',
      sectionNames: { articles: '文章', tools: '工具', works: '作品', about: '关于' },
      play: '播放', pause: '暂停',
      soundOff: '声音默认关闭，点了才响',
      nowPlaying: '正在播放',
      tracks: '曲目',
      lyrics: '歌词页',
      enter: '进入 Rapstar',
      openSite: '在站内打开',
      worksFacts: [
        ['封面卡', '每首歌都有一张自己的封面卡，分享出去就是一张唱片。'],
        ['音频', '翻唱、混音都是自己做的，网页里直接播放。'],
        ['歌词页', '每首一页，歌词随段落排好，配一张大封面。']
      ],
      factsKicker: '它由三样东西组成',
      setlist: '曲目单 · 点歌名就能听',
      visualizer: '音频可视化',
      wb: {
        toc: '小节',
        toTop: '回到顶部'
      }
    },
    en: {
      title: 'Crispy Cauliflower',
      brand: 'Crispy Cauliflower',
      fbGlyph: '菜花',
      skip: 'Skip to content',
      navLabel: 'Main navigation',
      'nav.articles': 'Articles', 'nav.tools': 'Tools', 'nav.works': 'Works', 'nav.about': 'About',
      langAria: '切换到中文',
      'foot.big': 'Still growing',
      'foot.note': 'Crispy Cauliflower · Beijing · at home anywhere',
      'foot.weibo': 'Weibo', 'foot.top': 'Back to top',
      modes: { home: 'scene · cauliflower', articles: 'scene · starfield', tools: 'scene · drift', works: 'scene · sound ring', about: 'scene · portrait', reading: 'reading', frame: 'frame', '': 'scene · lost' },
      particles: function (n) { return n.toLocaleString('en-US') + ' particles'; },
      heroKicker: 'datode.com · a daily chronicle & household ledger · since 2012',
      heroTitle: 'Crispy Cauliflower',
      heroSub: 'The daily chronicle and household ledger of a self-styled social idler',
      heroHint: 'Move the mouse to stir the cauliflower',
      heroHintTouch: 'Scroll down and the cauliflower scatters',
      scroll: 'Scroll down',
      manifestoKicker: 'Three things get written down here',
      manifesto: ['Notes on Python, machine learning and algorithms', 'Reading notes, travelogues, film and food reviews', 'Ideas and practice for earning money overseas'],
      portalsKicker: 'Four ways in',
      sec: {
        articles: ['Articles', 'Study notes, essays and an archive of old posts'],
        tools: ['Tools', 'Small tools I built, floating in space'],
        works: ['Works', 'Rapstar: a rap cover-song site'],
        about: ['About', 'Where should I even begin…']
      },
      portraitKicker: 'The one the particles just drew is me',
      portraitTitle: 'The author, more or less',
      quote: 'Life is the process of taking away, one word at a time, “I have a bright future ahead”.',
      quoteCite: '— from the Weibo archive',
      meet: 'Say hello',
      articlesLede: 'Study notes, essays and an archive of old posts. The texts stay in their original Chinese; the background goes quiet while you read.',
      toolsLede: 'Small tools I built for myself, floating in a space. Drag to look around, hover to see them refract, click to open one inside the site frame.',
      toolsLedeTouch: 'Small tools I built for myself, drifting as you scroll. Tap one to open it inside the site frame.',
      dragHint: 'Hold and drag · explore the space',
      worksKicker: 'The one and only work',
      worksLede: 'A rap cover-song site: every song gets a cover card, an audio track and a lyric page. You can listen right here — sound stays off until you press play.',
      aboutLede: 'An internet freelancer based in Beijing, often on the road, at home anywhere.',
      aboutMeta: 'In my own words',
      all: 'All',
      count: function (n) { return n + (n === 1 ? ' piece' : ' pieces'); },
      countItems: function (n) { return n + (n === 1 ? ' item' : ' items'); },
      openHere: 'Open here',
      openNew: 'New window',
      visit: 'Visit',
      back: 'Back',
      readTime: function (m) { return 'About ' + m + ' min read'; },
      chars: function (n) { return n.toLocaleString('en-US') + ' characters'; },
      toc: 'Contents',
      prev: 'Previous', next: 'Next',
      endMark: 'The end',
      backToList: 'Back to all articles',
      loading: 'Setting type…',
      notFound: 'This page wandered off',
      notFoundText: 'The link may have been renamed or removed.',
      goHome: 'Back home',
      loadError: 'The article failed to load. Check your connection and refresh.',
      avatarAlt: 'Portrait of the author',
      portrait: 'The author, more or less',
      frameNote: 'Running inside the site frame',
      sectionNames: { articles: 'Articles', tools: 'Tools', works: 'Works', about: 'About' },
      play: 'Play', pause: 'Pause',
      soundOff: 'Sound is off until you press play',
      nowPlaying: 'Now playing',
      tracks: 'Tracks',
      lyrics: 'Lyric page',
      enter: 'Enter Rapstar',
      openSite: 'Open here',
      worksFacts: [
        ['Cover cards', 'Every song has its own cover card, so a shared link looks like a record sleeve.'],
        ['Audio', 'Covers and mixes made at home, playable right in the page.'],
        ['Lyric pages', 'One page per song, lyrics set by verse beside a large cover.']
      ],
      factsKicker: 'It is made of three things',
      setlist: 'Setlist · tap a title to listen',
      visualizer: 'Audio visualizer',
      wb: {
        toc: 'Sections',
        toTop: 'Back to top'
      }
    }
  };

  var lang = root.getAttribute('lang') === 'en' ? 'en' : 'zh';
  function S() { return STR[lang]; }
  function L(o, k) { var key = (k || '') + lang; return o[key] != null ? o[key] : o[(k || '') + 'zh']; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hrefFor(path) { return '#/' + path; }
  function icon(slug) { return '<svg viewBox="0 0 48 48" aria-hidden="true">' + (ICONS[slug] || '') + '</svg>'; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---------------- 语言 ---------------- */
  function applyStatic() {
    root.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
    var s = S();
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-i18n');
      if (s[k] != null) nodes[i].textContent = s[k];
    }
    var an = document.querySelectorAll('[data-i18n-aria]');
    for (var j = 0; j < an.length; j++) an[j].setAttribute('aria-label', s[an[j].getAttribute('data-i18n-aria')]);
    var btn = document.querySelector('[data-lang-toggle]');
    if (btn) {
      btn.setAttribute('aria-label', s.langAria);
      btn.setAttribute('aria-pressed', lang === 'en' ? 'true' : 'false');
    }
    var tn = document.querySelector('[data-tel="n"]');
    if (tn) tn.textContent = window.Scene && Scene.ok ? s.particles(Scene.count()) : '';
  }

  function setLang(next) {
    lang = next;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    applyStatic();
    route(true);
  }

  /* ---------------- 路由 ---------------- */
  function parseHash() {
    var h = location.hash || '#/';
    h = h.replace(/^#!?/, '');
    var query = '';
    var qi = h.indexOf('?');
    if (qi >= 0) { query = h.slice(qi + 1); h = h.slice(0, qi); }
    try { h = decodeURIComponent(h); } catch (e) {}
    if (h.charAt(0) !== '/') h = '/' + h;
    h = h.replace(/\/+$/, '') || '/';
    h = h.replace(/\.md$/i, '');
    var id = '';
    query.split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0] === 'id' && p[1]) { try { id = decodeURIComponent(p[1]); } catch (e) { id = p[1]; } }
    });
    return { path: h, id: id };
  }

  var ARTICLE_RE = /^\/(weibo|README|_weibo\/[^\/]+|_study\/[^\/]+|_works\/[^\/]+)$/;

  function findMeta(p) {
    var all = ARTICLES.concat(EXTRA);
    for (var i = 0; i < all.length; i++) if (all[i].path === p) return all[i];
    return null;
  }

  // 上一篇 / 下一篇：按列表里看得见的顺序；隐藏的文章不出现，也不从它那里往外连
  function listNeighbours(meta) {
    var idx = LISTED.indexOf(meta);
    return {
      prev: idx > 0 ? LISTED[idx - 1] : null,
      next: idx >= 0 && idx < LISTED.length - 1 ? LISTED[idx + 1] : null
    };
  }

  function resolveRoute(r) {
    var p = r.path;
    if (p === '/' || p === '/home' || p === '/index') return { name: 'home', scene: 'home', render: homeView };
    if (p === '/articles') return { name: 'articles', scene: 'articles', render: articlesView };
    if (p === '/tools') return { name: 'tools', scene: 'tools', render: toolsView };
    if (p === '/works') return { name: 'works', scene: 'works', render: worksView };
    if (p === '/about') return { name: 'about', scene: 'about', render: aboutView };
    if (p === '/works/rapstar') return { name: 'works', scene: 'frame', render: function () { return frameView({ href: RAPSTAR.href, zh: 'Rapstar', en: 'Rapstar' }, 'works'); } };
    var m = p.match(/^\/tools\/([\w-]+)$/);
    if (m) {
      for (var i = 0; i < TOOLS.length; i++) {
        if (TOOLS[i].slug === m[1] && !TOOLS[i].external) {
          var item = TOOLS[i];
          return { name: 'tools', scene: 'frame', render: function () { return frameView(item, 'tools'); } };
        }
      }
    }
    // 微博合辑：第二版版式，仍属「文章」栏目（导航高亮文章），<html data-route="weibo"> 用来把纸色样式圈在这一页
    // paper: true 的两种页面共用纸页版式，<html data-paper> 圈住共用的纸色样式
    // 百变动态合集（#/baibian）与微博合辑同一套版式：同样 route: 'weibo'，只是不放小画（PAPER_COLLECTIONS）
    var coll = p.slice(1);
    if (PAPER_COLLECTIONS[coll]) return { name: 'articles', route: 'weibo', paper: true, scene: 'reading', article: true, render: function () { return weiboView(coll, r.id); } };
    if (ARTICLE_RE.test(p)) {
      var path = p.slice(1);
      if (PAPER_ESSAYS[path]) return { name: 'articles', route: 'essay', paper: true, scene: 'reading', article: true, render: function () { return paperEssayView(path, r.id); } };
      return { name: 'articles', scene: 'reading', article: true, render: function () { return articleView(path, r.id); } };
    }
    return { name: '', scene: '', render: notFoundView };
  }

  /* ---------------- 视图：首页 ---------------- */
  function homeView() {
    var s = S();
    var counts = { articles: LISTED.length, tools: TOOLS.length, works: 1, about: null };
    var portals = ['articles', 'tools', 'works', 'about'].map(function (k, i) {
      var c = counts[k] == null ? '' : pad(counts[k]);
      return '<li class="rv"><a class="portal" href="#/' + k + '" data-refract>' +
        '<span class="portal-n">' + pad(i + 1) + '</span>' +
        '<span class="portal-t" data-refract-target>' + esc(s.sec[k][0]) + '</span>' +
        '<span class="portal-d">' + esc(s.sec[k][1]) + '</span>' +
        '<span class="portal-c">' + esc(c) + '<i aria-hidden="true">→</i></span></a></li>';
    }).join('');
    var lines = s.manifesto.map(function (x, i) {
      return '<li class="rv"><span class="m-n">' + pad(i + 1) + '</span><span class="m-t">' + esc(x) + '</span></li>';
    }).join('');
    return '' +
      '<section class="hero" data-hero>' +
        '<p class="hero-kicker">' + esc(s.heroKicker) + '</p>' +
        '<div class="hero-bottom">' +
          '<div class="hero-copy">' +
            '<img class="hero-avatar" src="' + esc(C('IMG_0205.PNG')) + '" alt="' + esc(s.avatarAlt) + '" width="96" height="96" decoding="async">' +
            '<h1 class="hero-title">' + esc(s.heroTitle) + '</h1>' +
            '<p class="hero-sub">' + esc(s.heroSub) + '</p>' +
          '</div>' +
          '<a class="hero-cue" href="#/articles" data-scroll-next><span class="cue-line" aria-hidden="true"></span><span>' + esc(s.scroll) + '</span>' +
            '<small>' + esc(mqFine.matches ? s.heroHint : s.heroHintTouch) + '</small></a>' +
        '</div>' +
      '</section>' +
      '<section class="manifesto" id="manifesto">' +
        '<p class="kicker rv">' + esc(s.manifestoKicker) + '</p>' +
        '<ol class="m-list">' + lines + '</ol>' +
      '</section>' +
      '<section class="portals">' +
        '<p class="kicker rv">' + esc(s.portalsKicker) + '</p>' +
        '<ol class="portal-list">' + portals + '</ol>' +
      '</section>' +
      '<section class="portrait" data-portrait>' +
        '<div class="portrait-copy">' +
          '<p class="kicker rv">' + esc(s.portraitKicker) + '</p>' +
          '<h2 class="portrait-title rv">' + esc(s.portraitTitle) + '</h2>' +
          '<blockquote class="rv">' + esc(s.quote) + '<cite>' + esc(s.quoteCite) + '</cite></blockquote>' +
          '<a class="btn btn-solid rv" href="#/about">' + esc(s.meet) + ' →</a>' +
        '</div>' +
        '<img class="portrait-img" src="' + esc(C('IMG_0205.PNG')) + '" alt="' + esc(s.avatarAlt) + '" width="320" height="320" loading="lazy" decoding="async">' +
      '</section>';
  }

  /* ---------------- 栏目页头 ---------------- */
  function pageHead(key, lede, meta) {
    var s = S();
    return '<header class="page-head">' +
      '<p class="kicker rv">' + pad(['articles', 'tools', 'works', 'about'].indexOf(key) + 1) + ' / 04 · ' + esc(meta) + '</p>' +
      '<h1 class="page-title rv">' + esc(s.sec[key][0]) + '</h1>' +
      '<p class="page-lede rv">' + esc(lede) + '</p>' +
      '</header>';
  }

  /* ---------------- 视图：文章列表 ---------------- */
  function articlesView() {
    var s = S();
    var order = ['study', 'works', 'weibo'];
    var groups = order.map(function (cat) {
      var items = LISTED.filter(function (a) { return a.cat === cat; });
      var rows = items.map(function (a) {
        var n = LISTED.indexOf(a) + 1;
        var paper = !!PAPER_COLLECTIONS[a.path] || !!PAPER_ESSAYS[a.path];   // 纸页那一家：行样式与普通行一致，只多一段悬停过渡
        return '<li><a class="row"' + (paper ? ' data-paper-row' : '') + ' href="' + esc(hrefFor(a.path)) + '">' +
          '<span class="row-n">' + pad(n) + '</span>' +
          '<span class="row-t">' + esc(L(a)) + '</span>' +
          '<span class="row-d">' + esc(L(a, 'd')) + '</span>' +
          '<span class="row-go" aria-hidden="true">→</span>' +
          '</a></li>';
      }).join('');
      return '<section class="group rv" data-group="' + cat + '">' +
        '<div class="group-head"><h2><span class="tag tag-' + cat + '">' + esc(L(CATS[cat], '')) + '</span></h2><span>' + esc(s.count(items.length)) + '</span></div>' +
        '<ul class="rows">' + rows + '</ul></section>';
    }).join('');
    var chips = '<button class="chip" type="button" data-filter="all" aria-pressed="true">' + esc(s.all) + '<sup>' + LISTED.length + '</sup></button>' +
      order.map(function (cat) {
        var n = LISTED.filter(function (a) { return a.cat === cat; }).length;
        return '<button class="chip" type="button" data-filter="' + cat + '" aria-pressed="false">' + esc(L(CATS[cat], '')) + '<sup>' + n + '</sup></button>';
      }).join('');
    return pageHead('articles', s.articlesLede, s.count(LISTED.length)) +
      '<div class="sheet"><div class="chips rv" role="group">' + chips + '</div>' + groups + '</div>';
  }

  /* ---------------- 视图：工具（空间画廊） ---------------- */
  function toolsView() {
    var s = S();
    var items = TOOLS.map(function (t, i) {
      var main = t.external ? t.href : '#/tools/' + t.slug;
      var ext = t.external ? ' target="_blank" rel="noopener"' : '';
      var newWin = t.external ? t.href : C(t.href);
      var path = t.external ? t.href.replace(/^https?:\/\//, '') : 'datode.com/' + t.href;
      return '<li class="float" style="--x:' + t.x + '%;--y:' + t.y + '%;--d:' + t.d + '" data-d="' + t.d + '" data-i="' + i + '">' +
        '<a class="lens" href="' + esc(main) + '"' + ext + ' data-refract aria-label="' + esc(L(t)) + '">' +
          '<span class="lens-glass" data-refract-target>' + icon(t.slug) + '<span class="lens-n">' + pad(i + 1) + '</span></span>' +
        '</a>' +
        '<div class="float-meta">' +
          '<h2 class="float-t"><a href="' + esc(main) + '"' + ext + '>' + esc(L(t)) + (t.external ? ' ↗' : '') + '</a></h2>' +
          '<p class="float-d">' + esc(L(t, 'd')) + '</p>' +
          '<p class="float-path">' + esc(path) + '</p>' +
          '<p class="float-act">' +
            (t.external
              ? '<a href="' + esc(t.href) + '" target="_blank" rel="noopener">' + esc(s.visit) + ' ↗</a>'
              : '<a href="' + esc(main) + '">' + esc(s.openHere) + '</a><a href="' + esc(newWin) + '" target="_blank" rel="noopener">' + esc(s.openNew) + ' ↗</a>') +
          '</p>' +
        '</div>' +
      '</li>';
    }).join('');
    return pageHead('tools', mqFine.matches ? s.toolsLede : s.toolsLedeTouch, s.countItems(TOOLS.length)) +
      '<div class="gallery" data-gallery tabindex="-1">' +
        '<p class="drag-hint" aria-hidden="true">' + esc(s.dragHint) + '</p>' +
        '<ul class="plane">' + items + '</ul>' +
      '</div>';
  }

  function frameView(item, sec) {
    var s = S();
    var src = C(item.href);
    return { html: '<section class="frame">' +
      '<div class="frame-bar">' +
        '<a class="btn" href="#/' + sec + '">← ' + esc(s.sectionNames[sec]) + '</a>' +
        '<h1>' + esc(L(item)) + '</h1>' +
        '<a class="btn" href="' + esc(src) + '" target="_blank" rel="noopener">' + esc(s.openNew) + ' ↗</a>' +
      '</div>' +
      '<div class="frame-shell">' +
        '<div class="frame-chrome"><i></i><i></i><i></i><span>datode.com/' + esc(item.href) + ' — ' + esc(s.frameNote) + '</span></div>' +
        '<iframe src="' + esc(src) + '" title="' + esc(L(item)) + '" loading="lazy"></iframe>' +
      '</div></section>', title: L(item) };
  }

  /* ---------------- 视图：作品（Rapstar 专题） ---------------- */
  function worksView() {
    var s = S();
    var tr = RAPSTAR.tracks.map(function (t, i) {
      return '<li class="track" data-track="' + i + '">' +
        '<button class="track-play" type="button" data-play="' + i + '" aria-label="' + esc(s.play + ' ' + t.name) + '"><span class="ico-play" aria-hidden="true"></span></button>' +
        '<span class="track-n">' + pad(i + 1) + '</span>' +
        '<span class="track-t">' + esc(t.name) + '<small>' + esc(t.sub) + '</small></span>' +
        '<a class="track-l" href="' + esc(C(t.page)) + '" target="_blank" rel="noopener">' + esc(s.lyrics) + ' ↗</a>' +
      '</li>';
    }).join('');
    var facts = s.worksFacts.map(function (f, i) {
      return '<li class="rv"><span class="fact-n">' + pad(i + 1) + '</span><h3>' + esc(f[0]) + '</h3><p>' + esc(f[1]) + '</p></li>';
    }).join('');
    var marquee = RAPSTAR.tracks.map(function (t, i) {
      return '<li class="rv"><button type="button" class="big-track" data-play="' + i + '"><span class="bt-n">' + pad(i + 1) + '</span><span class="bt-t">' + esc(t.name) + '</span><span class="bt-s">' + esc(t.sub) + '</span></button></li>';
    }).join('');
    return '<section class="stage">' +
        '<div class="stage-copy">' +
          '<p class="kicker rv">03 / 04 · ' + esc(s.worksKicker) + '</p>' +
          '<h1 class="mega rv">Rapstar</h1>' +
          '<p class="page-lede rv">' + esc(s.worksLede) + '</p>' +
          '<p class="stage-act rv"><a class="btn btn-solid" href="#/works/rapstar">' + esc(s.openSite) + '</a><a class="btn" href="' + esc(C(RAPSTAR.href)) + '" target="_blank" rel="noopener">' + esc(s.openNew) + ' ↗</a></p>' +
        '</div>' +
        '<div class="deck">' +
          '<div class="vis" data-vis>' +
            '<canvas class="vis-canvas" aria-label="' + esc(s.visualizer) + '" role="img"></canvas>' +
            '<button class="disc" type="button" data-play="0" aria-label="' + esc(s.play + ' ' + RAPSTAR.tracks[0].name) + '">' +
              '<span class="disc-label" aria-hidden="true">飽</span>' +
              '<span class="disc-ico ico-play" aria-hidden="true"></span>' +
            '</button>' +
          '</div>' +
          '<p class="now" data-now>' + esc(s.soundOff) + '</p>' +
          '<ol class="tracks" aria-label="' + esc(s.tracks) + '">' + tr + '</ol>' +
        '</div>' +
      '</section>' +
      '<section class="facts">' +
        '<p class="kicker rv">' + esc(s.factsKicker) + '</p>' +
        '<ol class="fact-list">' + facts + '</ol>' +
      '</section>' +
      '<section class="setlist"><p class="kicker rv">' + esc(s.setlist) + '</p><ol>' + marquee + '</ol></section>' +
      '<section class="outro"><a class="outro-link" href="#/works/rapstar" data-refract><span data-refract-target>' + esc(s.enter) + '</span> <i aria-hidden="true">→</i></a></section>';
  }

  /* ---------------- Markdown ---------------- */
  // 文本缓存 + 进行中的请求去重：已经拿到的 .md 可以同步渲染，路由切换不用等网络
  var mdCache = {};
  var mdPending = {};
  function loadMd(path) {
    if (mdCache[path] != null) return Promise.resolve(mdCache[path]);
    if (mdPending[path]) return mdPending[path];
    var url = C(path.split('/').map(encodeURIComponent).join('/') + '.md');
    var p = fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) { var err = new Error('HTTP ' + res.status); err.status = res.status; throw err; }
      return res.text();
    }).then(function (t) { t = editedMd(path, t); mdCache[path] = t; delete mdPending[path]; return t; }, function (e) { delete mdPending[path]; throw e; });
    mdPending[path] = p;
    return p;
  }
  // 有缓存就同步出结果，没有才返回 Promise
  function withMd(path, ok, fail) {
    if (mdCache[path] != null) return ok(mdCache[path]);
    return loadMd(path).then(ok, fail);
  }

  /* 站长在这台浏览器里刚保存过的正文（js/edit.js 保存成功后经 editBridge.setMd 记进 localStorage）：Pages 的 CDN 还在发旧版时先用它，
     线上已是新版、或线上变成了别的版本、或过了一天，就删掉这条记录、照常用线上的。访客没有这条记录，什么都不变。 */
  var EDITED_KEY = 'datode-edit-pending';
  function mdHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return s.length + ':' + (h >>> 0).toString(16);
  }
  function editedAll() {
    try { return JSON.parse(localStorage.getItem(EDITED_KEY) || 'null') || null; } catch (e) { return null; }
  }
  function editedMd(path, text) {
    var all = editedAll();
    var rec = all && all[path];
    if (!rec) return text;
    if (text !== rec.text && rec.stale && rec.stale.indexOf(mdHash(text)) >= 0 && Date.now() - rec.at < 864e5) return rec.text;
    delete all[path];
    try { if (Object.keys(all).length) localStorage.setItem(EDITED_KEY, JSON.stringify(all)); else localStorage.removeItem(EDITED_KEY); } catch (e) {}
    return text;
  }
  function rememberEdited(path, before, after) {
    var all = editedAll() || {};
    var rec = all[path] || { stale: [] };
    if (rec.stale.indexOf(mdHash(before)) < 0) rec.stale.push(mdHash(before));
    rec.text = after;
    rec.at = Date.now();
    all[path] = rec;
    try { localStorage.setItem(EDITED_KEY, JSON.stringify(all)); } catch (e) {}
  }

  // 所有正文都从这里过 marked；编辑模式下 js/edit.js 换上 mdHook，给每个顶层块标上序号，输出的 HTML 其余一字不差
  var mdHook = null;
  function parseMd(md, opts) {
    if (!window.marked) return '<pre>' + esc(md) + '</pre>';
    return mdHook ? mdHook(md, opts) : window.marked.parse(md, opts);
  }

  function resolvePath(dir, rel) {
    var parts = (dir ? dir.split('/') : []);
    rel.split('/').forEach(function (seg) {
      if (seg === '..') parts.pop();
      else if (seg !== '.' && seg !== '') parts.push(seg);
    });
    return parts.join('/');
  }

  function slugify(text, used) {
    var base = text.trim().replace(/[\s]+/g, '-').replace(/[^\w一-鿿㐀-䶿-]/g, '').toLowerCase() || 'section';
    var id = base, n = 1;
    while (used[id]) id = base + '-' + (++n);
    used[id] = true;
    return id;
  }

  function renderMarkdown(md, path) {
    var dir = path.indexOf('/') >= 0 ? path.slice(0, path.lastIndexOf('/')) : '';
    var html = parseMd(md, { gfm: true, breaks: false });
    var box = document.createElement('div');
    box.innerHTML = html;

    Array.prototype.forEach.call(box.querySelectorAll('h1,h2,h3,h4,h5,h6'), function (h) {
      if (!h.textContent.trim()) h.parentNode.removeChild(h);
    });
    // 链接：站内 .md 改成 hash 路由；其余站内文件经内容根；外链新窗口
    Array.prototype.forEach.call(box.querySelectorAll('a[href]'), function (a) {
      var href = a.getAttribute('href').trim();
      if (/^(https?:)?\/\//i.test(href) || /^mailto:/i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
        return;
      }
      if (href.charAt(0) === '#') return;
      var clean = href.split('#')[0].split('?')[0];
      var target = clean.charAt(0) === '/' ? clean.slice(1) : resolvePath(dir, clean);
      try { target = decodeURIComponent(target); } catch (e) {}
      if (/\.md$/i.test(target)) a.setAttribute('href', '#/' + target.replace(/\.md$/i, ''));
      else a.setAttribute('href', C(target));
    });
    Array.prototype.forEach.call(box.querySelectorAll('img[src]'), function (img) {
      var src = img.getAttribute('src').trim();
      if (!/^(https?:|data:|\/\/)/i.test(src)) img.setAttribute('src', C(src.charAt(0) === '/' ? src.slice(1) : resolvePath(dir, src)));
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
    });
    Array.prototype.forEach.call(box.querySelectorAll('table'), function (t) {
      var w = document.createElement('div');
      w.className = 'table-wrap';
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
    });
    var used = {};
    var toc = [];
    Array.prototype.forEach.call(box.querySelectorAll('h1,h2,h3'), function (h) {
      var text = h.textContent.trim();
      h.id = slugify(text, used);
      h.setAttribute('data-text', text);
      if (h.tagName === 'H2') toc.push({ id: h.id, text: text });
    });
    return { html: box.innerHTML, toc: toc };
  }

  function countChars(md) {
    var m = md.replace(/```[\s\S]*?```/g, '').match(/[一-鿿㐀-䶿]/g);
    return m ? m.length : 0;
  }

  /* ---------------- 视图：文章 ---------------- */
  function articleView(path, anchor) {
    var s = S();
    var meta = findMeta(path) || { path: path, cat: path.indexOf('_study/') === 0 ? 'study' : path.indexOf('_works/') === 0 ? 'works' : 'weibo', zh: path.split('/').pop(), en: path.split('/').pop() };
    return withMd(path, function (md) {
      var r = renderMarkdown(md, path);
      var chars = countChars(md);
      var mins = Math.max(1, Math.round(chars / 450));
      var nb = listNeighbours(meta);
      var prev = nb.prev;
      var next = nb.next;
      var toc = r.toc.length >= 3
        ? '<nav class="toc" aria-label="' + esc(s.toc) + '"><p class="toc-label">' + esc(s.toc) + '</p><ol lang="zh-CN">' +
          r.toc.map(function (t) { return '<li><a href="#/' + esc(path) + '?id=' + encodeURIComponent(t.id) + '" data-anchor="' + esc(t.id) + '">' + esc(t.text) + '</a></li>'; }).join('') +
          '</ol></nav>'
        : '';
      var pager = (prev || next) ? '<nav class="pager">' +
        (prev ? '<a href="' + esc(hrefFor(prev.path)) + '"><small>← ' + esc(s.prev) + '</small><span>' + esc(L(prev)) + '</span></a>' : '<span></span>') +
        (next ? '<a class="pager-next" href="' + esc(hrefFor(next.path)) + '"><small>' + esc(s.next) + ' →</small><span>' + esc(L(next)) + '</span></a>' : '<span></span>') +
        '</nav>' : '';
      var catName = L(CATS[meta.cat] || CATS.weibo, '');
      return {
        html: '<article class="article">' +
          '<header class="article-head">' +
            '<p class="crumbs"><a href="#/articles">← ' + esc(s.sectionNames.articles) + '</a><span class="tag tag-' + esc(meta.cat) + '">' + esc(catName) + '</span>' + (meta.date ? '<span>' + esc(meta.date) + '</span>' : '') + '</p>' +
            '<h1 class="article-title">' + esc(L(meta)) + '</h1>' +
            '<p class="article-meta"><span>' + esc(s.chars(chars)) + '</span><span>' + esc(s.readTime(mins)) + '</span></p>' +
          '</header>' +
          '<div class="article-body">' +
            '<aside class="article-aside">' + toc + '</aside>' +
            '<div class="prose" lang="zh-CN">' + r.html +
              '<p class="article-end"><span>' + esc(s.endMark) + '</span><a href="#/articles">' + esc(s.backToList) + ' →</a></p>' +
            '</div>' +
          '</div>' +
          pager +
          '</article>',
        title: L(meta),
        anchor: anchor
      };
    }, mdFail);
  }

  /* ---------------- 纸页：#/weibo 与纸页随笔共用的一套版式（设计见 _preview/weibo-v2/DESIGN.md） ----------------
     暖纸底、纸飞机母题、阅读进度、贴着句子的单色墨线小画。微博合辑（weiboView）和登记在 PAPER_ESSAYS 里的随笔
     （paperEssayView）都由 paperPage 出页面、paperSketches 放小画、initPaper 挂阅读进度和回到顶部；
     样式在 css/site.css 的 html[data-paper] 下，类名沿用 wb- 前缀。
     只有微博合辑才有的东西（按 h2 分节、[data-entry] 条目、条间记号）留在 wbDecorate / wbRenderSeps 里。
     正文都是运行时读 .md，一个字不改；小画、字体直接引用 _preview/weibo-v2/ 下那一份素材，不另存拷贝。 */
  var WB_ASSETS = '_preview/weibo-v2/';
  // frag 是 weibo.md 里那一条的连续原文（去空白后匹配），画放在那条碎句旁边
  var WB_SKETCHES = [
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
  // 走微博合辑版式的合集：path → 小画。百变动态合集先不放画，等内容删定了再加
  var PAPER_COLLECTIONS = {
    weibo: { sketches: WB_SKETCHES },
    baibian: { sketches: [], font: 'baibian' }   // 这篇有 300 多个字不在微博那份文楷子集里，另有一份子集 fonts/wenkai-baibian.woff2
  };
  var WB_SEPS = ['dot', 'num', 'line'];
  var WB_SEP_DEFAULT = 'num';    // 条间记号默认值；用户定了以后只改这里

  /* 纸页随笔：path → 版式配置。登记在这里的文章走纸页版式，其余文章照旧走 articleView。
     sketches 的 frag 必须是正文里那一行的连续原文；src 相对站点根。 */
  var PAPER_ESSAYS = {
    '_works/普通人如何去拥有富士山呢': {
      font: 'fuji',     // 这篇有 80 来个字不在微博那份文楷子集里，另有一份子集 fonts/wenkai-fuji.woff2
      sign: true,       // 末段是落款
      sketches: [
        { frag: '那天淫雨霏霏像情人在低语', src: 'art/fuji/nichome-rain.svg' },
        { frag: '足够让一场雨凝结成雪，落在富士山顶', src: 'art/fuji/snow-summit.svg' },
        { frag: '他像在岸上打盹的救生员，浑然不知你正在溺水', src: 'art/fuji/lifeguard.svg' },
        { frag: '单恋是夜路上最轻的脚步声', src: 'art/fuji/night-steps.svg' },
        { frag: '喜欢一个遥不可及的人就像喜欢富士山', src: WB_ASSETS + 'art/fuji-walk.svg' },   // 与微博合辑同一幅，引用原路径
        { frag: '你看春樱秋叶，看晨昏更迭', src: 'art/fuji/sakura-momiji.svg' },
        { frag: '山根本不知道你在仰望它', src: 'art/fuji/look-up.svg' },
        { frag: '然后带着它的影子，继续走向下一座山，下一片海', src: 'art/fuji/shadow-sea.svg' }
      ]
    }
  };

  // 纸飞机：全部 <use href="#plane">（index.html 里唯一的 symbol）
  function paperPlane(cls, motif, viewBox, use, inner) {
    return '<svg class="' + cls + '"' + (motif ? ' data-motif="' + motif + '"' : '') + ' viewBox="' + viewBox + '" aria-hidden="true" focusable="false">' +
      (inner || '') + '<use href="#plane"' + (use || '') + '/></svg>';
  }

  function wbSquash(str) { return str.replace(/\s+/g, ''); }

  // 小画挂进含那句原文的第一个块里，左右交替（宽屏放在那一块旁边的留白，窄屏放在它下面）
  function paperSketches(blocks, sketches, base, lazy) {
    var keyed = blocks.map(function (b) { return wbSquash(b.textContent); });
    var side = 0;
    sketches.forEach(function (sk) {
      var idx = -1;
      for (var i = 0; i < keyed.length; i++) if (keyed[i].indexOf(sk.frag) !== -1) { idx = i; break; }
      if (idx === -1) return;   // 原文里找不到就不放，绝不改字去凑
      var img = document.createElement('img');
      img.className = 'wb-sketch ' + (side++ % 2 ? 'l' : 'r');
      img.src = C(base + sk.src);
      img.width = 160;
      img.height = 160;
      img.alt = '';              // 点缀性插画，不进入正文文字
      img.setAttribute('decoding', 'async');
      if (lazy) img.setAttribute('loading', 'lazy');
      img.setAttribute('data-illustrates', sk.frag);
      blocks[idx].appendChild(img);
    });
  }

  // 一张纸页：阅读进度、面包屑、刊头（航迹 + 标题 + o.masthead）、正文、页尾飞机 + 回到列表 + 上一篇 / 下一篇、回到顶部
  function paperPage(o) {
    var s = S();
    var meta = o.meta;
    return '<article class="article wb-page" data-paper-page' + (o.attrs || '') + '>' +
      '<div class="wb-progress" data-motif="progress" aria-hidden="true"><span class="wb-progress-line" data-wb-progress-line></span>' +
        paperPlane('wb-progress-plane', '', '0 0 24 24').replace('<svg ', '<svg data-wb-progress-plane ') + '</div>' +
      '<header class="article-head wb-head">' +
        '<p class="crumbs"><a href="#/articles">← ' + esc(s.sectionNames.articles) + '</a><span class="tag tag-' + esc(meta.cat) + '">' + esc(L(CATS[meta.cat], '')) + '</span>' + (meta.date ? '<span>' + esc(meta.date) + '</span>' : '') + '</p>' +
        '<div class="wb-masthead">' +
          '<svg class="wb-hero" data-motif="hero" viewBox="0 0 300 96" aria-hidden="true" focusable="false">' +
            '<path class="wb-hero-trail" d="M8 84 C 60 84, 70 30, 118 34 C 160 38, 150 78, 124 72 C 100 66, 126 22, 182 26 C 222 29, 246 46, 270 30"/>' +
            '<g class="wb-hero-plane"><use href="#plane" x="262" y="12" width="28" height="28"/></g></svg>' +
          '<h1 class="article-title wb-title">' + esc(L(meta)) + '</h1>' +
          (o.masthead || '') +
        '</div>' +
      '</header>' +
      '<div class="wb-body"' + (o.bodyAttrs || '') + ' lang="zh-CN">' + o.body + '</div>' +
      '<div class="wb-end">' +
        paperPlane('wb-end-plane', 'end', '0 0 120 40', ' x="74" y="20" width="22" height="22"', '<path class="wb-end-trail" d="M4 10 C 30 10, 40 34, 72 32"/>') +
        '<p class="article-end"><span>' + esc(s.endMark) + '</span><a href="#/articles">' + esc(s.backToList) + ' →</a></p>' +
        '<nav class="pager">' +
          (o.prev ? '<a href="' + esc(hrefFor(o.prev.path)) + '"><small>← ' + esc(s.prev) + '</small><span>' + esc(L(o.prev)) + '</span></a>' : '<span></span>') +
          (o.next ? '<a class="pager-next" href="' + esc(hrefFor(o.next.path)) + '"><small>' + esc(s.next) + ' →</small><span>' + esc(L(o.next)) + '</span></a>' : '<span></span>') +
        '</nav>' +
      '</div>' +
      '<button class="wb-to-top" type="button" data-motif="top" data-wb-to-top aria-label="' + esc(s.wb.toTop) + '">' + paperPlane('', '', '0 0 24 24') + '</button>' +
      '</article>';
  }

  function mdFail(err) {
    var s = S();
    if (err && err.status === 404) return notFoundView();
    return { html: '<section class="empty"><h1 class="page-title">' + esc(s.notFound) + '</h1><p>' + esc(s.loadError) + '</p></section>' };
  }

  /* ---------------- 视图：微博合辑 ---------------- */
  // 把 marked 渲染出的正文按 h2 分节、挂钩子、放小画；节点原样搬，不碰文字
  function wbDecorate(box, sketches) {
    var nodes = Array.prototype.slice.call(box.childNodes);
    var chapter = null;
    var chapters = [];
    var out = document.createDocumentFragment();
    nodes.forEach(function (n) {
      if (n.nodeType === 1 && n.tagName === 'H2') {
        chapter = document.createElement('section');
        chapter.className = 'wb-chapter';
        out.appendChild(chapter);
        chapters.push(chapter);
      }
      (chapter || out).appendChild(n);
    });
    box.appendChild(out);

    Array.prototype.forEach.call(box.querySelectorAll('p'), function (p) {
      if (p.textContent.replace(/[\s ]/g, '') === '') { p.className = 'wb-spacer'; p.setAttribute('aria-hidden', 'true'); }
    });

    var toc = [];
    chapters.forEach(function (sec, i) {
      var h = sec.querySelector('h2');
      var title = h ? h.textContent.trim() : '';
      sec.id = 'sec-' + i;
      if (i === 0 && title === '按') { sec.classList.add('is-preface'); return; }
      var mark = document.createElement('div');
      mark.innerHTML = paperPlane('wb-mark', 'section', '0 0 24 24');
      sec.insertBefore(mark.firstChild, h);
      var tr = document.createElement('div');
      tr.innerHTML = paperPlane('wb-trail', 'trail', '0 0 150 44', ' x="108" y="16" width="20" height="20"', '<path d="M6 8 C 40 6, 58 40, 106 28"/>');
      sec.appendChild(tr.firstChild);
      toc.push({ id: sec.id, title: title });
    });

    var entries = Array.prototype.slice.call(box.querySelectorAll('li'));
    entries.forEach(function (li) { li.setAttribute('data-entry', ''); });
    paperSketches(entries, sketches || [], WB_ASSETS, true);
    return toc;
  }

  function weiboView(path, anchor) {
    var s = S();
    var w = s.wb;
    var meta = findMeta(path);
    return withMd(path, function (md) {
      var box = document.createElement('div');
      box.innerHTML = parseMd(md, { gfm: true, breaks: false });
      var toc = wbDecorate(box, PAPER_COLLECTIONS[path].sketches);
      var nb = listNeighbours(meta);
      var tocHtml = toc.length ? '<nav class="wb-toc" aria-label="' + esc(w.toc) + '"><ol lang="zh-CN">' + toc.map(function (t) {
        return '<li><a href="#/' + esc(path) + '?id=' + esc(t.id) + '" data-anchor="' + esc(t.id) + '">' + esc(t.title) + '</a></li>';
      }).join('') + '</ol></nav>' : '';
      return {
        html: paperPage({
          meta: meta, attrs: ' data-weibo-page' + (PAPER_COLLECTIONS[path].font ? ' data-font="' + esc(PAPER_COLLECTIONS[path].font) + '"' : ''), masthead: tocHtml,
          bodyAttrs: ' data-weibo-body data-sep="' + WB_SEP_DEFAULT + '"', body: box.innerHTML,
          prev: nb.prev, next: nb.next
        }),
        title: L(meta),
        anchor: anchor
      };
    }, mdFail);
  }

  /* 条与条之间的记号：只看 [data-weibo-body] 上的 data-sep（dot / num / line），改这个属性就换，别的不用动。
     记号是真元素（带 data-sep-mark），放在条与条之间的 <li> 里，不进 [data-entry]，正文文字不变。 */
  function wbRenderSeps(body) {
    var mode = body.getAttribute('data-sep');
    if (WB_SEPS.indexOf(mode) < 0) mode = WB_SEP_DEFAULT;
    Array.prototype.forEach.call(body.querySelectorAll('.wb-sep'), function (el) { el.parentNode.removeChild(el); });
    var n = 0;
    Array.prototype.forEach.call(body.querySelectorAll('ul'), function (ul) {
      var prevEntry = false;
      Array.prototype.slice.call(ul.children).forEach(function (li) {
        if (!li.hasAttribute('data-entry')) return;
        var mark = null;
        if (mode === 'num') {
          mark = document.createElement('span');
          mark.textContent = ('00' + (++n)).slice(-3);
        } else if (prevEntry) {
          mark = document.createElement('span');
        }
        prevEntry = true;
        if (!mark) return;
        mark.className = 'wb-sep-mark';
        mark.setAttribute('data-sep-mark', mode);
        var holder = document.createElement('li');
        holder.className = 'wb-sep wb-sep-' + mode;
        holder.setAttribute('aria-hidden', 'true');
        holder.appendChild(mark);
        ul.insertBefore(holder, li);
      });
    });
    body.setAttribute('data-sep-ready', mode);
  }

  /* ---------------- 视图：纸页随笔 ----------------
     诗一样的分行短句：没有 h2 分节，也没有 li 条目，所以不分节、不编号。
     marked 用 breaks: true，md 里一行就是一行；每一行再拆成一个 .wb-line 块（节点原样搬，不碰字），小画贴在那一行旁边。 */
  function paperLines(box) {
    var lines = [];
    Array.prototype.forEach.call(box.querySelectorAll('p'), function (p) {
      var line = null;
      Array.prototype.slice.call(p.childNodes).forEach(function (n) {
        if (n.nodeName === 'BR') { p.removeChild(n); line = null; return; }
        if (!line && n.nodeType === 3 && !n.nodeValue.trim()) { p.removeChild(n); return; }
        if (!line) {
          line = document.createElement('span');
          line.className = 'wb-line';
          p.insertBefore(line, n);
          lines.push(line);
        }
        line.appendChild(n);
      });
    });
    return lines;
  }

  function paperEssayView(path, anchor) {
    var cfg = PAPER_ESSAYS[path];
    var meta = findMeta(path) || { path: path, cat: 'works', zh: path.split('/').pop(), en: path.split('/').pop() };
    return withMd(path, function (md) {
      var box = document.createElement('div');
      box.innerHTML = parseMd(md, { gfm: true, breaks: true });
      var h1 = box.firstElementChild;
      if (h1 && h1.tagName === 'H1') box.removeChild(h1);   // 标题由刊头给出
      var paras = box.querySelectorAll('p');
      if (cfg.sign && paras.length) paras[paras.length - 1].className = 'wb-sign';
      paperSketches(paperLines(box), cfg.sketches || [], '', false);   // 画不多、每幅几 KB，不懒加载
      var nb = listNeighbours(meta);
      var dek = L(meta, 'd');
      return {
        html: paperPage({
          meta: meta, attrs: ' data-paper-essay' + (cfg.font ? ' data-font="' + esc(cfg.font) + '"' : ''),
          masthead: dek ? '<p class="wb-dek">' + esc(dek) + '</p>' : '',
          body: box.innerHTML, prev: nb.prev, next: nb.next
        }),
        title: L(meta),
        anchor: anchor
      };
    }, mdFail);
  }

  // 两种纸页共用：阅读进度（顶栏下沿一根虚线，纸飞机随进度往前飞）& 回到顶部；微博合辑另挂条间记号
  function initPaper() {
    var page = view.querySelector('[data-paper-page]');
    if (!page) return;
    var body = page.querySelector('[data-weibo-body]');

    // 条间记号
    var mo = null;
    if (body) {
      wbRenderSeps(body);
      if (window.MutationObserver) {
        mo = new MutationObserver(function () { wbRenderSeps(body); });
        mo.observe(body, { attributes: true, attributeFilter: ['data-sep'] });
      }
    }

    // 阅读进度 & 回到顶部
    var hud = document.querySelector('.hud');
    var bar = page.querySelector('.wb-progress');
    var line = page.querySelector('[data-wb-progress-line]');
    var pl = page.querySelector('[data-wb-progress-plane]');
    var toTop = page.querySelector('[data-wb-to-top]');
    var rafId = 0;
    function onWbScroll() {
      if (rafId) return;
      rafId = requestAnimationFrame(function () {
        rafId = 0;
        var y = window.scrollY || window.pageYOffset;
        var vh = window.innerHeight || 1;
        var max = document.documentElement.scrollHeight - vh;
        var r = max > 0 ? clamp(y / max, 0, 1) : 0;
        var cw = document.documentElement.clientWidth;
        if (bar && hud) bar.style.top = Math.max(0, hud.offsetHeight) + 'px';
        if (line) line.style.width = (r * 100).toFixed(2) + '%';
        if (pl) pl.style.transform = 'translateX(' + Math.round(r * (cw - 22)) + 'px)';
        if (toTop) toTop.classList.toggle('is-shown', y > vh);
      });
    }
    function onTop() {
      window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
      try { view.focus({ preventScroll: true }); } catch (e) {}
    }
    window.addEventListener('scroll', onWbScroll, { passive: true });
    window.addEventListener('resize', onWbScroll);
    if (toTop) toTop.addEventListener('click', onTop);
    onWbScroll();

    cleanups.push(function () {
      if (mo) mo.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onWbScroll);
      window.removeEventListener('resize', onWbScroll);
    });
  }

  /* ---------------- 视图：关于 ---------------- */
  function aboutView() {
    var s = S();
    return withMd('README', function (md) {
      var r = renderMarkdown(md, 'README');
      var box = document.createElement('div');
      box.innerHTML = r.html;
      var h1 = box.querySelector('h1');
      if (h1 && h1 === box.firstElementChild) h1.parentNode.removeChild(h1);
      return {
        html: pageHead('about', s.aboutLede, s.aboutMeta) +
          '<div class="about">' +
            '<figure class="about-figure rv"><img src="' + esc(C('IMG_0205.PNG')) + '" alt="' + esc(s.avatarAlt) + '" width="512" height="512" loading="lazy" decoding="async"><figcaption>' + esc(s.portrait) + '</figcaption></figure>' +
            '<div class="prose sheet" lang="zh-CN">' + box.innerHTML + '</div>' +
          '</div>',
        title: s.sec.about[0]
      };
    }, function () {
      return { html: pageHead('about', s.aboutLede, s.aboutMeta) + '<p class="sheet">' + esc(s.loadError) + '</p>' };
    });
  }

  function notFoundView() {
    var s = S();
    return { html: '<section class="empty"><p class="kicker">404</p><h1 class="page-title">' + esc(s.notFound) + '</h1><p class="page-lede">' + esc(s.notFoundText) + '</p><p><a class="btn btn-solid" href="#/">' + esc(s.goHome) + '</a></p></section>', title: s.notFound };
  }

  /* ---------------- 渲染、转场 ---------------- */
  var current = null;
  var navToken = 0;
  var cleanups = [];
  var sceneMode = 'home';

  function runCleanups() { while (cleanups.length) { try { cleanups.pop()(); } catch (e) {} } }

  function setScene(name) {
    sceneMode = name;
    root.setAttribute('data-scene', name || 'lost');
    var tm = document.querySelector('[data-tel="mode"]');
    if (tm) tm.textContent = S().modes[name] || S().modes[''];
    if (!window.Scene || !Scene.ok) return;
    if (name === 'reading' || name === 'frame') { Scene.pause(true); return; }
    Scene.pause(false);
    Scene.setMode(name || 'lost');
  }

  /* hash 一变，新栏目的 DOM 和 <html data-route> 在这个事件回调里同步挂上：
     不等 WebGL 帧、不等转场、不等 Promise。转场只是事后盖上去的一层视觉。
     只有没缓存的文章正文要等网络：先同步挂上栏目和「正在排版」，正文到了再填。 */
  function route(instant) {
    var r = parseHash();
    var target = resolveRoute(r);
    var token = ++navToken;
    var sameArticle = current && current.article && target.article && current.path === r.path;
    if (sameArticle && !instant) { if (r.id) scrollToAnchor(r.id); return; }

    var out;
    try { out = target.render(); } catch (e) { out = notFoundView(); }
    var first = !current;
    if (out && typeof out.then === 'function') {
      mount(target, r, { html: '<div class="loading">' + esc(S().loading) + '</div>' }, instant);
      out.then(function (o) {
        if (token !== navToken) return;
        mount(target, r, o, true);
        if (!instant) { try { view.focus({ preventScroll: true }); } catch (e) {} }
      }, function () {});
    } else {
      mount(target, r, out, instant);
    }
    if (!instant && !first && window.Scene && Scene.veilOk && !reduced()) Scene.transition();
  }

  function mount(target, r, out, instant) {
    if (typeof out === 'string') out = { html: out };
    runCleanups();
    view.innerHTML = out.html;
    current = { name: target.name, route: target.route || target.name, article: !!target.article, path: r.path };
    root.classList.toggle('is-article', !!target.article);
    root.setAttribute('data-route', target.route || target.name || 'lost');
    if (target.paper) root.setAttribute('data-paper', ''); else root.removeAttribute('data-paper');
    document.title = (out.title ? out.title + ' — ' : (target.name && target.name !== 'home' ? S().sectionNames[target.name] + ' — ' : '')) + S().title;
    markNav(target.name);
    window.scrollTo(0, 0);
    afterRender();
    setScene(target.scene);
    if (out.anchor) requestAnimationFrame(function () { scrollToAnchor(out.anchor, true); });
    if (!instant) { try { view.focus({ preventScroll: true }); } catch (e) {} }
    if (editApi) editApi.mounted();
  }

  function markNav(name) {
    var links = document.querySelectorAll('[data-nav]');
    for (var i = 0; i < links.length; i++) {
      var on = links[i].getAttribute('data-nav') === name;
      links[i].classList.toggle('is-active', on);
      if (on) links[i].setAttribute('aria-current', 'page'); else links[i].removeAttribute('aria-current');
    }
  }

  function scrollToAnchor(id, instant) {
    var el = document.getElementById(id);
    if (!el) {
      var hs = view.querySelectorAll('[data-text]');
      for (var i = 0; i < hs.length; i++) if (hs[i].getAttribute('data-text') === id) { el = hs[i]; break; }
    }
    if (el) el.scrollIntoView({ behavior: instant || reduced() ? 'auto' : 'smooth', block: 'start' });
  }

  /* ---------------- 渲染后挂载 ---------------- */
  var io = null;
  var tocLinks = [];
  function afterRender() {
    var reveals = view.querySelectorAll('.rv');
    if (io) io.disconnect();
    if (reduced() || !('IntersectionObserver' in window)) {
      for (var i = 0; i < reveals.length; i++) reveals[i].classList.add('in');
    } else {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
      for (var j = 0; j < reveals.length; j++) io.observe(reveals[j]);
    }
    tocLinks = Array.prototype.slice.call(view.querySelectorAll('.toc a'));
    bindRefract(view);
    initGallery();
    initWorks();
    initPaper();
    if (current && current.route === 'articles') {   // 点进纸页时正文已在缓存里，同步挂上、当场起播
      Object.keys(PAPER_COLLECTIONS).concat(Object.keys(PAPER_ESSAYS)).forEach(function (p) { loadMd(p).catch(function () {}); });
    }
    onScroll();
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var chip = t.closest && t.closest('[data-filter]');
    if (chip) {
      var f = chip.getAttribute('data-filter');
      Array.prototype.forEach.call(view.querySelectorAll('[data-filter]'), function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-group]'), function (g) { g.hidden = !(f === 'all' || g.getAttribute('data-group') === f); });
      return;
    }
    var anc = t.closest && t.closest('[data-anchor]');
    if (anc) { e.preventDefault(); scrollToAnchor(anc.getAttribute('data-anchor')); return; }
    var top = t.closest && t.closest('[data-top]');
    if (top) { e.preventDefault(); window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); return; }
    var next = t.closest && t.closest('[data-scroll-next]');
    if (next) {
      var c = document.getElementById('manifesto');
      if (c) { e.preventDefault(); c.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); }
    }
  });

  /* ---------------- 滚动：场景演进、阅读进度、目录高亮 ---------------- */
  var ticking = false;
  var progressBar = document.querySelector('.progress span');
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY || window.pageYOffset;
      var vh = window.innerHeight || 1;
      root.classList.toggle('scrolled', y > 8);

      if (current && current.name === 'home') {
        var av = 0;
        var pt = view.querySelector('[data-portrait]');
        if (pt) av = clamp((vh - pt.getBoundingClientRect().top) / (vh * 0.75), 0, 1);
        if (window.Scene && Scene.ok) Scene.setScroll(y / vh, av);
        var hero = view.querySelector('[data-hero]');
        if (hero && !reduced()) {
          var k = clamp(y / (vh * 0.7), 0, 1);
          hero.style.opacity = String(1 - k);
          hero.style.transform = 'translate3d(0,' + (y * 0.25).toFixed(1) + 'px,0)';
        } else if (hero) { hero.style.opacity = ''; hero.style.transform = ''; }
      }

      if (root.classList.contains('is-article') && progressBar) {
        var max = document.documentElement.scrollHeight - vh;
        progressBar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0).toFixed(4) + ')';
      }
      if (tocLinks.length) {
        var cur = null;
        for (var i = 0; i < tocLinks.length; i++) {
          var h = document.getElementById(tocLinks[i].getAttribute('data-anchor'));
          if (h && h.getBoundingClientRect().top < 140) cur = tocLinks[i];
        }
        tocLinks.forEach(function (a) { a.classList.toggle('is-current', a === cur); });
      }
      if (galleryScroll) galleryScroll(y);
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  /* ---------------- 悬停折射（SVG 位移滤镜） ---------------- */
  var refractEl = null, refractRaf = 0, refractAmt = 0, refractGoal = 0;
  var turb = document.querySelector('#refract feTurbulence');
  var disp = document.querySelector('#refract feDisplacementMap');
  function refractLoop(now) {
    refractRaf = 0;
    refractAmt += (refractGoal - refractAmt) * 0.14;
    if (disp) disp.setAttribute('scale', refractAmt.toFixed(2));
    if (turb) {
      var t = now / 1000;
      turb.setAttribute('baseFrequency', (0.012 + Math.sin(t * 1.3) * 0.004).toFixed(4) + ' ' + (0.02 + Math.cos(t * 0.9) * 0.006).toFixed(4));
    }
    if (refractGoal === 0 && refractAmt < 0.3) {
      if (refractEl) refractEl.style.filter = '';
      refractEl = null; refractAmt = 0;
      if (disp) disp.setAttribute('scale', '0');
      return;
    }
    refractRaf = requestAnimationFrame(refractLoop);
  }
  function bindRefract(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll('[data-refract]'), function (el) {
      var target = el.querySelector('[data-refract-target]') || el;
      el.addEventListener('mouseenter', function () {
        if (reduced() || !mqFine.matches) return;
        if (refractEl && refractEl !== target) refractEl.style.filter = '';
        refractEl = target;
        target.style.filter = 'url(#refract)';
        refractGoal = 22;
        if (!refractRaf) refractRaf = requestAnimationFrame(refractLoop);
      });
      el.addEventListener('mouseleave', function () {
        refractGoal = 0;
        if (reduced()) { target.style.filter = ''; return; }
        if (!refractRaf) refractRaf = requestAnimationFrame(refractLoop);
      });
    });
  }
  function stopRefract() {
    if (refractRaf) cancelAnimationFrame(refractRaf);
    refractRaf = 0; refractGoal = 0; refractAmt = 0;
    if (refractEl) refractEl.style.filter = '';
    refractEl = null;
    if (disp) disp.setAttribute('scale', '0');
  }

  /* ---------------- 工具：可拖拽的空间画廊 ---------------- */
  var galleryScroll = null;
  function initGallery() {
    galleryScroll = null;
    var vp = view.querySelector('[data-gallery]');
    if (!vp) return;
    var plane = vp.querySelector('.plane');
    var floats = Array.prototype.slice.call(plane.querySelectorAll('.float'));
    var seeds = floats.map(function (f, i) { return { d: parseFloat(f.getAttribute('data-d')) || 1, ph: i * 1.7 }; });

    // 手机：竖向漂流，跟着滚动左右轻摆
    if (small()) {
      vp.classList.add('is-stream');
      galleryScroll = function (y) {
        if (reduced()) { floats.forEach(function (f) { f.style.transform = ''; }); return; }
        floats.forEach(function (f, i) {
          var s = seeds[i];
          f.style.transform = 'translate3d(' + (Math.sin(y / 260 + s.ph) * 10 * s.d).toFixed(1) + 'px,0,0)';
        });
      };
      cleanups.push(function () { galleryScroll = null; });
      return;
    }

    vp.classList.add('is-space');
    var ox = 0, oy = 0, vx = 0, vy = 0, raf = 0, dragging = false, moved = false, startX = 0, startY = 0, lastX = 0, lastY = 0, pid = null, sy = 0;
    var bounds = { minX: 0, minY: 0 };
    function measure() {
      bounds.minX = Math.min(0, vp.clientWidth - plane.offsetWidth);
      bounds.minY = Math.min(0, vp.clientHeight - plane.offsetHeight);
    }
    measure();
    ox = Math.max(bounds.minX, -40); oy = Math.max(bounds.minY, -60);   // 从左上角的一簇开始，右边留着引人去拖

    function apply() {
      ox = clamp(ox, bounds.minX, 0); oy = clamp(oy, bounds.minY, 0);
      plane.style.transform = 'translate3d(' + ox.toFixed(1) + 'px,' + oy.toFixed(1) + 'px,0)';
      // 景深视差：近处的漂得快、远处的慢；拖动和滚动都会推它们
      var cx = ox - bounds.minX / 2, cy = oy - bounds.minY / 2 - (reduced() ? 0 : sy * 0.5);
      floats.forEach(function (f, i) {
        var s = seeds[i];
        var px = cx * (s.d - 1) * 0.6, py = cy * (s.d - 1) * 0.6;
        f.style.transform = 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0)';
        f.style.zIndex = String(Math.round(s.d * 10));
      });
    }
    function loop(now) {
      raf = 0;
      if (reduced()) { apply(); return; }
      if (!dragging) {
        ox += vx; oy += vy;
        vx *= 0.93; vy *= 0.93;
        if (Math.abs(vx) < 0.02) vx = 0;
        if (Math.abs(vy) < 0.02) vy = 0;
      }
      apply();
      // 惯性停下就不再跑循环，画面静止
      if (dragging || vx || vy) raf = requestAnimationFrame(loop);
    }
    function start() { if (!raf && !reduced() && !document.hidden) raf = requestAnimationFrame(loop); }

    function down(e) {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      dragging = true; moved = false; pid = e.pointerId;
      startX = lastX = e.clientX; startY = lastY = e.clientY;
      vx = vy = 0;
    }
    function move(e) {
      if (!dragging || e.pointerId !== pid) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (!moved && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 6) {
        moved = true;
        vp.classList.add('is-dragging');
        try { vp.setPointerCapture(pid); } catch (err) {}
      }
      if (!moved) return;
      ox += dx; oy += dy;
      vx = dx; vy = dy;
      lastX = e.clientX; lastY = e.clientY;
      if (reduced()) { vx = vy = 0; apply(); } else start();
    }
    function up(e) {
      if (e.pointerId !== pid) return;
      dragging = false;
      vp.classList.remove('is-dragging');
      try { vp.releasePointerCapture(pid); } catch (err) {}
      if (moved) { suppress = true; setTimeout(function () { suppress = false; }, 0); }
    }
    var suppress = false;
    function click(e) { if (suppress || moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }
    // 键盘焦点移到画面外的工具时，把它平移进视野
    function focus(e) {
      var f = e.target.closest && e.target.closest('.float');
      if (!f) return;
      var r = f.getBoundingClientRect(), v = vp.getBoundingClientRect();
      if (r.left < v.left + 20) ox += v.left + 40 - r.left;
      if (r.right > v.right - 20) ox -= r.right - v.right + 40;
      if (r.top < v.top + 20) oy += v.top + 40 - r.top;
      if (r.bottom > v.bottom - 20) oy -= r.bottom - v.bottom + 40;
      vp.scrollLeft = 0; vp.scrollTop = 0;
      apply();
    }
    function resize() { measure(); apply(); }

    vp.addEventListener('pointerdown', down);
    vp.addEventListener('pointermove', move);
    vp.addEventListener('pointerup', up);
    vp.addEventListener('pointercancel', up);
    vp.addEventListener('click', click, true);
    vp.addEventListener('focusin', focus);
    window.addEventListener('resize', resize);
    var onVis = function () { if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; } else start(); };
    document.addEventListener('visibilitychange', onVis);
    galleryScroll = function (y) { sy = y; if (!raf) apply(); };
    apply();
    galleryRestart = function () { if (reduced()) { if (raf) cancelAnimationFrame(raf); raf = 0; apply(); } else start(); };
    cleanups.push(function () {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
      galleryRestart = null;
    });
  }
  var galleryRestart = null;

  /* ---------------- 作品：音频与可视化（不自动播放） ---------------- */
  var audio = null, actx = null, analyser = null, freq = null, playing = -1, worksStop = null;
  function stopAudio() {
    if (audio) { try { audio.pause(); } catch (e) {} }
    playing = -1;
    if (window.Scene) Scene.setAudio(0);
  }
  function initWorks() {
    worksStop = null;
    var vis = view.querySelector('[data-vis]');
    if (!vis) return;
    var cv = vis.querySelector('canvas');
    var ctx = cv.getContext('2d');
    var now = view.querySelector('[data-now]');
    var raf = 0, t = 0, last = 0, w = 0, h = 0, ratio = 1;
    var colors = getComputedStyle(root);

    function size() {
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.max(1, Math.round(w * ratio)); cv.height = Math.max(1, Math.round(h * ratio));
      colors = getComputedStyle(root);
    }
    function drawBars(levels) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2, r0 = Math.min(w, h) * 0.34;
      var n = levels.length;
      var acc = colors.getPropertyValue('--acc').trim() || '#c4ff3a';
      var acc2 = colors.getPropertyValue('--acc-2').trim() || '#ff6a3d';
      ctx.lineCap = 'round';
      for (var i = 0; i < n; i++) {
        var a = i / n * Math.PI * 2 - Math.PI / 2;
        var v = levels[i];
        var len = 6 + v * Math.min(w, h) * 0.15;
        ctx.strokeStyle = v > 0.62 ? acc2 : acc;
        ctx.globalAlpha = 0.35 + v * 0.65;
        ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.008);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    var BARS = 96;
    var levels = new Array(BARS);
    function idleLevels(tt) {
      for (var i = 0; i < BARS; i++) levels[i] = 0.12 + 0.1 * Math.sin(i * 0.45 + tt * 1.6) * Math.sin(i * 0.13 - tt * 0.7) + 0.06 * Math.sin(i * 1.7 + tt * 3.1);
      return levels;
    }
    function liveLevels() {
      analyser.getByteFrequencyData(freq);
      var usable = Math.floor(freq.length * 0.7);
      var bass = 0;
      for (var i = 0; i < BARS; i++) {
        var k = i < BARS / 2 ? i : BARS - 1 - i;     // 左右对称
        var idx = Math.floor(Math.pow(k / (BARS / 2), 1.6) * usable);
        levels[i] = freq[idx] / 255;
      }
      for (var j = 0; j < 8; j++) bass += freq[j];
      if (window.Scene) Scene.setAudio(clamp(bass / (8 * 255) * 1.3 - 0.15, 0, 1));
      return levels;
    }
    function frame(ts) {
      raf = 0;
      var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
      last = ts; t += dt;
      drawBars(playing >= 0 && analyser ? liveLevels() : idleLevels(t));
      if (!reduced() && !document.hidden) raf = requestAnimationFrame(frame);
    }
    function kick() {
      if (reduced()) { if (raf) cancelAnimationFrame(raf); raf = 0; drawBars(idleLevels(0)); return; }
      if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
    }

    function setUi() {
      var s = S();
      Array.prototype.forEach.call(view.querySelectorAll('[data-play]'), function (b) {
        var i = +b.getAttribute('data-play');
        var on = i === playing || (b.classList.contains('disc') && playing >= 0);
        b.classList.toggle('is-playing', on);
        var name = RAPSTAR.tracks[b.classList.contains('disc') && playing >= 0 ? playing : i].name;
        b.setAttribute('aria-label', (on ? s.pause : s.play) + ' ' + name);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-track]'), function (li) {
        li.classList.toggle('is-on', +li.getAttribute('data-track') === playing);
      });
      vis.classList.toggle('is-playing', playing >= 0);
      if (now) now.textContent = playing >= 0 ? s.nowPlaying + ' · ' + RAPSTAR.tracks[playing].name : s.soundOff;
    }

    function play(i) {
      var tr = RAPSTAR.tracks[i];
      if (playing === i) { stopAudio(); setUi(); return; }
      if (!audio) {
        audio = new Audio();
        audio.preload = 'none';
        audio.addEventListener('ended', function () { stopAudio(); setUi(); });
      }
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC && !actx) {
          actx = new AC();
          var src = actx.createMediaElementSource(audio);
          analyser = actx.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.8;
          freq = new Uint8Array(analyser.frequencyBinCount);
          src.connect(analyser);
          analyser.connect(actx.destination);
        }
        if (actx && actx.state === 'suspended') actx.resume();
      } catch (e) { analyser = null; }
      audio.src = C(tr.audio);
      playing = i;
      var p = audio.play();
      if (p && p.catch) p.catch(function () { stopAudio(); setUi(); });
      setUi();
      kick();
    }

    function onClick(e) {
      var b = e.target.closest && e.target.closest('[data-play]');
      if (!b || !view.contains(b)) return;
      var i = +b.getAttribute('data-play');
      if (b.classList.contains('disc') && playing >= 0) i = playing;
      play(i);
    }
    view.addEventListener('click', onClick);
    var onVis = function () { kick(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', size);
    size();
    setUi();
    kick();
    worksStop = kick;
    cleanups.push(function () {
      view.removeEventListener('click', onClick);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', size);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      stopAudio();
      worksStop = null;
    });
  }

  /* ---------------- 遥测角标（画面上的小字坐标） ---------------- */
  var telXY = document.querySelector('[data-tel="xy"]');
  var telTick = 0;
  function onFrame(st) {
    if (++telTick % 6 || !telXY) return;
    var x = st.mouse[0], y = st.mouse[1];
    if (y < -1.5) { x = 0; y = 0; }
    telXY.textContent = 'x ' + (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2) + ' y ' + (y >= 0 ? '+' : '−') + Math.abs(y).toFixed(2);
  }

  /* ---------------- 减少动态效果：随时切换都生效 ---------------- */
  function onMotionPref() {
    root.classList.toggle('reduce', reduced());
    if (reduced()) {
      stopRefract();
      Array.prototype.forEach.call(view.querySelectorAll('.rv'), function (el) { el.classList.add('in'); });
      var hero = view.querySelector('[data-hero]');
      if (hero) { hero.style.opacity = ''; hero.style.transform = ''; }
      Array.prototype.forEach.call(view.querySelectorAll('.float'), function (f) { f.style.transform = ''; });
    }
    if (galleryRestart) galleryRestart();
    if (worksStop) worksStop();
    onScroll();
  }
  onChange(mqReduce, onMotionPref);

  /* ---------------- 站长编辑：入口 ----------------
     焦点不在输入框里时，1 秒内连按三次 E（不带 Ctrl / ⌘ / Alt / Shift）才去加载 js/edit.js；
     编辑器、它的样式和它对 GitHub 的请求全在那个文件里，访客不按就什么都不加载。
     editBridge 是交给编辑器的几个口子：当前页对应哪个 .md、换渲染钩子、按新正文重排当前页。 */
  var editApi = null, editLoading = false, editKeys = [];
  function editablePath() {
    if (!current) return null;
    if (current.route === 'about') return 'README';
    var p = current.path.slice(1);
    return current.article && (ARTICLE_RE.test(current.path) || PAPER_COLLECTIONS[p]) ? p : null;
  }
  function remount() {
    var r = parseHash();
    var target = resolveRoute(r);
    var out = target.render();
    if (!out || typeof out.then === 'function') return;
    if (typeof out === 'string') out = { html: out };
    var y = window.scrollY || window.pageYOffset;
    ++navToken;
    mount(target, r, { html: out.html, title: out.title }, true);
    window.scrollTo(0, y);
  }
  // 用给定的正文把当前页排一遍（不挂到页面上），给编辑器做预览、查小画还在不在
  function renderWith(path, md) {
    var keep = mdCache[path];
    var out;
    mdCache[path] = md;
    try { out = resolveRoute(parseHash()).render(); } finally { if (keep == null) delete mdCache[path]; else mdCache[path] = keep; }
    return !out || typeof out.then === 'function' ? '' : typeof out === 'string' ? out : out.html;
  }
  var editBridge = {
    view: view,
    editablePath: editablePath,
    paper: function (path) { return !!PAPER_COLLECTIONS[path] || !!PAPER_ESSAYS[path]; },
    sketches: function (path) {
      if (PAPER_COLLECTIONS[path]) return PAPER_COLLECTIONS[path].sketches.map(function (sk) { return { frag: sk.frag, src: WB_ASSETS + sk.src }; });
      return PAPER_ESSAYS[path] ? (PAPER_ESSAYS[path].sketches || []).slice() : [];
    },
    getMd: function (path) { return mdCache[path]; },
    setMd: function (path, before, after) { mdCache[path] = after; rememberEdited(path, before, after); },
    setHook: function (fn) { mdHook = fn || null; },
    remount: remount,
    renderWith: renderWith
  };
  function openEditor() {
    if (editApi) { editApi.open(); return; }
    if (editLoading) return;
    editLoading = true;
    var s = document.createElement('script');
    s.src = 'js/edit.js?v=20261022-gb';
    s.onload = function () {
      s.parentNode.removeChild(s);
      editLoading = false;
      if (typeof window.DatodeEdit === 'function') { editApi = window.DatodeEdit(editBridge); editApi.open(); }
    };
    s.onerror = function () { s.parentNode.removeChild(s); editLoading = false; };
    document.head.appendChild(s);
  }
  document.addEventListener('keydown', function (e) {
    if (e.code !== 'KeyE' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return;
    var t = e.target;
    if (t && t.nodeType === 1 && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var now = Date.now();
    editKeys = editKeys.filter(function (x) { return now - x < 1000; });
    editKeys.push(now);
    if (editKeys.length < 3) return;
    editKeys = [];
    openEditor();
  });

  /* ---------------- 启动 ---------------- */
  var glOk = window.Scene ? Scene.init({ avatar: C('IMG_0205.PNG'), onFrame: onFrame }) : false;
  root.classList.add(glOk ? 'gl' : 'no-gl');
  root.classList.toggle('reduce', reduced());

  var langBtn = document.querySelector('[data-lang-toggle]');
  if (langBtn) langBtn.addEventListener('click', function () { setLang(lang === 'en' ? 'zh' : 'en'); });
  var yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  window.addEventListener('hashchange', function () { route(false); });
  applyStatic();
  route(true);
  // 「关于」的正文预取：点过去时已在缓存里，同步就能挂上
  loadMd('README').catch(function () {});
})();
