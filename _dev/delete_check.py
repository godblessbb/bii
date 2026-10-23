"""按编号删除（js/edit.js「按编号删除」一节）离线探针。

用法：/opt/Alphie/.venv/bin/python -I _dev/delete_check.py <仓库根> [--evidence <截图目录>] [--mutant keep-pics|keep-section]

本地起一个静态服务器打开站点，用 Playwright 的 route 把 api.github.com 换成一个假 GitHub：
仓库内容取自工作区里 git 跟踪的文件（另加一份只在假仓库里的 md，引用了一张要被删的动态的图），
按 GitHub REST 的 Git Data API 回应：ref / commits / trees（recursive）/ blobs 的 GET，blobs / trees / commits 的 POST
（tree 里 sha: null 表示删文件，删不存在的文件回 422），PATCH ref 只接受快进（不是快进回 422，force: true 记为违规）。
其余外网请求一律拦下；Chromium 另外把所有域名解析到不存在。真实的 baibian.md / weibo.md / media/ 一个字节都不碰。

判什么：
  V  访客：不按快捷键时 #/baibian、#/weibo 没有删除按钮、没有加载编辑器、没有请求 GitHub；进过编辑再退出，按钮也都没了。
  B  编辑模式：每条带编号的条目都有一个「删除」，编号与页面上的编号一一对应，按钮摆在编号那一行、编号右边；按钮不在 #view 里。
  Q  取消（按钮 / Esc）不发任何请求；确认框只写编号、正文开头 30 字、附带几张图（删到空的写明这一节也删）。
  D  删一条 = 一个提交（父提交是原分支头，分支非强制快进到它）：md 与「原文件只去掉这一条」逐字节相同（期望值由本探针按行独立算出）；
     这一条独有的图（缩略图 + 原图）在 tree 里被删，别的 .md 还引用的图不删，其余文件一个不动；提交信息写明页面、分类、原编号、正文开头。
     百变删中间一条（3 张图，其中 1 张别处在用）；百变删「2026 · 秋」唯一一条（整节去掉）；微博删「日常emo」最后一条（「## 按」不动）。
  N  删除后页面立刻重排，编号从 001 连续、不重复，删除按钮的编号跟着更新。
  C  分支上的 md 和页面显示的不一样：不发任何 POST / PATCH；分支在这期间被推进（不是快进）：不覆盖，提示刷新。
  S  刷新后（本地服务器仍发旧文件，模拟 CDN 缓存）被删的条目不回来；线上变成新版后本地记录自动清掉。
  T  Token 只出现在发往 api.github.com 的 Authorization 头里。
  P  浅色 / 深色：确认框、删除后各一张截图存进证据目录。

反证：--mutant keep-pics 把删除逻辑换成「只删正文不删图片」，--mutant keep-section 换成「删条后不删空节」，
对应的 D 断言会红（只换 js/edit.js 在浏览器里拿到的那一份，不改文件）。
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
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from playwright.sync_api import sync_playwright

REPO = 'godblessbb/bii'
API = 'https://api.github.com/'
TOK_WRITE = 'probe-token-write-5d21e8'
TOK_READ = 'probe-token-readonly-0c7a'
TOKENS = (TOK_WRITE, TOK_READ)
SITE_THIRD_PARTY = ('https://www.googletagmanager.com/', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/')
DEFAULT_EVIDENCE = '/root/.alphie/coding_tasks/ct_b566bc02/evidence'
# 只在假仓库里的一份 md：引用了「怀石」那条动态的第 2 张图（原图），所以这张图删那条时必须留着
REF_MD = '_works/删除探针-引用.md'
REF_MD_BYTES = '# 删除探针\n\n这一页借用了一张百变的图：\n\n![](../media/baibian/p113e106c89f24126_02.jpg)\n'.encode('utf-8')
MUTANTS = {
    'keep-pics': ('var cand = plan.pics.filter(', 'var cand = [].filter('),          # 只删正文不删图片
    'keep-section': ('var whole = hs >= 0', 'var whole = false && hs >= 0'),       # 删条后不删空节
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


# ---------------- 假 GitHub：Git Data API ----------------
class FakeRepo:
    def __init__(self, root: Path):
        try:
            paths = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z'], stderr=subprocess.DEVNULL).decode('utf-8').split('\0')
        except Exception:
            paths = [str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and '.git' not in p.parts]
        self.blobs: dict[str, bytes] = {}
        files: dict[str, tuple[str, str]] = {}
        for p in paths:
            f = root / p
            if p and f.is_file():
                files[p] = ('100644', self.put_blob(f.read_bytes()))
        files[REF_MD] = ('100644', self.put_blob(REF_MD_BYTES))
        self.trees: dict[str, dict[str, tuple[str, str]]] = {}
        self.commits: dict[str, dict] = {}
        self.base_commit = self.put_commit(self.put_tree(files), [], '探针：初始提交')
        self.head = self.base_commit
        self.log: list[dict] = []
        self.patches: list[dict] = []
        self.race_before_patch = False

    # 存储
    def put_blob(self, b: bytes) -> str:
        sha = git_blob_sha(b)
        self.blobs[sha] = b
        return sha

    def put_tree(self, files: dict[str, tuple[str, str]]) -> str:
        sha = hashlib.sha1(json.dumps(sorted(files.items()), ensure_ascii=False).encode('utf-8')).hexdigest()
        self.trees[sha] = dict(files)
        return sha

    def put_commit(self, tree: str, parents: list[str], message: str) -> str:
        sha = hashlib.sha1(json.dumps([tree, parents, message, len(self.commits)], ensure_ascii=False).encode('utf-8')).hexdigest()
        self.commits[sha] = {'tree': tree, 'parents': parents, 'message': message}
        return sha

    def files_at(self, commit: str | None = None) -> dict[str, tuple[str, str]]:
        return self.trees[self.commits[commit or self.head]['tree']]

    def file(self, path: str, commit: str | None = None) -> bytes | None:
        e = self.files_at(commit).get(path)
        return self.blobs[e[1]] if e else None

    def commit_elsewhere(self, path: str, new: bytes, message: str) -> str:
        files = dict(self.files_at())
        files[path] = ('100644', self.put_blob(new))
        self.head = self.put_commit(self.put_tree(files), [self.head], message)
        return self.head

    def is_ancestor(self, a: str, b: str) -> bool:
        seen, todo = set(), [b]
        while todo:
            c = todo.pop()
            if c == a:
                return True
            if c in seen or c not in self.commits:
                continue
            seen.add(c)
            todo.extend(self.commits[c]['parents'])
        return False

    def handle(self, route):
        req = route.request
        u = urlparse(req.url)
        cors = {'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag, X-RateLimit-Remaining'}
        try:
            hdrs = req.all_headers()
        except Exception:
            hdrs = req.headers
        self.log.append({'method': req.method, 'url': req.url, 'auth': hdrs.get('authorization', ''), 'body': req.post_data or ''})
        if req.method == 'OPTIONS':
            return route.fulfill(status=204, headers={**cors, 'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
                                                      'access-control-allow-headers': 'Authorization, Content-Type, Accept, X-GitHub-Api-Version',
                                                      'access-control-max-age': '600'})

        def reply(status, obj):
            route.fulfill(status=status, headers={**cors, 'content-type': 'application/json; charset=utf-8', 'x-ratelimit-remaining': '4999'},
                          body=json.dumps(obj, ensure_ascii=False))

        auth = hdrs.get('authorization', '')
        tok = auth[7:] if auth.startswith('Bearer ') else ''
        if tok not in TOKENS:
            return reply(401, {'message': 'Bad credentials'})
        base = f'/repos/{REPO}'
        if not u.path.startswith(base):
            return reply(404, {'message': 'Not Found'})
        rest = unquote(u.path[len(base):])
        m = req.method
        if rest in ('', '/') and m == 'GET':
            return reply(200, {'full_name': REPO, 'name': 'bii', 'default_branch': 'main',
                               'permissions': {'admin': True, 'push': True, 'pull': True}})
        if rest.startswith('/contents/'):
            if m == 'PUT':   # 校验 Token 时那个缺字段的 PUT
                return reply(403 if tok == TOK_READ else 422, {'message': 'Invalid request.'})
            b = self.file(rest[len('/contents/'):])
            if m == 'GET' and b is not None:
                return reply(200, {'type': 'file', 'encoding': 'base64', 'sha': git_blob_sha(b), 'content': base64.encodebytes(b).decode('ascii')})
            return reply(404, {'message': 'Not Found'})
        if m in ('POST', 'PATCH', 'PUT', 'DELETE') and tok == TOK_READ:
            return reply(403, {'message': 'Resource not accessible by personal access token'})
        try:
            data = json.loads(req.post_data) if req.post_data else None
        except ValueError:
            return reply(400, {'message': 'Problems parsing JSON'})
        if rest == '/git/ref/heads/main' and m == 'GET':
            return reply(200, {'ref': 'refs/heads/main', 'object': {'type': 'commit', 'sha': self.head}})
        mm = re.fullmatch(r'/git/commits/([0-9a-f]{40})', rest)
        if mm and m == 'GET':
            c = self.commits.get(mm.group(1))
            if not c:
                return reply(404, {'message': 'Not Found'})
            return reply(200, {'sha': mm.group(1), 'tree': {'sha': c['tree']}, 'parents': [{'sha': p} for p in c['parents']], 'message': c['message']})
        mm = re.fullmatch(r'/git/trees/([0-9a-f]{40})', rest)
        if mm and m == 'GET':
            t = self.trees.get(mm.group(1))
            if t is None:
                return reply(404, {'message': 'Not Found'})
            rec = parse_qs(u.query).get('recursive')
            items, dirs = [], set()
            for p, (mode, sha) in sorted(t.items()):
                parts = p.split('/')
                for i in range(1, len(parts)):
                    dirs.add('/'.join(parts[:i]))
                if rec or len(parts) == 1:
                    items.append({'path': p, 'mode': mode, 'type': 'blob', 'sha': sha, 'size': len(self.blobs[sha])})
            for d in sorted(dirs):
                if rec or '/' not in d:
                    items.append({'path': d, 'mode': '040000', 'type': 'tree', 'sha': hashlib.sha1(d.encode('utf-8')).hexdigest()})
            return reply(200, {'sha': mm.group(1), 'tree': items, 'truncated': False})
        mm = re.fullmatch(r'/git/blobs/([0-9a-f]{40})', rest)
        if mm and m == 'GET':
            b = self.blobs.get(mm.group(1))
            if b is None:
                return reply(404, {'message': 'Not Found'})
            return reply(200, {'sha': mm.group(1), 'size': len(b), 'encoding': 'base64', 'content': base64.encodebytes(b).decode('ascii')})
        if rest == '/git/blobs' and m == 'POST':
            if not isinstance(data, dict) or data.get('encoding') != 'base64':
                return reply(422, {'message': 'encoding must be base64 in this probe'})
            try:
                b = base64.b64decode(data.get('content', ''), validate=True)
            except Exception:
                return reply(422, {'message': 'content is not valid Base64'})
            return reply(201, {'sha': self.put_blob(b)})
        if rest == '/git/trees' and m == 'POST':
            if not isinstance(data, dict) or data.get('base_tree') not in self.trees or not isinstance(data.get('tree'), list):
                return reply(422, {'message': 'base_tree / tree missing'})
            files = dict(self.trees[data['base_tree']])
            for it in data['tree']:
                p = it.get('path')
                if it.get('type') != 'blob' or it.get('mode') not in ('100644', '100755') or not p:
                    return reply(422, {'message': f'bad tree item {it!r}'})
                if 'sha' in it and it['sha'] is None:
                    if p not in files:
                        return reply(422, {'message': f'GitRPC::BadObjectState: {p} does not exist'})
                    del files[p]
                elif it.get('sha') in self.blobs:
                    files[p] = (it['mode'], it['sha'])
                else:
                    return reply(422, {'message': f'bad tree item {it!r}'})
            sha = self.put_tree(files)
            return reply(201, {'sha': sha})
        if rest == '/git/commits' and m == 'POST':
            if not isinstance(data, dict) or data.get('tree') not in self.trees or not isinstance(data.get('message'), str) \
                    or not all(p in self.commits for p in data.get('parents') or []):
                return reply(422, {'message': 'bad commit'})
            sha = self.put_commit(data['tree'], list(data['parents']), data['message'])
            return reply(201, {'sha': sha, 'html_url': f'https://github.com/{REPO}/commit/{sha}', 'tree': {'sha': data['tree']}, 'message': data['message']})
        if rest == '/git/refs/heads/main' and m == 'PATCH':
            self.patches.append(data if isinstance(data, dict) else {})
            if not isinstance(data, dict) or data.get('sha') not in self.commits:
                return reply(422, {'message': 'Object does not exist'})
            if self.race_before_patch:   # 模拟：读完分支头、更新之前，别处刚好推了一个提交
                self.race_before_patch = False
                self.commit_elsewhere('README.md', self.file('README.md') + '\n（别处的一次提交）\n'.encode('utf-8'), '别处的提交')
            if data.get('force') is True:
                return reply(422, {'message': 'probe: force update refused'})
            if not self.is_ancestor(self.head, data['sha']):
                return reply(422, {'message': 'Update is not a fast forward'})
            self.head = data['sha']
            return reply(200, {'ref': 'refs/heads/main', 'object': {'type': 'commit', 'sha': self.head}})
        return reply(404, {'message': 'Not Found'})


# ---------------- 期望值：按行独立算，不用 marked ----------------
ITEM = re.compile(r'^ {0,3}[-*+] ')
IMG = re.compile(r'!\[[^\]]*\]\(([^)\s]+)\)')
THUMB = re.compile(r'^(.*/)s/([^/]+)-(\d+)x(\d+)\.jpg$')


def expected_delete(orig: bytes, snip: str, other_md: list[bytes]):
    """原文件只去掉以 snip 开头那一条：返回 (新字节, 是否整节去掉, 节标题, 要删的图, 留着的图, 正文开头 30 字, 图数)。"""
    text = orig.decode('utf-8')
    lines = text.splitlines(keepends=True)
    hits = [i for i, l in enumerate(lines) if ITEM.match(l) and snip in l]
    assert len(hits) == 1, (snip, hits)
    i = hits[0]
    last, j = i, i + 1
    while j < len(lines):
        if not lines[j].strip():
            j += 1
        elif lines[j].startswith((' ', '\t')):
            last = j
            j += 1
        else:
            break
    starts = [0]
    for l in lines:
        starts.append(starts[-1] + len(l))
    hs = max((k for k in range(i) if lines[k].startswith('## ')), default=None)
    he = next((k for k in range(i + 1, len(lines)) if lines[k].startswith('## ')), len(lines))
    n_items = sum(1 for k in range((hs or 0), he) if ITEM.match(lines[k]))
    whole = hs is not None and n_items == 1
    if whole:
        a, b = starts[hs], starts[he]
    elif j < len(lines) and ITEM.match(lines[j]):
        a, b = starts[i], starts[j]
    else:
        p = i - 1
        while not lines[p].strip():
            p -= 1
        a = starts[p] + len(lines[p].rstrip('\r\n'))
        b = starts[last] + len(lines[last].rstrip('\r\n'))
    new = text[:a] + text[b:]
    title = lines[hs][3:].strip() if hs is not None else ''
    item = ''.join(lines[i:last + 1])
    groups = []
    for src in IMG.findall(item):
        t = THUMB.match(src)
        groups.append([src, t.group(1) + t.group(2) + '.jpg'] if t else [src])
    texts = [x.decode('utf-8') for x in other_md] + [new]
    gone, kept = [], []
    for g in groups:
        used = any(p.rsplit('/', 1)[-1] in t for t in texts for p in g)
        (kept if used else gone).extend(g)
    words = re.sub(r'\s+', ' ', re.sub(r'<br\s*/?>', '', IMG.sub('', ITEM.sub('', lines[i], 1) + ''.join(lines[i + 1:last + 1])))).strip()
    head = words[:30] + ('…' if len(words) > 30 else '')
    return new.encode('utf-8'), whole, title, gone, kept, head, len(groups)


ENTRY_JS = """(snip) => {
  const li = [...document.querySelectorAll('#view li[data-entry]')].find(e => e.textContent.replace(/\\s+/g, '').includes(snip.replace(/\\s+/g, '')));
  if (!li) return null;
  const sep = li.previousElementSibling;
  return sep && sep.classList.contains('wb-sep-num') ? sep.textContent : '';
}"""
NUMS_JS = "() => [...document.querySelectorAll('#view .wb-sep-num .wb-sep-mark')].map(e => e.textContent)"
BTNS_JS = """() => [...document.querySelectorAll('.ed-del')].map(b => {
  const r = b.getBoundingClientRect();
  return { no: b.getAttribute('data-no'), hidden: b.hidden, inView: !!b.closest('#view'), x: r.left + scrollX, y: r.top + scrollY, h: r.height, label: b.getAttribute('aria-label'), text: b.textContent };
})"""
MARKS_JS = """() => [...document.querySelectorAll('#view .wb-sep-num .wb-sep-mark')].map(e => {
  const r = e.getBoundingClientRect(); return { no: e.textContent, right: r.right + scrollX, cy: r.top + scrollY + r.height / 2 };
})"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('root')
    ap.add_argument('--evidence', default=os.environ.get('DELETE_CHECK_EVIDENCE') or (DEFAULT_EVIDENCE if os.path.isdir(DEFAULT_EVIDENCE) else ''))
    ap.add_argument('--mutant', choices=sorted(MUTANTS), default='')
    a = ap.parse_args()
    root = Path(a.root).resolve()
    shots = Path(a.evidence) if a.evidence else Path(tempfile.mkdtemp(prefix='delete_check_'))
    if a.mutant:   # 反证跑：截图不进证据目录
        shots = Path(tempfile.mkdtemp(prefix='delete_check_mutant_'))
        print('MUTANT', a.mutant, '：js/edit.js 在浏览器里被换成', MUTANTS[a.mutant][1])
    shots.mkdir(parents=True, exist_ok=True)
    print('screenshots ->', shots)
    orig_md = {f: (root / f).read_bytes() for f in ('baibian.md', 'weibo.md')}

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *x):
            pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{srv.server_address[1]}'

    repo = [FakeRepo(root)]
    site_override: dict[str, bytes] = {}
    site_log: list[dict] = []
    external: list[str] = []
    consoles: list[str] = []
    nload = [0]

    def gh():
        return repo[0]

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
            if a.mutant and p == '/js/edit.js':
                src = (root / 'js/edit.js').read_text(encoding='utf-8')
                old, new = MUTANTS[a.mutant]
                if old not in src:
                    fail(f'反证：js/edit.js 里找不到要换的那一句 {old!r}')
                return route.fulfill(status=200, headers={'content-type': 'text/javascript; charset=utf-8'}, body=src.replace(old, new, 1))
            return route.continue_()
        if url.startswith(API):
            return gh().handle(route)
        external.append(url)
        return route.abort()

    def load(pg, hashpath: str):
        nload[0] += 1
        pg.goto(f'{origin}/?probe={nload[0]}#/{hashpath}', wait_until='load')
        pg.wait_for_function("() => { const v = document.getElementById('view'); return v && v.children.length && !v.querySelector('.loading'); }", timeout=15000)
        pg.wait_for_timeout(400)

    def open_page(ctx, hashpath: str):
        pg = ctx.new_page()
        pg.on('console', lambda m: consoles.append(m.text))
        pg.on('pageerror', lambda e: consoles.append('pageerror ' + str(e)))
        load(pg, hashpath)
        return pg

    def press_eee(pg):
        for _ in range(3):
            pg.keyboard.press('e')
            pg.wait_for_timeout(80)

    def enter_edit(pg):
        press_eee(pg)
        pg.wait_for_selector('.ed-dialog .ed-input, .ed-bar', timeout=8000)
        if pg.locator('.ed-dialog .ed-input').count():   # 第一次：贴 Token
            pg.locator('.ed-dialog .ed-input').fill(TOK_WRITE)
            pg.locator('.ed-dialog [data-ed="verify"]').click()
        pg.wait_for_function("() => document.documentElement.hasAttribute('data-editing') && document.querySelector('#view [data-edit-block]') && document.querySelector('.ed-del')", timeout=8000)
        pg.wait_for_timeout(250)

    def edit_requests():
        return [r for r in site_log if re.search(r'/(js/edit\.js|css/edit\.css)$', r['path'])]

    def ask(pg, snip: str):
        no = pg.evaluate(ENTRY_JS, snip)
        if not no:
            fail(f'找不到这一条或它的编号：{snip}')
            return None
        pg.evaluate("(s) => [...document.querySelectorAll('#view li[data-entry]')].find(e => e.textContent.replace(/\\s+/g, '').includes(s)).scrollIntoView({ block: 'center' })", squash(snip))
        pg.wait_for_timeout(150)
        pg.locator(f'.ed-del[data-no="{no}"]').click()
        pg.wait_for_selector('.ed-dialog [data-ed="del-go"]', timeout=5000)
        return no

    def dialog_lines(pg):
        return [x.strip() for x in pg.locator('.ed-dialog .ed-card').inner_text().split('\n') if x.strip()]

    def wait_done(pg, bar0: str):
        """等这一次删除有结果：底栏换成了新的「已删除」，或者确认框里出了原因（bar0 是点删除之前底栏的字，上一次的「已删除」不算）。"""
        pg.wait_for_function("""(bar0) => { const t = (document.querySelector('.ed-bar-s') || {}).textContent || '';
            return (t !== bar0 && /已删除/.test(t)) || ((document.querySelector('.ed-dialog .ed-msg') || {}).textContent || '').replace('正在删除……', '').length > 0; }""",
                             arg=bar0, timeout=15000)
        pg.wait_for_timeout(300)

    def bar_text(pg) -> str:
        return pg.evaluate("() => (document.querySelector('.ed-bar-s') || {}).textContent || ''")

    def numbers_ok(pg, label: str, total: int):
        nums = pg.evaluate(NUMS_JS)
        check(nums == ['%03d' % i for i in range(1, len(nums) + 1)] and len(nums) == total,
              f'N [{label}] 页面编号从 001 连续到 {len(nums):03d}，无断号、无重复（应有 {total} 条）')
        btns = pg.evaluate(BTNS_JS)
        check([b['no'] for b in btns] == nums, f'N [{label}] 删除按钮的编号跟着重排，与页面编号一一对应')

    def delete_one(pg, file: str, snip: str, label: str, shot: str | None = None, section_shot: str | None = None):
        """点这一条的删除 → 核对确认框 → 确认 → 核对拦下的提交和页面。"""
        repo_ = gh()
        head0 = repo_.head
        orig = repo_.file(file)
        others = [repo_.blobs[sha] for p, (_, sha) in repo_.files_at().items() if p.lower().endswith('.md') and p != file]
        exp, whole, title, gone, kept, head_txt, npics = expected_delete(orig, snip, others)
        n_before = len(pg.evaluate(NUMS_JS))
        no = ask(pg, snip)
        if not no:
            return None
        want = [f'删除第 {no} 条？', f'「{head_txt}」', f'附带 {npics} 张图' if npics else '不带图'] + ([f'「{title}」这一节也会一起删掉'] if whole else []) + ['删除', '取消']
        got = dialog_lines(pg)
        check(got == want, f'Q [{label}] 确认框只写编号、正文开头、几张图{"、整节一起删" if whole else ""}：{got}')
        if shot:
            pg.screenshot(path=str(shots / shot))
        if section_shot:
            pg.screenshot(path=str(shots / section_shot))
        nlog = len(repo_.log)
        npatch = len(repo_.patches)
        bar0 = bar_text(pg)
        pg.locator('.ed-dialog [data-ed="del-go"]').click()
        try:
            wait_done(pg, bar0)
        except Exception:
            fail(f'D [{label}] 删除没有完成')
            return None
        msg = pg.evaluate("() => (document.querySelector('.ed-dialog .ed-msg') || {}).textContent || ''")
        if not check(not msg and '已删除' in pg.locator('.ed-bar-s').inner_text(), f'D [{label}] 删除完成，确认框收起，底栏说已删除{"（" + msg + "）" if msg else ""}'):
            return None
        new_head = repo_.head
        c = repo_.commits.get(new_head, {})
        check(new_head != head0 and c.get('parents') == [head0], f'D [{label}] 分支头前进了一个提交，父提交就是原分支头')
        check(len(repo_.patches) == npatch + 1 and repo_.patches[-1].get('force') is False,
              f'D [{label}] 只更新了一次分支，带 force: false（非强制快进）')
        commits_made = [r for r in repo_.log[nlog:] if r['method'] == 'POST' and r['url'].endswith('/git/commits')]
        check(len(commits_made) == 1, f'D [{label}] 一次删除只建了一个提交')
        f0, f1 = repo_.files_at(head0), repo_.files_at(new_head)
        new_md = repo_.file(file, new_head)
        same = new_md == exp
        if not same and new_md is not None:
            i = next((k for k in range(min(len(exp), len(new_md))) if exp[k] != new_md[k]), min(len(exp), len(new_md)))
            print('   expected[...]', exp[max(0, i - 40):i + 40].decode('utf-8', 'replace'))
            print('   got     [...]', new_md[max(0, i - 40):i + 40].decode('utf-8', 'replace'))
        check(same, f'D [{label}] 提交里的 {file} 与「原文件只去掉这一条{"（连同整节）" if whole else ""}」逐字节相同（{len(orig)} → {len(exp)} 字节）')
        removed = sorted(set(f0) - set(f1))
        changed = sorted(p for p in f1 if p in f0 and f0[p] != f1[p])
        added = sorted(set(f1) - set(f0))
        check(removed == sorted(gone), f'D [{label}] tree 里删掉的正是这一条独有的图（缩略图 + 原图）：{removed}')
        if kept:
            check(all(p in f1 for p in kept), f'D [{label}] 别的 .md 还引用的图没删：{kept}')
        check(changed == [file] and not added, f'D [{label}] 除了 {file} 和这些图，仓库里别的文件一个没动')
        m = c.get('message', '')
        check(file in m and (not title or title in m) and no in m and head_txt[:20] in m,
              f'D [{label}] 提交信息写明页面、分类、原编号、正文开头：{m.splitlines()[0] if m else m!r}')
        txt = squash(pg.evaluate("() => document.getElementById('view').innerText"))
        check(squash(head_txt.rstrip('…')) not in txt, f'D [{label}] 页面上这一条立刻没了')
        if gone or kept:
            srcs = pg.evaluate("() => [...document.querySelectorAll('#view img')].map(i => i.getAttribute('src'))")
            check(not any(p.rsplit('/', 1)[-1] in s for s in srcs for p in gone + kept), f'D [{label}] 这一条的图也从页面上没了')
        if whole:
            heads = pg.evaluate("() => [...document.querySelectorAll('#view h2')].map(h => h.textContent.trim())")
            toc = pg.evaluate("() => [...document.querySelectorAll('.wb-toc a')].map(h => h.textContent.trim())")
            check(title not in heads and title not in toc, f'D [{label}] 「{title}」这一节的标题和目录项都没了')
        numbers_ok(pg, label, n_before - 1)
        return {'file': file, 'after': new_md, 'head_txt': head_txt, 'title': title, 'whole': whole}

    with sync_playwright() as p:
        br = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader',
                                     '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'])
        ctx = br.new_context(viewport={'width': 1440, 'height': 900}, color_scheme='light', reduced_motion='reduce')
        ctx.route('**/*', router)

        # ================= V 访客 =================
        pg = open_page(ctx, 'baibian')
        for hp in ('baibian', 'weibo'):
            load(pg, hp)
            st = pg.evaluate("() => ({ del: document.querySelectorAll('.ed-del, .ed-dels').length, ui: document.querySelectorAll('[data-edit-ui]').length, g: typeof window.DatodeEdit, nums: document.querySelectorAll('#view .wb-sep-num').length })")
            check(st['del'] == 0 and st['ui'] == 0 and st['g'] == 'undefined' and st['nums'] > 0, f'V 访客 #/{hp}：有编号（{st["nums"]} 条），但没有任何删除按钮、编辑元素、编辑器脚本')
        check(not edit_requests() and not gh().log, 'V 访客：没有加载 js/edit.js / css/edit.css，没有请求 api.github.com')
        pg.screenshot(path=str(shots / 'delete-visitor-light-weibo.png'))

        # ================= B 编辑模式：每条编号旁一个删除 =================
        load(pg, 'baibian')
        enter_edit(pg)
        marks = pg.evaluate(MARKS_JS)
        btns = pg.evaluate(BTNS_JS)
        check(len(btns) == len(marks) and [b['no'] for b in btns] == [m_['no'] for m_ in marks],
              f'B 每条带编号的条目都有一个删除按钮，编号一一对应（{len(btns)} 个）')
        check(all(not b['inView'] and b['text'] == '删除' and b['label'] == f'删除第 {b["no"]} 条' for b in btns),
              'B 按钮写「删除」、读屏念「删除第 NNN 条」，不在 #view 里（正文 DOM 与访客一致）')
        placed = [abs((b['y'] + b['h'] / 2) - m_['cy']) < 3 and 4 < b['x'] - m_['right'] < 30 for b, m_ in zip(btns, marks)]
        check(btns and all(placed), f'B 每个按钮都摆在自己编号那一行、编号右边（{sum(placed)}/{len(placed)}）')
        cls = pg.evaluate("() => document.querySelector('.ed-del').className")
        check(cls.split() == ['btn', 'ed-del'], f'B 按钮用站点现有的 .btn 样式：class="{cls}"')
        pg.evaluate("() => [...document.querySelectorAll('#view li[data-entry]')][3].scrollIntoView({ block: 'center' })")
        pg.wait_for_timeout(200)
        pg.mouse.move(5, 5)
        pg.screenshot(path=str(shots / 'delete-light-buttons.png'))
        pg.locator('.ed-bar [data-ed="exit"]').click()
        pg.wait_for_timeout(300)
        check(pg.evaluate("() => document.querySelectorAll('.ed-del, .ed-dels, [data-edit-ui]').length") == 0, 'V 退出编辑：删除按钮全部摘掉')
        enter_edit(pg)

        # ================= Q 取消不发请求 =================
        snip_mid = '可能是北京千元价位最好吃的怀石'
        n0 = len(gh().log)
        if ask(pg, snip_mid):
            pg.locator('.ed-dialog [data-ed="del-cancel"]').click()
            pg.wait_for_timeout(500)
            check(not pg.locator('.ed-dialog').count() and len(gh().log) == n0, 'Q 点「取消」：确认框收起，没有发出任何请求')
        if ask(pg, snip_mid):
            pg.keyboard.press('Escape')
            pg.wait_for_timeout(500)
            check(not pg.locator('.ed-dialog').count() and len(gh().log) == n0, 'Q 按 Esc：确认框收起，没有发出任何请求')

        # ================= C 分支上的 md 已经变了：不发 POST / PATCH =================
        gh().commit_elsewhere('baibian.md', orig_md['baibian.md'] + '\n'.encode('utf-8'), '别处改了 baibian.md')
        head_x = gh().head
        n0 = len(gh().log)
        if ask(pg, snip_mid):
            bar0 = bar_text(pg)
            pg.locator('.ed-dialog [data-ed="del-go"]').click()
            wait_done(pg, bar0)
            msg = pg.locator('.ed-dialog .ed-msg').inner_text()
            writes = [r for r in gh().log[n0:] if r['method'] in ('POST', 'PATCH', 'PUT', 'DELETE')]
            check('不一样' in msg and '刷新' in msg and not writes and gh().head == head_x,
                  f'C 分支上的 md 和页面不一样：不写任何东西（POST / PATCH 0 次），提示「{msg}」')
            pg.screenshot(path=str(shots / 'delete-light-conflict-md.png'))
            pg.locator('.ed-dialog [data-ed="del-cancel"]').click()
        repo[0] = FakeRepo(root)

        # ================= C 分支在这期间被推进（不是快进）：不覆盖 =================
        gh().race_before_patch = True
        if ask(pg, snip_mid):
            bar0 = bar_text(pg)
            pg.locator('.ed-dialog [data-ed="del-go"]').click()
            wait_done(pg, bar0)
            msg = pg.locator('.ed-dialog .ed-msg').inner_text()
            race_head = gh().head
            check('快进' in msg and '没有覆盖' in msg and gh().commits[race_head]['message'] == '别处的提交' and gh().file('baibian.md') == orig_md['baibian.md'],
                  f'C 分支被别处推进：更新分支被拒（不是快进），别处的提交还在、没被覆盖，提示「{msg}」')
            check(gh().patches and all(x.get('force') is False for x in gh().patches), 'C 更新分支带 force: false')
            check(len(pg.evaluate(NUMS_JS)) and snip_mid in pg.evaluate("() => document.getElementById('view').innerText"), 'C 没删成：页面上这一条还在')
            pg.screenshot(path=str(shots / 'delete-light-conflict-ref.png'))
            pg.locator('.ed-dialog [data-ed="del-cancel"]').click()
        repo[0] = FakeRepo(root)
        load(pg, 'baibian')
        enter_edit(pg)

        # ================= D 百变：删中间一条（3 张图，其中 1 张别处在用） =================
        r1 = delete_one(pg, 'baibian.md', snip_mid, '百变 · 中间一条带图', shot='delete-light-confirm.png')
        pg.mouse.move(5, 5)
        pg.screenshot(path=str(shots / 'delete-light-after.png'))

        # ================= D 百变：删「2026 · 秋」唯一一条，整节去掉 =================
        r2 = delete_one(pg, 'baibian.md', '求个搭子一起玩《双人成行》', '百变 · 2026 · 秋 唯一一条', section_shot='delete-light-section-confirm.png')
        pg.evaluate("() => window.scrollTo(0, 0)")
        pg.wait_for_timeout(200)
        pg.mouse.move(5, 5)
        pg.screenshot(path=str(shots / 'delete-light-section-after.png'))
        if r2:
            check(r2['whole'] and r2['title'] == '2026 · 秋', 'D 删到空的是「2026 · 秋」：期望值按整节去掉算')
            check(not r2['after'].startswith('## 2026 · 秋'.encode('utf-8')) and r2['after'].startswith('## 2026 · 夏\n'.encode('utf-8')),
                  'D 文件现在从「## 2026 · 夏」开始，秋这一节（标题、条目、&nbsp; 占位）整个没了')

        # ================= D 微博：删「日常emo」最后一条；「## 按」不动 =================
        load(pg, 'weibo')
        enter_edit(pg)
        r3 = delete_one(pg, 'weibo.md', '从未天真过，也从没成长过', '微博 · 日常emo 最后一条')
        if r3:
            check(r3['after'].startswith(orig_md['weibo.md'][:orig_md['weibo.md'].index('## 日常emo'.encode('utf-8'))]),
                  'D 微博本来没有条目的「## 按」一节逐字节原样')
            check(pg.locator('#view .wb-chapter.is-preface h2', has_text='按').count() == 1, 'D 页面上「按」这一节还在')
            check(not r3['whole'], 'D 「日常emo」还有别的条目：只删这一条，不删节')

        # ================= T Token =================
        auths = [r['auth'] for r in gh().log if r['method'] != 'OPTIONS']
        check(auths and all(x == 'Bearer ' + TOK_WRITE for x in auths), 'T 发往 api.github.com 的请求都带着贴进来的 Token（Authorization 头）')
        check(not any(t in r['url'] or t in r['body'] for r in gh().log for t in TOKENS), 'T Token 没进任何 URL 或请求体')
        check(not any(r['auth'] or any(t in r['url'] for t in TOKENS) for r in site_log), 'T 站点自己的请求里没有 Token')

        # ================= S 刷新：本地服务器仍发旧文件 =================
        load(pg, 'baibian')
        txt = squash(pg.evaluate("() => document.getElementById('view').innerText"))
        heads = pg.evaluate("() => [...document.querySelectorAll('#view h2')].map(h => h.textContent.trim())")
        check(r1 and r2 and squash(snip_mid) not in txt and '求个搭子' not in txt and '2026 · 秋' not in heads,
              'S 刷新后（线上仍是旧 baibian.md）被删的两条和「2026 · 秋」这一节都没回来')
        check(pg.evaluate("() => document.querySelectorAll('.ed-del, [data-edit-ui]').length") == 0, 'S 刷新后不在编辑模式，没有删除按钮')
        numbers_ok_n = pg.evaluate(NUMS_JS)
        check(numbers_ok_n == ['%03d' % i for i in range(1, len(numbers_ok_n) + 1)], 'S 刷新后编号仍然连续')
        load(pg, 'weibo')
        check('从未天真过' not in pg.evaluate("() => document.getElementById('view').innerText"), 'S 刷新后微博被删的那条也没回来')
        if r2:
            site_override['/baibian.md'] = r2['after']
        load(pg, 'baibian')
        rec = pg.evaluate("() => JSON.parse(localStorage.getItem('datode-edit-pending') || '{}')")
        check('baibian' not in rec and '求个搭子' not in pg.evaluate("() => document.getElementById('view').innerText"),
              'S 线上已是新版：照常显示，本地那条记录清掉')
        site_override.clear()
        ctx.close()

        # ================= P 深色：确认框、删除后 =================
        repo[0] = FakeRepo(root)
        for scheme in ('dark',):
            c2 = br.new_context(viewport={'width': 1440, 'height': 900}, color_scheme=scheme, reduced_motion='reduce')
            c2.add_init_script("try { localStorage.setItem('datode-edit-token', '%s'); } catch (e) {}" % TOK_WRITE)
            c2.route('**/*', router)
            p2 = open_page(c2, 'baibian')
            enter_edit(p2)
            p2.evaluate("() => [...document.querySelectorAll('#view li[data-entry]')][3].scrollIntoView({ block: 'center' })")
            p2.wait_for_timeout(200)
            p2.mouse.move(5, 5)
            p2.screenshot(path=str(shots / f'delete-{scheme}-buttons.png'))
            delete_one(p2, 'baibian.md', '求个搭子一起玩《双人成行》', f'{scheme} · 2026 · 秋 唯一一条', shot=f'delete-{scheme}-confirm.png')
            p2.evaluate("() => window.scrollTo(0, 0)")
            p2.wait_for_timeout(200)
            p2.mouse.move(5, 5)
            p2.screenshot(path=str(shots / f'delete-{scheme}-after.png'))
            c2.close()
        br.close()
    srv.shutdown()

    # ================= 全程离线、真文件没动 =================
    stray = [u for u in external if not u.startswith(SITE_THIRD_PARTY)]
    check(not stray, f'离线：除站点原有的统计 / 字体（已拦下）外没有任何外网请求{"：" + str(stray[:5]) if stray else ""}')
    check(all((root / f).read_bytes() == b for f, b in orig_md.items()), '仓库里真的 baibian.md / weibo.md 一个字节没动（删除只发生在假 GitHub 里）')
    errs = [m_ for m_ in consoles if m_.startswith('pageerror')]
    check(not errs, f'页面没有抛出脚本错误{"：" + str(errs[:3]) if errs else ""}')
    check(not any(any(t in m_ for t in TOKENS) for m_ in consoles), 'T Token 没有出现在 console 里')
    print(f'\n{len(failures)} failure(s)')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
