"""站长编辑器（js/edit.js）离线探针。

用法：/opt/Alphie/.venv/bin/python -I _dev/edit_check.py <仓库根> [--evidence <截图目录>]

本地起一个静态服务器打开站点，用 Playwright 的 route 把 api.github.com 换成一个假 GitHub
（GET 返回 base64 content + sha；PUT 必须带 sha，sha 不对回 409；只读 Token 写回 403；过期 Token 回 401；
没授权这个仓库回 404；缺 message / content 回 422），其余外网请求一律拦下；Chromium 另外把所有域名解析到不存在，
真连出去也连不上。站点自己的 Google 统计 / 字体请求被拦下不算错，别的任何外网请求都判失败。

判什么：
  V  访客：不按快捷键时没有加载 js/edit.js / css/edit.css、没有请求 api.github.com、DOM 和样式里没有编辑相关的东西；
     只按两下、按住不放、三下拉得超过 1 秒，都不触发。
  K  焦点在输入框里时，连按三次 E 不触发。
  T  Token：401 / 403 / 404 时不进编辑模式并说清原因；通过后 Token 只在 localStorage，
     只出现在发往 api.github.com 的 Authorization 头里，不进 URL、DOM、console、cookie、sessionStorage。
  R  编辑模式下的正文 = 访客正文（去掉块序号后逐字相同），退出编辑后 DOM 与访客一模一样。
  E  weibo、关于（README）、_study/docsify（CRLF）、富士山纸页随笔、BOM + CRLF 合成文件、无 BOM 无结尾换行合成文件
     各改一块：拦下的 PUT 解码后与「原文件只替换这一块」逐字节相同，带的是当前 sha，提交信息写明文件和第几块；页面立刻显示新字。
  C  sha 冲突（409）不覆盖并提示；GitHub 上的文件和页面不一致时不发 PUT。
  F  改掉插画 frag 时出现「会消失」警告并列出是哪张，「回去改」不保存，「仍然保存」才保存；原文没有的字有字体提示。
  S  刷新后（本地服务器仍发旧文件，模拟 CDN 缓存）仍显示新内容；线上变成新版后本地记录自动清掉。
  P  浅色 / 深色下编辑模式截图、访客视图截图存进证据目录。
"""
from __future__ import annotations

import argparse
import base64
import functools
import hashlib
import http.server
import json
import os
import re
import sys
import tempfile
import threading
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright

