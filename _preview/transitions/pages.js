/* 转场预览 · 舞台上的两张示意页（Canvas 2D 画）
   A = 首页（大标题 + 等高线圆环），B = 文章页（荧光绿精选卡 + 列表）。
   两张页都画在 2D 画布上：空闲时直接显示这张画布，转场时同一张画布上传成 WebGL 纹理，
   所以转场前后、冻结帧两端和「干净的页面」是同一份像素。 */
(function () {
  'use strict';

  var C = {
    bg: '#060807', bg2: '#0c110e', ink: '#e8efe4', ink2: '#9aa79c', ink3: '#5f6b62',
    line: 'rgba(232,239,228,0.13)', line2: 'rgba(232,239,228,0.28)',
    acc: '#c4ff3a', accInk: '#0b1205', acc2: '#ff6a3d'
  };
  var F_DISPLAY = '"Unbounded", "Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
  var F_SANS = '"Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", system-ui, sans-serif';
  var F_MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';

  var TEXT = {
    zh: {
      site: '香又脆的菜花', nav: ['首页', '作品', '文章', '微博', '关于'], lang: '中 / En',
      a: {
        kicker: '· 你好，这里是菜花',
        title: ['写点东西，', '做点小玩意'],
        dek: '一个程序员的自留地：随笔、工具和十年微博存档。',
        cta: '看看作品  →',
        stats: [['7', '篇文章'], ['107', '条微博'], ['9', '个小玩意']]
      },
      b: {
        tag: '精选 · 001',
        title: ['普通人如何去', '拥有富士山呢？'],
        dek: '写给一场单恋，和一座不属于自己的山。',
        more: '读全文  →',
        head: '文章',
        rows: [
          ['微博合辑（2012–2022）', '2022'],
          ['五分钟搭一个博客网站', '2021'],
          ['一分钟之内搭建一个梯子', '2021'],
          ['Docker 上手：跑你的 Python 脚本', '2020'],
          ['自动续签进京证', '2020'],
          ['《无名之辈》观后', '2019']
        ]
      }
    },
    en: {
      site: 'Crispy Caihua', nav: ['Home', 'Works', 'Writing', 'Weibo', 'About'], lang: 'En / 中',
      a: {
        kicker: '· Hello, this is Caihua',
        title: ['Writing things,', 'making toys'],
        dek: 'A programmer\'s allotment: essays, tools and a decade of Weibo.',
        cta: 'See the works  →',
        stats: [['7', 'essays'], ['107', 'posts'], ['9', 'toys']]
      },
      b: {
        tag: 'Featured · 001',
        title: ['How does anyone', 'own Mount Fuji?'],
        dek: 'On unrequited love, and a mountain that was never yours.',
        more: 'Read  →',
        head: 'Writing',
        rows: [
          ['Weibo anthology, 2012–2022', '2022'],
          ['A blog in five minutes', '2021'],
          ['A personal proxy in one minute', '2021'],
          ['First steps with Docker', '2020'],
          ['Auto-renewing a Beijing permit', '2020'],
          ['On "A Cool Fish"', '2019']
        ]
      }
    }
  };

  function font(ctx, weight, size, fam) { ctx.font = weight + ' ' + Math.round(size * 10) / 10 + 'px ' + fam; }

  /* 按宽度截断，放不下就加省略号 */
  function fit(ctx, s, max) {
    if (ctx.measureText(s).width <= max) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
    return s + '…';
  }
  /* 按宽度断行（中文逐字、英文按词） */
  function wrap(ctx, s, max) {
    var words = /[㐀-鿿]/.test(s) ? s.split('') : s.split(/(\s+)/);
    var lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var next = cur + words[i];
      if (cur && ctx.measureText(next).width > max) { lines.push(cur.trim()); cur = words[i].trim() ? words[i] : ''; }
      else cur = next;
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines;
  }
  function fitSize(ctx, lines, weight, fam, size, max) {
    font(ctx, weight, size, fam);
    var w = 0;
    for (var i = 0; i < lines.length; i++) w = Math.max(w, ctx.measureText(lines[i]).width);
    return w > max ? size * max / w : size;
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* 顶栏：logo + 站名 + 导航（当前栏目带荧光绿下划线） */
  function topbar(ctx, w, h, t, s, active) {
    var gut = s.gut, y = s.bar / 2;
    ctx.fillStyle = C.acc;
    ctx.beginPath(); ctx.arc(gut + s.logo / 2, y, s.logo / 2, 0, Math.PI * 2); ctx.fill();
    font(ctx, 900, s.logo * 0.56, F_SANS);
    ctx.fillStyle = C.accInk; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('菜', gut + s.logo / 2, y + s.logo * 0.03);
    ctx.textAlign = 'left';
    font(ctx, 700, s.nav * 1.05, F_SANS);
    ctx.fillStyle = C.ink;
    var siteX = gut + s.logo + s.nav * 0.7;
    if (!s.narrow) ctx.fillText(t.site, siteX, y);

    font(ctx, 500, s.nav, F_SANS);
    var items = s.narrow ? [t.nav[0], t.nav[2], t.nav[3]] : t.nav;
    var act = s.narrow ? (active === 0 ? 0 : 1) : active;
    var gap = s.nav * (s.narrow ? 1.1 : 1.6);
    var x = w - gut, xs = [];
    var langW = 0;
    if (!s.narrow) {
      font(ctx, 500, s.nav * 0.86, F_MONO);
      langW = ctx.measureText(t.lang).width + s.nav * 1.4;
      ctx.strokeStyle = C.line2; ctx.lineWidth = Math.max(1, s.u);
      rr(ctx, x - langW, y - s.nav * 0.85, langW, s.nav * 1.7, s.nav * 0.85); ctx.stroke();
      ctx.fillStyle = C.ink2; ctx.textAlign = 'center';
      ctx.fillText(t.lang, x - langW / 2, y);
      ctx.textAlign = 'left';
      x -= langW + gap;
      font(ctx, 500, s.nav, F_SANS);
    }
    for (var i = items.length - 1; i >= 0; i--) {
      var iw = ctx.measureText(items[i]).width;
      x -= iw; xs[i] = [x, iw];
      x -= gap;
    }
    for (var j = 0; j < items.length; j++) {
      ctx.fillStyle = j === act ? C.ink : C.ink2;
      ctx.fillText(items[j], xs[j][0], y);
      if (j === act) { ctx.fillStyle = C.acc; ctx.fillRect(xs[j][0], y + s.nav * 0.85, xs[j][1], Math.max(2, s.u * 2)); }
    }
    ctx.fillStyle = C.line;
    ctx.fillRect(0, s.bar, w, Math.max(1, s.u));
  }

  /* 等高线圆环（呼应主站背景的噪声地形等高线） */
  function contours(ctx, cx, cy, R, u) {
    ctx.save();
    for (var k = 0; k < 9; k++) {
      var r = R * (0.22 + k * 0.1);
      ctx.beginPath();
      for (var a = 0; a <= 120; a++) {
        var th = a / 120 * Math.PI * 2;
        var wob = 1 + 0.045 * Math.sin(th * 3 + k * 0.7) + 0.03 * Math.sin(th * 5 - k * 1.3);
        var px = cx + Math.cos(th) * r * wob, py = cy + Math.sin(th) * r * wob * 0.92;
        if (a) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = k === 4 ? C.acc : 'rgba(196,255,58,' + (0.10 + 0.05 * (k % 3)) + ')';
      ctx.lineWidth = (k === 4 ? 2.2 : 1.1) * u;
      ctx.stroke();
    }
    ctx.fillStyle = C.acc2;
    ctx.beginPath(); ctx.arc(cx + R * 0.47, cy - R * 0.33, 5 * u, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.acc;
    ctx.beginPath(); ctx.arc(cx - R * 0.08, cy + R * 0.06, 9 * u, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function scale(w, h) {
    var u = Math.min(w / 900, h / 560);
    u = Math.max(u, 0.42);
    var narrow = w < 560;
    return {
      u: u, narrow: narrow,
      gut: Math.max(16, w * 0.045),
      bar: Math.max(44, 64 * u),
      logo: Math.max(22, 30 * u),
      nav: Math.max(12, 15 * u)
    };
  }

  function pageA(ctx, w, h, t) {
    var s = scale(w, h), u = s.u, gut = s.gut;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    var g = ctx.createRadialGradient(w * 0.78, h * 0.55, 0, w * 0.78, h * 0.55, Math.max(w, h) * 0.6);
    g.addColorStop(0, 'rgba(196,255,58,0.07)'); g.addColorStop(1, 'rgba(196,255,58,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    var R = s.narrow ? Math.min(w * 0.62, h * 0.32) : Math.min(h * 0.5, w * 0.3);
    var cx = s.narrow ? w * 0.72 : w * 0.76, cy = s.narrow ? h * 0.74 : s.bar + (h - s.bar) * 0.5;
    contours(ctx, cx, cy, R, u);

    topbar(ctx, w, h, t, s, 0);
    var a = t.a;
    var colW = s.narrow ? w - gut * 2 : w * 0.56;
    var y = s.bar + (s.narrow ? 34 : 60) * Math.max(u, 0.6);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    font(ctx, 500, Math.max(11, 14 * u), F_MONO);
    ctx.fillStyle = C.acc; ctx.fillText(a.kicker, gut, y);

    var ts = fitSize(ctx, a.title, 900, F_DISPLAY, (s.narrow ? 46 : 72) * u * (s.narrow ? 1.25 : 1), colW);
    font(ctx, 900, ts, F_DISPLAY);
    ctx.fillStyle = C.ink;
    y += ts * 1.2;
    ctx.fillText(a.title[0], gut, y);
    y += ts * 1.08;
    ctx.fillText(a.title[1], gut, y);
    ctx.fillStyle = C.acc;
    ctx.beginPath(); ctx.arc(gut + ctx.measureText(a.title[1]).width + ts * 0.12, y - ts * 0.1, ts * 0.09, 0, Math.PI * 2); ctx.fill();

    font(ctx, 400, Math.max(12.5, 17 * u), F_SANS);
    ctx.fillStyle = C.ink2;
    var dl = wrap(ctx, a.dek, colW * 0.9);
    y += Math.max(26, 40 * u);
    for (var i = 0; i < dl.length; i++) { ctx.fillText(dl[i], gut, y); y += Math.max(19, 27 * u); }

    var bh = Math.max(34, 46 * u);
    font(ctx, 700, Math.max(12.5, 15 * u), F_SANS);
    var bw = ctx.measureText(a.cta).width + bh * 0.9;
    y += Math.max(6, 12 * u);
    ctx.fillStyle = C.acc; rr(ctx, gut, y, bw, bh, bh / 2); ctx.fill();
    ctx.fillStyle = C.accInk; ctx.textBaseline = 'middle';
    ctx.fillText(a.cta, gut + bh * 0.45, y + bh / 2 + 0.5);
    ctx.textBaseline = 'alphabetic';

    // 底部三格数字
    var sy = h - Math.max(28, 40 * u);
    var sx = gut, cw = s.narrow ? (w - gut * 2) / 3 : Math.min(190 * u, colW / 3);
    ctx.fillStyle = C.line; ctx.fillRect(gut, sy - Math.max(44, 62 * u), s.narrow ? w - gut * 2 : cw * 3, Math.max(1, u));
    for (var k = 0; k < a.stats.length; k++) {
      font(ctx, 800, Math.max(18, 30 * u), F_DISPLAY);
      ctx.fillStyle = k === 1 ? C.acc : C.ink;
      ctx.fillText(a.stats[k][0], sx + k * cw, sy - Math.max(14, 20 * u));
      font(ctx, 400, Math.max(10.5, 13 * u), F_SANS);
      ctx.fillStyle = C.ink3;
      ctx.fillText(a.stats[k][1], sx + k * cw, sy + 2 * u);
    }
  }

  /* 主站同款纸飞机线稿（index.html 里 #plane symbol 的路径，24×24） */
  function planeIcon(ctx, x, y, size, col) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(2.2, 11.6); ctx.lineTo(21.8, 3.2); ctx.lineTo(15.6, 20.6); ctx.lineTo(11.2, 13.4); ctx.closePath();
    ctx.moveTo(11.2, 13.4); ctx.lineTo(21.8, 3.2);
    ctx.moveTo(11.2, 13.4); ctx.lineTo(10.4, 18.6); ctx.lineTo(13.2, 15.9);
    ctx.stroke();
    ctx.restore();
  }

  function pageB(ctx, w, h, t) {
    var s = scale(w, h), u = s.u, gut = s.gut;
    ctx.fillStyle = C.bg2; ctx.fillRect(0, 0, w, h);
    topbar(ctx, w, h, t, s, 2);
    var b = t.b;
    var top = s.bar + Math.max(14, 26 * u), bottom = h - Math.max(14, 26 * u);

    // 精选卡：荧光绿大块
    var cx = gut, cy = top, cw, ch;
    if (s.narrow) { cw = w - gut * 2; ch = (bottom - top) * 0.5; }
    else { cw = w * 0.44; ch = bottom - top; }
    ctx.fillStyle = C.acc; rr(ctx, cx, cy, cw, ch, Math.max(10, 18 * u)); ctx.fill();
    var pad = Math.max(16, 30 * u);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    font(ctx, 600, Math.max(10.5, 13 * u), F_MONO);
    ctx.fillStyle = 'rgba(11,18,5,0.62)';
    ctx.fillText(b.tag, cx + pad, cy + pad + 10 * u);
    planeIcon(ctx, cx + cw - pad - 34 * Math.max(u, 0.7), cy + pad - 6 * u, 34 * Math.max(u, 0.7), C.accInk);
    var ts = fitSize(ctx, b.title, 900, F_DISPLAY, (s.narrow ? 30 : 44) * Math.max(u, 0.8), cw - pad * 2);
    font(ctx, 900, ts, F_DISPLAY);
    ctx.fillStyle = C.accInk;
    var ty = cy + ch - pad - Math.max(70, 96 * u) - ts * 1.1;
    if (s.narrow) ty = cy + ch - pad - Math.max(46, 60 * u) - ts * 1.1;
    ctx.fillText(b.title[0], cx + pad, ty);
    ctx.fillText(b.title[1], cx + pad, ty + ts * 1.12);
    font(ctx, 400, Math.max(11.5, 15 * u), F_SANS);
    ctx.fillStyle = 'rgba(11,18,5,0.72)';
    ctx.fillText(fit(ctx, b.dek, cw - pad * 2), cx + pad, ty + ts * 1.12 + Math.max(24, 34 * u));
    font(ctx, 700, Math.max(12, 14 * u), F_SANS);
    ctx.fillStyle = C.accInk;
    ctx.fillText(b.more, cx + pad, cy + ch - pad + 2 * u);
    ctx.fillStyle = C.accInk;
    ctx.fillRect(cx + pad, cy + ch - pad + 9 * u, ctx.measureText(b.more).width, Math.max(1.5, 2 * u));

    // 右侧（手机为下方）文章列表
    var lx, ly, lw, lh;
    if (s.narrow) { lx = gut; ly = cy + ch + Math.max(14, 20 * u); lw = w - gut * 2; lh = bottom - ly; }
    else { lx = cx + cw + Math.max(24, 48 * u); ly = top; lw = w - gut - lx; lh = bottom - top; }
    font(ctx, 800, Math.max(16, 26 * u), F_DISPLAY);
    ctx.fillStyle = C.ink;
    var hy = ly + Math.max(16, 26 * u);
    ctx.fillText(b.head, lx, hy);
    font(ctx, 500, Math.max(10, 12 * u), F_MONO);
    ctx.fillStyle = C.ink3; ctx.textAlign = 'right';
    ctx.fillText('07 / 07', lx + lw, hy);
    ctx.textAlign = 'left';
    var rows = b.rows, n = s.narrow ? Math.max(3, Math.min(rows.length, Math.floor((lh - 30) / 34))) : rows.length;
    var rh = (lh - (hy - ly) - Math.max(10, 16 * u)) / n;
    var y0 = hy + Math.max(10, 16 * u);
    for (var i = 0; i < n; i++) {
      var ry = y0 + i * rh;
      ctx.fillStyle = C.line; ctx.fillRect(lx, ry, lw, Math.max(1, u));
      var mid = ry + rh / 2;
      ctx.textBaseline = 'middle';
      font(ctx, 500, Math.max(10, 12 * u), F_MONO);
      ctx.fillStyle = i === 0 ? C.acc : C.ink3;
      ctx.fillText('0' + (i + 1), lx, mid);
      font(ctx, 500, Math.max(12.5, 16.5 * u), F_SANS);
      ctx.fillStyle = i === 0 ? C.ink : C.ink2;
      var numW = Math.max(28, 40 * u), yrW = Math.max(36, 52 * u);
      ctx.fillText(fit(ctx, rows[i][0], lw - numW - yrW), lx + numW, mid);
      font(ctx, 400, Math.max(10, 12 * u), F_MONO);
      ctx.fillStyle = C.ink3; ctx.textAlign = 'right';
      ctx.fillText(rows[i][1], lx + lw, mid);
      ctx.textAlign = 'left';
    }
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.line; ctx.fillRect(lx, y0 + n * rh, lw, Math.max(1, u));
  }

  /* 把一张页画到画布上：w/h 是 CSS 像素，dpr 是画布像素倍率 */
  window.Pages = {
    draw: function (canvas, which, w, h, dpr, lang) {
      var W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      var ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.setTransform(W / w, 0, 0, H / h, 0, 0);
      var t = TEXT[lang] || TEXT.zh;
      if (which === 'A') pageA(ctx, w, h, t); else pageB(ctx, w, h, t);
      return true;
    }
  };
})();
