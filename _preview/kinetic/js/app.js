/* datode.com · kinetic —— 纯静态单页：hash 路由 + 浏览器内渲染 Markdown + 动态字体。
   无构建、无 CDN；marked 在 vendor/，Anybody 可变字体在 fonts/。 */
(function () {
  'use strict';

  /* ================================================================
     内容根：全站唯一一处。
     预览期入口在 /_preview/kinetic/，内容文件在仓库根，所以是 ../../；
     整个目录搬到根目录后，路径里不再有 /_preview/，自动变成 ./。
     所有 .md、头像、工具页、rapstar 都只经过 C() 取路径。
     ================================================================ */
  var CONTENT_ROOT = /\/_preview\/[^\/]+\//.test(location.pathname) ? '../../' : './';
  function C(p) { return CONTENT_ROOT + p; }

  var root = document.documentElement;
  var view = document.getElementById('view');
  var LANG_KEY = 'datode-lang';

  /* ---------------- 动效开关 ---------------- */
  function mq(q) { return window.matchMedia ? window.matchMedia(q) : { matches: false }; }
  var mqReduce = mq('(prefers-reduced-motion: reduce)');
  var mqFine = mq('(hover: hover) and (pointer: fine)');
  function reduced() { return !!mqReduce.matches; }
  function fine() { return !!mqFine.matches; }

  /* ---------------- 内容数据 ---------------- */
  var ARTICLES = [
    { path: '_study/docsify', cat: 'study',
      zh: 'Docsify + Github 五分钟搭建一个博客网站', en: 'Build a blog in five minutes with Docsify and GitHub',
      dzh: '微博炸号以后，建站变成了刚需。', den: 'After losing the Weibo account, a website became a necessity.' },
    { path: '_study/vpn', cat: 'study',
      zh: '如何在一分钟之内搭建一个VPN', en: 'Spin up a private network tunnel in one minute',
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
    { path: '_works/周宇新：毛泽东一生谋的都是权', cat: 'works',
      zh: '【转载】周宇新：毛泽东一生谋的都是权', en: 'Repost — Zhou Yuxin: all Mao ever sought was power',
      dzh: '一篇转载的长文。', den: 'A long essay, reposted.' },
    { path: '_works/户口壁垒：现代中国的身份鸿沟', cat: 'works',
      zh: '户口壁垒：现代中国的“身份鸿沟”', en: 'The hukou barrier: the “identity gap” in modern China',
      dzh: '一个延续六十余年的人口管理制度。', den: 'A household registration system, more than sixty years on.' },
    { path: 'weibo', cat: 'weibo', date: '2012–2022',
      zh: '微博合辑（2012–2022）', en: 'Weibo anthology, 2012–2022',
      dzh: '十年老号被炸之后，挑了一百来条原创碎碎念留作纪念。', den: 'A hundred-odd original posts saved from a decade-old account that was shut down.' }
  ];
  // 不在列表里、但旧链接仍要能打开的页面
  var EXTRA = [
    { path: '_weibo/weibo0', cat: 'weibo', zh: '微博存档 · 生活手账', en: 'Weibo archive: life notes' },
    { path: 'README', cat: 'about', zh: '关于我', en: 'About me' }
  ];

  var TOOLS = [
    { slug: 'stock', href: 'stock/', zh: '美股百强看板', en: 'Top 100 stocks board',
      dzh: '表现最好的一百只美股，带筛选与个股详情页。', den: 'The hundred best-performing American stocks, with filters and a page for each.' },
    { slug: 'sticker', href: 'sticker/', zh: '智能贴纸工坊', en: 'Generative sticker studio',
      dzh: '用一句话生成你自己的表情贴纸。', den: 'Describe it in a sentence, get your own sticker.' },
    { slug: 'todo', href: 'todo.html', zh: '待办便签', en: 'Docket notes',
      dzh: '轻量待办清单，数据只存在你的浏览器里。', den: 'A light to-do list that lives only in your browser.' },
    { slug: 'note', href: 'note.html', zh: '极简文本排版', en: 'Minimal text typesetter',
      dzh: '粘贴一段文字，排成好看的版式。', den: 'Paste some text, get a tidy, good-looking layout.' },
    { slug: 'loan', href: 'loan.html', zh: '贷款比较计算器', en: 'Loan comparison calculator',
      dzh: '等额本息、等额本金，一张表算清楚。', den: 'Compare repayment plans side by side, with totals.' },
    { slug: 'fish', href: 'fish.html', zh: '动态鱼缸', en: 'Living fish tank',
      dzh: '一缸会游的鱼，适合发呆。', den: 'A tank of swimming fish, made for zoning out.' },
    { slug: 'clock', href: 'clock.html', zh: '指针时钟', en: 'Analog clock',
      dzh: '带日期的模拟时钟，放在副屏刚好。', den: 'An analog clock with the date, made for a second screen.' },
    { slug: 'hourglass', href: 'hourglass.html', zh: '沙漏计时器', en: 'Hourglass timer',
      dzh: '会翻转的沙漏，专注一段时间。', den: 'A flipping hourglass for one focused stretch of time.' },
    { slug: 'clip', href: 'https://clip.gpubuy.com', external: true, zh: '共享剪贴板', en: 'Shared clipboard',
      dzh: '共享剪贴板与文件中转，手机电脑之间传东西。', den: 'A shared clipboard and file relay between your phone and computer.' }
  ];

  // 作品只有一件：rapstar
  var WORK = { slug: 'rapstar', href: 'rapstar/', year: '2025', zh: 'Rapstar 说唱站', en: 'Rapstar' };
  var TRACKS = [
    { name: 'Payphone', sub: 'Wiz Khalifa verse cover', page: 'rapstar/payphone-cover.html', card: 'rapstar/payphone-cover-card.png', audio: 'rapstar/payphone-cover.mp3' },
    { name: 'Baby', sub: 'Cover', page: 'rapstar/baby-cover.html', card: 'rapstar/baby-cover-card.png', audio: 'rapstar/baby-cover11.mp3' }
  ];

  var CATS = {
    study: { zh: '学习笔记', en: 'Study notes' },
    works: { zh: '随笔杂文', en: 'Essays' },
    weibo: { zh: '微博存档', en: 'Weibo archive' },
    about: { zh: '关于', en: 'About' }
  };
  var SECS = ['articles', 'tools', 'works', 'about'];

  /* ---------------- 界面文字 ---------------- */
  var STR = {
    zh: {
      title: '香又脆的菜花',
      brand: '香又脆的菜花',
      skip: '跳到正文',
      navLabel: '主导航',
      'nav.articles': '文章', 'nav.tools': '工具', 'nav.works': '作品', 'nav.about': '关于',
      langAria: 'Switch to English',
      'footer.note': '香又脆的菜花 · 北京 · 四海为家',
      'footer.weibo': '微博 ↗',
      meta: ['datode.com', '起居注 · 食货志', '自 2012 年起连载', '北京 / 四海为家'],
      kinNote: '移动鼠标 · 字会变形',
      heroTitle: '香又脆的菜花',
      heroSub: '一个社会“闲达”的起居注和食货志',
      heroList: ['记录 Python、AI 和算法学习心得', '记录读书笔记、游记和影评食评', '记录出海业务搞钱思路和实践'],
      portrait: '本人近照（大概）',
      portraitAlt: '菜花的头像',
      marquee: ['香又脆', 'Python、AI 和算法', '读书笔记', '游记', '影评食评', '出海搞钱', '微博存档 2012–2022'],
      stripHead: '四个栏目',
      stripHint: '往下滚，栏目横着走 →',
      stripHintTouch: '左右滑动 →',
      sec: {
        articles: ['文章', '学习笔记、随笔杂文和十年微博存档，做成一张目录表。'],
        tools: ['工具', '自己写来用的小工具，在站内外框里直接打开。'],
        works: ['作品', '只有一件，但是认真做的：Rapstar 说唱站。'],
        about: ['关于', '从哪里讲起呢……']
      },
      threadsHead: '三条主线',
      threads: [
        ['Python、AI 与算法', '学习心得与踩坑记录：建站、搭梯子、Docker、Telegram 机器人。'],
        ['读书、游记与影评食评', '看过的书和电影，吃过的饭，走过的路。'],
        ['出海与搞钱', '互联网个体户的思路和实践，还有做出来的小工具。']
      ],
      quote: '人的一生就是“I have a bright future ahead”里的每个字<span class="hl">逐个拿掉</span>的过程。',
      quoteCite: '—— 摘自微博存档，2012–2022',
      sectionOf: function (i) { return pad(i) + ' / 04 · 栏目'; },
      articlesLede: '学习笔记、随笔杂文和十年微博存档。正文一字不改，排版重新做过。',
      toolsLede: '自己写来用的小工具。「在这里打开」会套在站内外框里运行，也可以新窗口直接打开。',
      worksLede: '做着玩、也认真做的东西。这一栏只放一件。',
      aboutLede: '互联网个体户，base 北京，经常出差，四海为家。',
      all: '全部',
      count: function (n) { return n + ' 篇'; },
      countItems: function (n) { return n + ' 件'; },
      colNo: '编号', colTitle: '标题', colCat: '分类',
      openHere: '在这里打开',
      openNew: '新窗口打开 ↗',
      visit: '前往 ↗',
      external: '外链',
      chars: function (n) { return n.toLocaleString('zh-CN') + ' 字'; },
      readTime: function (m) { return '约 ' + m + ' 分钟读完'; },
      toc: '本文目录',
      prev: '← 上一篇', next: '下一篇 →',
      endMark: '（完）',
      backToList: '回到文章目录 →',
      loading: '正在排版……',
      notFound: '这一页走丢了',
      notFoundText: '链接可能已经改名或者被删掉了。',
      goHome: '回到首页',
      loadError: '文章加载失败，请检查网络后刷新。',
      frameNote: '工具运行在站内外框中',
      back: '← ',
      work: {
        kicker: '作品 01 / 01 · 专题',
        title: '把喜欢的说唱，重新唱一遍。',
        body: 'Rapstar 是一个说唱翻唱曲目站：每首歌一张封面卡片、一段音频和一页滚动歌词。手机上打开像一张唱片，耳机一戴就能跟着念。',
        stats: [['02', '首翻唱'], ['2025', '年上线'], ['3', '件套：封面 · 音频 · 歌词'], ['∞', '次循环']],
        tracks: '曲目',
        trackPage: '打开歌词页 ↗',
        cover: function (n) { return n + ' 的封面卡片'; },
        enter: '在这里打开 Rapstar',
        newWin: '新窗口打开 ↗'
      },
      marqueeWork: ['Rapstar', '说唱翻唱', '封面', '音频', '歌词', '跟着念'],
      sectionNames: { articles: '文章', tools: '工具', works: '作品', about: '关于' }
    },
    en: {
      title: 'Crispy Cauliflower',
      brand: 'Crispy Cauliflower',
      skip: 'Skip to content',
      navLabel: 'Main navigation',
      'nav.articles': 'Articles', 'nav.tools': 'Tools', 'nav.works': 'Works', 'nav.about': 'About',
      langAria: '切换到中文',
      'footer.note': 'Crispy Cauliflower · Beijing · at home anywhere',
      'footer.weibo': 'Weibo ↗',
      meta: ['datode.com', 'Chronicle & ledger', 'Published since 2012', 'Beijing / anywhere'],
      kinNote: 'Move the mouse · the type bends',
      heroTitle: 'Crispy Cauliflower',
      heroSub: 'The daily chronicle and household ledger of a self-styled social idler',
      heroList: ['Notes on Python, machine learning and algorithms', 'Reading notes, travelogues, film and food reviews', 'Ideas and practice for earning money overseas'],
      portrait: 'The author, more or less',
      portraitAlt: 'Portrait of the author',
      marquee: ['Crispy', 'Python, machine learning, algorithms', 'Reading notes', 'Travelogues', 'Film and food', 'Earning overseas', 'Weibo archive 2012–2022'],
      stripHead: 'Four sections',
      stripHint: 'Scroll down, the sections slide sideways →',
      stripHintTouch: 'Swipe sideways →',
      sec: {
        articles: ['Articles', 'Study notes, essays and ten years of Weibo posts, set as a table of contents.'],
        tools: ['Tools', 'Small tools I built for myself, opened right inside the site frame.'],
        works: ['Works', 'Just one, made with care: the Rapstar site.'],
        about: ['About', 'Where should I even begin…']
      },
      threadsHead: 'Three threads',
      threads: [
        ['Python, machine learning and algorithms', 'Lessons and pitfalls: a blog, a private network tunnel, Docker, Telegram bots.'],
        ['Books, travel, film and food', 'Books read, films watched, meals eaten, roads taken.'],
        ['Going global, making money', 'Notes from an internet freelancer, and the little tools that came out of it.']
      ],
      quote: 'Life is the process of <span class="hl">taking away, one word at a time,</span> “I have a bright future ahead”.',
      quoteCite: '— from the Weibo archive, 2012–2022',
      sectionOf: function (i) { return pad(i) + ' / 04 · section'; },
      articlesLede: 'Study notes, essays and ten years of Weibo posts. The texts stay in their original Chinese, untouched; only the typesetting is new.',
      toolsLede: 'Small tools I built for my own use. “Open here” runs one inside the site frame; you can also open it in a new window.',
      worksLede: 'Things made for fun, and made with care. This section holds just one.',
      aboutLede: 'An internet freelancer based in Beijing, often on the road, at home anywhere.',
      all: 'All',
      count: function (n) { return n + (n === 1 ? ' piece' : ' pieces'); },
      countItems: function (n) { return n + (n === 1 ? ' item' : ' items'); },
      colNo: 'No.', colTitle: 'Title', colCat: 'Type',
      openHere: 'Open here',
      openNew: 'New window ↗',
      visit: 'Visit ↗',
      external: 'External',
      chars: function (n) { return n.toLocaleString('en-US') + ' characters'; },
      readTime: function (m) { return 'About ' + m + ' min read'; },
      toc: 'Contents',
      prev: '← Previous', next: 'Next →',
      endMark: 'The end',
      backToList: 'Back to all articles →',
      loading: 'Setting type…',
      notFound: 'This page wandered off',
      notFoundText: 'The link may have been renamed or removed.',
      goHome: 'Back home',
      loadError: 'The article failed to load. Check your connection and refresh.',
      frameNote: 'Running inside the site frame',
      back: '← ',
      work: {
        kicker: 'Work 01 / 01 · feature',
        title: 'Rap songs I love, sung again.',
        body: 'Rapstar is a site of rap covers: each song gets a cover card, an audio track and a page of scrolling lyrics. On a phone it opens like a record; put on headphones and rap along.',
        stats: [['02', 'covers'], ['2025', 'launched'], ['3', 'parts: art · audio · lyrics'], ['∞', 'loops']],
        tracks: 'Tracks',
        trackPage: 'Open lyrics page ↗',
        cover: function (n) { return 'Cover card for ' + n; },
        enter: 'Open Rapstar here',
        newWin: 'New window ↗'
      },
      marqueeWork: ['Rapstar', 'Rap covers', 'Artwork', 'Audio', 'Lyrics', 'Rap along'],
      sectionNames: { articles: 'Articles', tools: 'Tools', works: 'Works', about: 'About' }
    }
  };
  // 首屏装置：一句会动的巨型英文（菜花的拼音），两种语言下都是它
  var HERO_LINES = ['fragrant,', 'crispy,', 'caihua.'];
  var SLUG_WORD = { articles: 'articles', tools: 'tools', works: 'works', about: 'about' };

  var lang = root.getAttribute('lang') === 'en' ? 'en' : 'zh';
  function S() { return STR[lang]; }
  function L(o, k) { k = k || ''; return o[k + lang] != null ? o[k + lang] : o[k + 'zh']; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hrefFor(path) { return '#/' + path; }

  /* 动态字：拆成字母 span，交给 Kinetic 驱动 */
  function kin(text, cls, attrs) {
    var chars = Array.from(text);
    var out = '';
    for (var i = 0; i < chars.length; i++) {
      out += '<span class="kin-ch" style="--i:' + i + '">' + (chars[i] === ' ' ? '&nbsp;' : esc(chars[i])) + '</span>';
    }
    return '<span class="kin ' + (cls || '') + '" data-kin' + (attrs || '') + ' aria-hidden="true">' + out + '</span>';
  }

  /* ---------------- 语言 ---------------- */
  function applyStatic() {
    root.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
    var s = S();
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (n) {
      var k = n.getAttribute('data-i18n');
      if (s[k] != null) n.textContent = s[k];
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-aria]'), function (n) {
      n.setAttribute('aria-label', s[n.getAttribute('data-i18n-aria')]);
    });
    var btn = document.querySelector('[data-lang-toggle]');
    if (btn) {
      btn.setAttribute('aria-label', s.langAria);
      btn.setAttribute('aria-pressed', lang === 'en' ? 'true' : 'false');
    }
  }

  function setLang(next) {
    lang = next;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    applyStatic();
    route(true);
  }

  /* ---------------- 路由 ---------------- */
  function parseHash() {
    var h = (location.hash || '#/').replace(/^#!?/, '');
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

  var ARTICLE_RE = /^\/(weibo|_weibo\/[^\/]+|_study\/[^\/]+|_works\/[^\/]+)$/;

  function findMeta(p) {
    var all = ARTICLES.concat(EXTRA);
    for (var i = 0; i < all.length; i++) if (all[i].path === p) return all[i];
    return null;
  }

  function resolveRoute(r) {
    var p = r.path;
    if (p === '/' || p === '/home' || p === '/index') return { name: 'home', render: homeView };
    if (p === '/articles') return { name: 'articles', render: articlesView };
    if (p === '/tools') return { name: 'tools', render: toolsView };
    if (p === '/works') return { name: 'works', render: worksView };
    if (p === '/about') return { name: 'about', render: aboutView };
    if (p === '/README') return { name: 'about', article: true, render: function () { return articleView('README', r.id); } };
    var m = p.match(/^\/tools\/([\w-]+)$/);
    if (m) {
      for (var i = 0; i < TOOLS.length; i++) {
        if (TOOLS[i].slug === m[1] && !TOOLS[i].external) {
          var t = TOOLS[i];
          return { name: 'tools', render: function () { return frameView(t, 'tools'); } };
        }
      }
    }
    if (p === '/works/rapstar') return { name: 'works', render: function () { return frameView(WORK, 'works'); } };
    if (ARTICLE_RE.test(p)) {
      var path = p.slice(1);
      return { name: 'articles', article: true, render: function () { return articleView(path, r.id); } };
    }
    return { name: '', render: notFoundView };
  }

  /* ---------------- 视图：首页 ---------------- */
  function marquee(items, rev) {
    var g = items.map(function (m) { return '<span class="marquee-item">' + esc(m) + '</span><span class="marquee-star" aria-hidden="true">✦</span>'; }).join('');
    return '<div class="marquee' + (rev ? ' rev' : '') + '" aria-hidden="true"><div class="marquee-track"><div class="marquee-group">' + g + '</div><div class="marquee-group">' + g + '</div></div></div>';
  }

  function homeView() {
    var s = S();
    var counts = { articles: s.count(ARTICLES.length), tools: s.countItems(TOOLS.length), works: s.countItems(1), about: 'README.md' };
    var panels = SECS.map(function (k, i) {
      return '<a class="panel" href="#/' + k + '" data-cursor-big>' +
        '<div class="panel-top"><span>' + pad(i + 1) + ' / 04</span><span>' + esc(counts[k]) + '</span></div>' +
        '<div class="panel-name"><h2>' + esc(s.sec[k][0]) + '</h2>' + (lang === 'zh' ? kin(SLUG_WORD[k]) : '') + '</div>' +
        '<div class="panel-foot"><p>' + esc(s.sec[k][1]) + '</p><span class="panel-n" aria-hidden="true">→</span></div>' +
        '</a>';
    }).join('');
    var threads = s.threads.map(function (c, i) {
      return '<div><span class="n" aria-hidden="true">' + pad(i + 1) + '</span><h3>' + esc(c[0]) + '</h3><p>' + esc(c[1]) + '</p></div>';
    }).join('');

    return '' +
      '<section class="hero">' +
        '<div class="hero-meta">' + s.meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</div>' +
        '<div class="hero-kin" data-hero>' +
          HERO_LINES.map(function (l, i) { return kin(l, i === 1 ? 'kin-wave' : '', ' data-fit'); }).join('') +
          '<span class="hero-kin-note" data-pointer-note>' + esc(s.kinNote) + '</span>' +
        '</div>' +
        '<div class="hero-band">' +
          '<h1 class="hero-title">' + esc(s.heroTitle) + '<small>' + esc(s.heroSub) + '</small></h1>' +
          '<figure class="hero-face" style="margin:0"><img src="' + esc(C('IMG_0205.PNG')) + '" alt="' + esc(s.portraitAlt) + '" width="502" height="497" decoding="async"><figcaption>' + esc(s.portrait) + '</figcaption></figure>' +
        '</div>' +
        '<ol class="hero-list">' + s.heroList.map(function (x, i) { return '<li><b>' + pad(i + 1) + '</b>' + esc(x) + '</li>'; }).join('') + '</ol>' +
      '</section>' +
      marquee(s.marquee) +
      '<section class="strip" data-strip aria-label="' + esc(s.stripHead) + '">' +
        '<div class="strip-sticky">' +
          '<div class="strip-head"><span>' + esc(s.stripHead) + '</span><span data-strip-hint>' + esc(fine() ? s.stripHint : s.stripHintTouch) + '</span></div>' +
          '<div class="strip-track" data-strip-track>' + panels + '</div>' +
        '</div>' +
      '</section>' +
      '<section class="threads" aria-label="' + esc(s.threadsHead) + '">' + threads + '</section>' +
      '<section class="shout"><blockquote>' + s.quote + '</blockquote><cite>' + esc(s.quoteCite) + '</cite></section>';
  }

  /* ---------------- 视图：栏目页头 ---------------- */
  function pageHead(key, lede, meta) {
    var s = S();
    var name = s.sec[key][0];
    var title = lang === 'en'
      ? '<h1 class="page-title kin" data-kin aria-label="' + esc(name) + '">' + Array.from(name).map(function (c, i) { return '<span class="kin-ch" style="--i:' + i + '" aria-hidden="true">' + esc(c) + '</span>'; }).join('') + '</h1>'
      : '<h1 class="page-title">' + esc(name) + '</h1>' + kin(SLUG_WORD[key]);
    return '<header class="page-head">' +
      '<div class="page-head-top"><span>' + esc(s.sectionOf(SECS.indexOf(key) + 1)) + '</span><span>datode.com/#/' + key + '</span></div>' +
      '<div class="page-title-row">' + title + '</div>' +
      '<div class="page-lede"><span>' + esc(meta) + '</span><p>' + esc(lede) + '</p></div>' +
      '</header>';
  }

  /* ---------------- 视图：文章目录表 ---------------- */
  function articlesView() {
    var s = S();
    var order = ['study', 'works', 'weibo'];
    var groups = order.map(function (cat) {
      var items = ARTICLES.filter(function (a) { return a.cat === cat; });
      var rows = items.map(function (a) {
        return '<li><a class="ix-row" href="' + esc(hrefFor(a.path)) + '" data-cursor-big>' +
          '<span class="ix-n">' + pad(ARTICLES.indexOf(a) + 1) + '</span>' +
          '<span class="ix-t">' + esc(L(a)) + '<small>' + esc(L(a, 'd')) + '</small></span>' +
          '<span class="ix-cat"><span class="tag tag-' + cat + '">' + esc(L(CATS[cat])) + '</span></span>' +
          '<span class="ix-go" aria-hidden="true">→</span>' +
          '</a></li>';
      }).join('');
      return '<section data-group="' + cat + '">' +
        '<div class="group-bar"><span>' + esc(L(CATS[cat])) + '</span><small>' + esc(s.count(items.length)) + '</small></div>' +
        '<ul class="ix">' + rows + '</ul></section>';
    }).join('');
    var chips = '<button class="chip" type="button" data-filter="all" aria-pressed="true">' + esc(s.all) + '<sup>' + ARTICLES.length + '</sup></button>' +
      order.map(function (cat) {
        var n = ARTICLES.filter(function (a) { return a.cat === cat; }).length;
        return '<button class="chip" type="button" data-filter="' + cat + '" aria-pressed="false">' + esc(L(CATS[cat])) + '<sup>' + n + '</sup></button>';
      }).join('');
    return pageHead('articles', s.articlesLede, s.count(ARTICLES.length)) +
      '<div class="filters" role="group" aria-label="' + esc(s.colCat) + '">' + chips + '</div>' +
      '<div class="ix-head" aria-hidden="true"><span>' + esc(s.colNo) + '</span><span>' + esc(s.colTitle) + '</span><span>' + esc(s.colCat) + '</span><span></span></div>' +
      groups;
  }

  /* ---------------- 视图：工具 ---------------- */
  function toolsView() {
    var s = S();
    var rows = TOOLS.map(function (it, i) {
      var main = it.external ? it.href : '#/tools/' + it.slug;
      var ext = it.external ? ' target="_blank" rel="noopener"' : '';
      var acts = it.external
        ? '<a class="btn btn-solid" href="' + esc(it.href) + '" target="_blank" rel="noopener">' + esc(s.visit) + '</a>'
        : '<a class="btn btn-solid" href="' + esc(main) + '">' + esc(s.openHere) + '</a>' +
          '<a class="btn" href="' + esc(C(it.href)) + '" target="_blank" rel="noopener">' + esc(s.openNew) + '</a>';
      var path = it.external ? it.href.replace(/^https?:\/\//, '') + ' · ' + s.external : 'datode.com/' + it.href;
      return '<li class="tl-row' + (it.external ? ' is-ext' : '') + '">' +
        '<span class="ix-n">' + pad(i + 1) + '</span>' +
        '<div><h2 class="tl-name"><a href="' + esc(main) + '"' + ext + ' data-cursor-big>' + esc(L(it)) + '</a></h2><span class="tl-path">' + esc(path) + '</span></div>' +
        '<p class="tl-desc">' + esc(L(it, 'd')) + '</p>' +
        '<div class="tl-act">' + acts + '</div>' +
        '</li>';
    }).join('');
    return pageHead('tools', s.toolsLede, s.countItems(TOOLS.length)) + '<ul class="ix">' + rows + '</ul>';
  }

  /* ---------------- 视图：作品（rapstar 专题） ---------------- */
  function worksView() {
    var s = S(), w = s.work;
    var stats = w.stats.map(function (x) { return '<div><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></div>'; }).join('');
    var tracks = TRACKS.map(function (t, i) {
      return '<li class="track">' +
        '<span class="track-n" aria-hidden="true">' + pad(i + 1) + '</span>' +
        '<figure class="track-cover"><img src="' + esc(C(t.card)) + '" alt="' + esc(w.cover(t.name)) + '" width="1200" height="630" loading="lazy" decoding="async"></figure>' +
        '<div class="track-info">' +
          '<div><h3>' + esc(t.name) + '</h3><p>' + esc(t.sub) + '</p></div>' +
          '<audio controls preload="none" src="' + esc(C(t.audio)) + '"></audio>' +
          '<div><a class="btn" href="' + esc(C(t.page)) + '" target="_blank" rel="noopener">' + esc(w.trackPage) + '</a></div>' +
        '</div></li>';
    }).join('');
    return pageHead('works', s.worksLede, s.countItems(1)) +
      '<div class="feat-kin">' + kin('rapstar', 'kin-wave', ' data-fit') + '</div>' +
      '<section class="feat-grid">' +
        '<div class="feat-copy">' +
          '<p class="mono" style="font-size:12px;margin-bottom:14px">' + esc(w.kicker) + '</p>' +
          '<h2>' + esc(w.title) + '</h2>' +
          '<p>' + esc(w.body) + '</p>' +
          '<div class="feat-act"><a class="btn btn-solid" href="#/works/rapstar">' + esc(w.enter) + '</a>' +
          '<a class="btn" href="' + esc(C(WORK.href)) + '" target="_blank" rel="noopener">' + esc(w.newWin) + '</a></div>' +
        '</div>' +
        '<div class="feat-stats">' + stats + '</div>' +
      '</section>' +
      '<div class="group-bar"><span>' + esc(w.tracks) + '</span><small>' + pad(TRACKS.length) + '</small></div>' +
      '<ul class="tracks">' + tracks + '</ul>' +
      marquee(s.marqueeWork, true);
  }

  function frameView(item, sec) {
    var s = S();
    return '<div class="frame-bar">' +
        '<a class="btn" href="#/' + sec + '">' + esc(s.back + s.sectionNames[sec]) + '</a>' +
        '<h1>' + esc(L(item)) + '</h1>' +
        '<a class="btn" href="' + esc(C(item.href)) + '" target="_blank" rel="noopener">' + esc(s.openNew) + '</a>' +
      '</div>' +
      '<div class="frame-path">datode.com/' + esc(item.href) + ' — ' + esc(s.frameNote) + '</div>' +
      '<div class="frame-box"><iframe src="' + esc(C(item.href)) + '" title="' + esc(L(item)) + '"></iframe></div>';
  }

  /* ---------------- Markdown ---------------- */
  var mdCache = {};
  function loadMd(path) {
    if (mdCache[path]) return Promise.resolve(mdCache[path]);
    var url = C(path.split('/').map(encodeURIComponent).join('/') + '.md');
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) { var err = new Error('HTTP ' + res.status); err.status = res.status; throw err; }
      return res.text();
    }).then(function (t) { mdCache[path] = t; return t; });
  }

  function resolvePath(dir, rel) {
    var parts = dir ? dir.split('/') : [];
    rel.split('/').forEach(function (seg) {
      if (seg === '..') parts.pop();
      else if (seg !== '.' && seg !== '') parts.push(seg);
    });
    return parts.join('/');
  }

  function slugify(text, used) {
    var base = text.trim().replace(/\s+/g, '-').replace(/[^\w一-鿿㐀-䶿-]/g, '').toLowerCase() || 'section';
    var id = base, n = 1;
    while (used[id]) id = base + '-' + (++n);
    used[id] = true;
    return id;
  }

  function renderMarkdown(md, path) {
    var dir = path.indexOf('/') >= 0 ? path.slice(0, path.lastIndexOf('/')) : '';
    var html = window.marked ? window.marked.parse(md, { gfm: true, breaks: false }) : '<pre>' + esc(md) + '</pre>';
    var box = document.createElement('div');
    box.innerHTML = html;

    Array.prototype.forEach.call(box.querySelectorAll('h1,h2,h3,h4,h5,h6'), function (h) {
      if (!h.textContent.trim()) h.parentNode.removeChild(h);
    });
    // 站内 .md 链接改成 hash 路由；其他相对链接经内容根；外链新窗口
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
    var used = {}, toc = [], n2 = 0;
    Array.prototype.forEach.call(box.querySelectorAll('h1,h2,h3'), function (h) {
      var text = h.textContent.trim();
      h.id = slugify(text, used);
      h.setAttribute('data-text', text);
      if (h.tagName === 'H2') {
        n2++;
        toc.push({ id: h.id, text: text });
        var num = document.createElement('span');
        num.className = 'h-n';
        num.setAttribute('aria-hidden', 'true');
        num.textContent = pad(n2);
        h.insertBefore(num, h.firstChild);
      }
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
    return loadMd(path).then(function (md) {
      var r = renderMarkdown(md, path);
      var chars = countChars(md);
      var mins = Math.max(1, Math.round(chars / 450));
      var idx = ARTICLES.indexOf(meta);
      var prev = idx > 0 ? ARTICLES[idx - 1] : null;
      var next = idx >= 0 && idx < ARTICLES.length - 1 ? ARTICLES[idx + 1] : null;
      var toc = r.toc.length >= 3
        ? '<nav class="toc" aria-label="' + esc(s.toc) + '"><div class="toc-label">' + esc(s.toc) + '</div><ol lang="zh-CN">' +
          r.toc.map(function (t) { return '<li><a href="#/' + esc(path) + '?id=' + encodeURIComponent(t.id) + '" data-anchor="' + esc(t.id) + '">' + esc(t.text) + '</a></li>'; }).join('') +
          '</ol></nav>'
        : '';
      var pager = (prev || next) ? '<nav class="pager">' +
        (prev ? '<a href="' + esc(hrefFor(prev.path)) + '"><small>' + esc(s.prev) + '</small><b>' + esc(L(prev)) + '</b></a>' : '<span></span>') +
        (next ? '<a href="' + esc(hrefFor(next.path)) + '"><small>' + esc(s.next) + '</small><b>' + esc(L(next)) + '</b></a>' : '<span></span>') +
        '</nav>' : '';
      var catName = L(CATS[meta.cat] || CATS.weibo);
      var back = meta.cat === 'about' ? '<a href="#/about">' + esc(s.back + s.sectionNames.about) + '</a>' : '<a href="#/articles">' + esc(s.back + s.sectionNames.articles) + '</a>';
      return {
        html: '<article>' +
          '<header class="art-head">' +
            '<div class="crumbs">' + back + '<span><span class="tag tag-' + esc(meta.cat) + '">' + esc(catName) + '</span></span>' + (meta.date ? '<span>' + esc(meta.date) + '</span>' : '') + '</div>' +
            '<h1 class="art-title">' + esc(L(meta)) + '</h1>' +
            '<div class="art-meta"><span>' + esc(s.chars(chars)) + '</span><span>' + esc(s.readTime(mins)) + '</span><span>datode.com/#/' + esc(path) + '</span></div>' +
          '</header>' +
          '<div class="art-layout">' +
            '<aside class="art-aside">' + toc + '</aside>' +
            '<div class="prose" lang="zh-CN">' + r.html +
              '<div class="art-end"><span>' + esc(s.endMark) + '</span><a href="#/articles">' + esc(s.backToList) + '</a></div>' +
            '</div>' +
          '</div>' +
          pager +
          '</article>',
        title: L(meta),
        anchor: anchor
      };
    }, function (err) {
      if (err && err.status === 404) return notFoundView();
      return { html: '<section class="empty"><h1>' + esc(s.notFound) + '</h1><p>' + esc(s.loadError) + '</p></section>' };
    });
  }

  /* ---------------- 视图：关于 ---------------- */
  function aboutView() {
    var s = S();
    var side = '<aside class="about-side"><figure><img src="' + esc(C('IMG_0205.PNG')) + '" alt="' + esc(s.portraitAlt) + '" width="502" height="497" loading="lazy" decoding="async"><figcaption>' + esc(s.portrait) + '<br>README.md</figcaption></figure></aside>';
    return loadMd('README').then(function (md) {
      var r = renderMarkdown(md, 'README');
      var box = document.createElement('div');
      box.innerHTML = r.html;
      var h1 = box.querySelector('h1');
      if (h1 && h1 === box.firstElementChild) h1.parentNode.removeChild(h1);
      return {
        html: pageHead('about', s.aboutLede, 'README.md') +
          '<div class="about-grid">' + side + '<div class="about-body"><div class="prose" lang="zh-CN" style="padding-left:0;padding-right:0">' + box.innerHTML + '</div></div></div>',
        title: s.sec.about[0]
      };
    }, function () {
      return { html: pageHead('about', s.aboutLede, 'README.md') + '<div class="about-grid">' + side + '<div class="about-body"><p>' + esc(s.loadError) + '</p></div></div>' };
    });
  }

  function notFoundView() {
    var s = S();
    return { html: '<section class="empty">' + kin('404?', '') + '<h1>' + esc(s.notFound) + '</h1><p>' + esc(s.notFoundText) + '</p><p><a class="btn btn-solid" href="#/">' + esc(s.goHome) + '</a></p></section>', title: s.notFound };
  }

  /* ================================================================
     动态字引擎
     - 电脑（精确指针）：每个字母按到鼠标的距离实时改变字重 / 宽度 / 倾斜，
       随滚动纵向拉伸；没动鼠标时缓慢起伏。只在可见时跑 rAF，静止后停。
     - 触屏：不跑 JS，换成 CSS 的分格呼吸（只作用于一行），手机不卡。
     - 减少动态效果：什么都不跑，清掉内联变量，回到 CSS 里那张定格海报。
     ================================================================ */
  var Kinetic = (function () {
    var groups = [];      // { el, chars:[{el,cx,cy,w,d,k,s}], visible }
    var io = null;
    var raf = 0;
    var px = -1e4, py = -1e4, hasPointer = false, lastMove = 0;
    var running = false;

    function enabled() { return fine() && !reduced(); }

    function measure() {
      groups.forEach(function (g) {
        var r = g.el.getBoundingClientRect();
        var sy = window.scrollY;
        g.chars.forEach(function (c) {
          var cr = c.el.getBoundingClientRect();
          c.cx = cr.left + cr.width / 2;
          c.cy = cr.top + sy + cr.height / 2;
        });
        g.top = r.top + sy;
        g.h = r.height;
      });
    }

    function clear() {
      groups.forEach(function (g) {
        g.chars.forEach(function (c) {
          c.el.style.removeProperty('--w'); c.el.style.removeProperty('--d');
          c.el.style.removeProperty('--k'); c.el.style.removeProperty('--s');
          c.w = c.d = c.k = c.s = null;
        });
      });
    }

    function frame(t) {
      raf = 0;
      if (!enabled()) return;
      var sy = window.scrollY, vh = window.innerHeight, vw = window.innerWidth;
      var R = Math.max(220, vw * 0.32);
      var idle = !hasPointer || (t - lastMove > 2600);
      var moving = false;
      for (var gi = 0; gi < groups.length; gi++) {
        var g = groups[gi];
        if (!g.visible) continue;
        // 滚动进度：这一组越往上滚出，字越被纵向拉长
        var prog = Math.min(1, Math.max(0, (sy - g.top + vh * 0.25) / (g.h + vh * 0.5)));
        var stretch = 1 + prog * 0.7;
        for (var i = 0; i < g.chars.length; i++) {
          var c = g.chars[i];
          var tw, td, tk;
          if (idle) {
            var ph = t / 900 + i * 0.55 + gi * 1.3;
            var wv = (Math.sin(ph) + 1) / 2;
            tw = 220 + 680 * wv; td = 55 + 95 * wv; tk = Math.cos(ph) * 6;
          } else {
            var dx = px - c.cx, dy = (py + sy) - c.cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var f = Math.max(0, 1 - dist / R);
            f = f * f * (3 - 2 * f);
            tw = 120 + 780 * f; td = 50 + 100 * f; tk = Math.max(-18, Math.min(18, -dx / R * 22 * f));
          }
          td = Math.max(50, td - prog * 30);
          if (c.w == null) { c.w = tw; c.d = td; c.k = tk; c.s = stretch; }
          var nw = c.w + (tw - c.w) * 0.16, nd = c.d + (td - c.d) * 0.16, nk = c.k + (tk - c.k) * 0.16, ns = c.s + (stretch - c.s) * 0.2;
          if (Math.abs(nw - c.w) > 0.5 || Math.abs(nd - c.d) > 0.2 || Math.abs(nk - c.k) > 0.05 || Math.abs(ns - c.s) > 0.002) moving = true;
          c.w = nw; c.d = nd; c.k = nk; c.s = ns;
          var st = c.el.style;
          st.setProperty('--w', nw.toFixed(0));
          st.setProperty('--d', nd.toFixed(1));
          st.setProperty('--k', nk.toFixed(2));
          st.setProperty('--s', ns.toFixed(3));
        }
      }
      // 起伏模式一直跑（只在可见时）；跟手模式静止后停下
      if ((idle || moving) && anyVisible() && !document.hidden) raf = requestAnimationFrame(frame);
    }

    function anyVisible() { for (var i = 0; i < groups.length; i++) if (groups[i].visible) return true; return false; }
    function kick() { if (!raf && enabled() && anyVisible()) raf = requestAnimationFrame(frame); }

    function mount(scope) {
      if (io) io.disconnect();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      groups = Array.prototype.map.call(scope.querySelectorAll('[data-kin]'), function (el) {
        return { el: el, visible: false, chars: Array.prototype.map.call(el.querySelectorAll('.kin-ch'), function (c) { return { el: c }; }) };
      });
      fitAll();
      if (!enabled()) { clear(); return; }
      measure();
      if ('IntersectionObserver' in window) {
        io = new IntersectionObserver(function (es) {
          es.forEach(function (e) {
            groups.forEach(function (g) { if (g.el === e.target) g.visible = e.isIntersecting; });
          });
          kick();
        });
        groups.forEach(function (g) { io.observe(g.el); });
      } else {
        groups.forEach(function (g) { g.visible = true; });
        kick();
      }
    }

    // 撑满宽度：data-fit 的行按容器宽度算字号（静态 / 动态都适用）
    function fitAll() {
      Array.prototype.forEach.call(view.querySelectorAll('[data-fit]'), function (el) {
        el.style.fontSize = '';
        var box = el.parentNode.getBoundingClientRect().width;
        var w = el.scrollWidth;
        if (!w || !box) return;
        var cur = parseFloat(getComputedStyle(el).fontSize);
        var cap = window.innerHeight * 0.42;
        // 首屏三行要给下面的中文标题留出位置
        if (el.parentNode.hasAttribute('data-hero') && window.innerWidth > 720) cap = Math.max(90, (window.innerHeight - 330) / 3 / 0.84);
        var size = Math.min(cur * (box * 0.96) / w, cap);
        el.style.fontSize = size.toFixed(1) + 'px';
      });
    }

    window.addEventListener('mousemove', function (e) {
      if (!enabled()) return;
      px = e.clientX; py = e.clientY; hasPointer = true; lastMove = performance.now();
      kick();
    }, { passive: true });
    document.addEventListener('mouseleave', function () { hasPointer = false; kick(); });
    window.addEventListener('scroll', function () { kick(); }, { passive: true });
    document.addEventListener('visibilitychange', kick);

    return {
      mount: mount,
      refresh: function () { fitAll(); if (enabled()) { measure(); kick(); } else { clear(); if (raf) cancelAnimationFrame(raf); raf = 0; } },
      stop: function () { if (raf) cancelAnimationFrame(raf); raf = 0; clear(); }
    };
  })();

  /* ---------------- 横向栏目条：纵向滚动驱动横移（只在电脑、允许动效时） ---------------- */
  var Strip = (function () {
    var strip = null, track = null, on = false, dist = 0, top = 0, span = 0, raf = 0;
    function want() { return fine() && !reduced() && window.innerWidth > 900; }
    function layout() {
      if (!strip) return;
      on = want();
      root.classList.toggle('pin', on);
      track.style.transform = '';
      if (!on) { strip.style.removeProperty('--strip-h'); return; }
      var stickyH = window.innerHeight - (parseFloat(getComputedStyle(root).getPropertyValue('--bar-h')) || 0);
      dist = Math.max(0, track.scrollWidth - window.innerWidth);
      strip.style.setProperty('--strip-h', (stickyH + dist) + 'px');
      top = strip.getBoundingClientRect().top + window.scrollY;
      span = dist;
      update();
    }
    function update() {
      raf = 0;
      if (!on || !strip) return;
      var bar = parseFloat(getComputedStyle(root).getPropertyValue('--bar-h')) || 0;
      var p = Math.min(1, Math.max(0, (window.scrollY + bar - top) / (span || 1)));
      track.style.transform = 'translate3d(' + (-p * dist).toFixed(1) + 'px,0,0)';
    }
    window.addEventListener('scroll', function () { if (on && !raf) raf = requestAnimationFrame(update); }, { passive: true });
    return {
      mount: function (scope) {
        strip = scope.querySelector('[data-strip]');
        track = strip ? strip.querySelector('[data-strip-track]') : null;
        if (!strip) { on = false; root.classList.remove('pin'); return; }
        layout();
      },
      refresh: layout
    };
  })();

  /* ---------------- 反色光标 ---------------- */
  var cursor = document.querySelector('.cursor');
  if (cursor) cursor.classList.add('is-hidden'); // 第一次移动鼠标前不显示
  var cursorOn = false;
  function updateCursor() {
    cursorOn = fine() && !reduced();
    root.classList.toggle('has-cursor', cursorOn);
    root.classList.toggle('touch', !fine());
    if (!cursorOn && cursor) cursor.style.transform = '';
  }
  window.addEventListener('mousemove', function (e) {
    if (!cursorOn) return;
    cursor.classList.remove('is-hidden');
    cursor.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
  }, { passive: true });
  document.addEventListener('mouseover', function (e) {
    if (!cursorOn) return;
    var t = e.target.closest && e.target.closest('a, button, [data-cursor-big], audio');
    cursor.classList.toggle('is-big', !!t);
  });
  document.addEventListener('mouseleave', function () { if (cursor) cursor.classList.add('is-hidden'); });

  /* ---------------- 渲染与转场 ---------------- */
  var current = null;
  var navToken = 0;
  var wipe = document.querySelector('.wipe');

  // 一块荧光色块分 5 格切进来、再分 5 格切出去：干脆，不柔和
  function wipeTo(from, to, dur) {
    if (reduced() || !wipe || !wipe.animate) return Promise.resolve();
    wipe.classList.add('is-on');
    var a = wipe.animate([{ transform: from }, { transform: to }], { duration: dur, easing: 'steps(5, end)', fill: 'forwards' });
    return new Promise(function (res) { a.onfinish = res; a.oncancel = res; }).then(function () {
      if (to === 'translateY(-101%)') {
        if (wipe.getAnimations) wipe.getAnimations().forEach(function (x) { try { x.cancel(); } catch (e) {} });
        wipe.classList.remove('is-on');
      }
    });
  }

  function route(instant) {
    var r = parseHash();
    var target = resolveRoute(r);
    var token = ++navToken;
    if (!instant && current && current.article && target.article && current.path === r.path) {
      if (r.id) scrollToAnchor(r.id);
      return;
    }
    var result = Promise.resolve().then(function () { return target.render(); });
    var useWipe = !instant && current && !reduced();
    var cover = useWipe ? wipeTo('translateY(101%)', 'translateY(0%)', 240) : Promise.resolve();
    if (!current) view.innerHTML = '<div class="loading">' + esc(S().loading) + '</div>';

    Promise.all([result, cover]).then(function (vals) {
      if (token !== navToken) return;
      var out = vals[0];
      if (typeof out === 'string') out = { html: out };
      var wasPath = current && current.path;
      view.innerHTML = out.html;
      current = { name: target.name, article: !!target.article, path: r.path };
      root.classList.toggle('is-article', !!target.article);
      root.classList.toggle('is-home', target.name === 'home');
      document.title = (out.title ? out.title + ' — ' : (target.name && target.name !== 'home' ? S().sectionNames[target.name] + ' — ' : '')) + S().title;
      markNav(target.name);
      if (!(instant && wasPath === r.path)) window.scrollTo(0, 0);
      afterRender();
      if (out.anchor) requestAnimationFrame(function () { scrollToAnchor(out.anchor, true); });
      if (!instant) { try { view.focus({ preventScroll: true }); } catch (e) {} }
      if (useWipe) wipeTo('translateY(0%)', 'translateY(-101%)', 280);
    });
  }

  function markNav(name) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (a) {
      var on = a.getAttribute('data-nav') === name;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function scrollToAnchor(id, instant) {
    var el = document.getElementById(id);
    if (!el) {
      var hs = view.querySelectorAll('[data-text]');
      for (var i = 0; i < hs.length; i++) if (hs[i].getAttribute('data-text') === id) { el = hs[i]; break; }
    }
    if (el) el.scrollIntoView({ behavior: instant || reduced() ? 'auto' : 'smooth', block: 'start' });
  }

  var tocLinks = [];
  function afterRender() {
    tocLinks = Array.prototype.slice.call(view.querySelectorAll('.toc a'));
    Kinetic.mount(view);
    Strip.mount(view);
    var note = view.querySelector('[data-pointer-note]');
    if (note) note.hidden = !(fine() && !reduced());
    onScroll();
  }

  document.addEventListener('click', function (e) {
    var chip = e.target.closest && e.target.closest('[data-filter]');
    if (chip) {
      var f = chip.getAttribute('data-filter');
      Array.prototype.forEach.call(view.querySelectorAll('[data-filter]'), function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-group]'), function (g) { g.hidden = !(f === 'all' || g.getAttribute('data-group') === f); });
      return;
    }
    var anc = e.target.closest && e.target.closest('[data-anchor]');
    if (anc) { e.preventDefault(); scrollToAnchor(anc.getAttribute('data-anchor')); }
  });

  /* 阅读进度 + 目录高亮（只做读写，不做动画） */
  var ticking = false;
  var progressBar = document.querySelector('.progress span');
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY;
      if (root.classList.contains('is-article') && progressBar) {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        progressBar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0).toFixed(4) + ')';
      }
      if (tocLinks.length) {
        var cur = null;
        for (var k = 0; k < tocLinks.length; k++) {
          var h = document.getElementById(tocLinks[k].getAttribute('data-anchor'));
          if (h && h.getBoundingClientRect().top < 160) cur = tocLinks[k];
        }
        tocLinks.forEach(function (a) { a.classList.toggle('is-current', a === cur); });
      }
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  var rz = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rz);
    rz = setTimeout(function () { Kinetic.refresh(); Strip.refresh(); onScroll(); }, 120);
  }, { passive: true });

  function onMotionChange() {
    updateCursor();
    if (reduced()) {
      Kinetic.stop();
      if (wipe && wipe.getAnimations) wipe.getAnimations().forEach(function (a) { a.cancel(); });
      if (wipe) wipe.classList.remove('is-on');
    }
    Kinetic.refresh();
    Strip.refresh();
    var note = view.querySelector('[data-pointer-note]');
    if (note) note.hidden = !(fine() && !reduced());
  }
  [mqReduce, mqFine].forEach(function (m) {
    if (m.addEventListener) m.addEventListener('change', onMotionChange);
    else if (m.addListener) m.addListener(onMotionChange);
  });

  /* ---------------- 启动 ---------------- */
  var langBtn = document.querySelector('[data-lang-toggle]');
  if (langBtn) langBtn.addEventListener('click', function () { setLang(lang === 'en' ? 'zh' : 'en'); });
  var yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
  window.addEventListener('hashchange', function () { route(false); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { Kinetic.refresh(); Strip.refresh(); });

  updateCursor();
  applyStatic();
  route(true);
})();
