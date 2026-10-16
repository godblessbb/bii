/* 转场预览 · WebGL 效果层
   一张全屏三角形 + 每个效果一段片元着色器。两张页（2D 画布）上传成纹理 uFrom / uTo，
   着色器只拿「进度 uP（0..1）」「确定性时间 uT」「起点 uO」「随机种子 uSeed」算出这一帧，
   所以同一组参数永远画出同一帧 —— 冻结帧就是直接用 URL 里的进度画一次。
   纯 WebGL 1，不用扩展；拿不到上下文或编译失败时 FX.ok = false，页面直接换页。 */
(function () {
  'use strict';

  var FX = window.FX = { ok: false };

  var VS = 'attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }';

  /* ---- burn：逐字照抄 js/gl.js 的 FS_VEIL（同一套噪声、阈值、两圈边光、mediump），
     唯一区别是主站把它当透明层盖在新页上，这里在着色器里自己把它叠到 uTo 上（同一个 premultiplied over）。 */
  var BURN_NOISE = [
    'float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }',
    'float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < OCT; i++){ v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }'
  ].join('\n');
  var FS_BURN = [
    '#define OCT 4',
    'precision mediump float;',
    'uniform vec2 uRes; uniform float uP; uniform float uDir; uniform float uTime; uniform vec3 uBg; uniform vec3 uEdge; uniform vec3 uEdge2;',
    'uniform sampler2D uTo;',
    BURN_NOISE,
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;',
    '  vec2 w = vec2(fbm(p * 1.8 + uTime * 0.4), fbm(p * 1.8 + vec2(3.1, 7.7) - uTime * 0.3));',
    '  float n = fbm(p * 2.4 + 1.6 * w);',
    '  float g = mix(1.0 - uv.y, uv.y, uDir);',
    '  float field = g * 0.75 + n * 0.55;',
    '  float th = uP * 1.42 - 0.08;',
    '  float cover = 1.0 - smoothstep(th - 0.012, th + 0.012, field);',
    '  float e = exp(-pow((field - th) * 26.0, 2.0)) * step(0.001, uP) * step(uP, 0.999);',
    '  float e2 = exp(-pow((field - th + 0.05) * 18.0, 2.0)) * step(0.001, uP) * step(uP, 0.999);',
    '  vec3 col = uBg;',
    '  col = mix(col, uEdge2, e2 * 0.8);',
    '  col = mix(col, uEdge, e);',
    '  float a = clamp(max(cover, max(e, e2 * 0.8)), 0.0, 1.0);',
    '  vec3 base = texture2D(uTo, uv).rgb;',
    '  gl_FragColor = vec4(col * a + base * (1.0 - a), 1.0);',
    '}'
  ].join('\n');

  /* ---- 其余 7 个效果共用的头 ---- */
  var HEAD = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform sampler2D uFrom; uniform sampler2D uTo;',
    'uniform vec2 uRes; uniform float uP; uniform float uT; uniform vec2 uO; uniform float uSeed; uniform float uPx;',
    'const float PI = 3.14159265;',
    'float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }',
    'float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }',
    'float n1(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(vec2(i, 7.1)), hash(vec2(i + 1.0, 7.1)), f); }',
    'vec3 A(vec2 uv){ return texture2D(uFrom, uv).rgb; }',
    'vec3 B(vec2 uv){ return texture2D(uTo, uv).rgb; }',
    'mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }',
    'float sat(float x){ return clamp(x, 0.0, 1.0); }',
    'float farCorner(vec2 o){ return max(max(length(o), length(o - vec2(uRes.x, 0.0))), max(length(o - vec2(0.0, uRes.y)), length(o - uRes))); }',
    'const vec3 LIME = vec3(0.769, 1.0, 0.227);',
    ''
  ].join('\n');

  /* ---- ink：墨滴从起点扩散，外缘是毛细「指头」和纸纤维渗开的毛边，
     前沿过后整片墨盖住时底下换成新页；随后墨从里往外被纸吸干，干的边上留一圈潮痕。 */
  var FS_INK = HEAD + [
    'void main(){',
    '  float S = uRes.y;',
    '  vec2 q = (gl_FragCoord.xy - uO) / S;',
    '  float d = length(q);',
    '  vec2 dir = q / max(d, 1e-4);',
    '  float Rm = farCorner(uO) / S;',
    '  float fin = Rm * 1.3 + 0.16;',
    '  float x = sat(uP / 0.95);',
    '  float front = fin * (0.06 + 0.94 * pow(x, 0.92));',
    '  vec2 sd = vec2(uSeed * 13.1, uSeed * 7.3);',
    // 大的花瓣状起伏 + 径向毛细指头（只跟方向有关 → 放射状）
    '  float lobes = (fbm(dir * 1.6 + sd) - 0.5) * 0.36;',
    '  float fing = pow(noise(dir * 22.0 + sd + 3.0), 3.0) * 0.55 + pow(noise(dir * 61.0 + sd), 4.0) * 0.45;',
    '  float grain = fbm(q * 70.0 + sd);',
    '  float rE = front * (1.0 + lobes);',
    '  float reach = front * (0.05 + 0.13 * fing) * smoothstep(0.0, 0.25, front);',
    // 毛边：从 rE 往外 reach 这一段，墨被纸纤维吸着往外走，浓度随纹理掉下去
    '  float edge = (d - rE) / max(reach, 1e-4);',
    '  float body = 1.0 - smoothstep(-0.5 / S * uPx / max(reach, 1e-4), 0.0, d - rE);',
    '  float bleed = sat(1.0 - edge) * smoothstep(0.25, 0.75, grain + 0.35 * (1.0 - edge)) * step(0.0, edge);',
    '  float inkA = max(body, bleed * 0.85);',
    // 吸干：从起点往外，带大块的不均匀
    '  float Dn = 1.75 * pow(sat((uP - 0.22) / 0.78), 1.1);',
    '  float v = d / max(Rm, 0.2) * 0.72 + fbm(q * 3.2 + sd + 11.0) * 0.55 + (grain - 0.5) * 0.08;',
    '  float safe = smoothstep(rE - 0.025, rE - 0.07, d);',
    '  float dry = smoothstep(v - 0.015, v + 0.07, Dn) * safe;',
    '  float tide = exp(-pow((Dn - v - 0.006) / 0.012, 2.0)) * safe * step(0.001, Dn);',
    '  float swap = step(d, rE - 0.02);',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  vec3 pg = mix(A(uv), B(uv), swap);',
    // 湿痕：前沿外面一圈纸被潮气洇暗
    '  float wet = smoothstep(rE + reach + 0.06, rE + reach * 0.5, d) * (1.0 - swap);',
    '  pg *= 1.0 - 0.35 * wet;',
    // 墨色：边缘积墨更深更饱和，里面浅一些，带纸纹
    '  float pool = smoothstep(rE - 0.07, rE, d);',
    '  vec3 inkC = mix(vec3(0.085, 0.16, 0.035), vec3(0.15, 0.27, 0.05), smoothstep(0.3, 0.75, grain));',
    '  inkC = mix(inkC, vec3(0.34, 0.52, 0.07), pool * 0.8);',
    '  inkC = mix(inkC, LIME * 0.85, sat(edge + 0.6) * step(-0.6, edge) * bleed * 0.6);',
    '  inkC = mix(inkC, LIME * 0.8, tide * 0.9);',
    '  float a = inkA * (1.0 - dry);',
    '  a = max(a, tide * 0.85);',
    // 吸干后留一点浅浅的渍，越到最后越淡
    '  float stain = dry * (1.0 - smoothstep(0.6, 0.98, uP)) * 0.16 * (0.6 + 0.8 * grain);',
    '  vec3 col = mix(pg, inkC, a);',
    '  col = mix(col, vec3(0.2, 0.32, 0.06), stain);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ---- brush：一笔粗毛笔从左往右横扫（笔头圆鼓、整笔略带弧度），
     笔画带上下毛边，笔毛之间的空隙就是飞白（还看得见旧页），越靠笔画边缘飞白越多、过一会儿才被后面的笔毛补满；
     湿墨只挂在笔头，扫过的地方露出新页，最后笔锋收尾把上下边也扫满。 */
  var FS_BRUSH = HEAD + [
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  float W = uRes.x / uRes.y;',
    '  vec2 P = gl_FragCoord.xy / uRes.y;',
    '  float k = uP;',
    '  float e = k < 0.5 ? 4.0 * k * k * k : 1.0 - pow(-2.0 * k + 2.0, 3.0) / 2.0;',
    '  e = mix(k, e, 0.5);',
    '  float X = mix(-0.15, W + 0.6, e);',
    '  float cy = 0.5 + 0.05 * sin(P.x * 1.7 + uSeed) - 0.05 * (P.x / W - 0.5);',
    '  float behind = X - P.x;',
    // 笔画半宽：落笔就很粗，往后再铺开一点，收尾时上下扫满
    '  float hh = 0.31 + 0.03 * sin(P.x * 5.0 + uSeed * 2.0) + 0.16 * smoothstep(0.0, 1.3, behind) + 0.42 * smoothstep(0.66, 1.0, k);',
    '  float r = abs(P.y - cy) / hh;',
    '  float yy = P.y * uRes.y / uPx;',
    // 笔毛纹：沿横向拉长、竖向很细的噪声；粗细两层
    '  float str = noise(vec2(P.x * 7.0, yy / 2.6 + uSeed * 11.0)) * 0.55 + noise(vec2(P.x * 2.2, yy / 10.0 + uSeed * 3.0)) * 0.45;',
    '  float edgeJ = (str - 0.5) * 0.24;',
    '  float aaR = 1.2 * uPx / uRes.y / hh;',
    '  float inBand = smoothstep(1.0 + edgeJ + aaR, 1.0 + edgeJ - aaR, r);',
    // 飞白：笔毛纹低于阈值的地方没上墨；边缘多、中间少，笔过去一会儿后补满
    '  float dryT = (0.08 + 0.8 * pow(sat(r), 1.8)) * (1.0 - smoothstep(0.35, 1.6, behind)) - 0.25 * smoothstep(0.72, 0.95, k);',
    '  float paint = smoothstep(dryT - 0.035, dryT + 0.035, str);',
    // 笔头：中间鼓、两边缩，笔尖毛糙
    '  float tip = (noise(vec2(yy / 2.0, 3.0 + uSeed)) - 0.5) * 0.025 + (noise(vec2(yy / 14.0, 9.0)) - 0.5) * 0.03;',
    '  float hx = X - 0.26 * r * r + tip;',
    '  float aa = 1.2 * uPx / uRes.y;',
    '  float sh = hx - P.x;',
    '  float headM = smoothstep(-aa, aa, sh);',
    '  float rev = inBand * paint * headM;',
    '  vec3 col = mix(A(uv), B(uv), rev);',
    // 湿墨：笔头一段，墨色随笔毛深浅
    '  float wetW = 0.03 + 0.06 * str;',
    '  float wet = headM * inBand * (1.0 - smoothstep(wetW * 0.45, wetW, sh)) * smoothstep(0.2, 0.5, str + 0.25 * (1.0 - r));',
    '  wet *= 1.0 - smoothstep(0.9, 1.0, k);',
    '  vec3 inkC = mix(LIME, vec3(0.16, 0.30, 0.04), smoothstep(0.3, 0.8, str));',
    '  col = mix(col, inkC, wet * 0.9);',
    // 刚扫过的新页上压一层很淡的笔毛纹，很快退掉
    '  float trail = rev * (1.0 - smoothstep(0.0, 0.35, sh)) * (1.0 - smoothstep(0.85, 1.0, k));',
    '  col *= 1.0 - trail * 0.25 * (1.0 - str);',
    // 笔头前面甩出的几滴墨
    '  float cs = 10.0 * uPx;',
    '  vec2 cell = floor(gl_FragCoord.xy / cs);',
    '  vec2 lc = fract(gl_FragCoord.xy / cs) - 0.5;',
    '  float hd = hash(cell + uSeed * 3.0);',
    '  float dropR = 0.12 + 0.26 * hash(cell + 1.7);',
    '  float drop = step(0.975, hd) * (1.0 - smoothstep(dropR - 0.08, dropR, length(lc)));',
    '  drop *= step(0.0, -sh) * (1.0 - smoothstep(0.0, 0.05, -sh)) * step(r, 0.9) * smoothstep(0.05, 0.2, k) * (1.0 - smoothstep(0.75, 0.9, k));',
    '  col = mix(col, LIME, drop * 0.9);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ---- tear：一条锯齿线从上往下撕开，两半先像楔子一样张开，撕到底后各自往两边滑走；
     撕口露出白色纸纤维，靠近撕口的一溜纸往上卷、看得见纸背，新页上落着两半的影子。 */
  var FS_TEAR = HEAD + [
    'float tearX(float y, float W){',
    '  float t = y * 34.0 + uSeed * 9.0;',
    '  float i = floor(t), f = fract(t);',
    '  float z = mix(hash(vec2(i, 3.3)), hash(vec2(i + 1.0, 3.3)), f) - 0.5;',
    '  float fine = n1(y * 260.0 + uSeed * 4.0) - 0.5;',
    '  return W * 0.5 + 0.035 * sin(y * 4.2 + uSeed * 6.0) + 0.028 * z + 0.006 * fine;',
    '}',
    // side = -1 左半，+1 右半；返回 paper 坐标（单位：高度），w = 是否落在这半张纸上
    'vec3 piece(vec2 P, float side, float W, float yf, float k, float sl, float ph, out float edgeD){',
    '  vec2 c = vec2(W * 0.5 + side * W * 0.25, 0.5);',
    '  vec2 T = vec2(side * sl, -0.18 * ph * ph);',
    '  vec2 u = P - T - c;',
    '  u = rot(side * 0.16 * ph) * u;',
    '  u += c;',
    '  u.x -= side * k * max(u.y - yf, 0.0);',
    '  float tx = tearX(u.y, W);',
    '  float inside = side < 0.0 ? step(u.x, tx) : step(tx, u.x);',
    '  inside *= step(0.0, u.x) * step(u.x, W) * step(0.0, u.y) * step(u.y, 1.0);',
    '  edgeD = abs(u.x - tx);',
    '  return vec3(u, inside);',
    '}',
    'void main(){',
    '  float W = uRes.x / uRes.y;',
    '  vec2 P = gl_FragCoord.xy / uRes.y;',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  float k = uP;',
    '  float yf = 1.02 - 1.1 * smoothstep(0.0, 0.42, k);',
    '  float wedge = 0.07 * smoothstep(0.0, 0.42, k) + 0.12 * smoothstep(0.3, 0.7, k);',
    '  float ph = smoothstep(0.3, 1.0, k);',
    '  float sl = (W * 0.62 + 0.35) * ph * ph * (0.6 + 0.4 * ph);',
    '  float px = uPx / uRes.y;',
    '  float curlW = (0.018 + 0.03 * smoothstep(0.05, 0.5, k)) ;',
    '  vec3 col = B(uv);',
    // 新页上的影子：到两半纸边的近似距离
    '  float eL, eR;',
    '  vec3 Ls = piece(P + vec2(0.02, 0.012), -1.0, W, yf, wedge, sl, ph, eL);',
    '  vec3 Rs = piece(P + vec2(-0.02, 0.012), 1.0, W, yf, wedge, sl, ph, eR);',
    '  float sh = max(Ls.z, Rs.z);',
    '  col *= 1.0 - 0.5 * sh;',
    '  for (int s = 0; s < 2; s++){',
    '    float side = s == 0 ? -1.0 : 1.0;',
    '    float ed;',
    '    vec3 pc = piece(P, side, W, yf, wedge, sl, ph, ed);',
    '    if (pc.z < 0.5) continue;',
    '    vec2 pu = pc.xy;',
    '    float open = step(yf, pu.y) * smoothstep(0.0, 0.05, pu.y - yf + 0.02);',
    // 卷边：撕口这一溜往上卷 —— 越靠边越压缩（采样往里挪），最边上翻出纸背
    '    float cw = curlW * open;',
    '    float t = ed / max(cw, 1e-4);',
    '    vec2 su = pu;',
    '    if (t < 1.0) su.x += side * cw * (1.0 - t) * 0.9;',
    '    vec3 c = A(vec2(su.x / W, su.y));',
    '    float roll = (1.0 - smoothstep(0.0, 1.0, t)) * open;',
    '    c *= 1.0 - 0.45 * smoothstep(0.35, 1.0, 1.0 - t) * open;',
    '    c += vec3(0.06, 0.07, 0.05) * exp(-pow((t - 0.7) * 4.0, 2.0)) * open;',
    '    float back = (1.0 - smoothstep(0.32, 0.4, t)) * open;',
    '    vec3 paper = mix(vec3(0.74, 0.76, 0.70), vec3(0.93, 0.95, 0.90), smoothstep(0.0, 0.35, t));',
    '    c = mix(c, paper * (0.75 + 0.25 * noise(pu * 400.0)), back);',
    // 撕口白纤维：贴着锯齿线 1–3px 的毛边
    '    float fib = noise(vec2(pu.y * 900.0, side * 5.0)) * 0.6 + noise(pu * 1400.0) * 0.4;',
    '    float fw = px * (1.2 + 3.0 * fib);',
    '    float fiber = (1.0 - smoothstep(fw * 0.6, fw, ed)) * smoothstep(0.0, 1.0, k * 30.0);',
    '    c = mix(c, vec3(0.95, 0.96, 0.92), fiber * 0.95);',
    '    col = c;',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ---- pixel：整页切成方块，每块按随机先后（略偏向离起点远近）翻一下就没了；
     翻转只有 6 个台阶（一顿一顿的玩具感），翻的过程中方块打马赛克、降色阶、加 Bayer 抖动颗粒，
     侧面闪一条荧光绿。 */
  var FS_PIXEL = HEAD + [
    'float bayer2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }',
    'float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }',
    'void main(){',
    '  float bs = floor(max(26.0 * uPx, uRes.x / 20.0));',
    '  vec2 fc = gl_FragCoord.xy;',
    '  vec2 cell = floor(fc / bs);',
    '  vec2 lc = fract(fc / bs);',
    '  vec2 cc = (cell + 0.5) * bs;',
    '  float far = farCorner(uO);',
    '  float dn = length(cc - uO) / far;',
    '  float r = hash(cell + uSeed * 1.37);',
    '  float start = 0.76 * (0.6 * r + 0.4 * dn);',
    '  float lt = sat((uP - start) / 0.22);',
    '  float st = floor(lt * 6.0) / 6.0;',
    '  vec2 uv = fc / uRes;',
    '  vec3 col = B(uv);',
    // 新页刚露出来的那一下，块里也带一点抖动颗粒
    '  float fresh = step(1.0, lt) * (1.0 - sat((uP - start - 0.22) / 0.12));',
    '  float dth = bayer4(fc / max(1.0, 2.0 * uPx));',
    '  if (fresh > 0.0) { col = mix(col, floor(col * 6.0 + 0.5 + (dth - 0.5) * 0.7) / 6.0, fresh); }',
    '  if (lt < 1.0) {',
    '    float axisX = step(0.5, hash(cell + 9.1));',
    '    float w = cos(st * PI * 0.5);',
    '    float pop = 1.0 + 0.08 * sin(st * PI);',
    '    vec2 l = lc - 0.5;',
    '    float a = axisX > 0.5 ? l.x : l.y;',
    '    float o = axisX > 0.5 ? l.y : l.x;',
    '    float half_ = 0.5 * w * pop;',
    '    if (abs(a) < half_ && abs(o) < 0.5 * pop) {',
    '      float sa = a / max(w * pop, 1e-3), so = o / pop;',
    '      vec2 sl = axisX > 0.5 ? vec2(sa, so) : vec2(so, sa);',
    '      vec2 src = cc + sl * bs;',
    // 翻起来以后打马赛克（每块 8×8 → 4×4），降到 4 阶色并抖动
    '      float mos = st > 0.0 ? bs / (st > 0.4 ? 4.0 : 8.0) : 1.0;',
    '      src = (floor(src / mos) + 0.5) * mos;',
    '      vec3 c = A(src / uRes);',
    '      float lv = st > 0.0 ? 6.0 : 255.0;',
    '      c = floor(c * lv + 0.5 + (st > 0.0 ? (dth - 0.5) * 0.75 : 0.0)) / lv;',
    '      c *= 1.0 - 0.5 * st;',
    // 侧面：翻起来的那一边一条荧光绿
    '      float side = step(half_ - 0.07 * st, abs(a)) * step(0.01, st);',
    '      c = mix(c, LIME * (0.7 + 0.3 * step(0.0, a)), side);',
    '      col = c;',
    '    }',
    '  }',
    // 整体一层很淡的 8-bit 颗粒，只在转场中间出现
    '  float g = (bayer4(fc / max(1.0, 2.0 * uPx)) - 0.5) * 0.05 * sin(uP * PI);',
    '  gl_FragColor = vec4(col + g, 1.0);',
    '}'
  ].join('\n');

  /* ---- iris：圆形光圈从起点张开，边缘一圈像透镜：里外各有轻微折射，
     R/G/B 三个通道的半径错开一点 → 色散彩边；最后再收一道细亮边。 */
  var FS_IRIS = HEAD + [
    'void main(){',
    '  vec2 fc = gl_FragCoord.xy;',
    '  vec2 q = fc - uO;',
    '  float d = length(q);',
    '  vec2 dir = q / max(d, 1e-3);',
    '  float k = uP;',
    '  float e = k < 0.35 ? k * k / 0.35 : 1.0 - (1.0 - k) * (1.0 - k) / 0.65;',
    '  float Rm = farCorner(uO) + 40.0 * uPx;',
    '  float R = Rm * e;',
    '  float ca = (5.0 + 9.0 * sin(k * PI)) * uPx;',
    '  float band = 46.0 * uPx;',
    '  float aa = 1.0 * uPx;',
    '  vec3 col = vec3(0.0);',
    '  for (int c = 0; c < 3; c++){',
    '    float oc = (float(c) - 1.0) * ca;',
    '    float Rc = R + oc;',
    '    float m = smoothstep(Rc + aa, Rc - aa, d);',
    // 透镜：边内往外推、边外往里吸
    '    float inn = sat(1.0 - (Rc - d) / band), out_ = sat(1.0 - (d - Rc) / band);',
    '    float dIn = d + inn * inn * 18.0 * uPx * (1.0 + 0.4 * (float(c) - 1.0));',
    '    float dOut = d - out_ * out_ * 12.0 * uPx * (1.0 + 0.4 * (float(c) - 1.0));',
    '    vec3 bIn = B((uO + dir * dIn) / uRes);',
    '    vec3 aOut = A((uO + dir * dOut) / uRes);',
    '    vec3 v = mix(aOut, bIn, m);',
    '    if (c == 0) col.r = v.r; else if (c == 1) col.g = v.g; else col.b = v.b;',
    '  }',
    '  float ring = exp(-pow((d - R) / (1.4 * uPx), 2.0)) * step(0.001, k) * (1.0 - smoothstep(0.93, 1.0, k));',
    '  col = mix(col, vec3(0.92, 1.0, 0.75), ring * 0.55);',
    // 光圈外的旧页轻轻压暗，收放更有景深
    '  float outside = smoothstep(R - aa, R + aa, d);',
    '  col *= 1.0 - outside * 0.22 * sin(k * PI);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ---- mist：没有边。一层低对比的雾漫上来，雾最浓的时候两页按一张很粗的噪声图慢慢换掉，
     画面同时轻微失焦；雾退掉就是新页。 */
  var FS_MIST = HEAD + [
    'vec3 blurA(vec2 uv, float r){ vec3 s = A(uv) * 0.2;',
    '  for (int i = 0; i < 8; i++){ float a = float(i) * 0.785398; s += A(uv + vec2(cos(a), sin(a)) * r / uRes) * 0.1; } return s; }',
    'vec3 blurB(vec2 uv, float r){ vec3 s = B(uv) * 0.2;',
    '  for (int i = 0; i < 8; i++){ float a = float(i) * 0.785398 + 0.39; s += B(uv + vec2(cos(a), sin(a)) * r / uRes) * 0.1; } return s; }',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;',
    '  float k = uP;',
    '  float fog = smoothstep(0.0, 0.45, k) * (1.0 - smoothstep(0.55, 1.0, k));',
    '  vec2 drift = vec2(uT * 0.35, -uT * 0.12);',
    '  float n = fbm(p * 1.6 + drift + uSeed);',
    '  float n2 = fbm(p * 3.4 - drift * 1.6 + 4.0);',
    '  float sw = smoothstep(-0.35, 0.35, (k - 0.5) * 2.4 + (n - 0.5) * 1.1);',
    '  float r = fog * 3.5 * uPx;',
    '  vec3 a = blurA(uv, r), b = blurB(uv, r);',
    '  vec3 col = mix(a, b, sw);',
    '  vec3 mistC = vec3(0.30, 0.34, 0.31) + vec3(0.04, 0.05, 0.02) * n2;',
    '  float dens = fog * (0.32 + 0.2 * n2 + 0.1 * n);',
    '  col = mix(col, mistC, dens);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ---- plane：主站同款纸飞机（#plane symbol 的线稿，纸色填充 + 蓝墨描边）从左下斜着飞向右上，
     机尾拖出一道越拉越宽的尾流，尾流里就是新页；尾流中线是主站那种虚线航迹。 */
  var FS_PLANE = HEAD + [
    'float seg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = sat(dot(pa, ba) / dot(ba, ba)); return length(pa - ba * h); }',
    'float tri(vec2 p, vec2 a, vec2 b, vec2 c){',
    '  float d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);',
    '  float d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);',
    '  float d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);',
    '  bool neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0, pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;',
    '  return (neg && pos) ? 0.0 : 1.0; }',
    'void main(){',
    '  float W = uRes.x / uRes.y;',
    '  vec2 P = gl_FragCoord.xy / uRes.y;',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
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
    // 尾流：机尾很窄，越往后越宽，飞机走后整片张开；边缘带一点纸边的波浪
    '  float spread = pow(smoothstep(0.42, 1.0, k), 1.4) * 1.25;',
    '  float wave = 1.0 + 0.07 * sin(t * 9.0 - k * 7.0 + uSeed) + 0.04 * sin(t * 23.0 + k * 5.0);',
    '  float hw = (behind * 0.3 + spread) * wave;',
    '  float px = uPx / uRes.y;',
    '  float m = smoothstep(-px, px, behind) * smoothstep(hw + px, hw - px, abs(n));',
    '  vec3 col = mix(A(uv), B(uv), m);',
    '  float fade = 1.0 - smoothstep(0.85, 1.0, k);',
    '  vec3 blue = vec3(0.663, 0.753, 0.827);',
    // 尾流边：一道很细的纸色亮边 + 里侧一点阴影，像折起来的纸边
    '  float rim = exp(-pow((abs(n) - hw) / (1.3 * px), 2.0)) * step(0.0, behind);',
    '  float lip = smoothstep(hw - 14.0 * px, hw, abs(n)) * m;',
    '  col *= 1.0 - 0.3 * lip * fade;',
    '  col = mix(col, blue, rim * 0.55 * fade);',
    // 虚线航迹（主站 stroke-dasharray 2 6 的比例）
    '  float dash = step(fract(t / (0.032 * ps / 0.16)), 0.3);',
    '  float tl = (1.0 - smoothstep(0.9 * px, 1.8 * px, abs(n))) * dash * step(0.0, behind) * fade;',
    '  col = mix(col, blue, tl * 0.85);',
    // 纸飞机：把像素转到 symbol 的 24×24 坐标（y 向下）
    '  float a0 = atan(10.2, 10.6);',
    '  float ang = atan(dir.y, dir.x) - a0 + wob;',
    '  vec2 v = rot(-ang) * (P - pos) / ps * 24.0;',
    '  vec2 s = vec2(v.x + 12.0, 12.0 - v.y);',
    '  float upx = 24.0 * px / ps;',
    '  vec2 N = vec2(21.8, 3.2), Lw = vec2(2.2, 11.6), Rw = vec2(15.6, 20.6), Cf = vec2(11.2, 13.4);',
    '  vec2 F1 = vec2(10.4, 18.6), F2 = vec2(13.2, 15.9);',
    '  float f1 = tri(s, Lw, N, Cf), f2 = tri(s, N, Rw, Cf), f3 = tri(s, Cf, F1, F2);',
    '  float body = max(f1, max(f2, f3));',
    '  vec3 paper = vec3(0.965, 0.945, 0.906);',
    '  vec3 pc = paper * (f3 > 0.5 ? 0.72 : (f2 > 0.5 ? 0.84 : 1.0));',
    '  float dl = min(min(seg(s, Lw, N), seg(s, N, Rw)), min(seg(s, Rw, Cf), seg(s, Cf, Lw)));',
    '  dl = min(dl, min(seg(s, Cf, N), min(seg(s, Cf, F1), seg(s, F1, F2))));',
    '  float lw = 0.62;',
    '  float stroke = 1.0 - smoothstep(lw - upx * 0.6, lw + upx * 0.6, dl);',
    '  float vis = step(0.0005, k) * step(fk, 0.999);',
    // 机身下方一团柔和的投影
    '  vec2 vs = rot(-ang) * (P - pos - vec2(0.018, -0.03)) / ps * 24.0;',
    '  vec2 ss = vec2(vs.x + 12.0, 12.0 - vs.y);',
    '  float shd = max(tri(ss, Lw, N, Cf), tri(ss, N, Rw, Cf)) * vis;',
    '  col *= 1.0 - 0.35 * shd * (1.0 - body);',
    '  col = mix(col, pc, body * vis);',
    '  col = mix(col, vec3(0.31, 0.435, 0.56), stroke * vis);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var SOURCES = { burn: FS_BURN, ink: FS_INK, brush: FS_BRUSH, tear: FS_TEAR, pixel: FS_PIXEL, iris: FS_IRIS, mist: FS_MIST, plane: FS_PLANE };

  var gl, canvas, tri, progs = {}, texA, texB;

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(log); }
    return s;
  }
  function program(fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.u = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); p.u[info.name] = gl.getUniformLocation(p, info.name); }
    p.aPos = gl.getAttribLocation(p, 'aPos');
    return p;
  }
  function texture() {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  FX.init = function (cv) {
    canvas = cv;
    if (/[?&]gl=0\b/.test(location.search)) return false;
    try {
      var opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: true };
      gl = cv.getContext('webgl', opts) || cv.getContext('experimental-webgl', opts);
    } catch (e) { gl = null; }
    if (!gl) return false;
    try {
      for (var k in SOURCES) progs[k] = program(SOURCES[k]);
      tri = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, tri);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      texA = texture(); texB = texture();
    } catch (e) {
      gl = null; progs = {};
      return false;
    }
    cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); FX.ok = false; }, false);
    FX.ok = true;
    return true;
  };

  /* 两张页画好以后上传（只在载入、尺寸变化、换语言时做，不是每帧） */
  FX.upload = function (cA, cB) {
    if (!FX.ok || gl.isContextLost()) return;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, texA);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, cA);
    gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, cB);
  };

  FX.resize = function (W, H) {
    if (!FX.ok) return;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  /* 画一帧。o = 起点（画布像素，左上为原点）；fromA = 当前页是不是 A；px = 1 个 CSS 像素在画布上有几个像素 */
  FX.render = function (key, fromA, p, t, o, seed, px) {
    if (!FX.ok || gl.isContextLost()) return false;
    var pr = progs[key];
    if (!pr) return false;
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.enableVertexAttribArray(pr.aPos);
    gl.vertexAttribPointer(pr.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fromA ? texA : texB);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fromA ? texB : texA);
    var u = pr.u;
    if (u.uFrom) gl.uniform1i(u.uFrom, 0);
    if (u.uTo) gl.uniform1i(u.uTo, 1);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    if (key === 'burn') {
      // 主站：drawVeil(1 - ease(k), 1, now / 1000)，深色主题的 bg / c1 / c2
      gl.uniform1f(u.uP, 1 - p);
      gl.uniform1f(u.uDir, 1);
      gl.uniform1f(u.uTime, t);
      gl.uniform3f(u.uBg, 0.024, 0.031, 0.027);
      gl.uniform3f(u.uEdge, 0.77, 1.0, 0.23);
      gl.uniform3f(u.uEdge2, 1.0, 0.42, 0.24);
    } else {
      gl.uniform1f(u.uP, p);
      gl.uniform1f(u.uT, t);
      gl.uniform2f(u.uO, o[0], canvas.height - o[1]);
      gl.uniform1f(u.uSeed, seed);
      gl.uniform1f(u.uPx, px);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  };
})();
