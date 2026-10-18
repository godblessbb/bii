/* 站长编辑器：直接在文章页上改字，保存成 GitHub 上的一条提交。
   只有在 js/app.js 里连按三次 E 之后才会加载这个文件；访客不加载，也就没有这里的任何元素、样式和请求。
   站长和访客怎么分：不靠页面判断，靠 GitHub —— 保存时没有仓库写权限的 Token 会被 GitHub 拒绝。

   - Token 只存在这台浏览器的 localStorage（datode-edit-token），只放进发往 api.github.com 的请求头，
     不进 URL、不进 DOM 属性、不打印。
   - 块：正文按 marked.lexer 的顶层 token 切，编辑框里是这一块的 token.raw（markdown 原文）。
   - 保存：从 Contents API 取当前文件和 sha，只替换这一块原文对应的那段字节（BOM、换行、其余每个字节原样），
     带着 sha PUT 回去；sha 对不上（409）就不覆盖。
   - 渲染：仍是 app.js 那条路径（marked + 现有装饰），这里只换上一个给顶层块标序号的钩子。 */
(function () {
  'use strict';

  var API = 'https://api.github.com';
  var REPO = 'godblessbb/bii';
  var TOKEN_KEY = 'datode-edit-token';
  var CSS_HREF = 'css/edit.css?v=20261018';
  var KIND = { paragraph: '段落', heading: '标题', list: '列表', blockquote: '引用', table: '表格', code: '代码', hr: '分隔线', html: 'HTML' };

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return s.replace(/\r\n|\r/g, '\n'); }   // 与 marked.lexer 内部做的一样

  /* ---------------- UTF-8 / base64 ---------------- */
  var enc = new TextEncoder();
  function utf8(s) { return enc.encode(s); }
  function decodeUtf8(bytes) { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }   // 开头的 BOM 会被去掉，与 fetch().text() 一致
  function fromB64(b64) {
    var bin = atob(String(b64).replace(/\s+/g, ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function toB64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function concatBytes(parts) {
    var n = 0, i, off = 0;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n);
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }
  // 换行归一后的第 n 个字符，在原文里是第几个（\r\n 在归一后只算一个）
  function origIndex(text, n) {
    var i = 0, k = 0;
    while (k < n && i < text.length) { i += text.charAt(i) === '\r' && text.charAt(i + 1) === '\n' ? 2 : 1; k++; }
    return i;
  }

  /* ---------------- GitHub ---------------- */
  function gh(token, method, path, body) {
    var headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(API + path, {
      method: method, headers: headers, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (t) {
        var json = null;
        try { json = t ? JSON.parse(t) : null; } catch (e) {}
        return { status: res.status, json: json, limited: res.headers.get('x-ratelimit-remaining') === '0' };
      });
    });
  }
  function contentsPath(file) { return '/repos/' + REPO + '/contents/' + file.split('/').map(encodeURIComponent).join('/'); }

  function authReason(r) {
    if (r.status === 401) return 'Token 无效或已过期：到 GitHub 重新生成一个再贴。';
    if (r.status === 403 && r.limited) return 'GitHub 暂时限流了，过几分钟再试。';
    if (r.status === 403) return '这个 Token 没有写 ' + REPO + ' 的权限：Permissions → Contents 要选 Read and write。';
    if (r.status === 404) return '这个 Token 看不到 ' + REPO + '：仓库选错了，或创建时 Repository access 里没选这个仓库。';
    return '';
  }

  // 先看 Token 能不能读到这个仓库，再用一个缺字段的 PUT 试写权限：
  // 有写权限时 GitHub 只会因缺 message / content 回 422，什么都不写；没有写权限回 403。
  function verifyToken(token) {
    return gh(token, 'GET', '/repos/' + REPO).then(function (r) {
      if (r.status !== 200) return authReason(r) || '校验没通过（GitHub 返回 HTTP ' + r.status + '）。';
      if (!r.json || String(r.json.full_name).toLowerCase() !== REPO) return '这个 Token 指向的不是 ' + REPO + '。';
      if (r.json.permissions && r.json.permissions.push === false) return '这个 Token 的账号对 ' + REPO + ' 没有写权限。';
      return gh(token, 'PUT', contentsPath('README.md'), {}).then(function (p) {
        if (p.status === 422 || p.status === 200 || p.status === 201) return '';
        return authReason(p) || '校验没通过（GitHub 返回 HTTP ' + p.status + '）。';
      });
    }, function () { return '连不上 api.github.com，检查网络后再试。'; });
  }

  function readToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }

  window.DatodeEdit = function (site) {
    var root = document.documentElement;
    var view = site.view;
    var token = readToken();
    var on = false;
    var cssLink = null, bar = null, dialog = null, hint = null;
    var editor = null;      // 正在改的那一块
    var lexCache = [];      // [{ md, tokens }]：渲染时切出来的顶层 token，点哪一块就按它的序号回到原文

    /* ---------------- 渲染钩子：每个顶层 token 单独过 marked，第一个元素标上 data-edit-block ---------------- */
    function hook(md, opts) {
      var tokens = window.marked.lexer(md, opts);
      lexCache = lexCache.filter(function (c) { return c.md !== md; }).slice(-5);
      lexCache.push({ md: md, tokens: tokens });
      var out = '';
      for (var i = 0; i < tokens.length; i++) {
        var one = [tokens[i]];
        one.links = tokens.links;
        out += window.marked.parser(one, opts).replace(/^(\s*<[a-zA-Z][a-zA-Z0-9-]*)(?=[\s>\/])/, '$1 data-edit-block="' + i + '"');
      }
      return out;
    }
    function tokensFor(md) {
      for (var i = lexCache.length - 1; i >= 0; i--) if (lexCache[i].md === md) return lexCache[i].tokens;
      return window.marked.lexer(md, { gfm: true });
    }

    /* ---------------- 界面零件 ---------------- */
    function el(tag, cls, html) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      n.setAttribute('data-edit-ui', '');
      if (html != null) n.innerHTML = html;
      return n;
    }
    function loadCss() {
      return new Promise(function (resolve) {
        if (cssLink) return resolve();
        cssLink = el('link');
        cssLink.rel = 'stylesheet';
        cssLink.href = CSS_HREF;
        cssLink.onload = cssLink.onerror = function () { resolve(); };
        document.head.appendChild(cssLink);
      });
    }

    function showDialog() {
      if (dialog) return;
      dialog = el('div', 'ed-dialog',
        '<div class="ed-card" role="dialog" aria-modal="true" aria-labelledby="ed-card-t">' +
          '<p class="kicker">站长编辑</p>' +
          '<h2 class="ed-card-t" id="ed-card-t">贴一个 GitHub Token</h2>' +
          '<div class="ed-card-d">用 fine-grained Token：Repository access 只选 ' + esc(REPO) + '，Permissions 里 Contents 选 Read and write。' +
            '它只存在这台浏览器的 localStorage，只发往 api.github.com。</div>' +
          '<input class="ed-input" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…" aria-label="GitHub Token">' +
          '<div class="ed-msg" role="alert"></div>' +
          '<div class="ed-actions"><button class="btn btn-solid" type="button" data-ed="verify">校验并进入编辑</button><button class="btn" type="button" data-ed="close">取消</button></div>' +
        '</div>');
      document.body.appendChild(dialog);
      var input = dialog.querySelector('.ed-input');
      var msg = dialog.querySelector('.ed-msg');
      var go = dialog.querySelector('[data-ed="verify"]');
      function submit() {
        var t = input.value.trim();
        if (!t) { msg.textContent = '先把 Token 贴进来。'; return; }
        go.disabled = true;
        msg.textContent = '正在向 GitHub 校验……';
        verifyToken(t).then(function (reason) {
          go.disabled = false;
          if (reason) { msg.textContent = reason; return; }
          input.value = '';
          try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { msg.textContent = '这台浏览器不让存 localStorage，没法记住 Token。'; return; }
          token = t;
          closeDialog();
          enter();
        });
      }
      go.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      dialog.querySelector('[data-ed="close"]').addEventListener('click', closeDialog);
      dialog.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDialog(); });
      input.focus();
    }
    function closeDialog() {
      if (!dialog) return;
      dialog.parentNode.removeChild(dialog);
      dialog = null;
      if (!on) teardownUi();
    }

    function showBar() {
      if (bar) return;
      bar = el('div', 'ed-bar',
        '<span class="ed-bar-t">编辑模式</span><span class="ed-bar-s" aria-live="polite"></span>' +
        '<button class="btn" type="button" data-ed="exit">退出编辑</button>' +
        '<button class="btn" type="button" data-ed="forget">忘掉 Token</button>');
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', '编辑模式');
      bar.querySelector('[data-ed="exit"]').addEventListener('click', exit);
      bar.querySelector('[data-ed="forget"]').addEventListener('click', forget);
      document.body.appendChild(bar);
      hint = el('div', 'ed-hint', '点一下，改这一块');
      hint.hidden = true;
      document.body.appendChild(hint);
    }
    function barSay(html) { if (bar) bar.querySelector('.ed-bar-s').innerHTML = html; }
    function defaultBarText() {
      var path = site.editablePath();
      barSay(path && site.getMd(path) != null ? '点正文里任意一块就能改' : '这一页没有可以改的正文');
    }

    function teardownUi() {
      [bar, hint, dialog, cssLink].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
      bar = hint = dialog = cssLink = null;
    }

    /* ---------------- 进出编辑模式 ---------------- */
    function open() {
      loadCss().then(function () {
        if (on) { defaultBarText(); return; }
        if (token) enter(); else showDialog();
      });
    }
    function enter() {
      on = true;
      root.setAttribute('data-editing', '');
      showBar();
      site.setHook(hook);
      if (site.editablePath()) site.remount();
      defaultBarText();
      document.addEventListener('click', onClick, true);
      document.addEventListener('mouseover', onOver);
      window.addEventListener('beforeunload', onLeave);
    }
    function exit() {
      on = false;
      editor = null;
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mouseover', onOver);
      window.removeEventListener('beforeunload', onLeave);
      site.setHook(null);
      root.removeAttribute('data-editing');
      teardownUi();
      if (site.editablePath()) site.remount();   // 不带序号重排一遍，页面回到访客看到的样子
    }
    function forget() {
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
      token = '';
      exit();
    }
    function onLeave(e) {
      if (editor && editor.dirty()) { e.preventDefault(); e.returnValue = ''; }
    }
    // app.js 每次重挂正文都会叫这里：旧的编辑框已随旧 DOM 一起没了
    function mounted() {
      if (!on) return;
      editor = null;
      if (hint) hint.hidden = true;
      defaultBarText();
    }

    /* ---------------- 悬停提示 ---------------- */
    function blockOf(t) {
      var b = t && t.closest ? t.closest('[data-edit-block]') : null;
      return b && view.contains(b) && !b.closest('[data-edit-ui]') && !b.classList.contains('ed-hidden') ? b : null;
    }
    function onOver(e) {
      if (!hint) return;
      var b = editor ? null : blockOf(e.target);
      if (!b) { hint.hidden = true; return; }
      var r = b.getBoundingClientRect();
      hint.hidden = false;
      // 放在虚线框右上角的上方，不压住这一块和上一块的字
      hint.style.left = Math.max(8, r.right + 6 + window.scrollX - hint.offsetWidth) + 'px';
      hint.style.top = Math.max(8, r.top - 8 + window.scrollY - hint.offsetHeight) + 'px';
    }
    function onClick(e) {
      var b = blockOf(e.target);
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      if (editor) {
        if (editor.has(b)) return;
        if (editor.dirty()) { editor.say('先把正在改的这一块保存或取消，再去改别的。', 'warn'); editor.focus(); return; }
        editor.close();
      }
      if (hint) hint.hidden = true;
      defaultBarText();
      openBlock(b, e.target);
    }

    /* ---------------- 一块的编辑框 ---------------- */
    function openBlock(b, target) {
      var path = site.editablePath();
      var text = path ? site.getMd(path) : null;
      if (text == null) return;
      var n = norm(text);
      var tokens = tokensFor(text);
      if (tokens.map(function (t) { return t.raw; }).join('') !== n) { barSay('这一页的原文切块对不上，为了不碰坏别的字，不在网页里改。'); return; }
      var idx = +b.getAttribute('data-edit-block');
      var tok = tokens[idx];
      if (!tok) return;
      var start = 0;
      for (var i = 0; i < idx; i++) start += tokens[i].raw.length;
      var raw = tok.raw;
      var core = raw.replace(/\n+$/, '');          // 块后面的换行 / 空行不放进编辑框，保存时原样留着
      var visible = 0;
      for (var j = 0; j <= idx; j++) if (tokens[j].type !== 'space') visible++;
      var line0 = n.slice(0, start).split('\n').length;
      var line1 = line0 + core.split('\n').length - 1;
      var file = path + '.md';
      var label = '第 ' + visible + ' 块（' + (KIND[tok.type] || tok.type) + '，第 ' + line0 + (line1 > line0 ? '–' + line1 : '') + ' 行）';

      var els = Array.prototype.slice.call(view.querySelectorAll('[data-edit-block="' + idx + '"]')).map(function (x) {
        return x.parentNode && x.parentNode.classList && x.parentNode.classList.contains('table-wrap') ? x.parentNode : x;
      });
      var anchor = els[els.length - 1];
      els.forEach(function (x) { x.classList.add('ed-hidden'); });

      var panel = el('div', 'ed-panel',
        '<div class="ed-where">' + esc(file) + ' · ' + esc(label) + '</div>' +
        '<textarea class="ed-area" spellcheck="false" aria-label="这一块的 Markdown 原文"></textarea>' +
        '<div class="ed-notes" aria-live="polite"></div>' +
        '<div class="ed-actions">' +
          '<button class="btn btn-solid" type="button" data-ed="save">保存</button>' +
          '<button class="btn" type="button" data-ed="preview">预览</button>' +
          '<button class="btn" type="button" data-ed="cancel">取消</button>' +
          '<span class="ed-status" aria-live="polite"></span>' +
        '</div>');
      anchor.parentNode.insertBefore(panel, anchor.nextSibling);
      var area = panel.querySelector('.ed-area');
      var notes = panel.querySelector('.ed-notes');
      var status = panel.querySelector('.ed-status');
      var btnSave = panel.querySelector('[data-ed="save"]');
      var btnPrev = panel.querySelector('[data-ed="preview"]');
      var previewNodes = [];
      var busy = false;
      var paper = site.paper(path);
      var known = {};
      Array.from(text).forEach(function (ch) { known[ch] = true; });

      area.value = core;
      function grow() {
        area.style.height = 'auto';
        area.style.height = Math.min(area.scrollHeight + 2, Math.round(window.innerHeight * 0.7)) + 'px';
      }
      grow();

      // 点的是列表里的某一条：光标放到那一条的原文开头
      var caret = 0;
      if (tok.type === 'list' && tok.items && target.closest) {
        var li = target.closest('li');
        while (li && li.parentNode !== b) li = li.parentNode && li.parentNode.closest ? li.parentNode.closest('li') : null;
        if (li) {
          var lis = Array.prototype.filter.call(b.children, function (c) { return c.tagName === 'LI' && !c.classList.contains('wb-sep'); });
          var k = lis.indexOf(li), pos = 0;
          for (var m = 0; m <= k && m < tok.items.length; m++) {
            var at = core.indexOf(tok.items[m].raw.replace(/\n+$/, ''), pos);
            if (at < 0) break;
            caret = at;
            pos = at + 1;
          }
        }
      }
      area.focus({ preventScroll: true });
      area.setSelectionRange(caret, caret);
      if (caret) {
        area.value = core.slice(0, caret);
        var h = area.scrollHeight;
        area.value = core;
        area.setSelectionRange(caret, caret);
        area.scrollTop = Math.max(0, h - area.clientHeight / 3);
      }
      // 编辑框没整个露出来（比如很长的列表换成了编辑框）：把它的头挪到顶栏下面
      var pr = panel.getBoundingClientRect();
      if (pr.top < 80 || pr.bottom > window.innerHeight - 70) window.scrollBy(0, pr.top - 90);

      function draft() { return area.value.replace(/\n+$/, ''); }
      function draftText() { return n.slice(0, start) + draft() + n.slice(start + core.length); }
      function say(msg, kind) { status.textContent = msg; status.setAttribute('data-kind', kind || ''); }
      function note(key, html, kind) {
        var x = notes.querySelector('[data-note="' + key + '"]');
        if (!html) { if (x) x.parentNode.removeChild(x); return null; }
        if (!x) { x = document.createElement('div'); x.setAttribute('data-note', key); notes.appendChild(x); }
        x.className = 'ed-note' + (kind ? ' is-' + kind : '');
        x.innerHTML = html;
        return x;
      }
      // 纸页用的是只含现有字的文楷子集：原文件里没有的字，子集里多半也没有
      function checkGlyphs() {
        if (!paper) return;
        var seen = {}, miss = [];
        Array.from(draft()).forEach(function (ch) {
          if (!/\s/.test(ch) && !known[ch] && !seen[ch]) { seen[ch] = true; miss.push(ch); }
        });
        note('glyph', miss.length ? '这些字原文里没有，字体子集里可能也没有，会用系统字体显示：<b>' + esc(miss.join(' ')) + '</b>' : '', 'info');
      }
      // 用 app.js 同一条渲染路径排新旧两版，看哪张小画在新版里挂不上了
      function lostSketches(newText) {
        var sk = site.sketches(path);
        if (!sk.length) return [];
        function hung(md) {
          var t = document.createElement('template');
          t.innerHTML = site.renderWith(path, md);
          var got = {};
          Array.prototype.forEach.call(t.content.querySelectorAll('[data-illustrates]'), function (x) { got[x.getAttribute('data-illustrates')] = true; });
          return got;
        }
        var before = hung(n), after = hung(newText);
        return sk.filter(function (s) { return before[s.frag] && !after[s.frag]; });
      }
      function sketchNote(lost, withButtons) {
        if (!lost.length) { note('sketch', ''); return null; }
        var html = '<div>改完以后，下面' + (lost.length > 1 ? '这些插画' : '这张插画') + '在正文里找不到原来那句话，会消失：</div><ul class="ed-lost">' +
          lost.map(function (s) { return '<li><code>' + esc(s.src.split('/').pop()) + '</code> 原句「' + esc(s.frag) + '」</li>'; }).join('') + '</ul>';
        if (withButtons) html += '<div class="ed-actions"><button class="btn btn-solid" type="button" data-ed="force">仍然保存</button><button class="btn" type="button" data-ed="back">回去改</button></div>';
        var x = note('sketch', html, 'warn');
        if (withButtons) {
          x.querySelector('[data-ed="force"]').addEventListener('click', function () { note('sketch', ''); save(true); });
          x.querySelector('[data-ed="back"]').addEventListener('click', function () { note('sketch', ''); area.focus(); });
        }
        return x;
      }

      function clearPreview() {
        previewNodes.forEach(function (x) { if (x.parentNode) x.parentNode.removeChild(x); });
        previewNodes = [];
        area.hidden = false;
        btnPrev.textContent = '预览';
      }
      function preview() {
        if (previewNodes.length) { clearPreview(); area.focus(); return; }
        var t2 = draftText();
        var t = document.createElement('template');
        t.innerHTML = site.renderWith(path, t2);
        var delta = Math.max(0, window.marked.lexer(t2, { gfm: true }).length - tokens.length);
        Array.prototype.forEach.call(t.content.querySelectorAll('[data-edit-block]'), function (x) {
          var i2 = +x.getAttribute('data-edit-block');
          if (i2 < idx || i2 > idx + delta) return;
          var node = x.parentNode && x.parentNode.classList && x.parentNode.classList.contains('table-wrap') ? x.parentNode : x;
          node = document.importNode(node, true);
          [node].concat(Array.prototype.slice.call(node.querySelectorAll('[id],[data-edit-block]'))).forEach(function (y) { y.removeAttribute('id'); y.removeAttribute('data-edit-block'); });
          node.classList.add('ed-preview-node');
          node.setAttribute('data-edit-ui', '');
          panel.parentNode.insertBefore(node, panel);
          previewNodes.push(node);
        });
        if (!previewNodes.length) say('这一块预览出来是空的。', 'warn');
        area.hidden = true;
        btnPrev.textContent = '接着改';
        sketchNote(lostSketches(t2), false);
      }

      function close() {
        clearPreview();
        if (panel.parentNode) panel.parentNode.removeChild(panel);
        els.forEach(function (x) { x.classList.remove('ed-hidden'); });
        if (editor === api) editor = null;
      }

      function fail(r) {
        busy = false;
        btnSave.disabled = false;
        if (r.status === 409) { say('GitHub 上的文件在别处改过了（sha 对不上），这次没有覆盖。请刷新页面后重试。', 'err'); return; }
        if (r.status === 422) { say('GitHub 没收下这次修改：' + ((r.json && r.json.message) || 'HTTP 422'), 'err'); return; }
        say(authReason(r) || '保存失败（GitHub 返回 HTTP ' + r.status + '）。', 'err');
      }

      function save(force) {
        if (busy) return;
        var d = draft();
        if (d === core) { say('还没有改动。'); return; }
        if (!d.trim()) { say('这一块不能留空。', 'warn'); return; }
        var t2 = draftText();
        if (!force) {
          var lost = lostSketches(t2);
          if (lost.length) { sketchNote(lost, true); say('有插画会消失，确认后再保存。', 'warn'); return; }
        }
        busy = true;
        btnSave.disabled = true;
        say('正在保存……');
        var file = path + '.md';
        gh(token, 'GET', contentsPath(file)).then(function (r) {
          if (r.status !== 200 || !r.json || r.json.encoding !== 'base64' || typeof r.json.sha !== 'string') return fail(r);
          var bytes = fromB64(r.json.content);
          var bom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF ? 3 : 0;
          var remote;
          try { remote = decodeUtf8(bytes); } catch (e) { busy = false; btnSave.disabled = false; say('GitHub 上的文件不是合法的 UTF-8，不在网页里改。', 'err'); return; }
          if (remote !== text) {
            busy = false; btnSave.disabled = false;
            say('GitHub 上的 ' + file + ' 已经和这页显示的不一样了（可能别处刚改过），这次没有保存。刷新页面后重试；线上更新可能要等一两分钟。', 'err');
            return;
          }
          // 只换这一块：原文里 [s, e) 这一段（块后的换行不在里面），换行沿用这一段原来的写法
          var s = origIndex(text, start), e = origIndex(text, start + core.length);
          var seg = text.slice(s, e);
          var eol = /\r\n/.test(seg) ? '\r\n' : /\n/.test(seg) ? '\n' : /\r\n/.test(text) ? '\r\n' : '\n';
          var bs = bom + utf8(text.slice(0, s)).length, be = bs + utf8(seg).length;
          var newBytes = concatBytes([bytes.subarray(0, bs), utf8(d.replace(/\n/g, eol)), bytes.subarray(be)]);
          var after = decodeUtf8(newBytes);
          var head = d.replace(/\s+/g, ' ').trim();
          var message = '网页编辑：' + file + ' ' + label + '\n\n改后开头：' + (Array.from(head).length > 40 ? Array.from(head).slice(0, 40).join('') + '…' : head);
          return gh(token, 'PUT', contentsPath(file), { message: message, content: toB64(newBytes), sha: r.json.sha }).then(function (p) {
            if (p.status !== 200 && p.status !== 201) return fail(p);
            var commit = p.json && p.json.commit;
            site.setMd(path, text, after);
            editor = null;
            site.remount();
            var sha = commit && commit.sha ? String(commit.sha).slice(0, 7) : '';
            var url = commit && commit.html_url && /^https:\/\/github\.com\//.test(commit.html_url) ? commit.html_url : '';
            barSay('已保存' + (sha ? '（提交 ' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(sha) + '</a>' : esc(sha)) + '）' : '') + '，线上约半分钟后更新');
          });
        }).catch(function () { busy = false; btnSave.disabled = false; say('连不上 api.github.com，没有保存。', 'err'); });
      }

      area.addEventListener('input', function () { grow(); checkGlyphs(); note('sketch', ''); say(''); });
      area.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(false); }
      });
      btnSave.addEventListener('click', function () { save(false); });
      btnPrev.addEventListener('click', preview);
      panel.querySelector('[data-ed="cancel"]').addEventListener('click', close);
      checkGlyphs();

      var api = {
        has: function (x) { return els.indexOf(x) >= 0 || els.indexOf(x.parentNode) >= 0; },
        dirty: function () { return draft() !== core; },
        say: say,
        focus: function () { if (!area.hidden) area.focus(); },
        close: close
      };
      editor = api;
    }

    return { open: open, mounted: mounted };
  };
})();
