/*
 * 鱼缸的「光」层：一张 WebGL 片元着色器，只画光 —— 水面下的光束（god rays）、
 * 沙床上的焦散、水面的亮带。画布用 mix-blend-mode: screen 叠在鱼和石头上面，
 * 黑色 = 不加光，所以焦散会自然地落在鱼背和石头上。
 *
 * 焦散函数改写自 Shadertoy 上广为流传的 “Tileable Water Caustic”（joltz0r / Dave_Hoskins）。
 * 没有 WebGL 时退回 Canvas 2D 画几道静态光束。
 */
(function () {
  'use strict';

  var VERT = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);', // y=0 在顶部，和 CSS 一致
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 vUv;',
    'uniform float uTime;',
    'uniform float uAspect;',   // 宽 / 高
    'uniform float uSurface;',  // 水面位置（0..1，自上而下）
    'uniform float uFloor;',    // 沙床位置
    'uniform vec3 uRayCol;',
    'uniform float uRay;',
    'uniform float uCaus;',
    '#define TAU 6.28318530718',
    'float caustic(vec2 uv, float time) {',
    '  vec2 p = mod(uv * TAU, TAU) - 250.0;',
    '  vec2 i = p;',
    '  float c = 1.0;',
    '  float inten = 0.005;',
    '  for (int n = 0; n < 4; n++) {',
    '    float t = time * (1.0 - (3.5 / float(n + 1)));',
    '    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));',
    '    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));',
    '  }',
    '  c /= 4.0;',
    '  c = 1.17 - pow(c, 1.4);',
    '  return pow(abs(c), 8.0);',
    '}',
    'float band(float x, float k) { return pow(0.5 + 0.5 * sin(x), k); }',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
    'void main() {',
    '  vec2 uv = vUv;',
    '  float t = uTime;',
    '  float depth = clamp((uv.y - uSurface) / (1.0 - uSurface), 0.0, 1.0);',
    '  float below = smoothstep(uSurface - 0.004, uSurface + 0.03, uv.y);',
    // 光束：斜向的几层正弦带，用低频正弦扭一下让它们慢慢呼吸、合并、分开
    '  float x = uv.x * uAspect + uv.y * 0.30;',
    '  float r = band(x * 6.0 + t * 0.19 + sin(x * 2.1 + t * 0.10) * 1.8, 7.0);',
    '  r += 0.75 * band(x * 13.0 - t * 0.15 + sin(x * 4.7 - t * 0.07) * 2.2, 10.0);',
    '  r += 0.45 * band(x * 2.6 + t * 0.06, 4.0);',
    '  r *= pow(1.0 - depth, 1.7) * below;',
    // 沙床焦散：竖向压扁，假装是透视下的水平面
    '  vec2 cp = vec2(uv.x * uAspect * 1.25, uv.y * 3.6);',
    '  float floorMask = smoothstep(uFloor - 0.05, uFloor + 0.04, uv.y);',
    '  float cf = caustic(cp * 0.55 + vec2(0.0, t * 0.004), t * 0.42) * floorMask;',
    // 水体里很淡的一层，落在鱼和石头上
    '  float cw = caustic(vec2(uv.x * uAspect, uv.y) * 0.32, t * 0.33 + 7.0) * (1.0 - depth) * below;',
    // 水面亮带（从下往上看到的水面）
    '  float surf = (1.0 - smoothstep(0.0, uSurface + 0.02, uv.y)) * 0.55;',
    '  vec3 col = uRayCol * (r * uRay * 0.42 + cf * uCaus * 0.75 + cw * uCaus * 0.16 + surf * uRay);',
    '  col += (hash(gl_FragCoord.xy + t) - 0.5) / 255.0;',
    '  gl_FragColor = vec4(max(col, 0.0), 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('shader: ' + log);
    }
    return s;
  }

  function createGL(canvas) {
    var opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
    var gl = null;
    try { gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts); } catch (e) { gl = null; }
    if (!gl) return null;

    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) {
      return null;
    }
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var u = {};
    ['uTime', 'uAspect', 'uSurface', 'uFloor', 'uRayCol', 'uRay', 'uCaus'].forEach(function (n) {
      u[n] = gl.getUniformLocation(prog, n);
    });

    var lost = false;
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); lost = true; }, false);

    return {
      kind: 'webgl',
      resize: function (w, h, scale) {
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        gl.viewport(0, 0, canvas.width, canvas.height);
      },
      render: function (t, p) {
        if (lost) return;
        gl.uniform1f(u.uTime, t % 3600);
        gl.uniform1f(u.uAspect, p.aspect);
        gl.uniform1f(u.uSurface, p.surface);
        gl.uniform1f(u.uFloor, p.floor);
        gl.uniform3f(u.uRayCol, p.rayCol[0], p.rayCol[1], p.rayCol[2]);
        gl.uniform1f(u.uRay, p.ray);
        gl.uniform1f(u.uCaus, p.caus);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };
  }

  // 退路：几道静态斜光，只在参数变化时重画
  function create2D(canvas) {
    var ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) {
      // 画布已被 WebGL 占用但着色器编不过：干脆不画光，鱼缸照常运行
      canvas.style.display = 'none';
      return { kind: 'none', resize: function () {}, render: function () {} };
    }
    var w = 1, h = 1, key = '';
    return {
      kind: '2d',
      resize: function (cw, ch, scale) {
        w = Math.max(1, Math.round(cw * scale));
        h = Math.max(1, Math.round(ch * scale));
        canvas.width = w; canvas.height = h; key = '';
      },
      render: function (t, p) {
        var k = p.rayCol.join(',') + p.ray + p.surface;
        if (k === key) return;
        key = k;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        var c = p.rayCol.map(function (v) { return Math.round(v * 255); }).join(',');
        for (var i = 0; i < 7; i++) {
          var x0 = (i / 7 + 0.05) * w * 1.1, bw = w * (0.03 + (i % 3) * 0.02);
          var g = ctx.createLinearGradient(0, p.surface * h, 0, h * 0.9);
          g.addColorStop(0, 'rgba(' + c + ',' + (0.22 * p.ray) + ')');
          g.addColorStop(1, 'rgba(' + c + ',0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(x0, p.surface * h);
          ctx.lineTo(x0 + bw, p.surface * h);
          ctx.lineTo(x0 + bw * 2.2 - h * 0.3, h);
          ctx.lineTo(x0 - h * 0.3, h);
          ctx.closePath();
          ctx.fill();
        }
      }
    };
  }

  window.AquariumLight = {
    create: function (canvas) {
      return createGL(canvas) || create2D(canvas);
    }
  };
})();