REPO = 'godblessbb/bii'
API = 'https://api.github.com/'
TOK_WRITE = 'probe-token-write-7f3a9c'
TOK_READ = 'probe-token-readonly-2b81'
TOK_EXPIRED = 'probe-token-expired-91d0'
TOK_OTHER = 'probe-token-otherrepo-c4e2'
TOKENS = (TOK_WRITE, TOK_READ, TOK_EXPIRED, TOK_OTHER)
# 站点页面本来就有的第三方请求（Google 统计、Google 字体）：一律拦下、不连，只是不算编辑器的错
SITE_THIRD_PARTY = ('https://www.googletagmanager.com/', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/')
DEFAULT_EVIDENCE = '/root/.alphie/coding_tasks/ct_6f630412/evidence'

BOM = b'\xef\xbb\xbf'
CRLF = b'\r\n'
SYNTH = {
    # BOM + CRLF，全角标点，表格，结尾没有换行
    '_study/edit-probe-bom-crlf.md': BOM + (
        '# 合成测试：BOM 与 CRLF\r\n'
        '\r\n'
        '第一段，全角标点：“引号”、（括号）……还有半角, comma.\r\n'
        '第一段的第二行，行尾有两个空格  \r\n'
        '第一段的第三行。\r\n'
        '\r\n'
        '\r\n'
        '- 列表一\r\n'
        '- 列表二\r\n'
        '\r\n'
        '> 引用里的一句话。\r\n'
        '\r\n'
        '| 列 | 值 |\r\n'
        '| --- | --- |\r\n'
        '| 甲 | 乙 |\r\n'
        '\r\n'
        '最后一段，没有结尾换行。'
    ).encode('utf-8'),
    # 无 BOM、LF、尾随空白、结尾没有换行
    '_study/edit-probe-lf.md': (
        '# 合成测试：LF\n'
        '\n'
        '第一段。\t带一个制表符。\n'
        '\n'
        '## 小标题\n'
        '\n'
        '最后一段，后面还有空格   '
    ).encode('utf-8'),
}

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print('FAIL', msg, flush=True)


def ok(msg: str) -> None:
    print('ok  ', msg, flush=True)


def check(cond, msg: str) -> bool:
    (ok if cond else fail)(msg)
    return bool(cond)


def git_blob_sha(b: bytes) -> str:
    return hashlib.sha1(b'blob %d\0' % len(b) + b).hexdigest()


def squash(s: str) -> str:
    return re.sub(r'\s+', '', s)


class FakeGitHub:
    """按 GitHub REST Contents API 的行为回应：只认 api.github.com/repos/godblessbb/bii 下的几个端点。"""

    def __init__(self, root: Path):
        self.root = root
        self.files: dict[str, bytes | None] = {}
        self.log: list[dict] = []
        self.commits: list[dict] = []
        self.race_next_put = False

    def blob(self, path: str):
        if path not in self.files:
            if path in SYNTH:
                self.files[path] = SYNTH[path]
            else:
                p = self.root / path
                self.files[path] = p.read_bytes() if p.is_file() else None
        return self.files[path]

    def handle(self, route):
        req = route.request
        u = urlparse(req.url)
        cors = {'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag, X-RateLimit-Remaining, X-GitHub-Request-Id'}
        try:
            hdrs = req.all_headers()
        except Exception:
            hdrs = req.headers
        self.log.append({'method': req.method, 'url': req.url, 'auth': hdrs.get('authorization', ''), 'body': req.post_data})
        if req.method == 'OPTIONS':
            return route.fulfill(status=204, headers={**cors, 'access-control-allow-methods': 'GET, PUT, OPTIONS',
                                                      'access-control-allow-headers': 'Authorization, Content-Type, Accept, X-GitHub-Api-Version',
                                                      'access-control-max-age': '600'})

        def reply(status, obj):
            route.fulfill(status=status, headers={**cors, 'content-type': 'application/json; charset=utf-8', 'x-ratelimit-remaining': '4999'},
                          body=json.dumps(obj, ensure_ascii=False))

        auth = hdrs.get('authorization', '')
        tok = auth[7:] if auth.startswith('Bearer ') else ''
        if tok not in (TOK_WRITE, TOK_READ, TOK_OTHER):
            return reply(401, {'message': 'Bad credentials', 'documentation_url': 'https://docs.github.com/rest'})
        base = f'/repos/{REPO}'
        if not u.path.startswith(base) or tok == TOK_OTHER:
            return reply(404, {'message': 'Not Found'})
        rest = u.path[len(base):]
        if rest in ('', '/'):
            if req.method != 'GET':
                return reply(404, {'message': 'Not Found'})
            return reply(200, {'full_name': REPO, 'name': 'bii', 'private': False, 'default_branch': 'main',
                               'permissions': {'admin': True, 'maintain': True, 'push': True, 'triage': True, 'pull': True}})
        if not rest.startswith('/contents/'):
            return reply(404, {'message': 'Not Found'})
        path = unquote(rest[len('/contents/'):])
        if req.method == 'GET':
            b = self.blob(path)
            if b is None:
                return reply(404, {'message': 'Not Found'})
            return reply(200, {'type': 'file', 'encoding': 'base64', 'size': len(b), 'name': path.split('/')[-1], 'path': path,
                               'sha': git_blob_sha(b), 'content': base64.encodebytes(b).decode('ascii')})
        if req.method != 'PUT':
            return reply(404, {'message': 'Not Found'})
        if tok == TOK_READ:
            return reply(403, {'message': 'Resource not accessible by personal access token'})
        try:
            data = json.loads(req.post_data or 'null')
        except ValueError:
            return reply(400, {'message': 'Problems parsing JSON'})
        if not isinstance(data, dict) or 'message' not in data or 'content' not in data:
            return reply(422, {'message': 'Invalid request.\n\n"content", "message" weren\'t supplied.'})
        cur = self.blob(path)
        if self.race_next_put and cur is not None:   # 模拟：取完 sha、PUT 之前，别处刚好提交了一次
            self.race_next_put = False
            cur = cur + '\n（别处的一次提交）\n'.encode('utf-8')
            self.files[path] = cur
        if cur is not None and 'sha' not in data:
            return reply(422, {'message': 'Invalid request.\n\n"sha" wasn\'t supplied.'})
        if cur is not None and data['sha'] != git_blob_sha(cur):
            return reply(409, {'message': f'{path} does not match {data["sha"]}'})
        try:
            new = base64.b64decode(data['content'], validate=True)
        except Exception:
            return reply(422, {'message': 'content is not valid Base64'})
        self.files[path] = new
        csha = hashlib.sha1(b'commit' + new + data['message'].encode('utf-8')).hexdigest()
        self.commits.append({'path': path, 'message': data['message'], 'sha_sent': data.get('sha'), 'old': cur, 'new': new})
        return reply(200, {'content': {'name': path.split('/')[-1], 'path': path, 'sha': git_blob_sha(new), 'size': len(new)},
                           'commit': {'sha': csha, 'html_url': f'https://github.com/{REPO}/commit/{csha}', 'message': data['message']}})


def expected_after(orig: bytes, core0: str, core1: str) -> bytes | None:
    """原文件只把这一块（编辑框里的原文 core0）换成 core1，其余字节原样。"""
    bom = orig.startswith(BOM)
    text = (orig[3:] if bom else orig).decode('utf-8')
    crlf = '\r\n' in text
    c0 = core0.replace('\n', '\r\n') if crlf else core0
    c1 = core1.replace('\n', '\r\n') if crlf else core1
    if text.count(c0) != 1:
        return None
    i = text.index(c0)
    pre = orig[:len(BOM) if bom else 0] + text[:i].encode('utf-8')
    post = text[i + len(c0):].encode('utf-8')
    assert orig == pre + c0.encode('utf-8') + post
    return pre + c1.encode('utf-8') + post


VISITOR_JS = """() => ({
  blocks: document.querySelectorAll('[data-edit-block]').length,
  ui: document.querySelectorAll('[data-edit-ui]').length,
  editing: document.documentElement.hasAttribute('data-editing'),
  edClasses: [...document.querySelectorAll('[class]')].filter(e => /(^|\\s)ed-/.test(e.getAttribute('class'))).length,
  sheets: [...document.styleSheets].map(s => s.href || 'inline'),
  editRules: [...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText); } catch (e) { return []; } })
    .filter(t => /data-edit|\\.ed-/.test(t)).length,
  editScripts: [...document.querySelectorAll('script,link')].map(s => s.src || s.href || '').filter(s => /edit\\.(js|css)/.test(s)).length,
  global: typeof window.DatodeEdit,
  htmlAttrs: [...document.documentElement.attributes].map(a => a.name + '=' + a.value).filter(x => !/^class=/.test(x)).sort().join(' ')
})"""

VIEW_JS = """() => document.getElementById('view').innerHTML
  .replace(/ data-edit-block="\\d+"/g, '').replace(/ style="[^"]*"/g, '').replace(/ class="is-current"/g, '')"""   # 后两样随滚动位置变


def same_view(got: str, want: str, msg: str) -> None:
    if check(got == want, msg):
        return
    a, b = want.split('><'), got.split('><')
    import difflib
    for line in list(difflib.unified_diff(a, b, 'visitor', 'now', lineterm='', n=0))[:12]:
        print('   ', line[:220])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('root')
    ap.add_argument('--evidence', default=os.environ.get('EDIT_CHECK_EVIDENCE') or (DEFAULT_EVIDENCE if os.path.isdir(DEFAULT_EVIDENCE) else ''))
    a = ap.parse_args()
    root = Path(a.root).resolve()
    shots = Path(a.evidence) if a.evidence else Path(tempfile.mkdtemp(prefix='edit_check_'))
    shots.mkdir(parents=True, exist_ok=True)
    print('screenshots ->', shots)

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *x):
            pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{srv.server_address[1]}'

    gh = FakeGitHub(root)
    site_override: dict[str, bytes] = {'/' + k: v for k, v in SYNTH.items()}
    site_log: list[dict] = []
    external: list[str] = []
    consoles: list[str] = []
    nload = [0]

    def router(route):
        req = route.request
        url = req.url
        if url.startswith(origin + '/'):
            p = unquote(urlparse(url).path)
            try:
                hdrs = req.all_headers()
            except Exception:
                hdrs = req.headers
            site_log.append({'path': p, 'url': url, 'auth': hdrs.get('authorization', ''), 'body': req.post_data or ''})
            if p in site_override:
                return route.fulfill(status=200, headers={'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache'}, body=site_override[p])
            return route.continue_()
        if url.startswith(API):
            return gh.handle(route)
        external.append(url)
        return route.abort()

    def url(hashpath: str) -> str:
        nload[0] += 1
        return f'{origin}/?probe={nload[0]}#/{hashpath}'

    def open_page(ctx, hashpath: str):
        pg = ctx.new_page()
        pg.on('console', lambda m: consoles.append(m.text))
        pg.on('pageerror', lambda e: consoles.append('pageerror ' + str(e)))
        load(pg, hashpath)
        return pg

    def load(pg, hashpath: str):
        pg.goto(url(hashpath), wait_until='load')
        pg.wait_for_function("() => { const v = document.getElementById('view'); return v && v.children.length && !v.querySelector('.loading'); }", timeout=15000)
        pg.wait_for_timeout(500)

    def edit_requests():
        return [r for r in site_log if re.search(r'/(js/edit\.js|css/edit\.css)$', r['path'])]

    def press_eee(pg, gap=80):
        for _ in range(3):
            pg.keyboard.press('e')
            pg.wait_for_timeout(gap)

    def wait_editing(pg, timeout=8000):
        pg.wait_for_function("() => document.documentElement.hasAttribute('data-editing') && document.querySelector('#view [data-edit-block]')", timeout=timeout)

    def open_block(pg, snippet: str, li: bool = False):
        sel = '#view [data-edit-block] li' if li else '#view [data-edit-block]'
        loc = pg.locator(sel, has_text=snippet).first
        loc.evaluate("e => e.scrollIntoView({ block: 'center' })")
        pg.wait_for_timeout(150)
        loc.click()
        pg.wait_for_selector('.ed-panel .ed-area', state='visible', timeout=5000)
        return pg.locator('.ed-panel .ed-area').input_value()

    def lexed_raw(pg, text: str, snippet: str):
        return pg.evaluate("""([t, s]) => { const toks = marked.lexer(t, { gfm: true });
            const tok = toks.find(k => k.type !== 'space' && k.raw.replace(/\\s+/g, '').includes(s.replace(/\\s+/g, '')));
            return tok ? tok.raw.replace(/\\n+$/, '') : null; }""", [text, snippet])

    def save_and_verify(pg, file: str, snippet: str, core0: str, core1: str, label: str, force: bool = False, show: str | None = None):
        orig = gh.blob(file)
        sha0 = git_blob_sha(orig)
        text0 = (orig[3:] if orig.startswith(BOM) else orig).decode('utf-8')
        raw = lexed_raw(pg, text0, snippet)
        check(raw is not None and raw.replace('\r\n', '\n') == core0, f'E [{label}] 编辑框里正是这一块的 markdown 原文（token.raw）')
        n0 = len(gh.commits)
        pg.locator('.ed-panel .ed-area').fill(core1)
        pg.locator('.ed-panel [data-ed="save"]').click()
        if force:
            pg.wait_for_selector('.ed-panel [data-ed="force"]', timeout=5000)
            pg.locator('.ed-panel [data-ed="force"]').click()
        try:
            for _ in range(80):
                if len(gh.commits) > n0 or pg.locator('.ed-status[data-kind="err"]').count():
                    break
                pg.wait_for_timeout(100)
            pg.wait_for_function("() => /已保存/.test((document.querySelector('.ed-bar-s') || {}).textContent || '')", timeout=8000)
        except Exception:
            st = pg.evaluate("() => (document.querySelector('.ed-status') || {}).textContent || ''")
            fail(f'E [{label}] 保存没有完成：{st!r}')
            return False
        if not check(len(gh.commits) == n0 + 1 and gh.commits[-1]['path'] == file, f'E [{label}] 发出了一条对 {file} 的 PUT'):
            return False
        c = gh.commits[-1]
        exp = expected_after(orig, core0, core1)
        check(exp is not None, f'E [{label}] 这一块的原文在文件里唯一，能独立算出期望字节')
        same = exp is not None and c['new'] == exp
        if not same and exp is not None:
            i = next((k for k in range(min(len(exp), len(c['new']))) if exp[k] != c['new'][k]), min(len(exp), len(c['new'])))
            print('   expected[...]', exp[max(0, i - 30):i + 30])
            print('   got     [...]', c['new'][max(0, i - 30):i + 30])
        traits = f'{len(c["new"])} 字节，BOM {"有" if orig.startswith(BOM) else "无"}，CRLF {"有" if CRLF in orig else "无"}'
        check(same, f'E [{label}] PUT 解码后与「原文件只替换这一块」逐字节相同（{traits}）')
        check(c['sha_sent'] == sha0, f'E [{label}] PUT 带的是取文件时的 sha')
        check(file in c['message'] and re.search(r'第 \d+ 块', c['message']), f'E [{label}] 提交信息写明文件和第几块：{c["message"].splitlines()[0]}')
        shown = squash(pg.evaluate("() => document.getElementById('view').innerText"))
        check(squash(show or core1).replace('*', '') in shown or squash(show or '') in shown, f'E [{label}] 保存后页面立刻显示新文字')
        check(not pg.locator('.ed-panel').count(), f'E [{label}] 保存后编辑框收起')
        return True

    with sync_playwright() as p:
        br = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader',
                                     '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'])

        # ================= V 访客 =================
        ctx = br.new_context(viewport={'width': 1440, 'height': 900}, color_scheme='light', reduced_motion='reduce')
        ctx.route('**/*', router)
        visitor_html = {}
        visitor_state = {}
        pages = ['weibo', 'baibian', '_works/普通人如何去拥有富士山呢', '_study/docsify', 'about', 'README', '_weibo/weibo0',
                 '_works/户口壁垒：现代中国的身份鸿沟', '_study/edit-probe-bom-crlf']
        pg = open_page(ctx, 'articles')
        for hp in pages:
            load(pg, hp)
            visitor_html[hp] = pg.evaluate(VIEW_JS)
            st = pg.evaluate(VISITOR_JS)
            visitor_state[hp] = st
            check(st['blocks'] == 0 and st['ui'] == 0 and not st['editing'] and st['edClasses'] == 0 and st['editRules'] == 0
                  and st['editScripts'] == 0 and st['global'] == 'undefined', f'V 访客 #/{hp}：DOM / 样式 / 全局里没有编辑相关的东西')
        check(not edit_requests(), 'V 访客：没有请求 js/edit.js 或 css/edit.css')
        check(not gh.log, 'V 访客：没有任何对 api.github.com 的请求')
        load(pg, '_works/普通人如何去拥有富士山呢')
        pg.screenshot(path=str(shots / 'visitor-light-fuji.png'))
        load(pg, '_study/docsify')
        pg.screenshot(path=str(shots / 'visitor-light-docsify.png'))

        # 两下、按住、超过 1 秒：都不触发
        pg.keyboard.press('e'); pg.wait_for_timeout(80); pg.keyboard.press('e'); pg.wait_for_timeout(1300)
        pg.keyboard.down('e'); pg.wait_for_timeout(60); pg.keyboard.down('e'); pg.wait_for_timeout(60); pg.keyboard.down('e'); pg.keyboard.up('e')
        pg.wait_for_timeout(300)
        pg.keyboard.press('e'); pg.wait_for_timeout(700); pg.keyboard.press('e'); pg.wait_for_timeout(500); pg.keyboard.press('e')
        pg.keyboard.press('Control+e'); pg.keyboard.press('Control+e'); pg.keyboard.press('Control+e')
        pg.wait_for_timeout(800)
        check(not edit_requests() and pg.evaluate(VISITOR_JS)['ui'] == 0, 'V 只按两下 / 按住不放 / 三下超过 1 秒 / Ctrl+E：都不触发')

        # ================= K 焦点在输入框里 =================
        pg.evaluate("() => { const i = document.createElement('input'); i.id = 'probe-input'; document.body.prepend(i); i.focus(); }")
        press_eee(pg)
        pg.wait_for_timeout(800)
        check(not edit_requests() and pg.evaluate(VISITOR_JS)['ui'] == 0, 'K 焦点在输入框里：连按三次 E 不触发')
        pg.evaluate("() => { document.getElementById('probe-input').remove(); document.getElementById('view').focus(); }")

        # ================= T Token =================
        press_eee(pg)
        try:
            pg.wait_for_selector('.ed-dialog .ed-input', timeout=6000)
            ok('T 连按三次 E：按需加载 js/edit.js，出现贴 Token 的对话框')
        except Exception:
            fail('T 连按三次 E 后没有出现贴 Token 的对话框')
        check(len([r for r in edit_requests() if r['path'].endswith('/js/edit.js')]) == 1, 'T js/edit.js 只在按下快捷键后加载了一次')
        pg.screenshot(path=str(shots / 'edit-light-token-dialog.png'))
        for tok, want, why in [(TOK_EXPIRED, '过期', '401'), (TOK_READ, 'Read and write', '403'), (TOK_OTHER, '看不到', '404')]:
            pg.locator('.ed-dialog .ed-input').fill(tok)
            pg.locator('.ed-dialog [data-ed="verify"]').click()
            pg.wait_for_function("() => { const m = document.querySelector('.ed-dialog .ed-msg'); return m && m.textContent && !/正在/.test(m.textContent); }", timeout=6000)
            msg = pg.locator('.ed-dialog .ed-msg').text_content()
            st = pg.evaluate("() => ({ editing: document.documentElement.hasAttribute('data-editing'), bar: !!document.querySelector('.ed-bar'), ls: localStorage.getItem('datode-edit-token') })")
            check(want in msg and not st['editing'] and not st['bar'] and st['ls'] is None, f'T {why}：不进编辑模式，说明原因「{msg}」')
        pg.locator('.ed-dialog .ed-input').fill(TOK_WRITE)
        pg.locator('.ed-dialog [data-ed="verify"]').click()
        try:
            wait_editing(pg)
            ok('T 有写权限的 Token：进入编辑模式')
        except Exception:
            fail('T 有写权限的 Token 没能进入编辑模式：' + str(pg.locator('.ed-dialog .ed-msg').text_content() if pg.locator('.ed-dialog').count() else ''))
        st = pg.evaluate("""() => ({ ls: localStorage.getItem('datode-edit-token'), ss: JSON.stringify(Object.assign({}, sessionStorage)),
            cookie: document.cookie, dom: document.documentElement.outerHTML, href: location.href,
            lsOther: Object.keys(localStorage).filter(k => k !== 'datode-edit-token').map(k => localStorage.getItem(k)).join('\\n') })""")
        check(st['ls'] == TOK_WRITE, 'T Token 存进了 localStorage')
        leak = [w for w, v in [('sessionStorage', st['ss']), ('cookie', st['cookie']), ('DOM', st['dom']), ('URL', st['href']), ('localStorage 其它键', st['lsOther'])]
                if any(t in v for t in TOKENS)]
        check(not leak, f'T Token 不在 sessionStorage / cookie / DOM / URL / 其它存储里{"：" + ",".join(leak) if leak else ""}')

        # ================= R 编辑模式的正文 = 访客正文；退出后与访客一模一样 =================
        pg.wait_for_timeout(300)
        check(pg.evaluate(VIEW_JS) == visitor_html['_study/docsify'], 'R 编辑模式下 #/_study/docsify 去掉块序号后与访客正文逐字相同（同一条渲染路径）')
        pg.locator('.ed-bar [data-ed="exit"]').click()
        pg.wait_for_timeout(300)
        st = pg.evaluate(VISITOR_JS)
        same_view(pg.evaluate(VIEW_JS), visitor_html['_study/docsify'], 'R 退出编辑后正文 DOM 与访客相同')
        check(st['blocks'] == 0 and st['ui'] == 0 and not st['editing'] and st['edClasses'] == 0 and st['editRules'] == 0 and st['editScripts'] == 0
              and st['sheets'] == visitor_state['_study/docsify']['sheets'] and st['htmlAttrs'] == visitor_state['_study/docsify']['htmlAttrs'],
              'R 退出编辑后没有编辑元素、编辑样式、data-editing，样式表与 <html> 属性和访客一样')
        press_eee(pg)
        wait_editing(pg)
        check(not pg.locator('.ed-dialog').count(), 'T 记住了 Token：再次连按直接进编辑模式，不再问')
        for hp in pages:
            load(pg, hp)   # 刷新后编辑器不在了，重新呼出
            press_eee(pg)
            wait_editing(pg)
            pg.wait_for_timeout(200)
            same_view(pg.evaluate(VIEW_JS), visitor_html[hp], f'R 编辑模式下 #/{hp} 去掉块序号后与访客正文逐字相同')
        api_auth = [r for r in gh.log if r['auth']]
        check(all(r['auth'] == 'Bearer ' + TOK_WRITE or r['auth'] in ('Bearer ' + t for t in TOKENS) for r in api_auth), 'T 发往 api.github.com 的 Authorization 头就是贴进来的 Token')
        check(not any(r['auth'] or any(t in r['url'] or t in r['body'] for t in TOKENS) for r in site_log), 'T 站点自己的请求里没有 Token（头、URL、body 都没有）')
        check(not any(t in r['url'] for r in gh.log for t in TOKENS), 'T Token 没进任何 URL')

        # ================= E 各改一块 =================
        # weibo：点列表里的一条，编辑框是整个列表的原文，光标落在那一条
        load(pg, 'weibo'); press_eee(pg); wait_editing(pg)
        snip = '成熟不是你看清多少，而是你能接受多少'
        core0 = open_block(pg, snip, li=True)
        caret = pg.evaluate("() => document.querySelector('.ed-area').selectionStart")
        check(core0[caret:].startswith('- ' + snip), 'E [weibo] 点哪一条，光标就落在那一条的原文开头')
        new_snip = '成熟不是你看清了多少，而是你能接受多少'
        save_and_verify(pg, 'weibo.md', snip, core0, core0.replace(snip, new_snip, 1), 'weibo', show=new_snip)
        weibo_after = gh.blob('weibo.md')

        # 百变动态合集：与微博合辑同一版式（没有插画）
        load(pg, 'baibian'); press_eee(pg); wait_editing(pg)
        snip = '唯一的要求是通关之前不许掰'
        core0 = open_block(pg, snip, li=True)
        save_and_verify(pg, 'baibian.md', snip, core0, core0.replace(snip, '唯一的要求是通关之前不许跑', 1), 'baibian', show='唯一的要求是通关之前不许跑')

        # 关于（README）：真键盘打字，End 跳到那一条行尾再输入
        load(pg, 'about'); press_eee(pg); wait_editing(pg)
        snip = '理想的空调温度是26度'
        core0 = open_block(pg, snip, li=True)
        pg.keyboard.press('End')
        pg.keyboard.type('，冬天也是')
        typed = pg.locator('.ed-area').input_value()
        check(typed == core0.replace(snip, snip + '，冬天也是', 1), 'E [README] 键盘输入落在点中的那一条行尾')
        save_and_verify(pg, 'README.md', snip, core0, typed, 'README', show=snip + '，冬天也是')

        # _study/docsify：真实 CRLF 文件里的一段
        load(pg, '_study/docsify'); press_eee(pg); wait_editing(pg)
        snip = '微博炸号以后，建站对我而言就变得十分刚需。'
        core0 = open_block(pg, snip)
        save_and_verify(pg, '_study/docsify.md', snip, core0, core0.replace('十分刚需', '非常刚需', 1), '_study/docsify CRLF', show='非常刚需')

        # 富士山纸页：先看缺字提示，再改掉一张插画的 frag
        load(pg, '_works/普通人如何去拥有富士山呢'); press_eee(pg); wait_editing(pg)
        fuji_text = gh.blob('_works/普通人如何去拥有富士山呢.md').decode('utf-8')
        rare = next(ch for ch in '龘靐齉爩鱻麤' if ch not in fuji_text)
        snip = '那天淫雨霏霏像情人在低语'
        core0 = open_block(pg, snip)
        pg.locator('.ed-area').fill(core0 + rare)
        pg.wait_for_timeout(200)
        note = pg.evaluate("() => (document.querySelector('[data-note=\"glyph\"]') || {}).textContent || ''")
        check(rare in note and '系统字体' in note, f'F 原文没有的字「{rare}」出现字体子集提示：{note}')
        pg.screenshot(path=str(shots / 'edit-light-fuji-glyph-note.png'))
        core1 = core0.replace('淫雨霏霏', '细雨霏霏', 1)
        pg.locator('.ed-area').fill(core1)
        n0 = len(gh.commits)
        pg.locator('.ed-panel [data-ed="save"]').click()
        try:
            pg.wait_for_selector('[data-note="sketch"] [data-ed="force"]', timeout=5000)
            warn = pg.locator('[data-note="sketch"]').text_content()
            check('会消失' in warn and 'nichome-rain.svg' in warn and snip in warn, f'F 改掉 frag：保存前警告插画会消失并列出是哪张（{warn.strip()[:60]}…）')
        except Exception:
            fail('F 改掉插画 frag 后没有出现「会消失」警告')
        pg.screenshot(path=str(shots / 'edit-light-fuji-sketch-warning.png'))
        check(len(gh.commits) == n0, 'F 警告出现时还没有保存')
        pg.locator('[data-note="sketch"] [data-ed="back"]').click()
        pg.wait_for_timeout(300)
        check(len(gh.commits) == n0 and pg.locator('.ed-area').input_value() == core1, 'F 「回去改」：不保存，改动还在')
        pg.locator('.ed-panel [data-ed="preview"]').click()
        pg.wait_for_timeout(300)
        prev = pg.evaluate("() => [...document.querySelectorAll('.ed-preview-node')].map(e => e.innerText).join('\\n')")
        check('细雨霏霏' in prev and pg.locator('.ed-preview-node .wb-line').count() > 0, 'E [富士山] 预览走纸页同一条渲染路径（逐行 .wb-line）')
        pg.screenshot(path=str(shots / 'edit-light-fuji-preview.png'))
        pg.locator('.ed-panel [data-ed="preview"]').click()
        if save_and_verify(pg, '_works/普通人如何去拥有富士山呢.md', snip, core0, core1, '富士山纸页', force=True, show='那天细雨霏霏像情人在低语'):
            check(not pg.locator('img[data-illustrates="那天淫雨霏霏像情人在低语"]').count(), 'F 「仍然保存」后那张插画确实不在了')

        # 一个块都没碰到 frag：weibo 那次保存没有出现警告（上面直接保存成功即证明），再验富士山其它插画还在
        check(pg.locator('#view img[data-illustrates]').count() == 7, 'F 富士山其余 7 张插画都还在')

        # 合成文件：BOM + CRLF，改段落（段内多行、行尾两个空格）再改表格
        load(pg, '_study/edit-probe-bom-crlf'); press_eee(pg); wait_editing(pg)
        snip = '第一段，全角标点'
        core0 = open_block(pg, snip)
        save_and_verify(pg, '_study/edit-probe-bom-crlf.md', snip, core0, core0.replace('还有半角', '以及半角', 1).replace('第三行。', '第三行，改过。\n新加的第四行。', 1),
                        '合成 BOM+CRLF 段落', show='以及半角')
        core0 = open_block(pg, '甲')
        save_and_verify(pg, '_study/edit-probe-bom-crlf.md', '| 甲 | 乙 |', core0, core0.replace('| 甲 | 乙 |', '| 甲 | 丙 |'), '合成 BOM+CRLF 表格（第二次保存，用新 sha）', show='丙')
        core0 = open_block(pg, '最后一段，没有结尾换行')
        save_and_verify(pg, '_study/edit-probe-bom-crlf.md', '最后一段，没有结尾换行', core0, '最后一段，改过，仍然没有结尾换行。', '合成 BOM+CRLF 文件末块')
        final = gh.blob('_study/edit-probe-bom-crlf.md')
        check(final.startswith(BOM) and not final.endswith(b'\n') and b'\n' not in final.replace(b'\r\n', b''), 'E [合成 BOM+CRLF] 三次保存后 BOM 还在、全是 CRLF、结尾仍没有换行')

        load(pg, '_study/edit-probe-lf'); press_eee(pg); wait_editing(pg)
        core0 = open_block(pg, '最后一段，后面还有空格')
        save_and_verify(pg, '_study/edit-probe-lf.md', '最后一段，后面还有空格', core0, core0.replace('最后一段', '末段', 1), '合成 LF 尾随空白', show='末段')
        core0 = open_block(pg, '小标题')
        save_and_verify(pg, '_study/edit-probe-lf.md', '## 小标题', core0, '## 改过的小标题', '合成 LF 标题', show='改过的小标题')
        check(b'\t' in gh.blob('_study/edit-probe-lf.md') and gh.blob('_study/edit-probe-lf.md').endswith('   '.encode()), 'E [合成 LF] 别处的制表符和结尾空格原样')

        # ================= C 冲突 =================
        load(pg, '_study/vpn'); press_eee(pg); wait_editing(pg)
        snip = '一台境外服务器'
        before = gh.blob('_study/vpn.md')
        core0 = open_block(pg, snip, li=True)
        gh.race_next_put = True
        pg.locator('.ed-area').fill(core0.replace(snip, '一台海外服务器', 1))
        n0 = len(gh.commits)
        pg.locator('.ed-panel [data-ed="save"]').click()
        try:
            pg.wait_for_function("() => /sha|别处/.test((document.querySelector('.ed-status') || {}).textContent || '')", timeout=6000)
            st = pg.locator('.ed-status').text_content()
            check('刷新' in st, f'C 409：提示刷新后重试「{st}」')
        except Exception:
            fail('C sha 冲突（409）时没有提示')
        after = gh.blob('_study/vpn.md')
        check(len(gh.commits) == n0 and after == before + '\n（别处的一次提交）\n'.encode('utf-8'), 'C 409：没有覆盖别处的提交')
        check(any(r['method'] == 'PUT' and '/contents/_study/vpn.md' in unquote(r['url']) for r in gh.log), 'C 409 这一回确实发了带旧 sha 的 PUT')
        pg.screenshot(path=str(shots / 'edit-light-conflict.png'))
        puts0 = len([r for r in gh.log if r['method'] == 'PUT'])
        pg.locator('.ed-panel [data-ed="save"]').click()
        pg.wait_for_function("() => /不一样/.test((document.querySelector('.ed-status') || {}).textContent || '')", timeout=6000)
        check(len([r for r in gh.log if r['method'] == 'PUT']) == puts0 and gh.blob('_study/vpn.md') == after,
              'C GitHub 上的文件已和页面不一致：不发 PUT，提示刷新')
        pg.locator('.ed-panel [data-ed="cancel"]').click()

        # ================= S 刷新后仍是新内容 =================
        # 本地静态服务器仍发旧 weibo.md（= Pages CDN 还没更新）
        load(pg, 'weibo')
        shown = squash(pg.evaluate("() => document.getElementById('view').innerText"))
        check('成熟不是你看清了多少' in shown and '成熟不是你看清多少' not in shown, 'S 刷新后（线上仍是旧文件）这台浏览器显示新内容')
        check(pg.evaluate(VISITOR_JS)['ui'] == 0, 'S 刷新后不在编辑模式、没有编辑元素')
        load(pg, '_works/普通人如何去拥有富士山呢')
        check('那天细雨霏霏' in squash(pg.evaluate("() => document.getElementById('view').innerText")), 'S 刷新后富士山也显示新内容')
        # 线上追上了：本地记录清掉
        site_override['/weibo.md'] = weibo_after
        load(pg, 'weibo')
        rec = pg.evaluate("() => JSON.parse(localStorage.getItem('datode-edit-pending') || '{}')")
        check('成熟不是你看清了多少' in squash(pg.evaluate("() => document.getElementById('view').innerText")) and 'weibo' not in rec,
              'S 线上已是新版：照常显示，本地那条记录清掉')
        # 线上变成了别的版本（别处又改过）：用线上的
        site_override['/README.md'] = '# 关于我\n\n别处改成的版本。\n'.encode('utf-8')
        load(pg, 'about')
        rec = pg.evaluate("() => JSON.parse(localStorage.getItem('datode-edit-pending') || '{}')")
        check('别处改成的版本' in pg.evaluate("() => document.getElementById('view').innerText") and 'README' not in rec,
              'S 线上变成了第三个版本：显示线上的，本地记录清掉')
        del site_override['/README.md']

        # 忘掉 Token
        load(pg, '_study/docsify'); press_eee(pg); wait_editing(pg)
        pg.locator('.ed-bar [data-ed="forget"]').click()
        pg.wait_for_timeout(300)
        st = pg.evaluate(VISITOR_JS)
        check(pg.evaluate("() => localStorage.getItem('datode-edit-token')") is None and st['ui'] == 0 and not st['editing'], 'T 「忘掉 Token」：localStorage 里没了，退出编辑')
        press_eee(pg)
        pg.wait_for_selector('.ed-dialog .ed-input', timeout=5000)
        check(True, 'T 忘掉之后再呼出，重新要 Token')
        pg.keyboard.press('Escape')
        ctx.close()

        # ================= P 深色 + 浅色截图 =================
        for scheme in ('dark', 'light'):
            c2 = br.new_context(viewport={'width': 1440, 'height': 900}, color_scheme=scheme)
            c2.add_init_script("try { localStorage.setItem('datode-edit-token', '%s'); } catch (e) {}" % TOK_WRITE)
            c2.route('**/*', router)
            g0 = len(gh.log)
            e0 = len(edit_requests())
            p2 = open_page(c2, '_works/普通人如何去拥有富士山呢')
            p2.wait_for_timeout(600)
            check(len(gh.log) == g0 and len(edit_requests()) == e0, f'V [{scheme}] 浏览器里存着 Token 但没按快捷键：不加载编辑器、不请求 GitHub')
            p2.screenshot(path=str(shots / f'visitor-{scheme}-fuji.png'))
            press_eee(p2); wait_editing(p2)
            open_block(p2, '单恋是夜路上最轻的脚步声')
            p2.mouse.move(5, 5)
            p2.screenshot(path=str(shots / f'edit-{scheme}-fuji-editor.png'))
            load(p2, '_study/docsify')
            p2.screenshot(path=str(shots / f'visitor-{scheme}-docsify.png'))
            press_eee(p2); wait_editing(p2)
            loc = p2.locator('#view [data-edit-block]', has_text='docsify是一个神奇的文档网站生成工具').first
            loc.evaluate("e => e.scrollIntoView({ block: 'center' })")
            loc.hover()
            p2.wait_for_timeout(300)
            p2.screenshot(path=str(shots / f'edit-{scheme}-docsify-hover.png'))
            loc.click()
            p2.wait_for_selector('.ed-area')
            p2.mouse.move(5, 5)
            p2.screenshot(path=str(shots / f'edit-{scheme}-docsify-editor.png'))
            load(p2, 'weibo'); press_eee(p2); wait_editing(p2)
            open_block(p2, '中年人的爱情故事就是互相搀扶着走夜路', li=True)
            p2.mouse.move(5, 5)
            p2.screenshot(path=str(shots / f'edit-{scheme}-weibo-editor.png'))
            c2.close()
        br.close()
    srv.shutdown()

    # ================= 全程离线 =================
    stray = [u for u in external if not u.startswith(SITE_THIRD_PARTY)]
    check(not stray, f'离线：除站点原有的统计 / 字体（已拦下）外没有任何外网请求{"：" + str(stray[:5]) if stray else ""}')
    check(not any(any(t in m for t in TOKENS) for m in consoles), 'T Token 没有出现在 console 里')
    errs = [m for m in consoles if m.startswith('pageerror')]
    check(not errs, f'页面没有抛出脚本错误{"：" + str(errs[:3]) if errs else ""}')
    print(f'\n{len(failures)} failure(s)')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
