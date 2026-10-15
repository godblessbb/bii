/* datode.com —— 纯静态单页：hash 路由 + 浏览器内渲染 Markdown。
   不依赖任何 CDN；marked 放在 assets/vendor/。 */
(function () {
  'use strict';

  var root = document.documentElement;
  var view = document.getElementById('view');
  var LANG_KEY = 'datode-lang';

  /* ---------------- 动效开关 ---------------- */
  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var mqFine = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : { matches: false };
  function reduced() { return !!mqReduce.matches; }

  /* ---------------- 内容数据 ---------------- */
  var ARTICLES = [
    { path: 'weibo', cat: 'weibo', date: '2012–2022',
      zh: '微博合辑（2012–2022）', en: 'Weibo anthology, 2012–2022',
      dzh: '十年老号被炸之后，挑了一百来条原创碎碎念留作纪念。', den: 'A hundred-odd original posts saved from a decade-old account that was shut down.' },
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
    { path: '_works/周宇新：毛泽东一生谋的都是权', cat: 'works', repost: true,
      zh: '【转载】周宇新：毛泽东一生谋的都是权', en: 'Repost — Zhou Yuxin: all Mao ever sought was power',
      dzh: '一篇转载的长文。', den: 'A long essay, reposted.' },
    { path: '_works/户口壁垒：现代中国的身份鸿沟', cat: 'works',
      zh: '户口壁垒：现代中国的“身份鸿沟”', en: 'The hukou barrier: the “identity gap” in modern China',
      dzh: '一个延续六十余年的人口管理制度。', den: 'A household registration system, more than sixty years on.' }
  ];
  // 不在列表里、但旧链接仍需能打开的页面
  var EXTRA = [
    { path: '_weibo/weibo0', cat: 'weibo', zh: '微博存档 · 生活手账', en: 'Weibo archive: life notes', hidden: true },
    { path: 'README', cat: 'about', zh: '关于我', en: 'About me', hidden: true }
  ];

  var TOOLS = [
    { slug: 'stock', href: 'stock/', zh: '美股百强看板', en: 'Top 100 stocks board',
      dzh: '表现最好的一百只美股，带筛选与个股详情页。', den: 'The hundred best-performing American stocks, with filters and a detail page for each.' },
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

  var WORKS = [
    { slug: 'rapstar', href: 'rapstar/', year: '2025', zh: 'Rapstar 说唱站', en: 'Rapstar',
      dzh: '说唱翻唱曲目站：封面、音频和歌词卡片。', den: 'A rap cover-song site: artwork, audio and lyric cards.' },
    { slug: 'mahjong', href: 'https://mahjong.byteniu.com', external: true, year: '2025', zh: '麻将', en: 'Mahjong',
      dzh: '在浏览器里打一局麻将。', den: 'A game of mahjong, right in the browser.' },
    { slug: 'alphie', href: 'https://app.04bot.com', external: true, year: '2025', zh: 'Alphie', en: 'Alphie',
      dzh: '04bot 出品的 AI 应用。', den: 'An assistant app made by 04bot.' }
  ];

  var CATS = {
    study: { zh: '学习笔记', en: 'Study notes' },
    works: { zh: '随笔杂文', en: 'Essays' },
    weibo: { zh: '微博存档', en: 'Weibo archive' },
    about: { zh: '关于', en: 'About' }
  };

  /* ---------------- 界面文字 ---------------- */
  var STR = {
    zh: {
      title: '香又脆的菜花',
      brand: '香又脆的菜花',
      brandMark: '菜',
      skip: '跳到正文',
      navLabel: '主导航',
      'nav.articles': '文章', 'nav.tools': '工具', 'nav.works': '作品', 'nav.about': '关于',
      langAria: 'Switch to English',
      'footer.big': '下期<span class="accent">再见</span>',
      'footer.note': '香又脆的菜花 · 北京 · 四海为家',
      'footer.weibo': '微博', 'footer.top': '回到顶部',
      issue: '起居注 · 食货志',
      since: '自 2012 年起连载',
      place: '北京 / 四海为家',
      heroLines: ['香又脆的', '菜花'],
      heroSub: '一个社会“闲达”的<em>起居注</em>和<em>食货志</em>',
      heroList: ['记录 Python、AI 和算法学习心得', '记录读书笔记、游记和影评食评', '记录出海业务搞钱思路和实践'],
      stampText: '香又脆的菜花 · 起居注 · 食货志 · datode.com · ',
      stampAlt: '菜花的头像',
      scroll: '向下翻阅',
      marquee: ['Python、AI 和算法', '读书笔记', '游记', '影评食评', '出海搞钱', '微博存档 2012–2022'],
      contents: '本期目录',
      sec: {
        articles: ['文章', '学习笔记、随笔杂文与微博存档'],
        tools: ['工具', '自己写来用的小工具，随手可开'],
        works: ['作品', '说唱站、麻将和 Alphie'],
        about: ['关于', '从哪里讲起呢……']
      },
      quote: '人的一生就是“I have a bright future ahead”里的每个字<span class="hl">逐个拿掉</span>的过程。',
      quoteCite: '—— 摘自微博存档，2012–2022',
      columnsKicker: '三条主线',
      columns: [
        ['Python、人工智能与算法', '学习心得与踩坑记录：建站、搭梯子、Docker、Telegram 机器人。'],
        ['读书、游记与影评食评', '看过的书和电影，吃过的饭，走过的路。'],
        ['出海与搞钱', '互联网个体户的思路和实践，还有做出来的小工具。']
      ],
      articlesLede: '学习笔记、随笔杂文和十年微博存档。正文保持原样，排版重新做过。',
      toolsLede: '自己写来用的小工具。点「在这里打开」会套在站内外框里运行，也可以新窗口直接打开。',
      worksLede: '做着玩、也认真做的东西。',
      aboutLede: '互联网个体户，base 北京，经常出差，四海为家。',
      all: '全部',
      count: function (n) { return n + ' 篇'; },
      countItems: function (n) { return n + ' 件'; },
      openHere: '在这里打开',
      openNew: '新窗口打开',
      visit: '前往',
      back: '返回',
      home: '首页',
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
      portrait: '本人近照（大概）',
      frameNote: '工具运行在站内外框中',
      sectionNames: { articles: '文章', tools: '工具', works: '作品', about: '关于' }
    },
    en: {
      title: 'Crispy Cauliflower',
      brand: 'Crispy Cauliflower',
      brandMark: 'C',
      skip: 'Skip to content',
      navLabel: 'Main navigation',
      'nav.articles': 'Articles', 'nav.tools': 'Tools', 'nav.works': 'Works', 'nav.about': 'About',
      langAria: '切换到中文',
      'footer.big': 'Until next <span class="accent">issue</span>',
      'footer.note': 'Crispy Cauliflower · Beijing · at home anywhere',
      'footer.weibo': 'Weibo', 'footer.top': 'Back to top',
      issue: 'A daily chronicle & household ledger',
      since: 'Published since 2012',
      place: 'Beijing / anywhere',
      heroLines: ['Crispy', 'Cauliflower'],
      heroSub: 'The <em>daily chronicle</em> and <em>household ledger</em> of a self-styled social idler',
      heroList: ['Notes on Python, machine learning and algorithms', 'Reading notes, travelogues, film and food reviews', 'Ideas and practice for earning money overseas'],
      stampText: 'crispy cauliflower · chronicle · ledger · datode.com · ',
      stampAlt: 'Portrait of the author',
      scroll: 'Scroll to read',
      marquee: ['Python, machine learning and algorithms', 'Reading notes', 'Travelogues', 'Film and food reviews', 'Earning overseas', 'Weibo archive 2012–2022'],
      contents: 'In this issue',
      sec: {
        articles: ['Articles', 'Study notes, essays and the Weibo archive'],
        tools: ['Tools', 'Small tools I built for myself, ready to open'],
        works: ['Works', 'A rap site, mahjong and Alphie'],
        about: ['About', 'Where should I even begin…']
      },
      quote: 'Life is the process of <span class="hl">taking away, one word at a time,</span> “I have a bright future ahead”.',
      quoteCite: '— from the Weibo archive, 2012–2022',
      columnsKicker: 'Three threads',
      columns: [
        ['Python, machine learning and algorithms', 'Lessons and pitfalls: building a blog, a private network tunnel, Docker, Telegram bots.'],
        ['Books, travel, film and food', 'Books read, films watched, meals eaten, roads taken.'],
        ['Going global, making money', 'Notes from an internet freelancer, and the little tools that came out of it.']
      ],
      articlesLede: 'Study notes, essays and ten years of Weibo posts. The texts stay in their original Chinese; the typesetting is new.',
      toolsLede: 'Small tools I built for my own use. “Open here” runs one inside the site frame; you can also open it in a new window.',
      worksLede: 'Things made for fun, and made with care.',
      aboutLede: 'An internet freelancer based in Beijing, often on the road, at home anywhere.',
      all: 'All',
      count: function (n) { return n + (n === 1 ? ' piece' : ' pieces'); },
      countItems: function (n) { return n + (n === 1 ? ' item' : ' items'); },
      openHere: 'Open here',
      openNew: 'New window',
      visit: 'Visit',
      back: 'Back',
      home: 'Home',
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
      portrait: 'The author, more or less',
      frameNote: 'Running inside the site frame',
      sectionNames: { articles: 'Articles', tools: 'Tools', works: 'Works', about: 'About' }
    }
  };

  var lang = root.getAttribute('lang') === 'en' ? 'en' : 'zh';
  function S() { return STR[lang]; }
  function L(o, k) { return o[(k || '') + lang] != null ? o[(k || '') + lang] : o[(k || '') + 'zh']; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hrefFor(path) { return '#/' + path; }

  /* ---------------- 语言 ---------------- */
  function applyStatic() {
    root.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
    var s = S();
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-i18n');
      if (s[k] != null) nodes[i].innerHTML = s[k];
    }
    var an = document.querySelectorAll('[data-i18n-aria]');
    for (var j = 0; j < an.length; j++) an[j].setAttribute('aria-label', s[an[j].getAttribute('data-i18n-aria')]);
    var btn = document.querySelector('[data-lang-toggle]');
    if (btn) {
      btn.setAttribute('aria-label', s.langAria);
      btn.setAttribute('aria-pressed', lang === 'en' ? 'true' : 'false');
    }
    var cm = document.querySelector('.curtain-mark');
    if (cm) cm.textContent = lang === 'en' ? 'Cauliflower' : '菜花';
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

  function resolveRoute(r) {
    var p = r.path;
    if (p === '/' || p === '/home' || p === '/index') return { name: 'home', render: homeView };
    if (p === '/articles') return { name: 'articles', render: articlesView };
    if (p === '/tools') return { name: 'tools', render: toolsView };
    if (p === '/works') return { name: 'works', render: worksView };
    if (p === '/about' || p === '/README') return { name: 'about', render: aboutView };
    var m = p.match(/^\/(tools|works)\/([\w-]+)$/);
    if (m) {
      var list = m[1] === 'tools' ? TOOLS : WORKS;
      for (var i = 0; i < list.length; i++) {
        if (list[i].slug === m[2] && !list[i].external) {
          var item = list[i], sec = m[1];
          return { name: sec, render: function () { return frameView(item, sec); } };
        }
      }
    }
    if (ARTICLE_RE.test(p)) {
      var path = p.slice(1);
      return { name: 'articles', article: true, render: function () { return articleView(path, r.id); } };
    }
    return { name: '', render: notFoundView };
  }

  /* ---------------- 视图：首页 ---------------- */
  function splitChars(text, offset) {
    var out = '';
    var chars = Array.from(text);
    for (var i = 0; i < chars.length; i++) {
      var c = chars[i] === ' ' ? '&nbsp;' : esc(chars[i]);
      out += '<span class="ch-clip"><span class="ch-in" style="--i:' + (i + offset) + '"><span class="ch">' + c + '</span></span></span>';
    }
    return out;
  }

  function stampSVG() {
    var s = S();
    var txt = s.stampText;
    return '<span class="stamp" data-cursor="' + esc(lang === 'en' ? 'Hi' : '你好') + '">' +
      '<svg class="stamp-ring" viewBox="0 0 100 100" aria-hidden="true"><defs><path id="ring" d="M50,50 m-41,0 a41,41 0 1,1 82,0 a41,41 0 1,1 -82,0"/></defs>' +
      '<text><textPath href="#ring" textLength="255">' + esc(txt) + '</textPath></text></svg>' +
      '<span class="stamp-face"><img src="IMG_0205.PNG" alt="' + esc(s.stampAlt) + '" width="512" height="512" decoding="async"></span></span>';
  }

  function homeView() {
    var s = S();
    var l1 = s.heroLines[0], l2 = s.heroLines[1];
    var counts = { articles: ARTICLES.length, tools: TOOLS.length, works: WORKS.length, about: null };
    var rows = ['articles', 'tools', 'works', 'about'].map(function (k, i) {
      var c = counts[k] == null ? '<span class="arrow">→</span>' : pad(counts[k]);
      return '<li class="reveal"><a class="index-row" href="#/' + k + '" data-cursor="' + esc(lang === 'en' ? 'Open' : '翻开') + '">' +
        '<span class="index-n">' + pad(i + 1) + '</span>' +
        '<span class="index-t">' + esc(s.sec[k][0]) + '</span>' +
        '<span class="index-c">' + c + '</span>' +
        '<span class="index-d">' + esc(s.sec[k][1]) + '</span></a></li>';
    }).join('');

    var mq = s.marquee.map(function (m) { return '<span class="marquee-item">' + esc(m) + '</span><span class="marquee-star" aria-hidden="true">✺</span>'; }).join('');

    var cols = s.columns.map(function (c, i) {
      return '<div class="reveal"><span class="big-n">' + pad(i + 1) + '</span><h3>' + esc(c[0]) + '</h3><p>' + esc(c[1]) + '</p></div>';
    }).join('');

    var year = new Date().getFullYear();
    return '' +
      '<section class="hero">' +
        '<div class="wrap"><div class="hero-meta fade-in"><span>datode.com</span><span>' + esc(s.issue) + '</span><span>' + esc(s.since) + ' — ' + year + '</span><span>' + esc(s.place) + '</span></div></div>' +
        '<div class="wrap">' +
          '<div class="hero-stage" data-hero>' +
            '<h1 class="hero-title" aria-label="' + esc(lang === 'en' ? l1 + ' ' + l2 : l1 + l2) + '">' +
              '<span class="line line-1" aria-hidden="true" data-speed="-0.12">' + splitChars(l1, 0) + '</span>' +
              '<span class="line line-2" aria-hidden="true" data-speed="0.06">' + splitChars(l2, Array.from(l1).length) + '</span>' +
            '</h1>' +
            '<div class="hero-stamp" data-speed="0.14">' + stampSVG() + '</div>' +
          '</div>' +
          '<div class="hero-foot fade-in">' +
            '<div><p class="hero-sub">' + s.heroSub + '</p>' +
            '<a class="scroll-cue" href="#/articles" data-scroll-next><i></i>' + esc(s.scroll) + '</a></div>' +
            '<ol class="hero-list">' + s.heroList.map(function (x, i) { return '<li><span>' + pad(i + 1) + '</span><span>' + esc(x) + '</span></li>'; }).join('') + '</ol>' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<div class="marquee" aria-hidden="true"><div class="marquee-track"><div class="marquee-group">' + mq + '</div><div class="marquee-group">' + mq + '</div></div></div>' +
      '<section class="section wrap" id="contents">' +
        '<p class="kicker reveal">' + esc(s.contents) + '</p>' +
        '<ol class="index-list">' + rows + '</ol>' +
      '</section>' +
      '<section class="pull wrap"><blockquote class="reveal" data-speed="0.04">' + s.quote + '</blockquote><cite class="reveal">' + esc(s.quoteCite) + '</cite></section>' +
      '<section class="section wrap">' +
        '<p class="kicker reveal">' + esc(s.columnsKicker) + '</p>' +
        '<div class="columns">' + cols + '</div>' +
      '</section>';
  }

  /* ---------------- 视图：栏目页头 ---------------- */
  function pageHead(key, lede, meta) {
    var s = S();
    return '<header class="page-head wrap">' +
      '<p class="kicker reveal">' + pad(['articles', 'tools', 'works', 'about'].indexOf(key) + 1) + ' / 04</p>' +
      '<h1 class="page-title reveal">' + esc(s.sec[key][0]) + '<span class="dot">.</span></h1>' +
      '<div class="page-lede reveal"><span class="meta">' + esc(meta) + '</span><p>' + esc(lede) + '</p></div>' +
      '</header>';
  }

  /* ---------------- 视图：文章列表 ---------------- */
  function articlesView() {
    var s = S();
    var order = ['study', 'works', 'weibo'];
    var groups = order.map(function (cat) {
      var items = ARTICLES.filter(function (a) { return a.cat === cat; });
      var rows = items.map(function (a) {
        var n = ARTICLES.indexOf(a) + 1;
        return '<li><a class="list-row" href="' + esc(hrefFor(a.path)) + '" data-cursor="' + esc(lang === 'en' ? 'Read' : '阅读') + '">' +
          '<span class="list-n">' + pad(n) + '</span>' +
          '<span class="list-t">' + esc(L(a)) + '</span>' +
          '<span class="list-meta"><span class="tag tag-' + cat + '">' + esc(L(CATS[cat], '')) + '</span> <span class="arrow">→</span></span>' +
          '<span class="list-d">' + esc(L(a, 'd')) + '</span>' +
          '</a></li>';
      }).join('');
      return '<section class="group reveal" data-group="' + cat + '">' +
        '<div class="group-head"><h2>' + esc(L(CATS[cat], '')) + '</h2><span>' + esc(s.count(items.length)) + '</span></div>' +
        '<ul class="list">' + rows + '</ul></section>';
    }).join('');
    var chips = '<button class="chip" type="button" data-filter="all" aria-pressed="true">' + esc(s.all) + '<sup>' + ARTICLES.length + '</sup></button>' +
      order.map(function (cat) {
        var n = ARTICLES.filter(function (a) { return a.cat === cat; }).length;
        return '<button class="chip" type="button" data-filter="' + cat + '" aria-pressed="false">' + esc(L(CATS[cat], '')) + '<sup>' + n + '</sup></button>';
      }).join('');
    return pageHead('articles', s.articlesLede, s.count(ARTICLES.length)) +
      '<div class="wrap"><div class="filters reveal" role="group">' + chips + '</div>' + groups + '</div>';
  }

  /* ---------------- 视图：工具 / 作品 ---------------- */
  function entryList(list, sec) {
    var s = S();
    return '<div class="wrap"><ul class="list" style="border-top:2px solid var(--ink)">' + list.map(function (it, i) {
      var main = it.external ? it.href : '#/' + sec + '/' + it.slug;
      var mainAttr = it.external ? ' target="_blank" rel="noopener"' : '';
      var actions = it.external
        ? '<a class="btn btn-solid" href="' + esc(it.href) + '" target="_blank" rel="noopener">' + esc(s.visit) + ' ↗</a>'
        : '<a class="btn btn-solid" href="' + esc(main) + '">' + esc(s.openHere) + '</a>' +
          '<a class="btn" href="' + esc(it.href) + '" target="_blank" rel="noopener">' + esc(s.openNew) + ' ↗</a>';
      var path = it.external ? it.href.replace(/^https?:\/\//, '') : '/' + it.href;
      return '<li class="entry reveal">' +
        '<span class="list-n">' + pad(i + 1) + '</span>' +
        '<h2 class="entry-t"><a href="' + esc(main) + '"' + mainAttr + ' data-cursor="' + esc(lang === 'en' ? 'Open' : '打开') + '">' + esc(L(it)) + '</a></h2>' +
        '<span class="entry-path">' + esc(path) + (it.year ? ' · ' + it.year : '') + '</span>' +
        '<p class="entry-d">' + esc(L(it, 'd')) + '</p>' +
        '<div class="entry-actions">' + actions + '</div>' +
        '</li>';
    }).join('') + '</ul></div>';
  }

  function toolsView() { var s = S(); return pageHead('tools', s.toolsLede, s.countItems(TOOLS.length)) + entryList(TOOLS, 'tools'); }
  function worksView() { var s = S(); return pageHead('works', s.worksLede, s.countItems(WORKS.length)) + entryList(WORKS, 'works'); }

  function frameView(item, sec) {
    var s = S();
    return '<div class="wrap">' +
      '<div class="frame-bar">' +
        '<a class="btn" href="#/' + sec + '">← ' + esc(s.sectionNames[sec]) + '</a>' +
        '<h1>' + esc(L(item)) + '</h1>' +
        '<a class="btn" href="' + esc(item.href) + '" target="_blank" rel="noopener">' + esc(s.openNew) + ' ↗</a>' +
      '</div>' +
      '<div class="frame-wrap"><div class="frame-shell">' +
        '<div class="frame-dots"><i></i><i></i><i></i><span>datode.com/' + esc(item.href) + ' — ' + esc(s.frameNote) + '</span></div>' +
        '<iframe src="' + esc(item.href) + '" title="' + esc(L(item)) + '"></iframe>' +
      '</div></div></div>';
  }

  /* ---------------- Markdown ---------------- */
  var mdCache = {};
  function loadMd(path) {
    if (mdCache[path]) return Promise.resolve(mdCache[path]);
    var url = path.split('/').map(encodeURIComponent).join('/') + '.md';
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) { var err = new Error('HTTP ' + res.status); err.status = res.status; throw err; }
      return res.text();
    }).then(function (t) { mdCache[path] = t; return t; });
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
    var html = window.marked ? window.marked.parse(md, { gfm: true, breaks: false }) : '<pre>' + esc(md) + '</pre>';
    var box = document.createElement('div');
    box.innerHTML = html;

    // 空标题（如 "# "）不显示
    Array.prototype.forEach.call(box.querySelectorAll('h1,h2,h3,h4,h5,h6'), function (h) {
      if (!h.textContent.trim()) h.parentNode.removeChild(h);
    });

    // 链接：站内 .md 改成 hash 路由，外链新窗口
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
      else a.setAttribute('href', target);
    });

    // 图片：相对路径按文章所在目录解析
    Array.prototype.forEach.call(box.querySelectorAll('img[src]'), function (img) {
      var src = img.getAttribute('src').trim();
      if (!/^(https?:|data:|\/\/)/i.test(src)) img.setAttribute('src', src.charAt(0) === '/' ? src.slice(1) : resolvePath(dir, src));
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
    });

    // 表格包一层，窄屏可以横向滚
    Array.prototype.forEach.call(box.querySelectorAll('table'), function (t) {
      var w = document.createElement('div');
      w.className = 'table-wrap';
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
    });

    // 标题锚点
    var used = {};
    var toc = [];
    var n2 = 0;
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
        ? '<nav class="article-toc" aria-label="' + esc(s.toc) + '"><div class="toc-label">' + esc(s.toc) + '</div><ol lang="zh-CN">' +
          r.toc.map(function (t) { return '<li><a href="#/' + esc(path) + '?id=' + encodeURIComponent(t.id) + '" data-anchor="' + esc(t.id) + '">' + esc(t.text) + '</a></li>'; }).join('') +
          '</ol></nav>'
        : '';
      var pager = (prev || next) ? '<nav class="pager wrap">' +
        (prev ? '<a href="' + esc(hrefFor(prev.path)) + '"><small>← ' + esc(s.prev) + '</small><span>' + esc(L(prev)) + '</span></a>' : '<span></span>') +
        (next ? '<a href="' + esc(hrefFor(next.path)) + '"><small>' + esc(s.next) + ' →</small><span>' + esc(L(next)) + '</span></a>' : '<span></span>') +
        '</nav>' : '';
      var catName = L(CATS[meta.cat] || CATS.weibo, '');
      var drop = /^\s*[^#>\-\s*`|<!\[]/.test(md) ? ' has-drop' : '';
      return {
        html: '<article>' +
          '<header class="article-head wrap">' +
            '<div class="crumbs reveal"><a href="#/articles">← ' + esc(s.sectionNames.articles) + '</a><span class="tag tag-' + esc(meta.cat) + '">' + esc(catName) + '</span>' + (meta.date ? '<span>' + esc(meta.date) + '</span>' : '') + '</div>' +
            '<h1 class="article-title reveal">' + esc(L(meta)) + '</h1>' +
            '<div class="article-meta reveal"><span><b>' + esc(s.chars(chars)) + '</b></span><span>' + esc(s.readTime(mins)) + '</span><span class="meta-path">datode.com/#/' + esc(path) + '</span></div>' +
          '</header>' +
          '<div class="article-layout wrap">' +
            '<aside class="article-aside">' + toc + '</aside>' +
            '<div class="prose' + drop + '" lang="zh-CN">' + r.html +
              '<div class="article-end"><span>' + esc(s.endMark) + '</span><a href="#/articles">' + esc(s.backToList) + ' →</a></div>' +
            '</div>' +
          '</div>' +
          pager +
          '</article>',
        title: L(meta),
        anchor: anchor
      };
    }, function (err) {
      if (err && err.status === 404) return notFoundView();
      return { html: '<section class="empty wrap"><h1 class="page-title">' + esc(s.notFound) + '<span class="dot">.</span></h1><p>' + esc(s.loadError) + '</p></section>' };
    });
  }

  /* ---------------- 视图：关于 ---------------- */
  function aboutView() {
    var s = S();
    return loadMd('README').then(function (md) {
      var r = renderMarkdown(md, 'README');
      // README 的第一个一级标题提到页头里显示
      var box = document.createElement('div');
      box.innerHTML = r.html;
      var h1 = box.querySelector('h1');
      if (h1 && h1 === box.firstElementChild) h1.parentNode.removeChild(h1);
      return {
        html: pageHead('about', s.aboutLede, 'README.md') +
          '<div class="about-grid wrap">' +
            '<div class="about-portrait"><figure class="reveal"><div class="photo"><img src="IMG_0205.PNG" alt="' + esc(s.stampAlt) + '" width="512" height="640" loading="lazy" decoding="async"></div><figcaption>' + esc(s.portrait) + '</figcaption></figure></div>' +
            '<div class="prose" lang="zh-CN">' + box.innerHTML + '</div>' +
          '</div>',
        title: s.sec.about[0]
      };
    }, function () {
      return { html: pageHead('about', s.aboutLede, 'README.md') + '<div class="wrap"><p>' + esc(s.loadError) + '</p></div>' };
    });
  }

  function notFoundView() {
    var s = S();
    return { html: '<section class="empty wrap"><p class="kicker">404</p><h1 class="page-title">' + esc(s.notFound) + '<span class="dot">.</span></h1><p>' + esc(s.notFoundText) + '</p><p><a class="btn btn-solid" href="#/">' + esc(s.goHome) + '</a></p></section>', title: s.notFound };
  }

  /* ---------------- 渲染与转场 ---------------- */
  var current = null;
  var navToken = 0;
  var curtain = document.querySelector('.curtain');

  function animateCurtain(from, to, dur) {
    if (reduced() || !curtain || !curtain.animate) return Promise.resolve();
    curtain.classList.add('is-on');
    var a = curtain.animate([{ transform: from }, { transform: to }], { duration: dur, easing: 'cubic-bezier(.76,0,.24,1)', fill: 'forwards' });
    return new Promise(function (res) {
      a.onfinish = function () { res(); };
      a.oncancel = function () { res(); };
    }).then(function () {
      // 结束后不保留 Web Animation 对象，静止状态交给 CSS
      if (to === 'translateY(-101%)') {
        if (curtain.getAnimations) curtain.getAnimations().forEach(function (x) { try { x.cancel(); } catch (e) {} });
        else { try { a.cancel(); } catch (e) {} }
        curtain.classList.remove('is-on');
      }
    });
  }

  function route(instant) {
    var r = parseHash();
    var target = resolveRoute(r);
    var token = ++navToken;
    var sameArticle = current && current.article && target.article && current.path === r.path;

    // 同一篇文章内只是跳锚点
    if (sameArticle && !instant) {
      if (r.id) scrollToAnchor(r.id);
      return;
    }

    var result = Promise.resolve().then(function () { return target.render(); });
    var useCurtain = !instant && current && !reduced();
    var cover = useCurtain ? animateCurtain('translateY(101%)', 'translateY(0%)', 520) : Promise.resolve();
    if (!current) view.innerHTML = '<div class="loading">' + esc(S().loading) + '</div>';

    Promise.all([result, cover]).then(function (vals) {
      if (token !== navToken) return;
      var out = vals[0];
      if (typeof out === 'string') out = { html: out };
      view.innerHTML = out.html;
      current = { name: target.name, article: !!target.article, path: r.path };
      root.classList.toggle('is-article', !!target.article);
      document.title = (out.title ? out.title + ' — ' : (target.name && target.name !== 'home' ? S().sectionNames[target.name] + ' — ' : '')) + S().title;
      markNav(target.name);
      if (out.anchor) {
        afterRender();
        requestAnimationFrame(function () { scrollToAnchor(out.anchor, true); });
      } else {
        if (!instant || !current) window.scrollTo(0, 0);
        afterRender();
      }
      if (!instant) { try { view.focus({ preventScroll: true }); } catch (e) {} }
      if (useCurtain) animateCurtain('translateY(0%)', 'translateY(-101%)', 620);
    });
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
      // 兼容旧 docsify 锚点：按标题文字找
      var hs = view.querySelectorAll('[data-text]');
      for (var i = 0; i < hs.length; i++) if (hs[i].getAttribute('data-text') === id) { el = hs[i]; break; }
    }
    if (el) el.scrollIntoView({ behavior: instant || reduced() ? 'auto' : 'smooth', block: 'start' });
  }

  /* ---------------- 渲染后挂载交互 ---------------- */
  var io = null;
  var parallaxEls = [];
  var tocLinks = [];

  function afterRender() {
    // 揭示
    var reveals = view.querySelectorAll('.reveal');
    if (io) io.disconnect();
    if (reduced() || !('IntersectionObserver' in window)) {
      for (var i = 0; i < reveals.length; i++) reveals[i].classList.add('in');
    } else {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      for (var j = 0; j < reveals.length; j++) io.observe(reveals[j]);
    }

    parallaxEls = Array.prototype.slice.call(view.querySelectorAll('[data-speed]'));
    tocLinks = Array.prototype.slice.call(view.querySelectorAll('.article-toc a'));
    bindCursorTargets(view);
    bindMagnetic(view);
    onScroll();
  }

  /* 文章筛选、锚点、回到顶部 */
  document.addEventListener('click', function (e) {
    var chip = e.target.closest && e.target.closest('[data-filter]');
    if (chip) {
      var f = chip.getAttribute('data-filter');
      Array.prototype.forEach.call(view.querySelectorAll('[data-filter]'), function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-group]'), function (g) { g.hidden = !(f === 'all' || g.getAttribute('data-group') === f); });
      return;
    }
    var anc = e.target.closest && e.target.closest('[data-anchor]');
    if (anc) {
      e.preventDefault();
      scrollToAnchor(anc.getAttribute('data-anchor'));
      return;
    }
    var top = e.target.closest && e.target.closest('[data-top]');
    if (top) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
      return;
    }
    var next = e.target.closest && e.target.closest('[data-scroll-next]');
    if (next) {
      var c = document.getElementById('contents');
      if (c) { e.preventDefault(); c.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); }
    }
  });

  /* ---------------- 滚动：视差、进度、目录高亮 ---------------- */
  var ticking = false;
  var progressBar = document.querySelector('.progress span');
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY || window.pageYOffset;
      root.classList.toggle('scrolled', y > 8);

      if (!reduced()) {
        var vh = window.innerHeight;
        for (var i = 0; i < parallaxEls.length; i++) {
          var el = parallaxEls[i];
          var rect = el.getBoundingClientRect();
          if (rect.bottom < -200 || rect.top > vh + 200) continue;
          var sp = parseFloat(el.getAttribute('data-speed')) || 0;
          var center = rect.top + rect.height / 2 - vh / 2;
          el.style.transform = 'translate3d(0,' + (center * sp).toFixed(1) + 'px,0)';
        }
      }

      if (root.classList.contains('is-article') && progressBar) {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        progressBar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0).toFixed(4) + ')';
      }

      if (tocLinks.length) {
        var cur = null;
        for (var k = 0; k < tocLinks.length; k++) {
          var h = document.getElementById(tocLinks[k].getAttribute('data-anchor'));
          if (h && h.getBoundingClientRect().top < 140) cur = tocLinks[k];
        }
        tocLinks.forEach(function (a) { a.classList.toggle('is-current', a === cur); });
      }
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  function resetMotion() {
    parallaxEls.forEach(function (el) { el.style.transform = ''; });
    var hero = view.querySelector('[data-hero]');
    if (hero) hero.style.transform = '';
    magnets.forEach(function (m) { m.style.transform = ''; });
  }

  /* ---------------- 鼠标：跟随光标、磁吸、首屏景深 ---------------- */
  var cursor = document.querySelector('.cursor');
  var cursorLabel = document.querySelector('.cursor-label');
  var mx = -100, my = -100, cx = -100, cy = -100;
  var cursorRAF = 0;
  var cursorOn = false;

  function cursorEnabled() { return mqFine.matches && !reduced(); }

  function cursorLoop() {
    cursorRAF = 0;
    if (!cursorOn) return;
    cx += (mx - cx) * 0.2;
    cy += (my - cy) * 0.2;
    cursor.style.transform = 'translate3d(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px,0)';
    if (Math.abs(mx - cx) > 0.1 || Math.abs(my - cy) > 0.1) cursorRAF = requestAnimationFrame(cursorLoop);
  }

  function updateCursorState() {
    cursorOn = cursorEnabled();
    root.classList.toggle('has-cursor', cursorOn);
    root.classList.toggle('reduce', reduced());
    if (!cursorOn) {
      if (cursorRAF) cancelAnimationFrame(cursorRAF);
      cursorRAF = 0;
      if (cursor) cursor.style.transform = '';
    }
    if (reduced()) resetMotion();
  }

  window.addEventListener('mousemove', function (e) {
    if (!cursorOn) return;
    mx = e.clientX; my = e.clientY;
    if (!cursorRAF) cursorRAF = requestAnimationFrame(cursorLoop);

    var hero = view.querySelector('[data-hero]');
    if (hero) {
      var dx = (e.clientX / window.innerWidth - 0.5);
      var dy = (e.clientY / window.innerHeight - 0.5);
      hero.style.transform = 'translate3d(' + (dx * -18).toFixed(1) + 'px,' + (dy * -10).toFixed(1) + 'px,0)';
    }
  }, { passive: true });
  document.addEventListener('mouseleave', function () { if (cursor) cursor.classList.add('is-hidden'); });
  document.addEventListener('mouseenter', function () { if (cursor) cursor.classList.remove('is-hidden'); });

  function bindCursorTargets(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll('[data-cursor]'), function (el) {
      el.addEventListener('mouseenter', function () {
        if (!cursorOn) return;
        cursorLabel.textContent = el.getAttribute('data-cursor');
        cursor.classList.add('is-big');
      });
      el.addEventListener('mouseleave', function () { cursor.classList.remove('is-big'); });
    });
  }

  var magnets = [];
  function bindMagnetic(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll('[data-magnetic]'), function (el) {
      if (el.__mag) return;
      el.__mag = true;
      magnets.push(el);
      el.addEventListener('mousemove', function (e) {
        if (!cursorOn) return;
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) * 0.3;
        var y = (e.clientY - r.top - r.height / 2) * 0.4;
        el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
      });
      el.addEventListener('mouseleave', function () { el.style.transform = ''; });
    });
  }

  function onMotionPrefChange() {
    updateCursorState();
    if (reduced()) {
      Array.prototype.forEach.call(view.querySelectorAll('.reveal'), function (el) { el.classList.add('in'); });
      if (curtain && curtain.getAnimations) curtain.getAnimations().forEach(function (a) { a.cancel(); });
      if (curtain) curtain.classList.remove('is-on');
    }
  }
  if (mqReduce.addEventListener) mqReduce.addEventListener('change', onMotionPrefChange);
  else if (mqReduce.addListener) mqReduce.addListener(onMotionPrefChange);
  if (mqFine.addEventListener) mqFine.addEventListener('change', updateCursorState);
  else if (mqFine.addListener) mqFine.addListener(updateCursorState);

  /* ---------------- 启动 ---------------- */
  var langBtn = document.querySelector('[data-lang-toggle]');
  if (langBtn) langBtn.addEventListener('click', function () { setLang(lang === 'en' ? 'zh' : 'en'); });

  var yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  window.addEventListener('hashchange', function () { route(false); });

  updateCursorState();
  bindMagnetic(document.querySelector('.masthead'));
  applyStatic();
  route(true);
})();
