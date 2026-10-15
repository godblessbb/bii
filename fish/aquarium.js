/*
 * 动态鱼缸 —— 一缸 Iwagumi（岩组式）水草造景。
 *
 * 画面分四层，从远到近：
 *   #far      远景：后景水草、远处的小鱼群，低分辨率 + CSS 模糊 + 水色雾化 → 景深
 *   #aquarium 主层：沙床、青龙石、前景水草、草坪、鱼、饵料、气泡、悬浮颗粒、水面
 *   #light    光：WebGL 着色器画的光束和焦散，screen 叠加（见 fish/light.js）
 *   #front    近景：贴着玻璃的失焦水草和光斑
 *
 * 鱼的行为是 Reynolds boids：分离 / 对齐 / 聚拢（只和同种鱼对齐聚拢），加上
 * 前瞻式避障（石头用多边形有符号距离场，边界和沙床用软推力 + 硬约束），
 * 投食后「气味」从落点向外扩散，鱼按距离先后察觉、游过去吃；快速划过会惊散鱼群。
 * 光线和配色随访客本地时间在黎明 / 白天 / 黄昏 / 夜晚之间渐变。
 *
 * 验收探针：window.__aquarium = { snapshot(), feed(x, y) }，直接读模拟状态；
 * feed 与指针点击都走 feedAt()。
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  // ---------- 小工具 ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hex(h) { var n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function mixc(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a == null ? 1 : +a.toFixed(3)) + ')'; }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  // ---------- 时间与配色 ----------
  // 每个时段一套水色、沙色、石色、植物色和光的颜色/强度，按本地时间插值
  var PALETTES = {
    night: { top: '#1b3c5e', mid: '#0b2038', deep: '#040b17', fog: '#0c2340', sandL: '#3d4c5c', sandD: '#121a26',
      stoneL: '#56636f', stoneD: '#141b24', plantA: '#163f48', plantB: '#3d7570', carpet: '#24564f',
      rayCol: [0.50, 0.66, 0.95], ray: 0.38, caus: 0.30, night: 1 },
    dawn: { top: '#a9d2cc', mid: '#3c7389', deep: '#13283c', fog: '#3e6d84', sandL: '#d3ba95', sandD: '#5c4d3d',
      stoneL: '#999690', stoneD: '#2b2e33', plantA: '#356f4b', plantB: '#a8c26d', carpet: '#5e9a52',
      rayCol: [1.0, 0.80, 0.58], ray: 0.80, caus: 0.62, night: 0.12 },
    day: { top: '#bff3e9', mid: '#2a9aa0', deep: '#0b3f52', fog: '#3f9ea6', sandL: '#e6d8b3', sandD: '#7d6c4f',
      stoneL: '#a7aea6', stoneD: '#2c3433', plantA: '#2c8549', plantB: '#a9dc6c', carpet: '#5fae4e',
      rayCol: [0.94, 1.0, 0.88], ray: 0.95, caus: 0.85, night: 0 },
    dusk: { top: '#e6a983', mid: '#4b5e86', deep: '#171f3b', fog: '#5b5c82', sandL: '#caa181', sandD: '#4a3a3c',
      stoneL: '#958889', stoneD: '#272331', plantA: '#38604e', plantB: '#c39e5c', carpet: '#5b7a4c',
      rayCol: [1.0, 0.64, 0.42], ray: 0.78, caus: 0.50, night: 0.32 }
  };
  Object.keys(PALETTES).forEach(function (k) {
    var p = PALETTES[k];
    Object.keys(p).forEach(function (f) { if (typeof p[f] === 'string') p[f] = hex(p[f]); });
  });
  var KEYS = [[0, 'night'], [4.8, 'night'], [6.4, 'dawn'], [8.8, 'day'], [16.2, 'day'], [18.4, 'dusk'], [20.1, 'night'], [24, 'night']];

  function paletteAt(hour) {
    var i = 0;
    while (i < KEYS.length - 2 && hour >= KEYS[i + 1][0]) i++;
    var a = KEYS[i], b = KEYS[i + 1];
    var t = smooth(clamp((hour - a[0]) / (b[0] - a[0]), 0, 1));
    var A = PALETTES[a[1]], B = PALETTES[b[1]], out = {};
    Object.keys(A).forEach(function (f) {
      out[f] = Array.isArray(A[f]) ? mixc(A[f], B[f], t) : lerp(A[f], B[f], t);
    });
    return out;
  }

  var forcedHour = (function () {
    var m = /[?&]hour=([0-9.]+)/.exec(location.search);
    return m ? clamp(parseFloat(m[1]), 0, 23.99) : null;
  })();
  function currentHour() {
    if (forcedHour != null) return forcedHour;
    var d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }

  var LANG = 'zh';
  try { if (localStorage.getItem('datode-lang') === 'en') LANG = 'en'; } catch (e) {}
  var STR = {
    zh: { title: '动态鱼缸', hint: '轻点水中投食 · 快速划过会惊动鱼群', back: '返回 datode 首页',
      periods: ['深夜', '黎明', '清晨', '午后', '黄昏', '夜晚'] },
    en: { title: 'Living fish tank', hint: 'Tap the water to feed · swipe fast to startle the school', back: 'Back to datode',
      periods: ['Small hours', 'Dawn', 'Morning', 'Afternoon', 'Dusk', 'Evening'] }
  };
  function periodIndex(h) { return h < 4.8 ? 0 : h < 7 ? 1 : h < 12 ? 2 : h < 17.5 ? 3 : h < 19.8 ? 4 : h < 23 ? 5 : 0; }

  // ---------- 画布与全局状态 ----------
  var root = document.documentElement;
  var tank = document.getElementById('tank');
  var cvFar = document.getElementById('far');
  var cvMain = document.getElementById('aquarium');
  var cvLight = document.getElementById('light');
  var cvFront = document.getElementById('front');
  var cxFar = cvFar.getContext('2d');
  var cx = cvMain.getContext('2d');
  var cxFront = cvFront.getContext('2d');
  var light = window.AquariumLight ? window.AquariumLight.create(cvLight) : null;
  var staticCv = document.createElement('canvas');
  var sx = staticCv.getContext('2d');

  var W = 0, H = 0, S = 1, DPR = 1;
  var FAR_SCALE = 0.5, FRONT_SCALE = 0.3, lightScale = 0.5;
  var surfaceY = 0, floorBase = 0;
  var FLOOR_STEP = 4, floorTab = new Float32Array(2), mounds = [], dunes = [];
  var stones = [], farPlants = [], midPlants = [], frontPlants = [], carpet = [], bokeh = [];
  var fish = [], farFish = [], food = [], bubbles = [], sparks = [], snow = [], ripples = [], startles = [];
  var pal = paletteAt(currentHour()), palHour = -99, palCheck = 0;
  var envT = 0, simT = 0, foodId = 0;
  var bubbleClock = 0, pearlClock = 0;

  var reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduced = !!(reduceMQ && reduceMQ.matches);
  function motion() { return reduced ? 0.4 : 1; }      // 环境动画（水草、光、颗粒）
  function swimK() { return reduced ? 0.6 : 1; }       // 鱼的巡游速度

  // ---------- 地形 ----------
  function floorAt(x) {
    var f = x / FLOOR_STEP;
    if (f <= 0) return floorTab[0];
    var i = f | 0;
    if (i >= floorTab.length - 1) return floorTab[floorTab.length - 1];
    return lerp(floorTab[i], floorTab[i + 1], f - i);
  }

  function buildTerrain(rng) {
    var portrait = H > W * 1.05;
    surfaceY = Math.round(H * (portrait ? 0.045 : 0.06));
    floorBase = H * (portrait ? 0.83 : 0.8);

    // 青龙石的构图：主石在三分线附近、向一侧倾，副石和配石逐级变小
    var R = portrait ? Math.min(H * 0.1, W * 0.2) : Math.min(H * 0.165, W * 0.105);
    var lay = portrait
      ? [[0.40, 1, -0.10], [0.75, 0.62, 0.14], [0.13, 0.44, 0.22]]
      : [[0.355, 1, -0.14], [0.605, 0.64, 0.12], [0.245, 0.47, 0.24], [0.705, 0.39, -0.08], [0.84, 0.25, 0.18]];
    stones = lay.map(function (l) {
      return { x: l[0] * W, r: R * l[1], lean: l[2], seed: (rng() * 1e9) | 0 };
    });
    mounds = stones.map(function (s) { return { x: s.x, h: s.r * 0.32, w: s.r * 1.9 }; });

    dunes = [];
    for (var i = 0; i < 4; i++) dunes.push({ a: H * 0.006 * (1 + rng()), f: TAU / (W * (0.18 + rng() * 0.5)), p: rng() * TAU });

    var n = Math.ceil(W / FLOOR_STEP) + 2;
    floorTab = new Float32Array(n);
    for (var k = 0; k < n; k++) {
      var x = k * FLOOR_STEP, y = floorBase + (x / W - 0.5) * H * 0.025;
      for (var d = 0; d < dunes.length; d++) y += dunes[d].a * Math.sin(x * dunes[d].f + dunes[d].p);
      for (var m = 0; m < mounds.length; m++) {
        var u = (x - mounds[m].x) / mounds[m].w;
        y -= mounds[m].h * Math.exp(-u * u);
      }
      floorTab[k] = y;
    }

    // 石头：少点数的不规则多边形，画的时候用中点二次曲线收圆角；碰撞用原多边形（略大，更安全）
    stones.forEach(function (s) {
      var r2 = mulberry32(s.seed);
      var rx = s.r * 0.95, ry = s.r * 1.3;
      var cy = floorAt(s.x) - ry * 0.62;
      var N = 9, pts = [], ph1 = r2() * TAU, ph2 = r2() * TAU, maxR = 0;
      var cs = Math.cos(s.lean), sn = Math.sin(s.lean);
      for (var j = 0; j < N; j++) {
        var a = (j / N) * TAU + (r2() - 0.5) * 0.25;
        var k2 = 0.86 + 0.12 * Math.sin(3 * a + ph1) + 0.07 * Math.sin(5 * a + ph2) + (r2() - 0.5) * 0.08;
        var px = Math.cos(a) * rx * k2, py = Math.sin(a) * ry * k2;
        // 顶部收窄一点，石头更像立着的
        if (py < 0) px *= 1 - 0.28 * (-py / ry);
        var qx = px * cs - py * sn, qy = px * sn + py * cs;
        pts.push(s.x + qx, cy + qy);
        maxR = Math.max(maxR, Math.hypot(qx, qy));
      }
      s.poly = pts; s.cx = s.x; s.cy = cy; s.rx = rx; s.ry = ry; s.maxR = maxR;
    });
  }

  // 点到多边形的有符号距离（外正内负）+ 指向外侧的法线
  var sdOut = { d: 0, nx: 0, ny: 0 };
  function sdPoly(px, py, P) {
    var n = P.length / 2, best = 1e18, bx = 0, by = 0, inside = false;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = P[2 * i], yi = P[2 * i + 1], xj = P[2 * j], yj = P[2 * j + 1];
      var ex = xi - xj, ey = yi - yj, wx = px - xj, wy = py - yj;
      var t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
      var qx = xj + ex * t, qy = yj + ey * t, dx = px - qx, dy = py - qy, d2 = dx * dx + dy * dy;
      if (d2 < best) { best = d2; bx = qx; by = qy; }
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    var d = Math.sqrt(best), nx = (px - bx) / (d || 1), ny = (py - by) / (d || 1);
    if (inside) { d = -d; nx = -nx; ny = -ny; }
    sdOut.d = d; sdOut.nx = nx; sdOut.ny = ny;
    return sdOut;
  }

  // ---------- 植物 ----------
  function makeStrand(rng, x, y, h, w, o) {
    return {
      x: x, y: y, h: h, w: w, n: o.n || 9, lean: o.lean || 0,
      ph: rng() * TAU, sp: (0.55 + rng() * 0.5), amp: (o.amp || 0.07) * (0.7 + rng() * 0.6),
      tw: 2 + rng() * 4, hue: rng(), red: !!o.red
    };
  }

  function buildPlants(rng) {
    var portrait = H > W * 1.05, i, x, n;
    farPlants = []; midPlants = []; frontPlants = []; carpet = [];

    // 后景：两侧高的苦草丛 + 主石背后一小丛
    var backY = floorBase - H * 0.035;
    var groups = portrait
      ? [[0.08, 0.10, 10, 0.5], [0.88, 0.12, 12, 0.58], [0.5, 0.12, 6, 0.3]]
      : [[0.05, 0.08, 16, 0.58], [0.93, 0.08, 15, 0.62], [0.43, 0.06, 8, 0.36], [0.68, 0.05, 6, 0.28]];
    groups.forEach(function (g) {
      for (i = 0; i < g[2]; i++) {
        x = (g[0] + (rng() - 0.5) * g[1] * 2) * W;
        var h = H * g[3] * (0.55 + rng() * 0.5);
        farPlants.push(makeStrand(rng, x, backY + rng() * H * 0.02, h, (5 + rng() * 5) * S, { lean: (rng() - 0.5) * 0.35, n: 11, amp: 0.06 }));
      }
    });

    // 中景：石头脚下的小丛，其中一丛偏红（像红宫廷），给冷色画面一个暖点
    stones.forEach(function (s, si) {
      var count = Math.round(3 + rng() * 4 + s.r / (60 * S));
      var side = si % 2 ? 1 : -1;
      for (i = 0; i < count; i++) {
        x = s.x + side * s.rx * (0.6 + rng() * 0.8) + (rng() - 0.5) * s.rx * 0.6;
        if (x < 0 || x > W) continue;
        midPlants.push(makeStrand(rng, x, floorAt(x) + 3 * S, s.r * (0.55 + rng() * 0.75), (2.6 + rng() * 2.6) * S,
          { lean: side * 0.15 + (rng() - 0.5) * 0.4, n: 8, amp: 0.085, red: si === 1 }));
      }
    });

    // 近景：贴着玻璃的大叶，失焦
    var fh = portrait ? 0.24 : 0.42;
    [[-0.01, 0.06], [0.97, 0.05]].forEach(function (g, gi) {
      n = portrait ? 3 : 5;
      for (i = 0; i < n; i++) {
        x = (g[0] + rng() * g[1]) * W;
        frontPlants.push(makeStrand(rng, x, H + 20, H * fh * (0.6 + rng() * 0.5), (16 + rng() * 14) * S,
          { lean: (gi ? -1 : 1) * (0.1 + rng() * 0.25), n: 10, amp: 0.05 }));
      }
    });

    // 草坪：一片片的矮草，石头周围更密
    var step = 2.4 * S;
    for (x = 0; x < W; x += step) {
      var dens = 0.5 + 0.5 * Math.sin(x * 0.0061 + 1.3) * Math.sin(x * 0.0023 + 0.4);
      stones.forEach(function (s) { dens += 0.9 * Math.exp(-Math.pow((x - s.x) / (s.rx * 1.6), 2)); });
      if (dens < 0.42) continue;
      var rows = dens > 0.9 ? 3 : 2;
      for (var r = 0; r < rows; r++) {
        var depth = rng();
        carpet.push({
          x: x + (rng() - 0.5) * step, y: floorAt(x) + 1 + depth * H * 0.035,
          h: (4 + rng() * 8) * S * (0.7 + depth * 0.6) * Math.min(1.25, dens),
          lean: (rng() - 0.5) * 0.5, ph: rng() * TAU, c: (rng() * 3) | 0
        });
      }
    }
    carpet.sort(function (a, b) { return a.y - b.y; });

    bokeh = [];
    n = portrait ? 4 : 7;
    for (i = 0; i < n; i++) bokeh.push({ x: rng() * W, y: rng() * H, r: (30 + rng() * 70) * S, ph: rng() * TAU, a: 0.04 + rng() * 0.06 });
  }

  function current(t, x) {
    // 缓慢的整体水流，让所有水草朝一个方向「呼吸」
    return Math.sin(t * 0.23 + x * 0.0015) * 0.6 + Math.sin(t * 0.071 + 1.7) * 0.4;
  }

  var ribL = [], ribR = [];
  function strandPath(c, s, t, sway) {
    var n = s.n, seg = s.h / n, x = s.x, y = s.y, a = -Math.PI / 2 + s.lean;
    var cur = current(t, s.x) * sway;
    ribL.length = 0; ribR.length = 0;
    for (var i = 0; i <= n; i++) {
      var u = i / n;
      if (i > 0) {
        a += (Math.sin(t * s.sp + s.ph - i * 0.42) * s.amp + cur * 0.035) * (0.35 + u);
        x += Math.cos(a) * seg; y += Math.sin(a) * seg;
      }
      var w = s.w * (1 - 0.82 * u) * (0.4 + 0.6 * Math.abs(Math.cos(u * s.tw + t * 0.25 + s.ph)));
      var nx = -Math.sin(a) * w * 0.5, ny = Math.cos(a) * w * 0.5;
      ribL.push(x + nx, y + ny); ribR.push(x - nx, y - ny);
    }
    c.beginPath();
    c.moveTo(ribL[0], ribL[1]);
    for (i = 1; i < n; i++) {
      c.quadraticCurveTo(ribL[2 * i], ribL[2 * i + 1], (ribL[2 * i] + ribL[2 * i + 2]) / 2, (ribL[2 * i + 1] + ribL[2 * i + 3]) / 2);
    }
    c.lineTo(ribL[2 * n], ribL[2 * n + 1]);
    c.lineTo(ribR[2 * n], ribR[2 * n + 1]);
    for (i = n - 1; i > 0; i--) {
      c.quadraticCurveTo(ribR[2 * i], ribR[2 * i + 1], (ribR[2 * i] + ribR[2 * i - 2]) / 2, (ribR[2 * i + 1] + ribR[2 * i - 1]) / 2);
    }
    c.lineTo(ribR[0], ribR[1]);
    c.closePath();
    s.tipX = x; s.tipY = y;
  }

  function drawStrands(c, list, t, base, tip, alpha, sway) {
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      strandPath(c, s, t, sway);
      var b = s.red ? mixc(base, [150, 50, 40], 0.65) : mixc(base, tip, s.hue * 0.25);
      var e = s.red ? mixc(tip, [235, 110, 70], 0.7) : mixc(tip, base, s.hue * 0.3);
      var g = c.createLinearGradient(s.x, s.y, s.tipX, s.tipY);
      g.addColorStop(0, rgba(b, alpha));
      g.addColorStop(1, rgba(e, alpha));
      c.fillStyle = g;
      c.fill();
    }
  }

  // ---------- 静态层：沙床 + 石头（只在尺寸或时段变化时重画） ----------
  function renderStatic() {
    staticCv.width = Math.max(1, Math.round(W * DPR));
    staticCv.height = Math.max(1, Math.round(H * DPR));
    var c = sx;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, H);
    var rng = mulberry32(7);

    // 沙与水交界处的一层水雾
    var hz = c.createLinearGradient(0, floorBase - H * 0.12, 0, floorBase);
    hz.addColorStop(0, rgba(pal.fog, 0));
    hz.addColorStop(1, rgba(mixc(pal.fog, pal.sandL, 0.3), 0.35));
    c.fillStyle = hz;
    c.fillRect(0, floorBase - H * 0.12, W, H * 0.14);

    // 沙床
    c.beginPath();
    c.moveTo(-10, H + 10);
    for (var x = -10; x <= W + 10; x += 8) c.lineTo(x, floorAt(x));
    c.lineTo(W + 10, H + 10);
    c.closePath();
    var g = c.createLinearGradient(0, floorBase - H * 0.08, 0, H);
    g.addColorStop(0, rgba(pal.sandL));
    g.addColorStop(0.45, rgba(mixc(pal.sandL, pal.sandD, 0.55)));
    g.addColorStop(1, rgba(pal.sandD));
    c.fillStyle = g;
    c.fill();

    // 沙粒
    var grains = Math.round(W * (H - floorBase) / (90 / (S * S) + 40));
    for (var i = 0; i < grains; i++) {
      var gx = rng() * W, gy = floorAt(gx) + rng() * (H - floorAt(gx));
      c.fillStyle = rng() < 0.5 ? rgba(mixc(pal.sandL, [255, 255, 255], 0.3), 0.35) : rgba(pal.sandD, 0.3);
      var gs = (0.6 + rng() * 1.2) * S;
      c.fillRect(gx, gy, gs, gs);
    }

    // 石头的接触阴影
    stones.forEach(function (s) {
      var y = floorAt(s.x) + 2 * S;
      var rg = c.createRadialGradient(s.x, y, 0, s.x, y, s.rx * 1.6);
      rg.addColorStop(0, rgba(pal.sandD, 0.55));
      rg.addColorStop(1, rgba(pal.sandD, 0));
      c.fillStyle = rg;
      c.save();
      c.translate(s.x, y); c.scale(1, 0.28); c.translate(-s.x, -y);
      c.beginPath(); c.arc(s.x, y, s.rx * 1.6, 0, TAU); c.fill();
      c.restore();
    });

    stones.forEach(function (s) { drawStone(c, s); });

    // 前玻璃底部的暗边
    var fg = c.createLinearGradient(0, H * 0.94, 0, H);
    fg.addColorStop(0, 'rgba(0,0,0,0)');
    fg.addColorStop(1, 'rgba(0,0,0,0.28)');
    c.fillStyle = fg;
    c.fillRect(0, H * 0.94, W, H * 0.06);
  }

  // 只在每个顶点附近 22% 处切圆角：边是直的，石头有棱有角
  function polyPath(c, P) {
    var n = P.length / 2, k = 0.22;
    c.beginPath();
    for (var i = 0; i < n; i++) {
      var p = (i + n - 1) % n, q = (i + 1) % n;
      var x = P[2 * i], y = P[2 * i + 1];
      var ax = lerp(x, P[2 * p], k), ay = lerp(y, P[2 * p + 1], k);
      var bx = lerp(x, P[2 * q], k), by = lerp(y, P[2 * q + 1], k);
      if (i === 0) c.moveTo(ax, ay); else c.lineTo(ax, ay);
      c.quadraticCurveTo(x, y, bx, by);
    }
    c.closePath();
  }

  function drawStone(c, s) {
    var r = mulberry32(s.seed + 1);
    c.save();
    polyPath(c, s.poly);
    var g = c.createLinearGradient(s.cx - s.rx * 0.8, s.cy - s.ry, s.cx + s.rx * 0.7, s.cy + s.ry * 0.8);
    g.addColorStop(0, rgba(mixc(pal.stoneL, [255, 255, 255], 0.08)));
    g.addColorStop(0.5, rgba(mixc(pal.stoneL, pal.stoneD, 0.5)));
    g.addColorStop(1, rgba(pal.stoneD));
    c.fillStyle = g;
    c.fill();
    c.clip();

    // 切面：几刀半平面，亮暗交替，做出棱角
    for (var k = 0; k < 6; k++) {
      var px = s.cx + (r() - 0.5) * s.rx, py = s.cy + (r() - 0.5) * s.ry;
      var a = s.lean + (r() - 0.5) * 2.2, dx = Math.cos(a), dy = Math.sin(a), B = s.maxR * 3;
      c.beginPath();
      c.moveTo(px - dx * B, py - dy * B);
      c.lineTo(px + dx * B, py + dy * B);
      c.lineTo(px + dx * B - dy * B, py + dy * B + dx * B);
      c.lineTo(px - dx * B - dy * B, py - dy * B + dx * B);
      c.closePath();
      c.fillStyle = k % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.09)';
      c.fill();
    }

    // 青龙石标志性的白色石筋，斜着走
    var veins = 3 + ((r() * 3) | 0);
    for (k = 0; k < veins; k++) {
      var vx = s.cx + (r() - 0.7) * s.rx, vy = s.cy - s.ry * (0.2 + r() * 0.8);
      var va = s.lean + 0.9 + (r() - 0.5) * 0.5, len = s.ry * (0.12 + r() * 0.12);
      c.beginPath();
      c.moveTo(vx, vy);
      for (var j = 0; j < 9; j++) {
        va += (r() - 0.5) * 0.6;
        vx += Math.cos(va) * len; vy += Math.sin(va) * len;
        c.lineTo(vx, vy);
      }
      c.strokeStyle = 'rgba(232,238,230,' + (0.16 + r() * 0.2).toFixed(2) + ')';
      c.lineWidth = (0.5 + r() * 1.3) * S;
      c.stroke();
    }

    // 斑点
    for (k = 0; k < 40; k++) {
      c.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.10)';
      var dsz = (0.6 + r() * 1.6) * S;
      c.fillRect(s.cx + (r() - 0.5) * s.rx * 2, s.cy + (r() - 0.5) * s.ry * 2, dsz, dsz);
    }

    // 顶光 + 底部环境光遮蔽
    var tg = c.createLinearGradient(0, s.cy - s.ry, 0, s.cy + s.ry * 0.7);
    tg.addColorStop(0, rgba(mixc(pal.top, [255, 255, 255], 0.4), 0.32));
    tg.addColorStop(0.35, rgba(pal.top, 0));
    tg.addColorStop(0.75, 'rgba(0,0,0,0)');
    tg.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = tg;
    c.fillRect(s.cx - s.maxR, s.cy - s.maxR, s.maxR * 2, s.maxR * 2);
    c.restore();
  }

  // ---------- 鱼 ----------
  // len/cruise/max/force 都是 S=1 时的像素值
  var SPECIES = {
    cardinal: { name: 'cardinal', len: 21, cruise: 46, max: 180, force: 300, perc: 72, school: true, agility: 2.6 },
    ember: { name: 'ember', len: 15, cruise: 40, max: 160, force: 280, perc: 60, school: true, agility: 2.8 },
    gourami: { name: 'gourami', len: 76, cruise: 20, max: 90, force: 80, perc: 0, school: false, agility: 1.1 },
    distant: { name: 'distant', len: 13, cruise: 30, max: 90, force: 160, perc: 60, school: true, agility: 2.2 }
  };

  function makeFish(sp, x, y, far) {
    var a = Math.random() * TAU, L = sp.len * S * rnd(0.88, 1.12);
    var f = {
      sp: sp, x: x, y: y, L: L, far: !!far,
      vx: Math.cos(a) * sp.cruise * S, vy: Math.sin(a) * sp.cruise * S * 0.3,
      face: 1, pitch: 0, ph: Math.random() * TAU, wander: 0,
      hunger: rnd(0.55, 1), gulp: 0, tint: rnd(0, 1), dots: null, S0: S
    };
    f.face = f.vx >= 0 ? 1 : -1;
    if (sp === SPECIES.gourami) {
      f.dots = [];
      for (var i = 0; i < 46; i++) f.dots.push(rnd(-0.42, 0.34), rnd(-0.9, 0.9), rnd(0.008, 0.016));
    }
    return f;
  }

  function waterTop(f) { return surfaceY + f.L * 0.45; }
  function waterBottom(f, x) { return f.far ? floorBase - H * 0.08 : floorAt(x) - f.L * 0.4; }

  function randomWaterPoint(f, cxp, cyp, spread) {
    for (var tries = 0; tries < 40; tries++) {
      var x = cxp + (Math.random() - 0.5) * spread * 2, y = cyp + (Math.random() - 0.5) * spread;
      x = clamp(x, f.L, W - f.L);
      y = clamp(y, waterTop(f) + 4, waterBottom(f, x) - 4);
      if (f.far || !insideStone(x, y, f.L * 0.6)) { f.x = x; f.y = y; return; }
    }
    f.x = W * 0.5; f.y = surfaceY + (floorBase - surfaceY) * 0.3;
  }

  function insideStone(x, y, pad) {
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (Math.abs(x - s.cx) > s.maxR + pad || Math.abs(y - s.cy) > s.maxR + pad) continue;
      if (sdPoly(x, y, s.poly).d < pad) return true;
    }
    return false;
  }

  function targetCounts() {
    var area = W * H;
    var card = Math.round(clamp(area / 15500, 26, 96));
    return { cardinal: card, ember: Math.round(clamp(card * 0.22, 7, 20)), gourami: area > 600000 ? 2 : 1,
      distant: Math.round(clamp(area / 40000, 14, 46)) };
  }

  function syncPopulation() {
    var want = targetCounts();
    ['cardinal', 'ember', 'gourami'].forEach(function (name) {
      var sp = SPECIES[name], have = fish.filter(function (f) { return f.sp === sp; });
      var cxp = W * rnd(0.25, 0.75), cyp = surfaceY + (floorBase - surfaceY) * rnd(0.3, 0.55);
      for (var i = have.length; i < want[name]; i++) {
        var f = makeFish(sp, 0, 0, false);
        randomWaterPoint(f, cxp, cyp, sp.school ? Math.min(W, H) * 0.22 : W * 0.4);
        fish.push(f);
      }
      for (i = have.length; i > want[name]; i--) fish.splice(fish.indexOf(have[i - 1]), 1);
    });
    var sp = SPECIES.distant;
    while (farFish.length < want.distant) {
      var f2 = makeFish(sp, 0, 0, true);
      randomWaterPoint(f2, W * 0.6, surfaceY + (floorBase - surfaceY) * 0.35, Math.min(W, H) * 0.25);
      farFish.push(f2);
    }
    farFish.length = want.distant;
    // 小鱼画在大鱼前面
    fish.sort(function (a, b) { return (a.sp === SPECIES.gourami ? 0 : 1) - (b.sp === SPECIES.gourami ? 0 : 1); });
  }

  function constrain(f) {
    var half = f.L * 0.5;
    if (f.x < half) { f.x = half; if (f.vx < 0) f.vx *= -0.3; }
    if (f.x > W - half) { f.x = W - half; if (f.vx > 0) f.vx *= -0.3; }
    var top = waterTop(f), bot = waterBottom(f, f.x);
    if (f.y < top) { f.y = top; if (f.vy < 0) f.vy *= -0.3; }
    if (f.y > bot) { f.y = bot; if (f.vy > 0) f.vy *= -0.3; }
    if (f.far) return;
    var pad = f.L * 0.42;
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (Math.abs(f.x - s.cx) > s.maxR + pad || Math.abs(f.y - s.cy) > s.maxR + pad) continue;
      var r = sdPoly(f.x, f.y, s.poly);
      if (r.d < pad) {
        f.x += r.nx * (pad - r.d); f.y += r.ny * (pad - r.d);
        var vn = f.vx * r.nx + f.vy * r.ny;
        if (vn < 0) { f.vx -= vn * r.nx * 1.2; f.vy -= vn * r.ny * 1.2; }
      }
    }
    // 推出石头后可能又碰到沙床
    bot = waterBottom(f, f.x);
    if (f.y > bot) f.y = bot;
  }

  function mouthOf(f) {
    var d = f.face >= 0 ? 1 : -1;
    return [f.x + d * Math.cos(f.pitch) * f.L * 0.5, f.y + Math.sin(f.pitch) * f.L * 0.5];
  }

  function updateFish(f, list, dt) {
    var sp = f.sp, L = f.L;
    var cruise = sp.cruise * S * swimK(), maxs = sp.max * S;
    var spd = Math.hypot(f.vx, f.vy) || 1;
    var hx = f.vx / spd, hy = f.vy / spd;

    // 漫游：前进方向上加一点慢慢变化的偏转
    f.wander = clamp(f.wander + (Math.random() - 0.5) * dt * 4, -1, 1);
    var wa = f.wander * 0.5, cw = Math.cos(wa), sw = Math.sin(wa);
    var ux = hx * cw - hy * sw, uy = (hx * sw + hy * cw) * 0.75; // 鱼偏爱水平游
    var excite = 0;

    // 群体：只和同种鱼对齐、聚拢；分离对所有鱼
    if (list.length > 1) {
      var perc = sp.perc * S, perc2 = perc * perc;
      var cxs = 0, cys = 0, avx = 0, avy = 0, cn = 0, sepx = 0, sepy = 0;
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o === f) continue;
        var dx = o.x - f.x, dy = o.y - f.y, d2 = dx * dx + dy * dy;
        if (sp.school && o.sp === sp && d2 < perc2) { cxs += o.x; cys += o.y; avx += o.vx; avy += o.vy; cn++; }
        var sd = (L + o.L) * (o.sp.school ? 0.62 : 0.75);
        if (d2 < sd * sd && d2 > 1e-4) {
          var d = Math.sqrt(d2), k = (sd - d) / sd;
          sepx -= dx / d * k; sepy -= dy / d * k;
        }
        // 小鱼给大鱼让路，鱼群会从它身边分开再合拢
        if (sp.school && !o.sp.school) {
          var fr = o.L * 1.3;
          if (d2 < fr * fr) { var dd = Math.sqrt(d2) || 1, kk = 1 - dd / fr; ux -= dx / dd * kk * 2.2; uy -= dy / dd * kk * 2.2; excite += kk * 0.6; }
        }
      }
      if (cn > 0) {
        var am = Math.hypot(avx, avy) || 1;
        ux += avx / am * 1.15; uy += avy / am * 1.15;
        var tx = cxs / cn - f.x, ty = cys / cn - f.y, tm = Math.hypot(tx, ty) || 1;
        var ck = Math.min(1, tm / (perc * 0.5)) * 0.7;
        ux += tx / tm * ck; uy += ty / tm * ck;
      }
      ux += sepx * 2.4; uy += sepy * 2.4;
    }

    // 边界：看向前方 0.7 秒的位置，越靠边推得越重
    var look = 0.7, px = f.x + f.vx * look, py = f.y + f.vy * look;
    var m = Math.max(60 * S, L * 2.4);
    var top = waterTop(f) + m * 0.5, bot = waterBottom(f, clamp(px, 0, W)) - m * 0.5;
    if (px < m) ux += Math.pow((m - px) / m, 2) * 3;
    if (px > W - m) ux -= Math.pow((px - (W - m)) / m, 2) * 3;
    if (py < top) uy += Math.min(3, Math.pow((top - py) / m, 2) * 4 + 0.3);
    if (py > bot) uy -= Math.min(3, Math.pow((py - bot) / m, 2) * 4 + 0.3);

    // 石头：前瞻点进入安全距离就沿法线推开，再给一点切向，绕着走而不是顶住
    if (!f.far) {
      var sm = Math.max(26 * S, L * 1.6);
      for (i = 0; i < stones.length; i++) {
        var s = stones[i];
        var qx = f.x + f.vx * 0.45, qy = f.y + f.vy * 0.45;
        if (Math.abs(qx - s.cx) > s.maxR + sm || Math.abs(qy - s.cy) > s.maxR + sm) continue;
        var r = sdPoly(qx, qy, s.poly);
        if (r.d < sm) {
          var k2 = Math.pow((sm - Math.max(r.d, -sm)) / sm, 2);
          var tnx = -r.ny, tny = r.nx;
          if (tnx * f.vx + tny * f.vy < 0) { tnx = -tnx; tny = -tny; }
          ux += (r.nx * 2.6 + tnx * 1.2) * k2; uy += (r.ny * 2.6 + tny * 1.2) * k2;
        }
      }
    }

    // 惊吓：快速划过的地方，附近的鱼猛地散开
    for (i = 0; i < startles.length; i++) {
      var st = startles[i], age = simT - st.t;
      if (age > 1.2) continue;
      var sx2 = f.x - st.x, sy2 = f.y - st.y, sd2 = Math.hypot(sx2, sy2) || 1;
      var rr = st.r * (f.far ? 0.6 : 1) * (0.85 + f.tint * 0.3);
      if (sd2 < rr) {
        var kf = (1 - sd2 / rr) * (1 - age / 1.2);
        ux += sx2 / sd2 * kf * 4.5; uy += sy2 / sd2 * kf * 4.5;
        excite = Math.max(excite, kf * 2);
      }
    }

    // 觅食：饵料的「气味」以 notice 速度从落点扩散，鱼按距离先后察觉
    var want = cruise * (1 + excite);
    if (!f.far && food.length && f.hunger > 0.15) {
      var mo = mouthOf(f), best = null, bd = 1e18, notice = 460 * S;
      for (i = 0; i < food.length; i++) {
        var p = food[i];
        var fx = p.x - mo[0], fy = p.y - mo[1], fd = Math.hypot(fx, fy);
        if (simT - p.born < fd / notice) continue;
        if (fd < bd) { bd = fd; best = p; }
      }
      if (best) {
        var fdx = best.x - mo[0], fdy = best.y - mo[1], fm = bd || 1;
        var pull = 2.6 + f.hunger * 2;
        ux += fdx / fm * pull; uy += fdy / fm * pull;
        want = Math.max(want, lerp(cruise, maxs * 0.72, Math.min(1, f.hunger + 0.3)) * clamp(fm / (L * 2.5), 0.4, 1));
        if (fm < L * 0.3 + best.r + 3 * S) eat(f, best);
      }
    }

    // 期望速度 → 转向加速度（限幅）
    var um = Math.hypot(ux, uy) || 1;
    want = Math.min(want, maxs);
    var ax = (ux / um * want - f.vx) * sp.agility, ay = (uy / um * want - f.vy) * sp.agility;
    var am2 = Math.hypot(ax, ay), lim = sp.force * S * (1 + excite);
    if (am2 > lim) { ax *= lim / am2; ay *= lim / am2; }
    f.vx += ax * dt; f.vy += ay * dt;
    spd = Math.hypot(f.vx, f.vy);
    var minS = cruise * (sp.school ? 0.35 : 0.12);
    if (spd > maxs) { f.vx *= maxs / spd; f.vy *= maxs / spd; spd = maxs; }
    else if (spd < minS) { var g2 = minS / (spd || 1); f.vx = (f.vx || 0.01) * g2; f.vy *= g2; spd = minS; }

    f.x += f.vx * dt; f.y += f.vy * dt;
    constrain(f);

    // 姿态：朝向用平滑过的左右翻转（转身时身体会「变窄」），俯仰角限幅
    var target = f.vx > cruise * 0.15 ? 1 : f.vx < -cruise * 0.15 ? -1 : (f.face >= 0 ? 1 : -1);
    f.face += clamp(target - f.face, -dt * 5, dt * 5);
    var pt = clamp(Math.atan2(f.vy, Math.abs(f.vx) + 1e-3), -0.7, 0.7);
    f.pitch += (pt - f.pitch) * Math.min(1, dt * 6);
    var beat = sp === SPECIES.gourami ? 1.2 : 2.4;
    f.ph += dt * TAU * (beat + 2.6 * spd / (sp.cruise * S)) * (reduced ? 0.6 : 1);
    f.hunger = Math.min(1, f.hunger + dt / 50);
    f.gulp = Math.max(0, f.gulp - dt * 3);
  }

  function eat(f, p) {
    var i = food.indexOf(p);
    if (i < 0) return;
    food.splice(i, 1);
    f.hunger = Math.max(0, f.hunger - 0.65);
    f.gulp = 1;
    var n = reduced ? 2 : 5;
    for (var k = 0; k < n; k++) {
      sparks.push({ x: p.x, y: p.y, vx: rnd(-14, 14) * S, vy: rnd(-16, 6) * S, life: 0, max: rnd(0.5, 1.1),
        r: rnd(0.6, 1.3) * S, c: [235, 170, 110], glow: false });
    }
    bubbles.push({ x: p.x, y: p.y - 2, r: rnd(1, 1.8) * S, vy: 10 * S, ph: Math.random() * TAU });
  }

  // ---------- 投食（指针点击和 __aquarium.feed 都走这里） ----------
  function feedAt(x, y) {
    x = +x; y = +y;
    if (!isFinite(x) || !isFinite(y)) return null;
    x = clamp(x, 6, W - 6);
    y = clamp(y, surfaceY + 3, floorAt(x) - 4);
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      var r = sdPoly(x, y, s.poly);
      if (r.d < 3) { x += r.nx * (3 - r.d); y += r.ny * (3 - r.d); }
    }
    var p = { id: ++foodId, x: x, y: y, vx: 0, vy: 4 * S, r: rnd(2.9, 3.7) * S, born: simT, ph: Math.random() * TAU,
      rot: Math.random() * TAU, rest: 0 };
    food.push(p);
    if (food.length > 36) food.shift();

    // 落点一圈小水花；靠近水面时水面荡开一道涟漪；夜里还会激起一点生物荧光
    if (y < surfaceY + H * 0.12) ripples.push({ x: x, t: envT });
    var n = reduced ? 3 : 8, glow = pal.night > 0.4;
    for (var k = 0; k < n; k++) {
      var a = Math.random() * TAU, v = rnd(8, 26) * S;
      sparks.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rnd(0.5, 1.2),
        r: rnd(0.6, 1.4) * S, c: glow ? [120, 255, 230] : [235, 248, 255], glow: glow });
    }
    quietPlate();
    return { id: p.id, x: p.x, y: p.y };
  }

  function startle(x, y) {
    startles.push({ x: x, y: y, t: simT, r: 140 * S });
    if (startles.length > 8) startles.shift();
    if (pal.night > 0.4 && !reduced) {
      for (var k = 0; k < 6; k++) {
        sparks.push({ x: x + rnd(-20, 20) * S, y: y + rnd(-20, 20) * S, vx: rnd(-6, 6) * S, vy: rnd(-6, 6) * S,
          life: 0, max: rnd(0.8, 1.8), r: rnd(0.8, 1.8) * S, c: [110, 245, 230], glow: true });
      }
    }
  }

  // ---------- 每帧推进 ----------
  function step(dt) {
    var mk = motion();
    envT += dt * mk;
    simT += dt;

    for (var i = 0; i < fish.length; i++) updateFish(fish[i], fish, dt);
    for (i = 0; i < farFish.length; i++) updateFish(farFish[i], farFish, dt);

    // 饵料：缓慢下沉、轻轻打旋，落到沙上停住，30 秒没吃就慢慢消失
    for (i = food.length - 1; i >= 0; i--) {
      var p = food[i];
      var fl = floorAt(p.x) - p.r;
      if (p.y < fl) {
        p.vy = lerp(p.vy, 17 * S * (reduced ? 0.7 : 1), Math.min(1, dt * 1.5));
        p.x += Math.sin(p.ph + simT * 1.7) * 5 * S * dt;
        p.y += p.vy * dt;
        p.rot += dt * 1.2;
        for (var k = 0; k < stones.length; k++) {
          var r = sdPoly(p.x, p.y, stones[k].poly);
          if (r.d < p.r) { p.x += r.nx * (p.r - r.d); p.y += r.ny * (p.r - r.d); p.vy *= 0.6; }
        }
        p.x = clamp(p.x, 4, W - 4);
      } else {
        p.y = fl; p.rest += dt;
        if (p.rest > 30) food.splice(i, 1);
      }
    }

    // 气泡：右侧一串扩散器气泡（成簇、有节奏）+ 水草叶尖偶尔冒出的光合作用小气泡
    var srcX = W * (H > W ? 0.9 : 0.885);
    bubbleClock -= dt * mk;
    if (bubbleClock <= 0) {
      var pulse = 0.5 + 0.5 * Math.sin(envT * 0.6);
      bubbles.push({ x: srcX + rnd(-2, 2) * S, y: floorAt(srcX) - 3 * S, r: rnd(1.3, 3.4) * S, vy: 18 * S, ph: Math.random() * TAU });
      bubbleClock = lerp(0.6, 0.12, pulse) * (reduced ? 2.5 : 1);
    }
    pearlClock -= dt * mk;
    if (pearlClock <= 0 && midPlants.length) {
      var s = midPlants[(Math.random() * midPlants.length) | 0];
      if (s.tipX != null) bubbles.push({ x: s.tipX, y: s.tipY, r: rnd(0.8, 1.5) * S, vy: 6 * S, ph: Math.random() * TAU });
      pearlClock = rnd(0.25, 0.9) * (reduced ? 3 : 1);
    }
    for (i = bubbles.length - 1; i >= 0; i--) {
      var b = bubbles[i];
      b.vy = Math.min(b.vy + dt * 60 * S, (40 + b.r * 16) * S);
      b.y -= b.vy * dt * mk;
      b.x += Math.sin(b.ph + envT * 7) * 6 * S * dt * mk;
      b.r += dt * 0.12 * S;
      if (b.y < surfaceY + b.r) {
        if (b.r > 2 * S) ripples.push({ x: b.x, t: envT, small: true });
        bubbles.splice(i, 1);
      }
    }
    if (bubbles.length > 260) bubbles.splice(0, bubbles.length - 260);

    for (i = sparks.length - 1; i >= 0; i--) {
      var sp = sparks[i];
      sp.life += dt;
      if (sp.life > sp.max) { sparks.splice(i, 1); continue; }
      sp.x += sp.vx * dt; sp.y += sp.vy * dt;
      sp.vx *= 1 - dt * 2.5; sp.vy *= 1 - dt * 2.5;
      sp.vy += 4 * S * dt;
    }
    for (i = ripples.length - 1; i >= 0; i--) if (envT - ripples[i].t > (ripples[i].small ? 1.2 : 2.4)) ripples.splice(i, 1);
    for (i = startles.length - 1; i >= 0; i--) if (simT - startles[i].t > 1.2) startles.splice(i, 1);

    // 悬浮颗粒随水流漂
    for (i = 0; i < snow.length; i++) {
      var q = snow[i];
      q.x += (current(envT, q.y) * 7 + Math.sin(envT * 0.4 + q.ph) * 3) * S * dt * q.z * mk;
      q.y += (2.5 + Math.sin(envT * 0.3 + q.ph * 2) * 2) * S * dt * q.z * mk;
      if (q.x < -4) q.x += W + 8; else if (q.x > W + 4) q.x -= W + 8;
      if (q.y > H + 4) { q.y = surfaceY; q.x = Math.random() * W; }
    }
  }

  // ---------- 画鱼 ----------
  var CARD_X = [0.5, 0.3, 0.1, -0.1, -0.3, -0.45], CARD_H = [0.025, 0.118, 0.135, 0.11, 0.068, 0.042];
  var GOUR_X = [0.5, 0.33, 0.13, -0.07, -0.25, -0.38], GOUR_H = [0.035, 0.17, 0.235, 0.235, 0.165, 0.08];
  var spineY = [0, 0, 0, 0, 0, 0];

  function bodyPath(c, xs, hs, L, ph, amp) {
    for (var i = 0; i < 6; i++) spineY[i] = Math.sin(ph - i * 0.85) * L * amp * Math.pow(i / 5, 1.5);
    c.beginPath();
    c.moveTo(xs[0] * L + L * 0.02, spineY[0]);
    var i2;
    for (i2 = 1; i2 < 6; i2++) {
      var x0 = xs[i2 - 1] * L, x1 = xs[i2] * L;
      c.quadraticCurveTo(x0, spineY[i2 - 1] - hs[i2 - 1] * L, (x0 + x1) / 2, (spineY[i2 - 1] - hs[i2 - 1] * L + spineY[i2] - hs[i2] * L) / 2);
    }
    c.lineTo(xs[5] * L, spineY[5] - hs[5] * L);
    c.lineTo(xs[5] * L, spineY[5] + hs[5] * L);
    for (i2 = 5; i2 > 0; i2--) {
      var a0 = xs[i2] * L, a1 = xs[i2 - 1] * L;
      c.quadraticCurveTo(a0, spineY[i2] + hs[i2] * L, (a0 + a1) / 2, (spineY[i2] + hs[i2] * L + spineY[i2 - 1] + hs[i2 - 1] * L) / 2);
    }
    c.quadraticCurveTo(xs[0] * L, spineY[0] + hs[0] * L, xs[0] * L + L * 0.02, spineY[0]);
    c.closePath();
  }

  function tailPath(c, xs, hs, L, spread, len) {
    var bx = xs[5] * L, by = spineY[5];
    var a = Math.atan2(spineY[5] - spineY[4], (xs[5] - xs[4]) * L) - Math.PI; // 指向尾后
    var ca = Math.cos(a), sa = Math.sin(a);
    function P(u, v) { return [bx - (u * ca - v * sa) * L, by - (u * sa + v * ca) * L]; }
    var t1 = P(len, -spread), nn = P(len * 0.62, 0), t2 = P(len, spread);
    c.beginPath();
    c.moveTo(bx, by - hs[5] * L * 0.9);
    c.quadraticCurveTo((bx + t1[0]) / 2, (by + t1[1]) / 2 - L * 0.02, t1[0], t1[1]);
    c.quadraticCurveTo(nn[0], nn[1] - L * 0.02, nn[0], nn[1]);
    c.quadraticCurveTo(nn[0], nn[1] + L * 0.02, t2[0], t2[1]);
    c.quadraticCurveTo((bx + t2[0]) / 2, (by + t2[1]) / 2 + L * 0.02, bx, by + hs[5] * L * 0.9);
    c.closePath();
  }

  function drawSmallFish(c, f, night) {
    var L = f.L, ember = f.sp === SPECIES.ember;
    var g = c.createLinearGradient(0, -L * 0.14, 0, L * 0.14);
    if (ember) {
      g.addColorStop(0, '#9c3a1c');
      g.addColorStop(0.4, '#f0702e');
      g.addColorStop(0.75, '#ff9a4f');
      g.addColorStop(1, '#ffc896');
    } else {
      // 红绿灯鱼：深色背、会随角度变色的霓虹蓝带、整条红腹
      var irid = 0.5 + 0.5 * Math.sin(f.ph * 0.06 + f.x * 0.004 + f.tint * 6);
      var neon = mixc([70, 235, 255], [90, 120, 255], irid);
      neon = mixc(neon, [180, 255, 255], night * 0.3);
      g.addColorStop(0, '#1b3236');
      g.addColorStop(0.33, '#2d5650');
      g.addColorStop(0.4, rgba(neon));
      g.addColorStop(0.53, rgba(mixc(neon, [255, 255, 255], 0.25)));
      g.addColorStop(0.6, '#d5332e');
      g.addColorStop(1, '#f47a5e');
    }
    // 尾鳍（bodyPath 顺带算出脊柱位置，尾鳍跟着最后一节摆）
    bodyPath(c, CARD_X, CARD_H, L, f.ph, 0.075);
    tailPath(c, CARD_X, CARD_H, L, 0.11, 0.17);
    c.fillStyle = ember ? 'rgba(255,120,60,0.55)' : 'rgba(225,70,60,0.5)';
    c.fill();
    // 背鳍
    c.beginPath();
    c.moveTo(0.02 * L, spineY[2] - 0.13 * L);
    c.lineTo(-0.1 * L, spineY[3] - 0.21 * L);
    c.lineTo(-0.12 * L, spineY[3] - 0.1 * L);
    c.closePath();
    c.fillStyle = ember ? 'rgba(255,150,90,0.45)' : 'rgba(220,240,240,0.28)';
    c.fill();
    // 身体
    bodyPath(c, CARD_X, CARD_H, L, f.ph, 0.075);
    c.fillStyle = g;
    c.fill();
    if (!ember && night > 0.05) {
      // 夜里霓虹带自己发光
      c.globalCompositeOperation = 'lighter';
      c.beginPath();
      c.moveTo(0.34 * L, spineY[1] - 0.02 * L);
      for (var i = 2; i < 6; i++) c.lineTo(CARD_X[i] * L, spineY[i] - 0.02 * L);
      c.strokeStyle = 'rgba(80,220,255,' + (0.5 * night).toFixed(3) + ')';
      c.lineWidth = Math.max(1, L * 0.07);
      c.stroke();
      c.globalCompositeOperation = 'source-over';
    }
    // 眼睛
    if (L > 10) {
      var ex = 0.36 * L, ey = spineY[1] * 0.4 - 0.015 * L, er = Math.max(0.9, L * 0.048);
      c.fillStyle = 'rgba(220,230,230,0.8)';
      c.beginPath(); c.arc(ex, ey, er * 1.25, 0, TAU); c.fill();
      c.fillStyle = '#0a1012';
      c.beginPath(); c.arc(ex, ey, er, 0, TAU); c.fill();
    }
  }

  function drawGourami(c, f, night) {
    var L = f.L;
    bodyPath(c, GOUR_X, GOUR_H, L, f.ph, 0.05);
    // 长长的腹鳍须，带一点拖尾延迟
    var w = Math.sin(f.ph * 0.5);
    c.beginPath();
    c.moveTo(0.2 * L, spineY[2] + 0.17 * L);
    c.quadraticCurveTo(-0.05 * L, 0.36 * L + w * 0.04 * L, -0.42 * L, 0.3 * L + Math.sin(f.ph * 0.5 - 1) * 0.07 * L);
    c.moveTo(0.18 * L, spineY[2] + 0.17 * L);
    c.quadraticCurveTo(-0.02 * L, 0.33 * L - w * 0.03 * L, -0.35 * L, 0.36 * L + Math.sin(f.ph * 0.5 - 1.6) * 0.06 * L);
    c.strokeStyle = 'rgba(245,205,150,0.75)';
    c.lineWidth = Math.max(0.8, L * 0.011);
    c.stroke();
    // 背鳍、臀鳍、尾鳍：半透明，边缘随摆动起伏
    c.beginPath();
    c.moveTo(-0.02 * L, spineY[3] - 0.22 * L);
    c.quadraticCurveTo(-0.22 * L, spineY[4] - 0.36 * L, -0.42 * L, spineY[5] - 0.2 * L + w * 0.03 * L);
    c.lineTo(-0.3 * L, spineY[5] - 0.06 * L);
    c.closePath();
    c.fillStyle = 'rgba(205,195,175,0.38)';
    c.fill();
    c.beginPath();
    c.moveTo(0.12 * L, spineY[2] + 0.2 * L);
    c.quadraticCurveTo(-0.15 * L, spineY[4] + 0.38 * L + w * 0.03 * L, -0.43 * L, spineY[5] + 0.24 * L);
    c.lineTo(-0.3 * L, spineY[5] + 0.05 * L);
    c.closePath();
    c.fillStyle = 'rgba(232,170,115,0.42)';
    c.fill();
    tailPath(c, GOUR_X, GOUR_H, L, 0.16, 0.24);
    c.fillStyle = 'rgba(210,200,180,0.42)';
    c.fill();

    bodyPath(c, GOUR_X, GOUR_H, L, f.ph, 0.05);
    var g = c.createLinearGradient(0, -0.24 * L, 0, 0.24 * L);
    g.addColorStop(0, '#59544b');
    g.addColorStop(0.45, '#b4ab98');
    g.addColorStop(0.75, '#e6c597');
    g.addColorStop(1, '#f0a868');
    c.fillStyle = g;
    c.fill();
    c.save();
    c.clip();
    // 珍珠斑
    c.fillStyle = 'rgba(255,250,235,0.7)';
    var d = f.dots;
    for (var i = 0; i < d.length; i += 3) {
      var ux = d[i], seg = clamp(Math.round((0.5 - ux) / 0.18), 0, 5);
      c.beginPath();
      c.arc(ux * L, spineY[seg] + d[i + 1] * GOUR_H[seg] * L, d[i + 2] * L, 0, TAU);
      c.fill();
    }
    // 侧线的深色带
    c.beginPath();
    c.moveTo(0.3 * L, spineY[1]);
    for (i = 2; i < 6; i++) c.lineTo(GOUR_X[i] * L, spineY[i] + Math.sin(i * 2.1) * 0.012 * L);
    c.strokeStyle = 'rgba(35,32,28,0.32)';
    c.lineWidth = L * 0.03;
    c.stroke();
    c.restore();
    // 眼睛
    var ex = 0.37 * L, ey = spineY[1] - 0.03 * L;
    c.fillStyle = '#d58a3e';
    c.beginPath(); c.arc(ex, ey, L * 0.045, 0, TAU); c.fill();
    c.fillStyle = '#0d0f10';
    c.beginPath(); c.arc(ex, ey, L * 0.03, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.beginPath(); c.arc(ex + L * 0.01, ey - L * 0.012, L * 0.009, 0, TAU); c.fill();
  }

  function drawFarFish(c, f, col) {
    var L = f.L;
    bodyPath(c, CARD_X, CARD_H, L, f.ph, 0.07);
    tailPath(c, CARD_X, CARD_H, L, 0.1, 0.16);
    c.fillStyle = col;
    c.fill();
    bodyPath(c, CARD_X, CARD_H, L, f.ph, 0.07);
    c.fill();
  }

  function placeFish(c, f) {
    var fs = Math.abs(f.face) < 0.18 ? (f.face < 0 ? -0.18 : 0.18) : f.face;
    c.translate(f.x, f.y);
    c.scale(fs, 1 + f.gulp * 0.06);
    c.rotate(f.pitch);
  }

  // ---------- 渲染 ----------
  function renderFar() {
    var c = cxFar, t = envT;
    c.setTransform(FAR_SCALE, 0, 0, FAR_SCALE, 0, 0);
    c.clearRect(0, 0, W, H);

    // 远处的沙丘
    c.beginPath();
    c.moveTo(0, H);
    for (var x = 0; x <= W + 20; x += 20) {
      c.lineTo(x, floorBase - H * 0.05 - Math.sin(x * 0.004 + 1.1) * H * 0.02 - Math.sin(x * 0.0013) * H * 0.03);
    }
    c.lineTo(W, H);
    c.closePath();
    var dg = c.createLinearGradient(0, floorBase - H * 0.1, 0, floorBase + H * 0.05);
    dg.addColorStop(0, rgba(mixc(pal.sandL, pal.fog, 0.7), 0));
    dg.addColorStop(0.5, rgba(mixc(pal.sandL, pal.fog, 0.62), 0.85));
    dg.addColorStop(1, rgba(mixc(pal.sandL, pal.fog, 0.5)));
    c.fillStyle = dg;
    c.fill();

    drawStrands(c, farPlants, t, mixc(pal.plantA, pal.deep, 0.25), pal.plantB, 0.95, 1);

    var col = rgba(mixc(mixc(pal.deep, pal.fog, 0.5), [200, 210, 220], 0.15), 0.9);
    for (var i = 0; i < farFish.length; i++) {
      c.save();
      placeFish(c, farFish[i]);
      drawFarFish(c, farFish[i], col);
      c.restore();
    }

    // 水色雾：远景整体被水「吃掉」一部分颜色
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = rgba(pal.fog, 0.42);
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
  }

  function renderMain() {
    var c = cx, t = envT, night = pal.night, i;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, H);
    c.drawImage(staticCv, 0, 0, W, H);

    drawStrands(c, midPlants, t, pal.plantA, pal.plantB, 1, 1.2);

    // 草坪：按三种颜色各一条路径批量画
    for (i = 0; i < 3; i++) {
      c.beginPath();
      for (var j = 0; j < carpet.length; j++) {
        var b = carpet[j];
        if (b.c !== i) continue;
        var sw = b.lean + Math.sin(t * 1.1 + b.ph + b.x * 0.01) * 0.18 + current(t, b.x) * 0.08;
        c.moveTo(b.x, b.y);
        c.quadraticCurveTo(b.x + sw * b.h * 0.3, b.y - b.h * 0.6, b.x + sw * b.h, b.y - b.h);
      }
      c.strokeStyle = rgba(i === 0 ? mixc(pal.carpet, pal.plantA, 0.5) : i === 1 ? pal.carpet : mixc(pal.carpet, pal.plantB, 0.45));
      c.lineWidth = 1.5 * S;
      c.lineCap = 'round';
      c.stroke();
    }

    // 鱼
    for (i = 0; i < fish.length; i++) {
      var f = fish[i];
      c.save();
      placeFish(c, f);
      if (f.sp === SPECIES.gourami) drawGourami(c, f, night); else drawSmallFish(c, f, night);
      c.restore();
    }

    // 饵料
    for (i = 0; i < food.length; i++) {
      var p = food[i], fade = p.rest > 27 ? (30 - p.rest) / 3 : 1;
      // 柔和的光晕，让小小的饵料在水里一眼可见
      var hg = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
      hg.addColorStop(0, rgba([255, 220, 160], (0.3 + 0.25 * night) * fade));
      hg.addColorStop(1, rgba([255, 220, 160], 0));
      c.fillStyle = hg;
      c.beginPath(); c.arc(p.x, p.y, p.r * 4, 0, TAU); c.fill();
      c.save();
      c.translate(p.x, p.y); c.rotate(p.rot);
      c.fillStyle = rgba([214, 120, 52], 0.95 * fade);
      c.beginPath(); c.ellipse(0, 0, p.r, p.r * 0.72, 0, 0, TAU); c.fill();
      c.fillStyle = rgba([255, 214, 150], 0.8 * fade);
      c.beginPath(); c.arc(-p.r * 0.3, -p.r * 0.25, p.r * 0.35, 0, TAU); c.fill();
      c.restore();
    }

    // 气泡
    c.lineWidth = Math.max(0.7, 0.8 * S);
    for (i = 0; i < bubbles.length; i++) {
      var bb = bubbles[i];
      c.beginPath(); c.arc(bb.x, bb.y, bb.r, 0, TAU);
      c.fillStyle = 'rgba(255,255,255,0.08)'; c.fill();
      c.strokeStyle = 'rgba(225,250,255,0.55)'; c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.fillRect(bb.x - bb.r * 0.45, bb.y - bb.r * 0.5, Math.max(0.8, bb.r * 0.35), Math.max(0.8, bb.r * 0.35));
    }

    // 悬浮颗粒
    c.fillStyle = rgba(mixc(pal.top, [255, 255, 255], 0.5), 0.35);
    for (i = 0; i < snow.length; i++) {
      var q = snow[i], qs = q.z * 1.6 * S;
      c.fillRect(q.x, q.y, qs, qs);
    }

    // 水花 / 碎屑 / 夜光
    for (i = 0; i < sparks.length; i++) {
      var sp = sparks[i], a = 1 - sp.life / sp.max;
      if (sp.glow) {
        c.globalCompositeOperation = 'lighter';
        c.fillStyle = rgba(sp.c, 0.18 * a);
        c.beginPath(); c.arc(sp.x, sp.y, sp.r * 4, 0, TAU); c.fill();
      }
      c.fillStyle = rgba(sp.c, 0.8 * a);
      c.beginPath(); c.arc(sp.x, sp.y, sp.r, 0, TAU); c.fill();
      c.globalCompositeOperation = 'source-over';
    }

    // 水面：从下往上看到的一条亮带 + 起伏的水线 + 涟漪
    var sg = c.createLinearGradient(0, 0, 0, surfaceY + 6 * S);
    sg.addColorStop(0, rgba(mixc(pal.top, [255, 255, 255], 0.35), 0.55));
    sg.addColorStop(1, rgba(pal.top, 0.05));
    c.fillStyle = sg;
    c.fillRect(0, 0, W, surfaceY + 6 * S);
    c.beginPath();
    for (var x = 0; x <= W + 12; x += 12) {
      var y = surfaceY + Math.sin(x * 0.011 + t * 0.9) * 2 * S + Math.sin(x * 0.029 - t * 1.3) * 1.1 * S;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = 1.2 * S;
    c.stroke();
    for (i = 0; i < ripples.length; i++) {
      var rp = ripples[i], life = rp.small ? 1.2 : 2.4, u = (t - rp.t) / life;
      var rad = (rp.small ? 14 : 46) * S * (0.2 + u);
      c.beginPath();
      c.ellipse(rp.x, surfaceY + 1, rad, rad * 0.16, 0, 0, TAU);
      c.strokeStyle = 'rgba(255,255,255,' + (0.5 * (1 - u)).toFixed(3) + ')';
      c.lineWidth = 1 * S;
      c.stroke();
    }
  }

  function renderFront() {
    var c = cxFront, t = envT;
    c.setTransform(FRONT_SCALE, 0, 0, FRONT_SCALE, 0, 0);
    c.clearRect(0, 0, W, H);
    drawStrands(c, frontPlants, t * 0.7, mixc(pal.plantA, [0, 0, 0], 0.55), mixc(pal.plantA, pal.deep, 0.3), 0.92, 0.8);
    for (var i = 0; i < bokeh.length; i++) {
      var b = bokeh[i];
      var x = b.x + Math.sin(t * 0.05 + b.ph) * 40 * S, y = b.y + Math.cos(t * 0.04 + b.ph) * 30 * S;
      var g = c.createRadialGradient(x, y, 0, x, y, b.r);
      g.addColorStop(0, rgba(mixc(pal.top, [255, 255, 255], 0.5), b.a * (1 - pal.night * 0.6)));
      g.addColorStop(1, rgba(pal.top, 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, b.r, 0, TAU); c.fill();
    }
  }

  var lightParams = { aspect: 1, surface: 0.06, floor: 0.8, rayCol: [1, 1, 1], ray: 1, caus: 1 };
  function renderLight() {
    if (!light) return;
    lightParams.aspect = W / H;
    lightParams.surface = surfaceY / H;
    lightParams.floor = (floorBase - H * 0.02) / H;
    lightParams.rayCol = pal.rayCol;
    lightParams.ray = pal.ray * (reduced ? 0.8 : 1);
    lightParams.caus = pal.caus;
    light.render(envT, lightParams);
  }

  function render() {
    var half = quality >= 2 && (frameNo & 1);
    if (!half) renderFar();
    renderMain();
    if (quality < 3 && !half) renderLight();
    if (quality < 3) renderFront();
  }

  // ---------- 时段 ----------
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  var timeEl = document.getElementById('plate-time');
  function applyPalette(force) {
    var h = currentHour();
    if (!force && Math.abs(h - palHour) < 0.05) return;
    palHour = h;
    pal = paletteAt(h);
    root.style.setProperty('--water-top', rgba(pal.top));
    root.style.setProperty('--water-mid', rgba(pal.mid));
    root.style.setProperty('--water-deep', rgba(pal.deep));
    if (themeMeta) themeMeta.setAttribute('content', rgba(pal.deep));
    if (timeEl) timeEl.textContent = STR[LANG].periods[periodIndex(h)];
    if (W > 0) renderStatic();
  }

  // ---------- 尺寸 ----------
  function resize() {
    var nw = Math.max(1, window.innerWidth || root.clientWidth || 1);
    var nh = Math.max(1, window.innerHeight || root.clientHeight || 1);
    var ow = W, oh = H, oSurf = surfaceY, oFloor = floorBase;
    W = nw; H = nh;
    S = clamp(Math.min(W, H * 1.25) / 1000, 0.6, 1.35);
    // 主层像素预算约 600 万，2560 宽的屏也不会被高 DPR 拖垮
    DPR = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6e6 / (W * H)));
    if (quality >= 3) DPR = Math.min(DPR, quality >= 4 ? 0.75 : 1);
    DPR = Math.max(DPR, 0.5);
    cvMain.width = Math.round(W * DPR); cvMain.height = Math.round(H * DPR);
    cvFar.width = Math.round(W * FAR_SCALE); cvFar.height = Math.round(H * FAR_SCALE);
    cvFront.width = Math.max(1, Math.round(W * FRONT_SCALE)); cvFront.height = Math.max(1, Math.round(H * FRONT_SCALE));
    lightScale = Math.min(0.5, Math.sqrt(1.1e6 / (W * H))) * (quality >= 1 ? 0.6 : 1);
    if (light) light.resize(W, H, lightScale);

    var rng = mulberry32(20261015);
    buildTerrain(rng);
    buildPlants(rng);
    renderStatic();

    // 已有的鱼按比例搬到新尺寸里，再按新面积补齐或减少
    if (ow > 0) {
      var remap = function (f) {
        f.x = f.x * W / ow;
        f.y = surfaceY + (f.y - oSurf) * (floorBase - surfaceY) / Math.max(1, oFloor - oSurf);
        f.L = f.L / f.S0 * S; f.S0 = S;
        constrain(f);
        if (!f.far && insideStone(f.x, f.y, f.L * 0.4)) randomWaterPoint(f, f.x, f.y, Math.min(W, H) * 0.3);
      };
      fish.forEach(remap); farFish.forEach(remap);
      food.forEach(function (p) { p.x = clamp(p.x * W / ow, 4, W - 4); p.y = Math.min(p.y * H / oh, floorAt(p.x) - p.r); });
      bubbles.length = 0; ripples.length = 0;
    }
    syncPopulation();

    var want = Math.round(clamp(W * H / 9000, 40, 320) * (reduced ? 0.5 : 1));
    while (snow.length < want) snow.push({ x: Math.random() * W, y: surfaceY + Math.random() * (H - surfaceY), z: rnd(0.3, 1), ph: Math.random() * TAU });
    snow.length = want;
    snow.forEach(function (q) { if (q.x > W) q.x = Math.random() * W; if (q.y > H) q.y = Math.random() * H; });
  }

  function syncSize() {
    if ((window.innerWidth || 1) !== W || (window.innerHeight || 1) !== H) resize();
  }

  // ---------- 主循环（标签页不可见时完全停掉） ----------
  // 模拟按真实时间分步推进（每步 ≤ 1/30 秒），慢机器上鱼也按真实速度游；
  // 画面按帧时逐级降级：先去掉 CSS 模糊、降低光层分辨率，再隔帧画光和远景，最后关掉光层、降 DPR。
  var raf = 0, last = 0, running = false, frameNo = 0;
  var quality = 0, frameEMA = 16, slowFor = 0, lastDegrade = 0;
  var lockQuality = /[?&]hq\b/.test(location.search);
  function degrade() {
    quality++;
    if (quality === 1) { tank.classList.add('q-lite'); lightScale *= 0.6; if (light) light.resize(W, H, lightScale); }
    if (quality === 3) { tank.classList.add('q-nolight'); DPR = Math.min(DPR, 1); cvMain.width = Math.round(W * DPR); cvMain.height = Math.round(H * DPR); renderStatic(); }
    if (quality === 4) { DPR = 0.75; cvMain.width = Math.round(W * DPR); cvMain.height = Math.round(H * DPR); renderStatic(); snow.length = Math.round(snow.length / 2); }
  }
  function frame(now) {
    raf = 0;
    if (!running) return;
    var elapsed = last ? Math.min(0.25, Math.max(0, (now - last) / 1000)) : 1 / 60;
    last = now;
    frameNo++;
    palCheck -= elapsed;
    if (palCheck <= 0) { applyPalette(false); palCheck = 20; }
    var n = Math.max(1, Math.ceil(elapsed * 30 - 1e-6)), sub = elapsed / n;
    for (var i = 0; i < n; i++) step(sub);
    render();

    if (!lockQuality && quality < 4 && frameNo > 8) {
      frameEMA = lerp(frameEMA, elapsed * 1000, 0.25);
      slowFor = frameEMA > 30 ? slowFor + elapsed : 0;
      if (slowFor > 1 && now - lastDegrade > 1200) {
        degrade();
        if (frameEMA > 90 && quality < 3) degrade();
        lastDegrade = now; slowFor = 0;
      }
    }
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (running || document.hidden) return;
    running = true; last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', start);
  window.addEventListener('resize', function () { syncSize(); if (!running) render(); });

  if (reduceMQ) {
    var onReduce = function () {
      reduced = reduceMQ.matches;
      var want = Math.round(clamp(W * H / 9000, 40, 320) * (reduced ? 0.5 : 1));
      while (snow.length < want) snow.push({ x: Math.random() * W, y: surfaceY + Math.random() * (H - surfaceY), z: rnd(0.3, 1), ph: Math.random() * TAU });
      snow.length = want;
    };
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onReduce);
    else if (reduceMQ.addListener) reduceMQ.addListener(onReduce);
  }

  // ---------- 交互：轻点投食，快速划过惊散 ----------
  var down = null, lastMove = null, lastStartle = 0, fastRun = 0;
  function pos(e) {
    var r = tank.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  tank.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return;
    var p = pos(e);
    down = { id: e.pointerId, x: p[0], y: p[1], t: performance.now(), moved: 0 };
    lastMove = { x: p[0], y: p[1], t: performance.now() };
  });
  window.addEventListener('pointermove', function (e) {
    var p = pos(e), now = performance.now();
    if (lastMove) {
      var dt = Math.max(1, now - lastMove.t), dd = Math.hypot(p[0] - lastMove.x, p[1] - lastMove.y);
      var v = dd / dt; // px/ms
      var thresh = e.pointerType === 'mouse' && !down ? 2.4 : 1.3;
      // 至少连续两次快速移动才算「划过」：单次瞬移（触屏点到另一处、程序化点击）不吓鱼
      fastRun = v > thresh && dt < 120 ? fastRun + 1 : 0;
      if (fastRun >= 2 && now - lastStartle > 90 && p[1] > surfaceY) { startle(p[0], p[1]); lastStartle = now; }
      if (down && down.id === e.pointerId) down.moved += dd;
    }
    lastMove = { x: p[0], y: p[1], t: now };
  }, { passive: true });
  window.addEventListener('pointerup', function (e) {
    if (!down || down.id !== e.pointerId) return;
    var d = down;
    down = null;
    if (d.moved < 14 && performance.now() - d.t < 700) {
      var p = pos(e);
      feedAt(p[0], p[1]);
    }
  });
  window.addEventListener('pointercancel', function () { down = null; });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'f' || e.key === 'F') feedAt(W * rnd(0.2, 0.8), surfaceY + H * 0.05);
  });

  // ---------- 说明牌 ----------
  var plate = document.getElementById('plate');
  function quietPlate() {
    if (plate && !plate.classList.contains('is-quiet')) plate.classList.add('is-quiet');
  }
  (function initPlate() {
    var s = STR[LANG];
    if (LANG === 'en') root.setAttribute('lang', 'en');
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = s[el.getAttribute('data-i18n')]; });
    var back = document.querySelector('.plate-back');
    if (back) back.setAttribute('aria-label', s.back);
    cvMain.setAttribute('aria-label', LANG === 'en'
      ? 'A planted Iwagumi aquarium where a school of cardinal tetras and a few ember tetras swim between stones.'
      : cvMain.getAttribute('aria-label'));
    setTimeout(quietPlate, 9000);
  })();

  // ---------- 启动 ----------
  applyPalette(true);
  resize();
  render();
  start();

  // ---------- 验收探针：读的是模拟本身的状态 ----------
  window.__aquarium = {
    snapshot: function () {
      syncSize();
      return {
        width: W,
        height: H,
        fish: fish.map(function (f) { return { x: f.x, y: f.y }; }),
        food: food.map(function (p) { return { x: p.x, y: p.y }; })
      };
    },
    feed: function (x, y) { return feedAt(x, y); }
  };
})();
