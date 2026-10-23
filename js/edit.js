/* 站长编辑器：直接在文章页上改字，保存成 GitHub 上的一条提交。
   只有在 js/app.js 里连按三次 E 之后才会加载这个文件；访客不加载，也就没有这里的任何元素、样式和请求。
   站长和访客怎么分：不靠页面判断，靠 GitHub —— 保存时没有仓库写权限的 Token 会被 GitHub 拒绝。

   - Token 只存在这台浏览器的 localStorage（datode-edit-token），只放进发往 api.github.com 的请求头，
     不进 URL、不进 DOM 属性、不打印。
   - 块：正文按 marked.lexer 的顶层 token 切，编辑框里是这一块的 token.raw（markdown 原文）。
   - 保存：从 Contents API 取当前文件和 sha，只替换这一块原文对应的那段字节（BOM、换行、其余每个字节原样），
     带着 sha PUT 回去；sha 对不上（409）就不覆盖。
   - 渲染：仍是 app.js 那条路径（marked + 现有装饰），这里只换上一个给顶层块标序号的钩子。
   - 按编号删一条（微博合辑 / 百变动态合集）：见下面「按编号删除」一节，md 修改和删图走 Git Data API 合成一个提交。 */
(function () {
  'use strict';

  var API = 'https://api.github.com';
  var REPO = 'godblessbb/bii';
  var TOKEN_KEY = 'datode-edit-token';
  var CSS_HREF = 'css/edit.css?v=20261022-del';
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

  /* ---------------- 配图标记 ----------------
     百变动态合集里，一条动态的文字下面紧跟一行只有缩略图标记的 ![](media/…/s/<id>_<NN>-<宽>x<高>.jpg)（app.js 的 paperPics 把它排成图组）。
     这一行不是正文：编辑框里不放它，框下说明这一块有几条带图；保存 / 预览时按「它跟着哪条文字」放回去 ——
     那条文字没动就原样放回原处；改过字的，放回改后最像它的那一条（只在改过 / 新加的条目里找）；
     那条被删了、找不到了，就和插画一样先警告「会消失」，确认了才保存。 */
  var PIC_LINE = /^[ \t]+(?:!\[[^\]]*\]\([^()\s]*\/s\/[^()\s\/]+-\d+x\d+\.jpg\))+[ \t]*$/;
  var ITEM_START = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?: |$)/;
  function picText(s) { return s.replace(/^ {0,3}(?:[-*+]|\d{1,9}[.)]) ?/, '').replace(/<br\s*\/?>/gi, '').replace(/\s+/g, ''); }
  // 一段原文切成条目：每条从列表标记那一行起，到下一条之前；last 是这一条最后一个非空行
  function picItems(lines) {
    var items = [], cur = null;
    lines.forEach(function (l, i) {
      if (ITEM_START.test(l)) { cur = { first: i, last: i, text: '' }; items.push(cur); }
      if (!cur) return;
      if (l.trim()) cur.last = i;
      cur.text += picText(l);
    });
    return items;
  }
  // 去掉配图行：{ shown: 编辑框里的字, groups: [{ line, text }] }；配图行不紧跟在一条文字后面时返回 null（不拆，原样给人看）
  function splitPics(core) {
    var lines = core.split('\n'), kept = [], groups = [], item = null;
    for (var i = 0; i < lines.length; i++) {
      if (ITEM_START.test(lines[i])) item = { text: '' };
      if (PIC_LINE.test(lines[i])) {
        if (!item || !kept.length || !kept[kept.length - 1].trim()) return null;
        groups.push({ line: lines[i], text: item.text, item: item });
        continue;
      }
      if (item) item.text += picText(lines[i]);
      kept.push(lines[i]);
    }
    if (!groups.length) return null;
    var out = { shown: kept.join('\n'), groups: groups };
    return joinPics(out, out.shown).text === core ? out : null;
  }
  function bigrams(s) { var a = Array.from(s), o = {}; for (var i = 0; i + 1 < a.length; i++) o[a[i] + a[i + 1]] = (o[a[i] + a[i + 1]] || 0) + 1; return o; }
  function likeness(a, b) {
    if (!a || !b) return 0;
    var x = bigrams(a), y = bigrams(b), both = 0, n = 0, k;
    for (k in x) { n += x[k]; if (y[k]) both += Math.min(x[k], y[k]); }
    for (k in y) n += y[k];
    return n ? 2 * both / n : 0;
  }
  // 把配图行放回 draft：{ text: 完整原文, lost: [没处放的组] }
  function joinPics(sp, draft) {
    var lines = draft.split('\n'), items = picItems(lines), owner = new Array(sp.groups.length), taken = {};
    var before = {};
    sp.groups.forEach(function (g) { before[g.item.text] = true; });
    picItems(sp.shown.split('\n')).forEach(function (it) { before[it.text] = true; });
    sp.groups.forEach(function (g, gi) {
      for (var i = 0; i < items.length; i++) if (!taken[i] && items[i].text === g.item.text) { owner[gi] = i; taken[i] = true; return; }
    });
    sp.groups.forEach(function (g, gi) {
      if (owner[gi] != null) return;
      var best = -1, score = 0.5;
      for (var i = 0; i < items.length; i++) {
        if (taken[i] || before[items[i].text]) continue;
        var r = likeness(items[i].text, g.item.text);
        if (r >= score) { score = r; best = i; }
      }
      if (best >= 0) { owner[gi] = best; taken[best] = true; }
    });
    var after = {};
    owner.forEach(function (i, gi) { if (i != null) after[items[i].last] = sp.groups[gi].line; });
    var out = [];
    lines.forEach(function (l, i) { out.push(l); if (after[i] != null) out.push(after[i]); });
    return { text: out.join('\n'), lost: sp.groups.filter(function (g, gi) { return owner[gi] == null; }) };
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

  /* ---------------- 一段 md 里引用的站内图片 ----------------
     ![](…) 和 <img src="…">，按 md 所在目录解析成仓库路径（与 app.js 的 resolvePath 同一规则）；外链、data: 不算。
     配图缩略图 <dir>/s/<名>-<宽>x<高>.jpg 和它的原图 <dir>/<名>.jpg 算同一张：要删一起删，要留一起留。 */
  var THUMB_RE = /^(.*\/)s\/([^\/]+)-(\d+)x(\d+)\.jpg$/;
  function repoPath(dir, src) {
    var parts = src.charAt(0) === '/' ? [] : (dir ? dir.split('/') : []);
    src.split(/[?#]/)[0].split('/').forEach(function (seg) {
      if (seg === '..') parts.pop();
      else if (seg !== '.' && seg !== '') parts.push(seg);
    });
    try { return decodeURIComponent(parts.join('/')); } catch (e) { return parts.join('/'); }
  }
  function picGroups(md, dir) {
    var out = [], seen = {}, m;
    var re = /!\[[^\]]*\]\(\s*<?([^()\s<>]+)>?(?:\s+["'][^"']*["'])?\s*\)|<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
    while ((m = re.exec(md))) {
      var src = (m[1] || m[2]).trim();
      if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) continue;
      var p = repoPath(dir, src);
      if (!p || seen[p]) continue;
      seen[p] = true;
      var t = THUMB_RE.exec(p);
      out.push(t ? [p, t[1] + t[2] + '.jpg'] : [p]);
    }
    return out;
  }
  function baseName(p) { return p.slice(p.lastIndexOf('/') + 1); }

  window.DatodeEdit = function (site) {
    var root = document.documentElement;
    var view = site.view;
    var token = readToken();
    var on = false;
    var cssLink = null, bar = null, dialog = null, hint = null;
    var editor = null;      // 正在改的那一块
    var lexCache = [];      // [{ md, tokens }]：渲染时切出来的顶层 token，点哪一块就按它的序号回到原文
    var dels = null, delsRO = null, delsRaf = 0;   // 每条编号旁边的「删除」按钮层
    var asking = null;      // 正开着的删除确认框

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
          enter();          // 先进编辑模式再关对话框：关的时候 on 已经是 true，不会把刚挂上的 edit.css 一起摘掉
          closeDialog();
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
      clearDels();
      if (asking) asking.close();
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
      buildDels();
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
      if (asking && !asking.busy()) asking.close();
      defaultBarText();
      buildDels();
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
      var pics = splitPics(core);                  // 有配图行：框里只放文字，配图行另记着
      var shown = pics ? pics.shown : core;
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
      queuePlace();
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

      area.value = shown;
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
            var itemRaw = tok.items[m].raw.replace(/\n+$/, '');
            if (pics) itemRaw = itemRaw.split('\n').filter(function (l) { return !PIC_LINE.test(l); }).join('\n').replace(/\n+$/, '');
            var at = shown.indexOf(itemRaw, pos);
            if (at < 0) break;
            caret = at;
            pos = at + 1;
          }
        }
      }
      area.focus({ preventScroll: true });
      area.setSelectionRange(caret, caret);
      if (caret) {
        area.value = shown.slice(0, caret);
        var h = area.scrollHeight;
        area.value = shown;
        area.setSelectionRange(caret, caret);
        area.scrollTop = Math.max(0, h - area.clientHeight / 3);
      }
      // 编辑框没整个露出来（比如很长的列表换成了编辑框）：把它的头挪到顶栏下面
      var pr = panel.getBoundingClientRect();
      if (pr.top < 80 || pr.bottom > window.innerHeight - 70) window.scrollBy(0, pr.top - 90);

      function draft() { return area.value.replace(/\n+$/, ''); }
      function joined() { return pics ? joinPics(pics, draft()) : { text: draft(), lost: [] }; }   // 放回配图行之后的这一块
      function draftText(j) { return n.slice(0, start) + (j || joined()).text + n.slice(start + core.length); }
      function say(msg, kind) { status.textContent = msg; status.setAttribute('data-kind', kind || ''); }
      function note(key, html, kind) {
        var x = notes.querySelector('[data-note="' + key + '"]');
        if (!html) { if (x) x.parentNode.removeChild(x); return null; }
        if (!x) { x = document.createElement('div'); x.setAttribute('data-note', key); notes.appendChild(x); }
        x.className = 'ed-note' + (kind ? ' is-' + kind : '');
        x.innerHTML = html;
        return x;
      }
      // 纸页先用只含现有字的文楷小子集，缺的字落到按 GB2312 切片的整套文楷（css/wenkai-gb.css，7445 字，用到哪片才下载哪片）。
      // 只有这两层都没有的字才会退回系统字体；覆盖范围直接读那份 CSS 声明的 unicode-range，不另存一份名单
      var gbRanges = null;
      function gbCovers(ch) {
        if (!gbRanges) {
          gbRanges = [];
          document.fonts.forEach(function (f) {
            if (f.family.replace(/["']/g, '') !== 'WenKaiGB') return;
            f.unicodeRange.split(',').forEach(function (r) {
              var m = /U\+([0-9A-F]+)(?:-([0-9A-F]+))?/i.exec(r.trim());
              if (m) gbRanges.push([parseInt(m[1], 16), parseInt(m[2] || m[1], 16)]);
            });
          });
        }
        var cp = ch.codePointAt(0);
        return cp < 0x80 || gbRanges.some(function (r) { return cp >= r[0] && cp <= r[1]; });
      }
      function checkGlyphs() {
        if (!paper) return;
        var seen = {}, miss = [];
        Array.from(draft()).forEach(function (ch) {
          if (!/\s/.test(ch) && !known[ch] && !gbCovers(ch) && !seen[ch]) { seen[ch] = true; miss.push(ch); }
        });
        note('glyph', miss.length ? '这些字不在文楷常用字库（GB2312）里，会用系统字体显示：<b>' + esc(miss.join(' ')) + '</b>' : '', 'info');
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
      function sketchNote(lost, withButtons, lostPics) {
        lostPics = lostPics || [];
        if (!lost.length && !lostPics.length) { note('sketch', ''); return null; }
        var html = '';
        if (lost.length) html += '<div>改完以后，下面' + (lost.length > 1 ? '这些插画' : '这张插画') + '在正文里找不到原来那句话，会消失：</div><ul class="ed-lost">' +
          lost.map(function (s) { return '<li><code>' + esc(s.src.split('/').pop()) + '</code> 原句「' + esc(s.frag) + '」</li>'; }).join('') + '</ul>';
        if (lostPics.length) html += '<div>改完以后，下面' + (lostPics.length > 1 ? '这几条动态' : '这条动态') + '的配图找不到原来那条文字，会消失：</div><ul class="ed-lost">' +
          lostPics.map(function (g) {
            var names = g.line.match(/[^\/()]+-\d+x\d+\.jpg/g) || [];
            var head = Array.from(g.item.text);
            return '<li><code>' + esc(names.map(function (x) { return x.replace(/-\d+x\d+\.jpg$/, '.jpg'); }).join(' ')) + '</code> 原文「' + esc(head.slice(0, 24).join('') + (head.length > 24 ? '…' : '')) + '」</li>';
          }).join('') + '</ul>';
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
        var j = joined();
        var t2 = draftText(j);
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
        sketchNote(lostSketches(t2), false, j.lost);
      }

      function close() {
        clearPreview();
        if (panel.parentNode) panel.parentNode.removeChild(panel);
        els.forEach(function (x) { x.classList.remove('ed-hidden'); });
        if (editor === api) editor = null;
        queuePlace();
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
        if (d === shown) { say('还没有改动。'); return; }
        if (!d.trim()) { say('这一块不能留空。', 'warn'); return; }
        var j = joined();
        var t2 = draftText(j);
        if (!force) {
          var lost = lostSketches(t2);
          if (lost.length || j.lost.length) { sketchNote(lost, true, j.lost); say((lost.length ? '有插画' : '有配图') + '会消失，确认后再保存。', 'warn'); return; }
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
          var newBytes = concatBytes([bytes.subarray(0, bs), utf8(j.text.replace(/\n/g, eol)), bytes.subarray(be)]);
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
      if (pics) {
        var nPics = pics.groups.reduce(function (k, g) { return k + (g.line.match(/!\[/g) || []).length; }, 0);
        note('pics', '这一块里有 ' + pics.groups.length + ' 条动态带图（共 ' + nPics + ' 张）。图片标记不在框里，保存时会自动放回原来那条文字下面；改字不影响，整条删掉的话它的图也会消失（保存前会提醒）。', 'info');
      }
      area.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(false); }
      });
      btnSave.addEventListener('click', function () { save(false); });
      btnPrev.addEventListener('click', preview);
      panel.querySelector('[data-ed="cancel"]').addEventListener('click', close);
      checkGlyphs();

      var api = {
        has: function (x) { return els.indexOf(x) >= 0 || els.indexOf(x.parentNode) >= 0; },
        dirty: function () { return draft() !== shown; },
        say: say,
        focus: function () { if (!area.hidden) area.focus(); },
        close: close
      };
      editor = api;
    }

    /* ---------------- 按编号删除（微博合辑 / 百变动态合集） ----------------
       编辑模式下，每条带编号的条目（顶层列表里的一条 [data-entry]）编号右边有一个「删除」。按钮不进 #view（正文 DOM 仍与访客一字不差），
       而是浮在 body 上的一层里、对准编号摆；正文尺寸一变就重摆，被编辑框替下去的那一块不显示。
       点了先确认：编号、正文开头、附带几张图；这一节只剩这一条的，写明整节一起删。取消不发任何请求。
       确认后做成一个提交（Git Data API：blob → tree → commit → 非强制更新分支）：
         - md 去掉这一条（正文、续行、配图行，连同它和相邻条目之间的空行）；删到空的那一节从 ## 标题起到下一个 ## 之前整节去掉；其余字节原样。
         - 去掉的这段原文引用的图片（缩略图 + 原图），仓库里别的 .md 和删完以后的这份 md 都不再引用的，才从仓库删掉。
         - 分支上的这份 md 和页面显示的不一样、或者这期间分支被别处推进了（不是快进），都不覆盖。 */
    function entryLis() {
      var body = view.querySelector('[data-weibo-body]');
      return body ? Array.prototype.slice.call(body.querySelectorAll('ul[data-edit-block] > li[data-entry]')) : [];
    }
    // 与 app.js 的 wbRenderSeps 同一种数法：正文里每个 ul 的直属条目，按文档顺序从 1 数起，补足三位
    function entryNo(li) {
      var n = 0, at = 0;
      Array.prototype.some.call(li.closest('[data-weibo-body]').querySelectorAll('ul'), function (ul) {
        return Array.prototype.some.call(ul.children, function (x) {
          if (x.hasAttribute('data-entry')) n++;
          if (x === li) at = n;
          return x === li;
        });
      });
      return ('00' + at).slice(-3);
    }

    function clearDels() {
      if (delsRO) { delsRO.disconnect(); delsRO = null; }
      window.removeEventListener('resize', queuePlace);
      if (delsRaf) { cancelAnimationFrame(delsRaf); delsRaf = 0; }
      if (dels && dels.box.parentNode) dels.box.parentNode.removeChild(dels.box);
      dels = null;
    }
    function buildDels() {
      clearDels();
      var lis = on ? entryLis() : [];
      if (!lis.length) return;
      var box = el('div', 'ed-dels');
      dels = { box: box, items: lis.map(function (li) {
        var no = entryNo(li);
        var b = el('button', 'btn ed-del', '删除');
        b.type = 'button';
        b.setAttribute('data-ed', 'del');
        b.setAttribute('data-no', no);
        b.setAttribute('aria-label', '删除第 ' + no + ' 条');
        b.addEventListener('click', function () { askDelete(li, no, b); });
        box.appendChild(b);
        return { b: b, li: li };
      }) };
      document.body.appendChild(box);
      placeDels();
      if (window.ResizeObserver) { delsRO = new ResizeObserver(queuePlace); delsRO.observe(view); }
      window.addEventListener('resize', queuePlace);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(queuePlace);
    }
    function queuePlace() { if (dels && !delsRaf) delsRaf = requestAnimationFrame(placeDels); }
    // 摆在编号那一行、编号右边；没有编号（条间记号换成了点 / 线）就摆在这一条左上角的上方
    function placeDels() {
      delsRaf = 0;
      if (!dels) return;
      var sx = window.scrollX, sy = window.scrollY;
      dels.items.forEach(function (it) {
        var sep = it.li.previousElementSibling;
        var mark = sep && sep.classList.contains('wb-sep-num') ? sep.querySelector('.wb-sep-mark') : null;
        var r = (mark || it.li).getBoundingClientRect();
        it.b.hidden = !it.li.isConnected || !r.width;
        if (it.b.hidden) return;
        var h = it.b.offsetHeight;
        it.b.style.left = Math.round(sx + (mark ? r.right + 10 : r.left)) + 'px';
        it.b.style.top = Math.round(sy + (mark ? r.top + (r.height - h) / 2 : r.top - h - 6)) + 'px';
      });
    }

    function askDelete(li, no, btn) {
      if (asking || !li.isConnected) return;
      if (editor) {
        if (editor.dirty()) { editor.say('先把正在改的这一块保存或取消，再去删别的。', 'warn'); editor.focus(); return; }
        editor.close();
      }
      var plan = planDelete(li);
      if (typeof plan === 'string') { barSay(esc(plan)); return; }
      plan.no = no;
      confirmDelete(plan, btn);
    }

    // 只看本地：这一条在原文里是 [a, b) 这一段（换行归一后的下标），要不要连整节一起去掉，去掉的这段引用了哪些图
    function planDelete(li) {
      var path = site.editablePath();
      var text = path ? site.getMd(path) : null;
      if (text == null) return '这一页没有可以改的正文';
      var n = norm(text);
      var tokens = tokensFor(text);
      if (tokens.map(function (t) { return t.raw; }).join('') !== n) return '这一页的原文切块对不上，为了不碰坏别的字，不在网页里删。';
      var ul = li.parentNode;
      var idx = +ul.getAttribute('data-edit-block');
      var tok = tokens[idx];
      var lis = Array.prototype.filter.call(ul.children, function (c) { return c.tagName === 'LI' && !c.classList.contains('wb-sep'); });
      var k = lis.indexOf(li);
      if (!tok || tok.type !== 'list' || tok.items.length !== lis.length || k < 0) return '这一条和原文对不上，为了不碰坏别的字，不在网页里删。';
      var off = [0], at, i;
      for (i = 0; i < tokens.length; i++) off.push(off[i] + tokens[i].raw.length);
      at = [off[idx]];
      for (i = 0; i < tok.items.length; i++) at.push(at[i] + tok.items[i].raw.length);
      function bodyEnd(j) { return at[j] + tok.items[j].raw.replace(/(?:\n[ \t]*)+$/, '').length; }   // 这一条最后一个字之后（不含它后面的空行）
      // 这一条所在的节：前面最近的 ## 标题起，到下一个 ## 标题之前
      function h2(t) { return t.type === 'heading' && t.depth === 2; }
      var hs = -1, he = tokens.length, count = 0;
      for (i = idx - 1; i >= 0; i--) if (h2(tokens[i])) { hs = i; break; }
      for (i = idx + 1; i < tokens.length; i++) if (h2(tokens[i])) { he = i; break; }
      for (i = hs + 1; i < he; i++) if (tokens[i].type === 'list') count += tokens[i].items.length;
      var chapter = li.closest('.wb-chapter');
      var heading = chapter && chapter.querySelector('h2');
      var title = heading ? heading.textContent.trim() : hs >= 0 ? tokens[hs].text : '';
      // 只有「删到空」才删节：md 里这一节只剩这一条，页面上这一节也只有这一条
      var whole = hs >= 0 && count === 1 && !!chapter && chapter.querySelectorAll('[data-entry]').length === 1;
      var a, b;
      if (whole) { a = off[hs]; b = off[he]; }
      else if (k < tok.items.length - 1) { a = at[k]; b = at[k + 1]; }      // 连同它和下一条之间的空行
      else if (k > 0) { a = bodyEnd(k - 1); b = bodyEnd(k); }                // 列表最后一条：去掉它和上一条之间的空行，列表后面的空行留着
      else { a = off[idx]; b = off[idx + 1] + (tokens[idx + 1] && tokens[idx + 1].type === 'space' ? tokens[idx + 1].raw.length : 0); }   // 列表里只有它、这一节还有别的条目
      var dir = path.indexOf('/') >= 0 ? path.slice(0, path.lastIndexOf('/')) : '';
      var words = Array.from(li.textContent.replace(/\s+/g, ' ').trim());
      return {
        path: path, file: path + '.md', text: text, a: a, b: b, whole: whole, title: title,
        head: words.slice(0, 30).join('') + (words.length > 30 ? '…' : ''),
        nPics: picGroups(tok.items[k].raw, dir).length,
        pics: picGroups(n.slice(a, b), dir)
      };
    }

    function confirmDelete(plan, btn) {
      var busy = false;
      var box = el('div', 'ed-dialog',
        '<div class="ed-card" role="alertdialog" aria-modal="true" aria-labelledby="ed-del-t" aria-describedby="ed-del-d">' +
          '<h2 class="ed-card-t" id="ed-del-t">删除第 ' + esc(plan.no) + ' 条？</h2>' +
          '<div class="ed-card-d ed-del-d" id="ed-del-d">' +
            '<p>「' + esc(plan.head) + '」</p>' +
            '<p>' + (plan.nPics ? '附带 ' + plan.nPics + ' 张图' : '不带图') + '</p>' +
            (plan.whole ? '<p>「' + esc(plan.title) + '」这一节也会一起删掉</p>' : '') +
          '</div>' +
          '<div class="ed-msg" role="alert"></div>' +
          '<div class="ed-actions"><button class="btn btn-solid" type="button" data-ed="del-go">删除</button><button class="btn" type="button" data-ed="del-cancel">取消</button></div>' +
        '</div>');
      document.body.appendChild(box);
      var msg = box.querySelector('.ed-msg');
      var go = box.querySelector('[data-ed="del-go"]');
      var cancel = box.querySelector('[data-ed="del-cancel"]');
      function close() {
        if (box.parentNode) box.parentNode.removeChild(box);
        if (asking === api) asking = null;
        if (btn && btn.isConnected) btn.focus({ preventScroll: true });
      }
      go.addEventListener('click', function () {
        if (busy) return;
        busy = true;
        go.disabled = cancel.disabled = true;
        msg.textContent = '正在删除……';
        runDelete(plan).then(function (res) {
          busy = false;
          close();
          site.setMd(plan.path, plan.text, res.after);
          site.remount();
          var sha = res.commit.sha ? String(res.commit.sha).slice(0, 7) : '';
          var url = res.commit.html_url && /^https:\/\/github\.com\//.test(res.commit.html_url) ? res.commit.html_url : '';
          barSay('已删除第 ' + esc(plan.no) + ' 条' + (plan.whole ? '和「' + esc(plan.title) + '」这一节' : '') +
            (res.gone.length ? '，' + res.gone.length + ' 个图片文件一起删了' : '') +
            (res.kept.length ? '，' + res.kept.length + ' 个图片文件别处还在用、留着' : '') +
            (sha ? '（提交 ' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(sha) + '</a>' : esc(sha)) + '）' : '') + '，线上约半分钟后更新');
        }, function (why) {
          busy = false;
          go.disabled = cancel.disabled = false;
          msg.textContent = why;
        });
      });
      cancel.addEventListener('click', close);
      box.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !busy) close(); });
      var api = { close: close, busy: function () { return busy; } };
      asking = api;
      cancel.focus();
    }

    // 成功：{ after: 删完以后的正文, commit, gone: 删掉的图片路径, kept: 别处还在用、留下的图片路径 }；失败：一句给人看的原因
    function runDelete(plan) {
      var R = '/repos/' + REPO;
      var branch, head, treeSha, files, mdEntry, newBytes, after, commit;
      var gone = [], kept = [];
      function need(r, status) {
        if (r.status !== (status || 200) || !r.json) throw r;
        return r.json;
      }
      function branchPath() { return branch.split('/').map(encodeURIComponent).join('/'); }
      function message() {
        var page = document.title.split(' — ')[0].trim();
        var lines = ['网页编辑：删除 ' + plan.file + (plan.title ? '「' + plan.title + '」' : '') + '第 ' + plan.no + ' 条', '',
          '页面：' + (page ? page + '（' + plan.file + '）' : plan.file)];
        if (plan.title) lines.push('分类：' + plan.title + (plan.whole ? '（这一节删到空了，整节去掉）' : ''));
        lines.push('原编号：' + plan.no, '正文开头：' + plan.head);
        if (gone.length) lines = lines.concat('', '删除图片：', gone.map(function (p) { return '- ' + p; }));
        if (kept.length) lines = lines.concat('', '保留图片（别的 .md 还在引用）：', kept.map(function (p) { return '- ' + p; }));
        return lines.join('\n');
      }
      return gh(token, 'GET', R).then(function (r) {
        branch = need(r).default_branch || 'main';
        return gh(token, 'GET', R + '/git/ref/heads/' + branchPath());
      }).then(function (r) {
        head = need(r).object && r.json.object.sha;
        if (typeof head !== 'string') throw r;
        return gh(token, 'GET', R + '/git/commits/' + head);
      }).then(function (r) {
        treeSha = need(r).tree && r.json.tree.sha;
        if (typeof treeSha !== 'string') throw r;
        return gh(token, 'GET', R + '/git/trees/' + treeSha + '?recursive=1');
      }).then(function (r) {
        var t = need(r);
        if (t.truncated || !Array.isArray(t.tree)) throw 'GitHub 没给全仓库的文件列表，没法确认图片别处有没有在用，这次没有删除。';
        files = {};
        t.tree.forEach(function (x) { if (x.type === 'blob') files[x.path] = x; });
        mdEntry = files[plan.file];
        if (!mdEntry) throw 'GitHub 上找不到 ' + plan.file + '，这次没有删除。';
        return gh(token, 'GET', R + '/git/blobs/' + mdEntry.sha);
      }).then(function (r) {
        var blob = need(r);
        if (blob.encoding !== 'base64') throw r;
        var bytes = fromB64(blob.content);
        var bom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF ? 3 : 0;
        var remote;
        try { remote = decodeUtf8(bytes); } catch (e) { throw 'GitHub 上的文件不是合法的 UTF-8，不在网页里改。'; }
        if (remote !== plan.text) throw 'GitHub 上的 ' + plan.file + ' 已经和这页显示的不一样了（可能别处刚改过），这次没有删除。刷新页面后重试；线上更新可能要等一两分钟。';
        // 原文里 [s, e) 这一段原样拿掉，其余字节（BOM、换行写法）不动
        var text = plan.text, s = origIndex(text, plan.a), e = origIndex(text, plan.b);
        var bs = bom + utf8(text.slice(0, s)).length, be = bs + utf8(text.slice(s, e)).length;
        newBytes = concatBytes([bytes.subarray(0, bs), bytes.subarray(be)]);
        after = decodeUtf8(newBytes);
        // 仓库里确实有的图，才看它别处还用不用：别的 .md 全文、删完以后的这份 md 里出现了它（缩略图或原图）的文件名就留着
        var cand = plan.pics.filter(function (g) { return g.some(function (p) { return files[p]; }); });
        if (!cand.length) return;
        var others = Object.keys(files).filter(function (p) { return /\.md$/i.test(p) && p !== plan.file; });
        return Promise.all(others.map(function (p) {
          return gh(token, 'GET', R + '/git/blobs/' + files[p].sha).then(function (r2) {
            var b2 = need(r2);
            if (b2.encoding !== 'base64') throw r2;
            return new TextDecoder('utf-8').decode(fromB64(b2.content));
          });
        })).then(function (texts) {
          texts.push(after);
          cand.forEach(function (g) {
            var used = texts.some(function (t) { return g.some(function (p) { return t.indexOf(baseName(p)) >= 0; }); });
            g.forEach(function (p) {
              var list = used ? kept : gone;
              if (files[p] && list.indexOf(p) < 0) list.push(p);
            });
          });
        });
      }).then(function () {
        return gh(token, 'POST', R + '/git/blobs', { content: toB64(newBytes), encoding: 'base64' });
      }).then(function (r) {
        var tree = [{ path: plan.file, mode: mdEntry.mode, type: 'blob', sha: need(r, 201).sha }].concat(gone.map(function (p) {
          return { path: p, mode: files[p].mode, type: 'blob', sha: null };   // sha: null = 从树里去掉这个文件
        }));
        return gh(token, 'POST', R + '/git/trees', { base_tree: treeSha, tree: tree });
      }).then(function (r) {
        return gh(token, 'POST', R + '/git/commits', { message: message(), tree: need(r, 201).sha, parents: [head] });
      }).then(function (r) {
        commit = need(r, 201);
        return gh(token, 'PATCH', R + '/git/refs/heads/' + branchPath(), { sha: commit.sha, force: false });
      }).then(function (r) {
        if (r.status === 422 || r.status === 409) throw 'GitHub 上的分支在别处更新过了（不是快进），这次没有覆盖。请刷新页面后重试。';
        need(r);
        return { after: after, commit: commit, gone: gone, kept: kept };
      }).catch(function (x) {
        if (typeof x === 'string') throw x;
        if (x && typeof x.status === 'number') {
          if (x.status === 422) throw 'GitHub 没收下这次删除：' + ((x.json && x.json.message) || 'HTTP 422');
          throw authReason(x) || '删除失败（GitHub 返回 HTTP ' + x.status + '）。';
        }
        throw '连不上 api.github.com，没有删除。';
      });
    }

    return { open: open, mounted: mounted };
  };
})();
