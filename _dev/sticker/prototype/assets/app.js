/* Peelings clickable prototype — shared chrome, state, pricing, mock providers, sticker renderer.
   Everything runs locally: no network calls except ../../../sticker/pricing.json (same origin).
   The "mock" providers stand in for the real cutout / AI adapters described in SPEC.md §6. */
(function () {
  'use strict';

  var PRICING_URL = '../../../sticker/pricing.json';
  var STYLE_IMG = '../../../sticker/src/img/style/';
  var KEY = 'peelings.proto.v1';
  var MAX_BYTES = 20 * 1024 * 1024;
  var MIN_SIDE = 600;
  var TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

  var STYLES = [
    { id: 'original', name: 'Just the photo', img: null, note: 'No AI, clean cutout' },
    { id: 'sunny', name: 'Sunny cartoon', img: '1.png' },
    { id: 'ink', name: 'Ink comic', img: '2.png' },
    { id: 'line', name: 'Line art', img: '3.png' },
    { id: 'badge', name: 'Vintage badge', img: '4.png' },
    { id: 'pastel', name: 'Pastel doodle', img: '5.png' },
    { id: 'wash', name: 'Soft wash', img: '6.png' },
    { id: 'clay', name: 'Clay figure', img: '7.png' },
    { id: 'pop', name: 'Pop sticker', img: '8.png' }
  ];

  // ---------- storage (works without it: falls back to memory) ----------
  var mem = null;
  function load() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { mem = {}; }
    mem.draft = mem.draft || {};
    mem.cart = mem.cart || [];
    mem.orders = mem.orders || {};
    return mem;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* quota or private mode */ }
  }
  function sim(name) {
    return new URLSearchParams(location.search).get('sim') === name;
  }

  // ---------- pricing (same algorithm as SPEC §3 / api_contract.md / sticker_prototype_check.py) ----------
  var pricing = null;
  function loadPricing() {
    if (pricing) return Promise.resolve(pricing);
    return fetch(PRICING_URL).then(function (r) {
      if (!r.ok) throw new Error('pricing.json ' + r.status);
      return r.json();
    }).then(function (d) { pricing = d; return d; });
  }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function unitCents(p, o) {
    var base = p.unit_price_cents[o.size][String(o.qty)];
    var fin = byId(p.finishes, o.finish);
    if (base == null || !fin) throw new Error('invalid option');
    return Math.round(base * (100 + fin.surcharge_pct) / 100);
  }
  function quoteLine(p, o) {
    var u = unitCents(p, o);
    return { unit_cents: u, line_cents: u * o.qty };
  }
  function quoteCart(p, lines) {
    var sub = 0;
    lines.forEach(function (l) { sub += quoteLine(p, l.opts).line_cents; });
    var ship = p.shipping.methods[0];
    var shipCents = lines.length === 0 ? 0 : (sub >= ship.free_over_cents ? 0 : ship.price_cents);
    return { subtotal_cents: sub, shipping_cents: shipCents, total_cents: sub + shipCents };
  }
  function money(c) { return '$' + (c / 100).toFixed(2); }

  // ---------- chrome ----------
  var STEPS = [['upload', 'Photo'], ['cutout', 'Cutout'], ['style', 'Style'], ['edit', 'Details'], ['preview', 'Preview']];
  function chrome() {
    var page = document.body.dataset.page;
    var st = load();
    var strip = document.createElement('div');
    strip.className = 'proto-strip';
    strip.innerHTML = '<div class="wrap"><span>Prototype<span class="hide-sm"> · mock AI and mock payments</span> · nothing is charged or shipped</span>' +
      '<span class="sims"><button type="button" data-reset>Reset demo</button></span></div>';
    document.body.prepend(strip);
    strip.querySelector('[data-reset]').addEventListener('click', function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      mem = null; location.href = 'index.html';
    });
    var head = document.querySelector('[data-head]');
    if (head) {
      head.innerHTML = '<div class="wrap"><a class="wordmark" href="index.html">Peelings<span>.</span></a>' +
        '<nav class="site-nav" aria-label="Main"><a class="hide-sm" href="index.html#how">How it works</a>' +
        '<a class="hide-sm" href="index.html#pricing">Pricing</a><a class="hide-sm" href="index.html#faq">FAQ</a>' +
        '<a class="cart-link" href="cart.html" data-cart-link>Cart <span class="cart-count" data-cart-count>' + countItems(st.cart) + '</span></a></nav></div>';
    }
    var stepper = document.querySelector('[data-stepper]');
    if (stepper) {
      var idx = STEPS.map(function (s) { return s[0]; }).indexOf(page);
      stepper.innerHTML = STEPS.map(function (s, i) {
        var cls = i < idx ? 'done' : (i === idx ? 'now' : '');
        return '<li class="' + cls + '"' + (i === idx ? ' aria-current="step"' : '') + '><b>' + (i + 1) + '</b><span>' + s[1] + '</span></li>';
      }).join('');
    }
    var foot = document.querySelector('[data-foot]');
    if (foot) {
      foot.innerHTML = '<div class="wrap"><p>Peelings — photo stickers, printed in the US. Prototype build.</p>' +
        '<nav aria-label="Footer"><a href="index.html#faq">Shipping &amp; returns</a><a href="index.html#faq">Content policy</a><a href="order.html">Track an order</a></nav></div>';
    }
  }
  function countItems(cart) { return cart.length; }
  function refreshCount() {
    var el = document.querySelector('[data-cart-count]');
    if (el) el.textContent = countItems(load().cart);
  }

  // ---------- image helpers ----------
  function loadImg(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      i.onload = function () { res(i); };
      i.onerror = function () { rej(new Error('image failed to load')); };
      i.src = src;
    });
  }
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function fit(img, max) {
    var s = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    var c = canvas((img.naturalWidth || img.width) * s, (img.naturalHeight || img.height) * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  function trim(c) {
    var ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data;
    var x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (var y = 0; y < c.height; y++) for (var x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return c;
    var o = canvas(x1 - x0 + 1, y1 - y0 + 1);
    o.getContext('2d').drawImage(c, -x0, -y0);
    return o;
  }

  // Mock cutout provider: soft-edged oval around the centre subject. Real adapter: in-browser segmentation (SPEC §6.3).
  function mockCutout(img) {
    var src = fit(img, 720);
    var w = src.width, h = src.height;
    var c = canvas(w, h), ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    var m = canvas(w, h), mx = m.getContext('2d');
    mx.filter = 'blur(' + Math.round(Math.min(w, h) * 0.02) + 'px)';
    mx.fillStyle = '#000';
    mx.beginPath();
    mx.ellipse(w / 2, h * 0.5, w * 0.44, h * 0.46, 0, 0, Math.PI * 2);
    mx.fill();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(m, 0, 0);
    return trim(c);
  }

  // Mock stylize provider: deterministic pixel filters. Real adapter: image-to-image model (SPEC §6.2).
  function mockStylize(srcCanvas, styleId) {
    var c = canvas(srcCanvas.width, srcCanvas.height), ctx = c.getContext('2d');
    ctx.drawImage(srcCanvas, 0, 0);
    if (styleId === 'original') return c;
    var im = ctx.getImageData(0, 0, c.width, c.height), d = im.data, w = c.width, h = c.height;
    var lum = new Float32Array(w * h);
    for (var i = 0; i < w * h; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    function edge(x, y) {
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return 0;
      var gx = lum[y * w + x + 1] - lum[y * w + x - 1], gy = lum[(y + 1) * w + x] - lum[(y - 1) * w + x];
      return Math.sqrt(gx * gx + gy * gy);
    }
    var lv = { sunny: 5, ink: 4, badge: 4, pop: 3, pastel: 6, wash: 8, clay: 7, line: 2 }[styleId] || 5;
    var step = 255 / (lv - 1);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var p = (y * w + x) * 4, r = d[p], g = d[p + 1], b = d[p + 2];
      if (styleId === 'line') {
        var e = edge(x, y) > 38 ? 30 : 255; r = g = b = e;
      } else if (styleId === 'badge') {
        var L = lum[y * w + x]; r = L * 1.07 + 20; g = L * 0.9 + 12; b = L * 0.62;
      } else if (styleId === 'pastel' || styleId === 'wash') {
        r = r * 0.6 + 102; g = g * 0.6 + 96; b = b * 0.6 + 100;
      } else if (styleId === 'pop') {
        var m = (r + g + b) / 3; r = m + (r - m) * 1.9; g = m + (g - m) * 1.9; b = m + (b - m) * 1.9;
      }
      r = Math.round(Math.min(255, Math.max(0, r)) / step) * step;
      g = Math.round(Math.min(255, Math.max(0, g)) / step) * step;
      b = Math.round(Math.min(255, Math.max(0, b)) / step) * step;
      if ((styleId === 'ink' || styleId === 'sunny' || styleId === 'pop') && edge(x, y) > 46) { r = g = b = 25; }
      d[p] = r; d[p + 1] = g; d[p + 2] = b;
    }
    ctx.putImageData(im, 0, 0);
    return c;
  }

  // Sticker renderer: shape + white border + finish sheen. borderIn and sizeIn are inches; out = longest side in px.
  function renderSticker(art, o, out) {
    var sizeIn = parseFloat(o.size), b = o.border;
    var pxPerIn = out / sizeIn, bp = b * pxPerIn;
    var a = trim(art);
    var inner = out - 2 * bp;
    var s = inner / Math.max(a.width, a.height);
    if (o.shape !== 'diecut') s *= 0.86;
    var aw = a.width * s, ah = a.height * s;
    var W = o.shape === 'diecut' ? aw + 2 * bp : out, H = o.shape === 'diecut' ? ah + 2 * bp : out;
    var pad = Math.ceil(out * 0.04);
    var c = canvas(W + pad * 2, H + pad * 2), ctx = c.getContext('2d');
    var base = canvas(W, H), bx = base.getContext('2d');
    if (o.shape === 'diecut') {
      // dilate the alpha silhouette by drawing it around a circle, then paint it white
      var n = 36;
      for (var i = 0; i < n; i++) {
        var t = i / n * Math.PI * 2;
        bx.drawImage(a, bp + Math.cos(t) * bp, bp + Math.sin(t) * bp, aw, ah);
      }
      bx.drawImage(a, bp, bp, aw, ah);
      bx.globalCompositeOperation = 'source-in';
      bx.fillStyle = '#fffdf8';
      bx.fillRect(0, 0, W, H);
      bx.globalCompositeOperation = 'source-over';
    } else {
      bx.fillStyle = '#fffdf8';
      bx.beginPath();
      if (o.shape === 'circle') bx.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2);
      else roundRect(bx, 0, 0, W, H, W * 0.09);
      bx.fill();
    }
    bx.drawImage(a, (W - aw) / 2, (H - ah) / 2, aw, ah);
    if (o.finish === 'glossy' || o.finish === 'holographic') {
      var sheen = canvas(W, H), sx = sheen.getContext('2d');
      sx.drawImage(base, 0, 0);
      sx.globalCompositeOperation = 'source-in';
      if (o.finish === 'glossy') {
        sx.fillStyle = 'rgba(255,255,255,0.16)';
        sx.beginPath(); sx.moveTo(0, 0); sx.lineTo(W * 0.55, 0); sx.lineTo(0, H * 0.55); sx.closePath(); sx.fill();
      } else {
        var cols = ['rgba(120,200,255,.18)', 'rgba(255,160,200,.16)', 'rgba(255,240,140,.16)', 'rgba(150,255,190,.16)'];
        for (var k = 0; k < 8; k++) { sx.fillStyle = cols[k % 4]; sx.fillRect(k * W / 8, 0, W / 8 + 1, H); }
      }
      bx.drawImage(sheen, 0, 0);
    }
    ctx.shadowColor = 'rgba(30,29,26,.22)';
    ctx.shadowBlur = pad * 0.9;
    ctx.shadowOffsetY = pad * 0.35;
    ctx.drawImage(base, pad, pad);
    return c;
  }
  function roundRect(x, l, t, w, h, r) {
    x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r);
    x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath();
  }

  function artFromDraft(dr) {
    var src = dr.styled || dr.cutout;
    return loadImg(src).then(function (i) { return fit(i, 720); });
  }

  // ---------- pages ----------
  var pages = {};

  pages.index = function () {
    loadPricing().then(function (p) {
      var tb = document.querySelector('[data-price-table]');
      if (!tb) return;
      var qs = p.display_quantities;
      var head = '<thead><tr><th scope="col">Size</th>' + qs.map(function (q) { return '<th scope="col">' + q + ' pc' + (q > 1 ? 's' : '') + '</th>'; }).join('') + '</tr></thead>';
      var body = p.sizes.map(function (s) {
        return '<tr><th scope="row">' + s.label + '</th>' + qs.map(function (q) {
          var l = quoteLine(p, { size: s.id, qty: q, finish: p.finishes[0].id });
          return '<td>' + money(l.line_cents) + '<span class="each">' + money(l.unit_cents) + ' each</span></td>';
        }).join('') + '</tr>';
      }).join('');
      tb.innerHTML = head + '<tbody>' + body + '</tbody>';
      var low = Infinity;
      p.sizes.forEach(function (s) { p.quantities.forEach(function (q) { low = Math.min(low, quoteLine(p, { size: s.id, qty: q, finish: 'glossy' }).line_cents); }); });
      document.querySelector('[data-from]').textContent = 'from ' + money(low).replace(/\.00$/, '') + ' for ' + p.quantities[0];
      var sh = p.shipping.methods[0];
      document.querySelector('[data-ship-note]').textContent = 'Prices include ' + sh.label.replace(/^Free/, 'free') + ' (about ' + sh.estimate_business_days.join('\u2013') +
        ' business days door to door). Glossy or matte, any shape, same price.';
    });
  };

  pages.upload = function () {
    var st = load();
    var input = document.getElementById('file');
    var zone = document.querySelector('.dropzone');
    var err = document.querySelector('[data-error]');
    var okBox = document.querySelector('[data-ok]');
    var rights = document.getElementById('rights');
    var next = document.querySelector('[data-next]');
    var thumb = document.querySelector('[data-thumb]');
    function showErr(title, msg) { err.hidden = false; err.innerHTML = '<strong>' + title + '</strong>' + msg; okBox.hidden = true; }
    function gate() { next.setAttribute('aria-disabled', st.draft.photo && rights.checked ? 'false' : 'true'); }
    function accept(dataUrl, name) {
      st.draft = { photo: dataUrl, photoName: name, sample: name === 'sample.jpg' };
      save();
      err.hidden = true; okBox.hidden = false;
      okBox.innerHTML = '<strong>Photo ready</strong>' + name;
      thumb.innerHTML = '<img src="' + dataUrl + '" alt="Your uploaded photo">';
      gate();
    }
    function handle(f) {
      if (!f) return;
      if (TYPES.indexOf(f.type) < 0) return showErr('That file type won’t work', 'Use a JPG, PNG, WebP or HEIC photo. You picked ' + (f.name || 'a file') + '.');
      if (f.size > MAX_BYTES) return showErr('That photo is too large', 'The limit is 20 MB. Try exporting a smaller copy from your phone.');
      var url = URL.createObjectURL(f);
      loadImg(url).then(function (i) {
        if (Math.min(i.naturalWidth, i.naturalHeight) < MIN_SIDE) {
          return showErr('That photo is too small to print sharply', 'We need at least ' + MIN_SIDE + ' px on the short side; this one is ' + i.naturalWidth + ' × ' + i.naturalHeight + '.');
        }
        accept(fit(i, 1200).toDataURL('image/jpeg', 0.86), f.name);
      }, function () { showErr('We couldn’t read that photo', 'The file may be damaged. HEIC files from older iPhones sometimes need to be exported as JPG.'); });
    }
    input.addEventListener('change', function () { handle(input.files[0]); });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('drag'); });
    zone.addEventListener('drop', function (e) { e.preventDefault(); zone.classList.remove('drag'); handle(e.dataTransfer.files[0]); });
    zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    document.querySelector('[data-sample]').addEventListener('click', function () {
      loadImg('assets/sample.jpg').then(function (i) { accept(fit(i, 1200).toDataURL('image/jpeg', 0.86), 'sample.jpg'); });
    });
    rights.addEventListener('change', function () { if (rights.checked && st.draft.photo) err.hidden = true; gate(); });
    next.addEventListener('click', function (e) {
      if (next.getAttribute('aria-disabled') === 'true') {
        e.preventDefault();
        if (!st.draft.photo) showErr('Add a photo first', 'Pick a file or use the sample photo.');
        else showErr('One more thing', 'Please confirm you have the right to use this photo.');
      }
    });
    if (sim('blocked')) {
      showErr('We can’t print this photo', 'It looks like it contains a trademarked character or logo. We only print photos you took or have permission to use. <a href="index.html#faq">Content policy</a>');
    }
    if (st.draft.photo) { accept(st.draft.photo, st.draft.photoName); rights.checked = true; gate(); }
    gate();
  };

  pages.cutout = function () {
    var st = load();
    if (!st.draft.photo) { location.replace('upload.html'); return; }
    var stage = document.querySelector('[data-stage]');
    var next = document.querySelector('[data-next]');
    stage.innerHTML = '<div class="busy"><div class="spinner"></div>Finding the subject…</div>';
    loadImg(st.draft.photo).then(function (i) {
      setTimeout(function () {
        var c = mockCutout(i);
        st.draft.cutout = c.toDataURL('image/png');
        delete st.draft.styled; save();
        var r = renderSticker(c, { size: '3', border: 0.125, shape: 'diecut', finish: 'matte' }, 560);
        r.setAttribute('aria-label', 'Cutout preview');
        stage.innerHTML = '<span class="tag">Mock cutout</span>';
        stage.appendChild(r);
        next.setAttribute('aria-disabled', 'false');
        document.body.dataset.ready = '1';
      }, 450);
    });
  };

  pages.style = function () {
    var st = load();
    if (!st.draft.cutout) { location.replace('cutout.html'); return; }
    var grid = document.querySelector('[data-styles]');
    var stage = document.querySelector('[data-stage]');
    var err = document.querySelector('[data-error]');
    var next = document.querySelector('[data-next]');
    var left = document.querySelector('[data-left]');
    st.draft.tries = st.draft.tries || 0;
    var cutImg;
    grid.innerHTML = STYLES.map(function (s, i) {
      var img = s.img ? STYLE_IMG + s.img : st.draft.cutout;
      return '<div class="style-opt"><input type="radio" name="style" id="st-' + s.id + '" value="' + s.id + '"' + (st.draft.style === s.id ? ' checked' : '') + '>' +
        '<label for="st-' + s.id + '"><img src="' + img + '" alt="" loading="lazy">' + s.name + '</label></div>';
    }).join('');
    function updLeft() { left.textContent = Math.max(0, 6 - st.draft.tries) + ' of 6 free tries left for this photo'; }
    updLeft();
    function run(id) {
      err.hidden = true;
      next.setAttribute('aria-disabled', 'true');
      stage.innerHTML = '<div class="busy"><div class="spinner"></div>Drawing your sticker… usually 10–20 seconds</div>';
      if (st.draft.tries >= 6) {
        err.hidden = false;
        err.innerHTML = '<strong>You’ve used the free tries for this photo</strong>Pick one of the versions you already made, or start over with a new photo.';
        stage.innerHTML = '';
        return;
      }
      st.draft.tries++; updLeft();
      setTimeout(function () {
        if (sim('aifail')) {
          err.hidden = false;
          err.innerHTML = '<strong>That one didn’t come out right</strong>The style generator timed out. This try wasn’t counted. <button class="link-btn" type="button" data-retry>Try again</button>';
          st.draft.tries--; updLeft(); save();
          stage.innerHTML = '<span class="tag">No result</span>';
          err.querySelector('[data-retry]').addEventListener('click', function () { history.replaceState(null, '', 'style.html'); run(id); });
          return;
        }
        var s = byId(STYLES, id);
        var done = function (c) {
          st.draft.style = id;
          st.draft.styled = c.toDataURL('image/png');
          save();
          var r = renderSticker(c, { size: '3', border: 0.125, shape: 'diecut', finish: 'matte' }, 560);
          r.setAttribute('aria-label', s.name + ' result');
          stage.innerHTML = '<span class="tag">' + s.name + (st.draft.sample || id === 'original' ? '' : ' · mock style') + '</span>';
          stage.appendChild(r);
          next.setAttribute('aria-disabled', 'false');
          document.body.dataset.ready = id;
        };
        if (st.draft.sample && s.img) loadImg(STYLE_IMG + s.img).then(function (i) { done(fit(i, 720)); });
        else done(mockStylize(cutImg, id));
      }, 650);
    }
    loadImg(st.draft.cutout).then(function (i) {
      cutImg = fit(i, 720);
      grid.addEventListener('change', function (e) { if (e.target.name === 'style') run(e.target.value); });
      if (st.draft.style && st.draft.styled) {
        var r = renderSticker(fit(cutImg, 720), { size: '3', border: 0.125, shape: 'diecut', finish: 'matte' }, 560);
        loadImg(st.draft.styled).then(function (si) {
          stage.innerHTML = '<span class="tag">' + byId(STYLES, st.draft.style).name + '</span>';
          stage.appendChild(renderSticker(fit(si, 720), { size: '3', border: 0.125, shape: 'diecut', finish: 'matte' }, 560));
          next.setAttribute('aria-disabled', 'false');
          document.body.dataset.ready = st.draft.style;
        });
        void r;
      } else {
        stage.innerHTML = '<p class="muted">Pick a style to see your sticker.</p>';
      }
    });
    next.addEventListener('click', function (e) { if (next.getAttribute('aria-disabled') === 'true') e.preventDefault(); });
  };

  pages.edit = function () {
    var st = load();
    if (!st.draft.styled) { location.replace('style.html'); return; }
    var form = document.querySelector('[data-form]');
    var stage = document.querySelector('[data-stage]');
    var o = st.draft.opts = Object.assign({ shape: 'diecut', border: 0.125, size: '3', qty: 10, finish: 'glossy' }, st.draft.opts || {});
    Promise.all([loadPricing(), artFromDraft(st.draft)]).then(function (r) {
      var p = r[0], art = r[1];
      function seg(name, items) {
        return items.map(function (it) {
          var id = name + '-' + it.v;
          return '<input type="radio" name="' + name + '" id="' + id + '" value="' + it.v + '"' + (String(o[name]) === String(it.v) ? ' checked' : '') + (it.off ? ' disabled' : '') + '><label for="' + id + '"' + (it.off ? ' class="off"' : '') + '>' + it.t + '</label>';
        }).join('');
      }
      form.querySelector('[data-f=shape]').innerHTML = seg('shape', p.shapes.map(function (s) { return { v: s.id, t: s.label }; }));
      form.querySelector('[data-f=size]').innerHTML = seg('size', p.sizes.map(function (s) { return { v: s.id, t: s.label }; }));
      form.querySelector('[data-f=qty]').innerHTML = seg('qty', p.quantities.map(function (q) { return { v: q, t: String(q) }; }));
      form.querySelector('[data-f=finish]').innerHTML = seg('finish', p.finishes.map(function (f) { return { v: f.id, off: !f.enabled, t: f.label + (f.enabled ? (f.surcharge_pct ? ' <small>+' + f.surcharge_pct + '%</small>' : '') : ' <small>coming soon</small>') }; }));
      var range = form.querySelector('#border');
      range.min = 0; range.max = p.borders_in.length - 1; range.step = 1;
      range.value = Math.max(0, p.borders_in.map(function (b) { return b.inches; }).indexOf(o.border));
      function render() {
        var b = p.borders_in[+range.value];
        o.border = b.inches;
        form.querySelector('[data-border-label]').textContent = b.label;
        range.disabled = o.shape !== 'diecut';
        form.querySelector('[data-border-wrap]').classList.toggle('muted', range.disabled);
        var c = renderSticker(art, o, 520);
        c.setAttribute('aria-label', 'Sticker preview');
        stage.innerHTML = '<span class="tag">' + byId(p.sizes, o.size).label + ' · ' + byId(p.shapes, o.shape).label + ' · ' + byId(p.finishes, o.finish).label + '</span>';
        stage.appendChild(c);
        var q = quoteLine(p, o);
        document.querySelector('[data-unit]').textContent = money(q.unit_cents) + ' each';
        document.querySelector('[data-total]').textContent = money(q.line_cents);
        document.querySelector('[data-total]').dataset.cents = q.line_cents;
        save();
      }
      form.addEventListener('change', function (e) {
        var t = e.target;
        if (t.name === 'qty') o.qty = +t.value;
        else if (t.name && t.name !== 'border') o[t.name] = t.value;
        render();
      });
      range.addEventListener('input', render);
      render();
      document.body.dataset.ready = '1';
    });
  };

  pages.preview = function () {
    var st = load();
    if (!st.draft.styled || !st.draft.opts) { location.replace('edit.html'); return; }
    var o = st.draft.opts;
    Promise.all([loadPricing(), artFromDraft(st.draft)]).then(function (r) {
      var p = r[0], art = r[1];
      var c = renderSticker(art, o, 600);
      var url = c.toDataURL('image/png');
      var sizeIn = parseFloat(o.size);
      // laptop lid 11.97 in wide, bottle 2.9 in wide — place at true relative scale
      var lap = document.querySelector('[data-laptop]'), bot = document.querySelector('[data-bottle]');
      lap.insertAdjacentHTML('beforeend', '<img class="placed" alt="" src="' + url + '" style="width:' + (sizeIn / 11.97 * 100 * 1.08) + '%;left:62%;top:18%;transform:rotate(-6deg)">');
      bot.insertAdjacentHTML('beforeend', '<img class="placed" alt="" src="' + url + '" style="width:' + Math.min(96, sizeIn / 2.9 * 100 * 1.08) + '%;left:50%;top:44%;transform:translateX(-50%) rotate(3deg)">');
      document.querySelector('[data-hand]').innerHTML = '<img src="' + url + '" alt="Your sticker" style="width:' + Math.min(100, 42 + sizeIn * 11) + '%;margin:0 auto">';
      var q = quoteLine(p, o);
      document.querySelector('[data-desc]').textContent = o.qty + ' × ' + byId(p.sizes, o.size).label + ' ' + byId(p.shapes, o.shape).label.toLowerCase() + ', ' + byId(p.finishes, o.finish).label.toLowerCase();
      document.querySelector('[data-total]').textContent = money(q.line_cents);
      document.querySelector('[data-add]').addEventListener('click', function () {
        var th = renderSticker(art, o, 240).toDataURL('image/png');
        st.cart.push({ id: 'ln_' + Date.now().toString(36), thumb: th, style: st.draft.style, opts: Object.assign({}, o) });
        save();
        location.href = 'cart.html';
      });
      document.body.dataset.ready = '1';
    });
  };

  pages.cart = function () {
    var st = load();
    var list = document.querySelector('[data-lines]');
    loadPricing().then(function (p) {
      if (new URLSearchParams(location.search).get('canceled')) document.querySelector('[data-canceled]').hidden = false;
      function draw() {
        refreshCount();
        if (!st.cart.length) {
          list.innerHTML = '<li class="empty"><p class="serif" style="font-size:24px">Your cart is empty.</p><p class="muted" style="margin:8px 0 18px">Start with a photo you love.</p><a class="btn accent" href="upload.html">Make a sticker</a></li>';
          document.querySelector('[data-summary]').hidden = true;
          return;
        }
        document.querySelector('[data-summary]').hidden = false;
        list.innerHTML = st.cart.map(function (l, i) {
          var q = quoteLine(p, l.opts), s = byId(STYLES, l.style);
          return '<li class="line"><div class="thumb"><img src="' + l.thumb + '" alt=""></div><div><div><b>' + (s ? s.name : 'Sticker') + '</b></div>' +
            '<div class="meta">' + byId(p.sizes, l.opts.size).label + ' · ' + byId(p.shapes, l.opts.shape).label + ' · ' + byId(p.finishes, l.opts.finish).label + ' · ' + money(q.unit_cents) + ' each</div>' +
            '<div class="qty"><label for="q' + i + '" class="small">Qty</label><select id="q' + i + '" data-i="' + i + '">' +
            p.quantities.map(function (n) { return '<option' + (n === l.opts.qty ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
            '</select><button class="link-btn small" type="button" data-rm="' + i + '">Remove</button></div></div>' +
            '<div class="price">' + money(q.line_cents) + '</div></li>';
        }).join('');
        var t = quoteCart(p, st.cart), sh = p.shipping.methods[0];
        document.querySelector('[data-sub]').textContent = money(t.subtotal_cents);
        document.querySelector('[data-ship]').textContent = t.shipping_cents ? money(t.shipping_cents) : 'Free';
        document.querySelector('[data-ship-hint]').textContent = t.shipping_cents ? 'Add ' + money(sh.free_over_cents - t.subtotal_cents) + ' more for free shipping' : 'Arrives in about ' + sh.estimate_business_days.join('\u2013') + ' business days';
        var tot = document.querySelector('[data-grand]');
        tot.textContent = money(t.total_cents);
        tot.dataset.cents = t.total_cents;
      }
      list.addEventListener('change', function (e) {
        if (e.target.dataset.i != null) { st.cart[+e.target.dataset.i].opts.qty = +e.target.value; save(); draw(); }
      });
      list.addEventListener('click', function (e) {
        if (e.target.dataset.rm != null) { st.cart.splice(+e.target.dataset.rm, 1); save(); draw(); }
      });
      document.querySelector('[data-checkout]').addEventListener('click', function () {
        var t = quoteCart(p, st.cart);
        // In production: POST /v1/checkout → { checkout_url } and redirect to Stripe. The server re-prices; see api_contract.md.
        var sid = 'cs_test_mock_' + Math.random().toString(36).slice(2, 10);
        st.pending = { session: sid, total_cents: t.total_cents, subtotal_cents: t.subtotal_cents, shipping_cents: t.shipping_cents };
        save();
        location.href = 'checkout.html?session_id=' + sid;
      });
      draw();
      document.body.dataset.ready = '1';
    });
  };

  pages.checkout = function () {
    var st = load();
    if (!st.pending) { location.replace('cart.html'); return; }
    document.querySelector('[data-amount]').textContent = money(st.pending.total_cents);
    document.querySelector('[data-pay]').textContent = 'Pay ' + money(st.pending.total_cents);
    document.querySelector('[data-items]').innerHTML = st.cart.map(function (l) {
      return '<div style="display:flex;gap:12px;align-items:center;margin:10px 0"><img src="' + l.thumb + '" alt="" style="width:44px;height:44px;object-fit:contain;background:#fff;border-radius:6px;border:1px solid #e3e8ee"><span>' + l.opts.qty + ' × ' + l.opts.size + ' in sticker</span></div>';
    }).join('');
    document.querySelector('[data-form]').addEventListener('submit', function (e) {
      e.preventDefault();
      var n = String(Math.floor(1000 + Math.random() * 8999));
      var id = 'PL-' + n;
      st.orders[id] = { id: id, total_cents: st.pending.total_cents, lines: st.cart, email: document.getElementById('email').value || 'you@example.com', created: Date.now() };
      st.lastOrder = id;
      st.cart = []; st.draft = {}; delete st.pending;
      save();
      location.href = 'success.html?order=' + id;
    });
  };

  pages.success = function () {
    var st = load();
    var id = new URLSearchParams(location.search).get('order') || st.lastOrder;
    var o = st.orders[id];
    if (!o) { document.querySelector('[data-order-id]').textContent = 'unknown'; return; }
    document.querySelector('[data-order-id]').textContent = o.id;
    document.querySelector('[data-email]').textContent = o.email;
    document.querySelector('[data-paid]').textContent = money(o.total_cents);
    document.querySelector('[data-track]').href = 'order.html?order=' + o.id;
    document.querySelector('[data-thumbs]').innerHTML = o.lines.map(function (l) { return '<img src="' + l.thumb + '" alt="" style="width:120px">'; }).join('');
    refreshCount();
    document.body.dataset.ready = '1';
  };

  pages.order = function () {
    var st = load();
    var id = new URLSearchParams(location.search).get('order') || st.lastOrder;
    var o = id && st.orders[id];
    var hold = sim('review');
    document.querySelector('[data-order-id]').textContent = o ? o.id : 'PL-0000 (example)';
    document.querySelector('[data-total]').textContent = o ? money(o.total_cents) : '—';
    var steps = [
      ['Paid', 'We got your order.'],
      ['Checked', hold ? 'A person is taking a closer look at your photo. We’ll email you within one business day.' : 'Every design gets a quick human check before printing.'],
      ['Printing', 'Your stickers are being printed and cut.'],
      ['Shipped', 'Tracking number appears here.'],
      ['Delivered', '']
    ];
    var now = hold ? 1 : 1;
    document.querySelector('[data-timeline]').innerHTML = steps.map(function (s, i) {
      return '<li class="' + (i < now ? 'done' : i === now ? 'now' : '') + '"><b>' + s[0] + '</b><div class="when">' + s[1] + '</div></li>';
    }).join('');
    document.querySelector('[data-hold]').hidden = !hold;
    document.body.dataset.ready = '1';
  };

  pages.email = function () {
    var st = load();
    var o = st.orders[st.lastOrder];
    if (o) {
      document.querySelector('[data-order-id]').textContent = o.id;
      document.querySelector('[data-total]').textContent = money(o.total_cents);
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    chrome();
    var f = pages[document.body.dataset.page];
    if (f) f();
  });

  window.Peelings = { quoteLine: quoteLine, quoteCart: quoteCart, loadPricing: loadPricing };
})();
