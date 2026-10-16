/* 菜花 · 沉浸式 WebGL 场景
   两块画布：
   - #scene：常驻背景。全屏噪声地形（域扭曲 fbm + 等高线）+ 一万多颗粒子。
     粒子在四种「形」之间插值：A 菜花字形 / B 头像线稿 / C 环（作品页，随音频起伏）/ D 漂移星野。
   - #veil：切换栏目后盖在新内容上溶解掉的一层，纯视觉，不挡路由。
   纯 WebGL 1，没有外部库。拿不到 WebGL、或实测太慢被降级关掉时 Scene.ok = false，页面走 CSS 静态回退。 */
(function () {
  'use strict';

  var Scene = window.Scene = { ok: false, veilOk: false };

  function mq(q) { return window.matchMedia ? window.matchMedia(q) : { matches: false }; }
  var mqReduce = mq('(prefers-reduced-motion: reduce)');
  var mqSmall = mq('(max-width: 760px), (pointer: coarse)');
  var mqDark = mq('(prefers-color-scheme: dark)');
  function reduced() { return !!mqReduce.matches; }
  function small() { return !!mqSmall.matches; }
  function onChange(m, fn) { if (m.addEventListener) m.addEventListener('change', fn); else if (m.addListener) m.addListener(fn); }

  /* ---------- 配色：两套各自调过，不是反色 ---------- */
  var THEMES = {
    dark: {
      bg: [0.024, 0.031, 0.027], edge: [0.004, 0.006, 0.005],
      c1: [0.77, 1.0, 0.23],      // 菜花绿（荧光青柠）
      c2: [1.0, 0.42, 0.24],      // 余烬橙（鼠标与音频的热度）
      c3: [0.90, 0.94, 0.88],     // 骨白
      field1: [0.55, 0.85, 0.20], field2: [1.0, 0.45, 0.22],
      additive: true, alpha: 0.62
    },
    light: {
      bg: [0.905, 0.918, 0.886], edge: [0.80, 0.83, 0.78],
      c1: [0.09, 0.30, 0.13],     // 叶绿墨
      c2: [1.0, 0.33, 0.12],      // 信号橙
      c3: [0.05, 0.10, 0.07],
      field1: [0.36, 0.58, 0.20], field2: [1.0, 0.55, 0.30],
      additive: false, alpha: 0.95
    }
  };
  function theme() { return mqDark.matches ? THEMES.dark : THEMES.light; }

  /* ---------- 着色器 ---------- */
  var NOISE = [
    'float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }',
    'float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < OCT; i++){ v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }'
  ].join('\n');

  var VS_QUAD = 'attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }';

  var FS_BG = [
    'precision mediump float;',
    'uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform float uDim; uniform float uAudio; uniform float uScroll;',
    'uniform vec3 uBg; uniform vec3 uEdge; uniform vec3 uF1; uniform vec3 uF2;',
    NOISE,
    'void main(){',
    '  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;',
    '  float t = uTime * 0.035;',
    '  vec2 m = uMouse; float md = length(p - m);',
    '  vec2 q = vec2(fbm(p * 1.5 + t), fbm(p * 1.5 + vec2(5.2, 1.3) - t));',
    '  q += 0.35 * exp(-md * md * 5.0) * (p - m);',
    '  vec2 r = vec2(fbm(p * 1.25 + 2.0 * q + vec2(1.7, 9.2) + 0.6 * t + uScroll * 0.35), fbm(p * 1.25 + 2.0 * q + vec2(8.3, 2.8) - 0.4 * t));',
    '  float f = fbm(p * 1.1 + 2.4 * r);',
    '  vec3 col = uBg;',
    '  col = mix(col, uF1, smoothstep(0.42, 0.95, f) * 0.20 * uDim * (1.0 + uAudio * 1.5));',
    '  col = mix(col, uF2, smoothstep(0.55, 1.0, r.x) * 0.13 * uDim);',
    '  float iso = abs(fract(f * 10.0 + uScroll * 0.5) - 0.5);',
    '  col = mix(col, uF1, (1.0 - smoothstep(0.0, 0.035, iso)) * 0.07 * uDim);',
    '  col = mix(uEdge, col, smoothstep(1.35, 0.25, length(p * vec2(0.85, 1.0))));',
    '  col += (hash(gl_FragCoord.xy + fract(uTime * 0.37) * 100.0) - 0.5) * 0.03;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var VS_PT = [
    'attribute vec2 aA; attribute vec2 aB; attribute vec4 aS;',
    'uniform float uTime; uniform vec4 uW; uniform float uScatter; uniform vec2 uMouse; uniform float uForce; uniform float uAspect;',
    'uniform vec3 uFitA; uniform vec3 uFitB; uniform vec3 uFitC; uniform float uSize; uniform float uDpr; uniform float uAudio;',
    'varying float vHeat; varying float vSeed;',
    'void main(){',
    '  float t = uTime;',
    '  vec2 a = aA * uFitA.z + uFitA.xy;',
    '  vec2 b = aB * uFitB.z + uFitB.xy;',
    '  float ang = aS.x * 6.28318 + t * 0.06 * (aS.y - 0.5);',
    '  float band = floor(aS.y * 3.0);',
    '  float rr = 0.62 + band * 0.07 + 0.05 * (aS.z - 0.5) + uAudio * 0.22 * sin(ang * (4.0 + band * 2.0) + t * 2.2) * (0.4 + aS.w) + 0.025 * sin(ang * 3.0 + t * 0.7);',
    '  vec2 c = vec2(cos(ang), sin(ang)) * rr * uFitC.z + uFitC.xy;',
    '  vec2 d0 = (aS.xy * 2.0 - 1.0) * vec2(uAspect * 1.08, 1.08);',
    '  vec2 d = d0 + 0.09 * vec2(sin(d0.y * 3.0 + t * 0.21 + aS.z * 6.0), cos(d0.x * 3.0 - t * 0.17 + aS.w * 6.0));',
    '  vec2 p = a * uW.x + b * uW.y + c * uW.z + d * uW.w;',
    '  float n1 = sin(p.y * 4.0 + t * 0.6 + aS.z * 12.0) + sin(p.x * 3.1 - t * 0.4 + aS.w * 9.0);',
    '  float n2 = cos(p.x * 4.3 - t * 0.5 + aS.x * 7.0) + cos(p.y * 2.7 + t * 0.35 + aS.y * 11.0);',
    '  p += vec2(n1, n2) * (0.004 + uScatter * 0.2 * (0.4 + aS.z));',
    '  vec2 dm = p - uMouse; float dd = dot(dm, dm);',
    '  float push = uForce * exp(-dd * 16.0);',
    '  p += normalize(dm + 1e-5) * push * 0.2;',
    '  vHeat = clamp(push * 2.2 + uAudio * uW.z * aS.w, 0.0, 1.0);',
    '  vSeed = aS.w;',
    '  gl_Position = vec4(p.x / uAspect, p.y, 0.0, 1.0);',
    '  gl_PointSize = uSize * uDpr * (0.5 + aS.z * 0.9) * (1.0 + vHeat * 0.8);',
    '}'
  ].join('\n');

  var FS_PT = [
    'precision mediump float;',
    'uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform float uAlpha;',
    'varying float vHeat; varying float vSeed;',
    'void main(){',
    '  float d = length(gl_PointCoord - 0.5);',
    '  float a = smoothstep(0.5, 0.05, d) * uAlpha;',
    '  vec3 col = mix(uC1, uC3, step(0.87, vSeed));',
    '  col = mix(col, uC2, vHeat);',
    '  gl_FragColor = vec4(col * a, a);',
    '}'
  ].join('\n');

  /* 转场：纸飞机（与 _preview/transitions 的 plane 同一套几何）。
     遮罩只有「新页还没被尾流揭开的部分」：主题底色盖在新内容上，飞机从左下飞向右上，
     机尾拖出越拉越宽的尾流，尾流里露出新页；尾流边是细蓝线，中线是虚线航迹。 */
  var FS_VEIL = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform vec2 uRes; uniform float uP; uniform float uSeed; uniform float uPx; uniform vec3 uBg;',
    'const float PI = 3.14159265;',
    'mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }',
    'float sat(float x){ return clamp(x, 0.0, 1.0); }',
    'float seg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = sat(dot(pa, ba) / dot(ba, ba)); return length(pa - ba * h); }',
    'float tri(vec2 p, vec2 a, vec2 b, vec2 c){',
    '  float d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);',
    '  float d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);',
    '  float d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);',
    '  bool neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0, pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;',
    '  return (neg && pos) ? 0.0 : 1.0; }',
    // premultiplied「over」：在 d 上叠一层颜色 c、不透明度 a
    'vec4 over(vec4 d, vec3 c, float a){ a = sat(a); return vec4(c * a + d.rgb * (1.0 - a), a + d.a * (1.0 - a)); }',
    'void main(){',
    '  float W = uRes.x / uRes.y;',
    '  vec2 P = gl_FragCoord.xy / uRes.y;',
    '  float k = uP;',
    '  vec2 P0 = vec2(-0.3, -0.2), P1 = vec2(W + 0.35, 1.22);',
    '  vec2 D = P1 - P0; float Ln = length(D); vec2 dir = D / Ln; vec2 nrm = vec2(-dir.y, dir.x);',
    '  float fk = sat(k / 0.84);',
    '  float fe = pow(fk, 1.3);',
    '  float sp = mix(0.02, 1.14, fe) * Ln;',
    '  float wob = sin(fk * 9.0 + uSeed) * 0.05 * fk;',
    '  vec2 pos = P0 + dir * sp + nrm * (sin(fk * PI) * 0.06 + wob * 0.4);',
    '  vec2 rel = P - P0;',
    '  float t = dot(rel, dir), n = dot(rel, nrm) - sin(fk * PI) * 0.06 * smoothstep(0.0, 0.4, t / Ln);',
    '  float ps = 0.16 * (0.85 + 0.35 * sin(fk * PI));',
    '  float behind = sp - ps * 0.32 - t;',
    '  float spread = pow(smoothstep(0.42, 1.0, k), 1.4) * 1.25;',
    '  float wave = 1.0 + 0.07 * sin(t * 9.0 - k * 7.0 + uSeed) + 0.04 * sin(t * 23.0 + k * 5.0);',
    '  float hw = (behind * 0.3 + spread) * wave;',
    '  float px = uPx / uRes.y;',
    '  float m = smoothstep(-px, px, behind) * smoothstep(hw + px, hw - px, abs(n));',
    '  vec4 o = vec4(uBg * (1.0 - m), 1.0 - m);',
    '  float fade = 1.0 - smoothstep(0.85, 1.0, k);',
    '  vec3 blue = vec3(0.663, 0.753, 0.827);',
    '  float rim = exp(-pow((abs(n) - hw) / (1.3 * px), 2.0)) * step(0.0, behind);',
    '  float lip = smoothstep(hw - 14.0 * px, hw, abs(n)) * m;',
    '  o = over(o, vec3(0.0), 0.3 * lip * fade);',
    '  o = over(o, blue, rim * 0.55 * fade);',
    '  float dash = step(fract(t / (0.032 * ps / 0.16)), 0.3);',
    '  float tl = (1.0 - smoothstep(0.9 * px, 1.8 * px, abs(n))) * dash * step(0.0, behind) * fade;',
    '  o = over(o, blue, tl * 0.85);',
    '  float a0 = atan(10.2, 10.6);',
    '  float ang = atan(dir.y, dir.x) - a0 + wob;',
    '  vec2 v = rot(-ang) * (P - pos) / ps * 24.0;',
    '  vec2 s = vec2(v.x + 12.0, 12.0 - v.y);',
    '  float upx = 24.0 * px / ps;',
    '  vec2 N = vec2(21.8, 3.2), Lw = vec2(2.2, 11.6), Rw = vec2(15.6, 20.6), Cf = vec2(11.2, 13.4);',
    '  vec2 F1 = vec2(10.4, 18.6), F2 = vec2(13.2, 15.9);',
    '  float f1 = tri(s, Lw, N, Cf), f2 = tri(s, N, Rw, Cf), f3 = tri(s, Cf, F1, F2);',
    '  float body = max(f1, max(f2, f3));',
    '  vec3 pc = vec3(0.965, 0.945, 0.906) * (f3 > 0.5 ? 0.72 : (f2 > 0.5 ? 0.84 : 1.0));',
    '  float dl = min(min(seg(s, Lw, N), seg(s, N, Rw)), min(seg(s, Rw, Cf), seg(s, Cf, Lw)));',
    '  dl = min(dl, min(seg(s, Cf, N), min(seg(s, Cf, F1), seg(s, F1, F2))));',
    '  float stroke = 1.0 - smoothstep(0.62 - upx * 0.6, 0.62 + upx * 0.6, dl);',
    '  float vis = step(0.0005, k) * step(fk, 0.999);',
    '  vec2 vs = rot(-ang) * (P - pos - vec2(0.018, -0.03)) / ps * 24.0;',
    '  vec2 ss = vec2(vs.x + 12.0, 12.0 - vs.y);',
    '  float shd = max(tri(ss, Lw, N, Cf), tri(ss, N, Rw, Cf)) * vis;',
    '  o = over(o, vec3(0.0), 0.35 * shd * (1.0 - body));',
    '  o = over(o, pc, body * vis);',
    '  o = over(o, vec3(0.31, 0.435, 0.56), stroke * vis);',
    '  gl_FragColor = o;',
    '}'
  ].join('\n');

  /* ---------- 工具 ---------- */
  function compile(g, type, src) {
    var s = g.createShader(type);
    g.shaderSource(s, src);
    g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) { var log = g.getShaderInfoLog(s); g.deleteShader(s); throw new Error(log); }
    return s;
  }
  function program(g, vs, fs, defs) {
    var head = defs || '';
    var p = g.createProgram();
    g.attachShader(p, compile(g, g.VERTEX_SHADER, vs));
    g.attachShader(p, compile(g, g.FRAGMENT_SHADER, head + fs));
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p));
    p.u = {};
    var n = g.getProgramParameter(p, g.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var info = g.getActiveUniform(p, i); p.u[info.name] = g.getUniformLocation(p, info.name); }
    // attribute 位置也在链接后一次取好：每帧再调 getAttribLocation 可能是一次同步往返，会把主线程卡在 GPU 上
    p.a = {};
    var na = g.getProgramParameter(p, g.ACTIVE_ATTRIBUTES);
    for (var j = 0; j < na; j++) { var ai = g.getActiveAttrib(p, j); p.a[ai.name] = g.getAttribLocation(p, ai.name); }
    return p;
  }
  function getGL(c, opts) {
    try { return c.getContext('webgl', opts) || c.getContext('experimental-webgl', opts); } catch (e) { return null; }
  }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function rand(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

  /* ---------- 状态 ---------- */
  var canvas, gl, pBg, pPt, triBuf, aBuf, bBuf, sBuf;
  var veil, vgl, pVeil, vTri;
  var N = 0, W = 1, H = 1, dpr = 1, aspect = 1;
  var raf = 0, running = false, paused = false, lastT = 0, frameSkip = 0;

  /* ---------- 自适应降级 ----------
     按实测帧率（rAF 回调频率，即主线程 + GPU 的真实吞吐）分档：
     每个测量窗口约 0.8 秒；低于 30fps 降一档（分辨率和粒子数一起降），低于 15fps 一次降两档，
     低于 8fps、或已降过档还低于 15fps、或到最低档仍不够，就整个关掉场景，只留 CSS 静态底图（.no-gl 那一套）。
     只降不升：避免在临界设备上来回抖。 */
  var TIERS = [
    { q: 1, n: 1 },        // 满配
    { q: 0.7, n: 0.6 },    // 分辨率 ×0.7，粒子 60%
    { q: 0.5, n: 0.35 },   // 分辨率 ×0.5，粒子 35%
    { q: 0.35, n: 0.2 }    // 分辨率 ×0.35，粒子 20%
  ];
  var FPS_LOW = 30, FPS_BAD = 15, FPS_DEAD = 8, WARMUP = 400, WINDOW = 800;
  var tier = 0, quality = 1, lite = false;
  var perfStart = 0, perfFrames = 0, perfSkipUntil = 0, lastFps = 0;
  var glyphPts = null, avatarPts = null, avatarUrl = '';
  var mode = 'home', scrollP = 0, avatarP = 0;

  var S = {
    time: 12, w: [1, 0, 0, 0], scatter: 0.0, dim: 1, audio: 0, force: 0,
    mouse: [0, -2], fitA: [0, 0.1, 1], fitB: [0, 0, 0.6], fitC: [0, 0, 1]
  };
  var T = { w: [1, 0, 0, 0], scatter: 0, dim: 1, audio: 0, force: 0, mouse: [0, -2], fitA: [0, 0.1, 1], fitB: [0, 0, 0.6], fitC: [0, 0, 1] };

  /* 每个栏目的场景构图 */
  function layout() {
    var portrait = aspect < 0.9;
    var fitA = portrait ? [0, 0.12, Math.min(aspect * 1.55, 0.6)] : [0, 0.1, Math.min(aspect * 0.78, 1.12)];
    var avatarHome = portrait ? [0, 0.36, Math.min(aspect * 0.8, 0.46)] : [aspect * 0.45, 0, 0.66];
    var avatarAbout = portrait ? [0, 0.47, Math.min(aspect * 0.64, 0.38)] : [aspect * 0.55, 0.02, 0.66];
    var ringFit = portrait ? [0, -0.36, aspect * 0.95] : [aspect * 0.42, 0.02, 0.92];
    var cfg = { w: [0, 0, 0, 1], scatter: 0.05, dim: 1, fitA: fitA, fitB: avatarHome, fitC: ringFit };
    if (mode === 'home') {
      // 滚动推动场景：字形 → 散开成星野 → 聚成头像
      var p = scrollP;
      var toField = Math.min(1, Math.max(0, (p - 0.12) / 0.6));
      var toAvatar = Math.min(1, Math.max(0, avatarP));
      var wa = (1 - toField), wd = toField * (1 - toAvatar), wb = toAvatar;
      cfg.w = [wa, wb, 0, wd];
      cfg.scatter = Math.sin(Math.min(1, toField) * Math.PI) * 0.6 + Math.sin(toAvatar * Math.PI) * 0.4 + 0.02;
      cfg.dim = 1;
    } else if (mode === 'about') {
      cfg.w = [0, 1, 0, 0]; cfg.scatter = 0.03; cfg.fitB = avatarAbout; cfg.dim = 0.8;
    } else if (mode === 'works') {
      cfg.w = [0, 0, 1, 0]; cfg.scatter = 0.06; cfg.dim = 0.9;
    } else if (mode === 'tools') {
      cfg.w = [0, 0, 0, 1]; cfg.scatter = 0.12; cfg.dim = 0.85;
    } else if (mode === 'articles') {
      cfg.w = [0, 0, 0, 1]; cfg.scatter = 0.04; cfg.dim = 0.55;
    } else {
      cfg.w = [0, 0, 0, 1]; cfg.scatter = 0.3; cfg.dim = 0.7;
    }
    return cfg;
  }

  function applyLayout(instant) {
    var c = layout();
    T.w = c.w; T.scatter = c.scatter; T.dim = c.dim; T.fitA = c.fitA; T.fitB = c.fitB; T.fitC = c.fitC;
    if (instant) {
      S.w = c.w.slice(); S.scatter = c.scatter; S.dim = c.dim; S.fitA = c.fitA.slice(); S.fitB = c.fitB.slice(); S.fitC = c.fitC.slice();
    }
  }

  /* ---------- 采样：字形与头像 ---------- */
  // 按权重从画布上撒点：权重越高越密
  function sampleWeights(wt, w, h, n, seed) {
    var cand = [];
    for (var i = 0; i < w * h; i++) if (wt[i] > 0) cand.push(i);
    var out = new Float32Array(n * 2);
    var r = rand(seed);
    var half = Math.max(w, h) / 2;
    if (!cand.length) { for (var k = 0; k < n; k++) { out[k * 2] = (r() - 0.5) * 0.2; out[k * 2 + 1] = (r() - 0.5) * 0.2; } return out; }
    var m = cand.length, got = 0, guard = 0, idx;
    while (got < n && guard < n * 60) {
      guard++;
      idx = cand[Math.floor(r() * m)];
      if (r() > wt[idx]) continue;
      out[got * 2] = ((idx % w) + r() - w / 2) / half;
      out[got * 2 + 1] = -(Math.floor(idx / w) + r() - h / 2) / half;
      got++;
    }
    for (; got < n; got++) { idx = cand[Math.floor(r() * m)]; out[got * 2] = ((idx % w) - w / 2) / half; out[got * 2 + 1] = -(Math.floor(idx / w) - h / 2) / half; }
    return out;
  }

  var GLYPH_FONT = '"Caihua Glyph","Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei","WenQuanYi Zen Hei","Source Han Sans SC",sans-serif';
  var glyphPortrait = null;
  function buildGlyph() {
    var portrait = aspect < 0.9;
    glyphPortrait = portrait;
    var cv = document.createElement('canvas');
    cv.width = portrait ? 220 : 440; cv.height = portrait ? 440 : 220;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 196px ' + GLYPH_FONT;
    if (portrait) { ctx.fillText('菜', 110, 116); ctx.fillText('花', 110, 326); }
    else { ctx.fillText('菜花', 220, 116); }
    var d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    var wt = new Float32Array(cv.width * cv.height);
    for (var i = 0; i < wt.length; i++) wt[i] = d[i * 4 + 3] > 110 ? 1 : 0;
    glyphPts = sampleWeights(wt, cv.width, cv.height, N, 7);
  }

  function buildAvatar(img) {
    var cv = document.createElement('canvas');
    cv.width = 200; cv.height = 200;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 200, 200);
    try { ctx.drawImage(img, 0, 0, 200, 200); } catch (e) {}
    try {
      // 线稿：取亮度梯度（轮廓、眼镜、五官）为主，深色块（头发）和浅色块只撒薄薄一层
      var d = ctx.getImageData(0, 0, 200, 200).data;
      var lum = new Float32Array(200 * 200), wt = new Float32Array(200 * 200);
      for (var i = 0; i < lum.length; i++) lum[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
      for (var y = 1; y < 199; y++) for (var x = 1; x < 199; x++) {
        var k = y * 200 + x;
        var g = Math.abs(lum[k + 1] - lum[k - 1]) + Math.abs(lum[k + 200] - lum[k - 200]);
        var l = lum[k];
        wt[k] = Math.min(1, g * 2.2) + (l < 0.3 ? 0.16 : l < 0.9 ? 0.025 : 0);
        if (wt[k] > 1) wt[k] = 1;
      }
      avatarPts = sampleWeights(wt, 200, 200, N, 11);
    } catch (e) { avatarPts = null; }
  }

  /* ---------- 初始化 ---------- */
  function setupBuffers() {
    N = small() ? 6500 : 16000;
    var r = rand(3);
    var seeds = new Float32Array(N * 4);
    for (var i = 0; i < N * 4; i++) seeds[i] = r();
    sBuf = sBuf || gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sBuf);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    aBuf = aBuf || gl.createBuffer();
    bBuf = bBuf || gl.createBuffer();
    buildGlyph();
    uploadA();
    if (!avatarPts || avatarPts.length !== N * 2) avatarPts = new Float32Array(N * 2);
    uploadB();
  }
  function uploadA() { gl.bindBuffer(gl.ARRAY_BUFFER, aBuf); gl.bufferData(gl.ARRAY_BUFFER, glyphPts, gl.STATIC_DRAW); }
  function uploadB() { gl.bindBuffer(gl.ARRAY_BUFFER, bBuf); gl.bufferData(gl.ARRAY_BUFFER, avatarPts, gl.STATIC_DRAW); }

  function resize() {
    if (!gl || lite) return;
    var cap = small() ? 1.25 : 1.75;
    dpr = Math.min(window.devicePixelRatio || 1, cap) * quality;
    var w = window.innerWidth, h = window.innerHeight;
    // 手机地址栏伸缩时高度会抖，宽度不变就不重建
    W = Math.max(1, Math.round(w * dpr)); H = Math.max(1, Math.round(h * dpr));
    canvas.width = W; canvas.height = H;
    aspect = w / h;
    gl.viewport(0, 0, W, H);
    if (glyphPortrait !== (aspect < 0.9) && N) { buildGlyph(); uploadA(); }
    applyLayout(true);
    if (vgl) {
      var vs = (small() ? 0.75 : 1.0) * Math.max(quality, 0.7);   // 纸飞机着色器很轻，遮罩不必跟着粒子的降档一起糊
      veil.width = Math.max(1, Math.round(w * vs)); veil.height = Math.max(1, Math.round(h * vs));
      vgl.viewport(0, 0, veil.width, veil.height);
    }
    if (!running) requestStatic();
  }

  function attrib(p, name, buf, size) {
    var loc = p.a[name];
    if (loc == null || loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }
  function disable(p, name) { var loc = p.a[name]; if (loc != null && loc >= 0) gl.disableVertexAttribArray(loc); }

  function draw() {
    if (!gl || lite || gl.isContextLost()) return;
    var th = theme();
    // 背景
    gl.disable(gl.BLEND);
    gl.useProgram(pBg);
    attrib(pBg, 'aPos', triBuf, 2);
    gl.uniform2f(pBg.u.uRes, W, H);
    gl.uniform1f(pBg.u.uTime, S.time);
    gl.uniform2f(pBg.u.uMouse, S.mouse[0] * 0.5, S.mouse[1] * 0.5);
    gl.uniform1f(pBg.u.uDim, S.dim);
    gl.uniform1f(pBg.u.uAudio, S.audio);
    gl.uniform1f(pBg.u.uScroll, mode === 'home' ? scrollP : 0);
    gl.uniform3fv(pBg.u.uBg, th.bg); gl.uniform3fv(pBg.u.uEdge, th.edge);
    gl.uniform3fv(pBg.u.uF1, th.field1); gl.uniform3fv(pBg.u.uF2, th.field2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    disable(pBg, 'aPos');

    // 粒子
    gl.enable(gl.BLEND);
    if (th.additive) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(pPt);
    attrib(pPt, 'aA', aBuf, 2); attrib(pPt, 'aB', bBuf, 2); attrib(pPt, 'aS', sBuf, 4);
    gl.uniform1f(pPt.u.uTime, S.time);
    gl.uniform4fv(pPt.u.uW, S.w);
    gl.uniform1f(pPt.u.uScatter, S.scatter);
    gl.uniform2f(pPt.u.uMouse, S.mouse[0], S.mouse[1]);
    gl.uniform1f(pPt.u.uForce, S.force);
    gl.uniform1f(pPt.u.uAspect, aspect);
    gl.uniform3fv(pPt.u.uFitA, S.fitA); gl.uniform3fv(pPt.u.uFitB, S.fitB); gl.uniform3fv(pPt.u.uFitC, S.fitC);
    gl.uniform1f(pPt.u.uSize, (small() ? 2.6 : 2.4) * (th.additive ? 1 : 1.2));
    gl.uniform1f(pPt.u.uDpr, dpr);
    gl.uniform1f(pPt.u.uAudio, S.audio);
    gl.uniform3fv(pPt.u.uC1, th.c1); gl.uniform3fv(pPt.u.uC2, th.c2); gl.uniform3fv(pPt.u.uC3, th.c3);
    gl.uniform1f(pPt.u.uAlpha, th.alpha * (0.55 + 0.45 * S.dim));
    // 按档位只画前一部分粒子（种子是随机的，前 k 颗就是均匀的子集）
    gl.drawArrays(gl.POINTS, 0, Math.max(1, Math.round(N * TIERS[tier].n)));
    disable(pPt, 'aA'); disable(pPt, 'aB'); disable(pPt, 'aS');
  }

  // ?gl=full：关掉自动降级（调试、截图用）；?gl=0：完全不用 WebGL
  var forceFull = /[?&]gl=full\b/.test(location.search);
  function measure(now) {
    if (forceFull) return;
    if (now < perfSkipUntil) { perfStart = 0; return; }
    if (!perfStart) { perfStart = now; perfFrames = 0; return; }
    perfFrames++;
    var el = now - perfStart;
    if (el < WINDOW) return;
    var fps = perfFrames * 1000 / el;
    lastFps = fps;
    perfStart = 0;
    if (fps >= FPS_LOW) return;
    var last = TIERS.length - 1;
    if (fps < FPS_DEAD || tier >= last || (tier > 0 && fps < FPS_BAD)) goLite();
    else setTier(Math.min(last, tier + (fps < FPS_BAD ? 2 : 1)));
  }
  function setTier(t) {
    tier = t;
    quality = TIERS[t].q;
    document.documentElement.setAttribute('data-gl-tier', String(t));
    perfSkipUntil = performance.now() + WARMUP;   // 换档后先让画面稳一下再量
    resize();
  }
  // 最低档：停掉场景和转场，交给 CSS 静态底图；之后不再碰 GPU
  function goLite() {
    lite = true;
    Scene.ok = false; Scene.veilOk = false; Scene.lite = true;
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (vRaf) cancelAnimationFrame(vRaf);
    vRaf = 0;
    if (veil) veil.classList.remove('is-on');
    // 不在这里 loseContext / 改画布尺寸：那两步会同步等 GPU 把积压的帧画完，弱设备上能卡住主线程一两秒。
    // 画布交给 CSS 隐藏（.no-gl .scene），之后不再提交任何绘制。
    var r = document.documentElement;
    r.classList.remove('gl'); r.classList.add('no-gl', 'gl-lite');
    r.setAttribute('data-gl-tier', 'off');
  }

  /* 开场先实测一帧的真实 GPU 耗时（readPixels 会等 GPU 画完）：
     弱设备直接从合适的档位起步，不用先卡几秒再慢慢降。第一帧含着色器编译，量第二帧。 */
  function benchmark() {
    // 减少动态效果时也量：那时每次切栏目都要重画一张静态帧，弱设备上同样会拖住合成
    if (!gl || document.hidden || forceFull) return;
    var px = new Uint8Array(4), ms;
    var BQ = TIERS[TIERS.length - 1].q;   // 在最低分辨率上量，开销按面积（分辨率的平方）折回满配
    quality = BQ; resize();
    try {
      draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      var t0 = performance.now();
      draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      ms = (performance.now() - t0) / (BQ * BQ);
    } catch (e) { ms = 0; }
    Scene.benchMs = Math.round(ms);
    lastFps = ms ? 1000 / ms : 0;
    // 预算比 30fps 的 33ms 紧一半：GPU 之外合成、页面本身也要时间
    var BUDGET = 16;
    for (var t = 0; t < TIERS.length; t++) {
      if (ms * TIERS[t].q * TIERS[t].q <= BUDGET) { setTier(t); return; }
    }
    goLite();
  }

  function step(now) {
    raf = 0;
    if (!running) return;
    raf = requestAnimationFrame(step);
    measure(now);
    if (!running) return;
    // 手机隔帧渲染，约 30fps
    if (small()) { frameSkip = (frameSkip + 1) % 2; if (frameSkip) return; }
    var raw = (now - (lastT || now)) / 1000;
    var dt = Math.min(0.05, raw);
    lastT = now;
    S.time += dt;
    var k = 1 - Math.pow(0.0025, dt);   // 帧率无关的缓动
    var km = 1 - Math.pow(0.0001, dt);
    for (var i = 0; i < 4; i++) S.w[i] = lerp(S.w[i], T.w[i], k);
    for (var j = 0; j < 3; j++) { S.fitA[j] = lerp(S.fitA[j], T.fitA[j], k); S.fitB[j] = lerp(S.fitB[j], T.fitB[j], k); S.fitC[j] = lerp(S.fitC[j], T.fitC[j], k); }
    S.scatter = lerp(S.scatter, T.scatter, k);
    S.dim = lerp(S.dim, T.dim, k);
    S.audio = lerp(S.audio, T.audio, 1 - Math.pow(0.00001, dt));
    S.mouse[0] = lerp(S.mouse[0], T.mouse[0], km); S.mouse[1] = lerp(S.mouse[1], T.mouse[1], km);
    S.force = lerp(S.force, T.force, k);
    T.force *= Math.pow(0.35, dt);      // 鼠标停下，扰动慢慢平息
    if (hudCb) hudCb(S);
    draw();
  }

  function shouldRun() { return Scene.ok && !lite && !reduced() && !paused && !document.hidden; }
  function sync() {
    var want = shouldRun();
    if (want && !running) { running = true; lastT = 0; perfStart = 0; perfSkipUntil = performance.now() + WARMUP; raf = requestAnimationFrame(step); }
    else if (!want && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
    if (!want) requestStatic();
  }
  // 静态帧不在调用方的同步路径里画（例如路由切换），挪到下一帧前统一画一次
  var staticRaf = 0;
  function requestStatic() {
    if (staticRaf || lite || !Scene.ok) return;
    staticRaf = requestAnimationFrame(function () { staticRaf = 0; if (!running) staticFrame(); });
  }
  // 静态画面：减少动态效果时只画这一帧（字形已成形、无鼠标扰动），不是空白
  function staticFrame() {
    if (!Scene.ok || lite) return;
    applyLayout(true);
    if (reduced()) { S.time = 12; S.force = 0; T.force = 0; S.audio = 0; S.mouse = [0, -2]; }
    draw();
  }

  var hudCb = null;

  Scene.init = function (opts) {
    opts = opts || {};
    avatarUrl = opts.avatar || '';
    hudCb = opts.onFrame || null;
    canvas = document.getElementById('scene');
    veil = document.getElementById('veil');
    if (!canvas || /[?&]gl=0\b/.test(location.search)) return false;
    gl = getGL(canvas, { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) return false;
    try {
      var oct = small() ? '3' : '5';
      pBg = program(gl, VS_QUAD, FS_BG, '#define OCT ' + oct + '\n');
      pPt = program(gl, VS_PT, FS_PT);
      triBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var w = window.innerWidth, h = window.innerHeight; aspect = w / h;
      setupBuffers();
    } catch (e) {
      gl = null;
      return false;
    }
    Scene.ok = true;
    document.documentElement.setAttribute('data-gl-tier', '0');

    // 转场画布：失败不影响主场景
    if (veil) {
      vgl = getGL(veil, { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
      if (vgl) {
        try {
          pVeil = program(vgl, VS_QUAD, FS_VEIL);
          vTri = vgl.createBuffer();
          vgl.bindBuffer(vgl.ARRAY_BUFFER, vTri);
          vgl.bufferData(vgl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), vgl.STATIC_DRAW);
          Scene.veilOk = true;
        } catch (e) { vgl = null; }
      }
    }

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      Scene.ok = false; Scene.veilOk = false; running = false;
      document.documentElement.classList.remove('gl');
      document.documentElement.classList.add('no-gl');
    });

    resize();
    benchmark();
    if (lite) return false;
    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', sync);
    onChange(mqReduce, sync);
    onChange(mqDark, function () { if (!running) requestStatic(); });

    // 字体到了再重采一次字形（自带的 1KB 子集，通常很快）
    if (document.fonts && document.fonts.load) {
      document.fonts.load('900 100px "Caihua Glyph"', '菜花').then(function () { buildGlyph(); uploadA(); if (!running) requestStatic(); }, function () {});
    }
    if (avatarUrl) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () { if (lite) return; buildAvatar(img); if (avatarPts) uploadB(); if (!running) requestStatic(); };
      img.src = avatarUrl;
    }

    window.addEventListener('pointermove', function (e) {
      if (reduced() || !running) return;
      var x = (e.clientX / window.innerWidth * 2 - 1) * aspect;
      var y = -(e.clientY / window.innerHeight * 2 - 1);
      var dx = x - T.mouse[0], dy = y - T.mouse[1];
      T.mouse = [x, y];
      T.force = Math.min(1, T.force + Math.sqrt(dx * dx + dy * dy) * 2.2 + 0.02);
    }, { passive: true });

    sync();
    return true;
  };

  Scene.setMode = function (m) {
    mode = m;
    applyLayout(false);
    if (!running) requestStatic();
  };
  Scene.setScroll = function (p, av) {
    scrollP = p;
    avatarP = av || 0;
    if (mode === 'home') { applyLayout(false); if (!running && Scene.ok) requestStatic(); }
  };
  Scene.setAudio = function (v) { T.audio = v; };
  Scene.pause = function (v) { paused = !!v; sync(); };
  Scene.reduced = reduced;
  Scene.small = small;
  Scene.count = function () { return Math.round(N * TIERS[tier].n); };
  Scene.stats = function () { return { bench: Scene.benchMs, tier: lite ? 'off' : tier, fps: Math.round(lastFps * 10) / 10, quality: quality, particles: lite ? 0 : Scene.count() }; };

  /* ---------- 页面转场（纸飞机）----------
     只是盖在新内容上的视觉层：调用时新栏目的 DOM 已经挂好，
     遮罩从「盖满」溶解到「全开」，不回调、不阻塞任何东西。
     掉帧（低于 30fps 或已降档）就直接不放。 */
  var vRaf = 0, vStart = 0, vLast = 0, VEIL_MS = 1150;
  var vSeed = 0;
  function drawVeil(p) {
    var th = theme();
    vgl.clearColor(0, 0, 0, 0);
    vgl.clear(vgl.COLOR_BUFFER_BIT);
    vgl.useProgram(pVeil);
    var loc = pVeil.a.aPos;
    vgl.bindBuffer(vgl.ARRAY_BUFFER, vTri);
    vgl.enableVertexAttribArray(loc);
    vgl.vertexAttribPointer(loc, 2, vgl.FLOAT, false, 0, 0);
    vgl.uniform2f(pVeil.u.uRes, veil.width, veil.height);
    vgl.uniform1f(pVeil.u.uP, p);
    vgl.uniform1f(pVeil.u.uSeed, vSeed);
    vgl.uniform1f(pVeil.u.uPx, veil.width / Math.max(1, window.innerWidth));   // 1 个 CSS 像素 = 几个画布像素
    vgl.uniform3fv(pVeil.u.uBg, th.bg);
    vgl.drawArrays(vgl.TRIANGLES, 0, 3);
  }
  function veilOff() {
    if (vRaf) cancelAnimationFrame(vRaf);
    vRaf = 0; vStart = 0;
    if (veil) veil.classList.remove('is-on');
    if (vgl && !vgl.isContextLost()) { vgl.clearColor(0, 0, 0, 0); vgl.clear(vgl.COLOR_BUFFER_BIT); }
  }
  function veilFrame(now) {
    vRaf = 0;
    if (!vStart) vStart = vLast = now;
    var k = Math.min(1, (now - vStart) / VEIL_MS);
    // 中途掉帧严重（一帧超过 120ms）就直接收掉，不拖着慢动画
    var gap = now - vLast; vLast = now;
    if (k >= 1 || lite || gap > 120) { veilOff(); return; }
    drawVeil(k);
    vRaf = requestAnimationFrame(veilFrame);
  }
  Scene.transition = function () {
    if (!Scene.veilOk || lite || reduced() || !vgl || vgl.isContextLost()) return false;
    if (tier > 0 || (lastFps && lastFps < FPS_LOW)) return false;
    if (vRaf) cancelAnimationFrame(vRaf);
    vStart = 0;
    veil.classList.add('is-on');
    vSeed = Math.random() * 6.0;
    drawVeil(0.0);   // 先盖满（只是排进 GPU 命令，不等它画完）
    vRaf = requestAnimationFrame(veilFrame);
    return true;
  };
})();
