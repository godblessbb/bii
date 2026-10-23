"""百变动态合集（#/baibian）配图的真实浏览器探针。

用法：/opt/Alphie/.venv/bin/python -I _dev/baibian_check.py <仓库根> [--evidence <截图目录>]

本地起一个静态服务器，用 Playwright 的 Chromium 打开站点，所有外网请求一律拦下（Chromium 另外把域名都解析到不存在）。
判什么：
  M  baibian.md 里每条动态下面那一行缩略图标记（![](media/baibian/s/<id>_<NN>-<宽>x<高>.jpg)）都排成了这一条里的图组：
     图组跟在这条文字的 [data-entry] 里、顺序与 md 一致、同一组只属于一条动态、编号从 01 连续；每张链接指向 media/baibian/<id>_<NN>.jpg，
     原图和缩略图都在仓库里；media/baibian 下没有页面不用的图（删掉的动态的图不在仓库里）。
  T  配图不加字：页面正文的文字与「把 md 里的配图行全删掉」排出来的正文逐字相同；图片 alt 全为空，没有图注。
  L  版式：1 张按原比例（框不超过 24rem × 21rem，长图按 3:4 的框），2、4 张两列，3、5、6 张三列，格子是正方形、各组格子一样大；
     长图在页面里不会被拉成一条（任何一格都不高过 21rem）。
  W  手机 390 / 320 宽、浅色深色：页面没有横向溢出，每个图组都在屏幕里。
  Z  懒加载：刚打开页面时只下载了少量缩略图，没有下载任何一张原图。
  V  实点图片：大图浮层打开，img 的 src 就是这张的原图文件，截图里大图位置确实是照片（不是空框，浮层不透明、淡入已结束），
     原图还在下载（限速）时垫着这张的缩略图，在浏览器里取回的字节 sha256 与仓库里的原图相同、naturalWidth 与原图一致；
     → / ← / 按钮能在同一条动态的几张之间切换（张数对、到头循环）、不会跨到别的动态；Esc、点空白处、关闭按钮都能退出，焦点回到那张图；
     长图按屏宽排开、能上下滚；手机上点开、左右滑切换、点关闭都可用；整个过程没有任何外网请求。
  E  站长编辑（假 GitHub）：点带图的那一块，编辑框里没有图片标记、框下说明有几条带图；删掉一条带图的动态时先警告「会消失」并列出图，
     「回去改」不发 PUT；改一条带图动态的字，预览里图还在，保存发出的 PUT 与「原文件只改这几个字」逐字节相同（图片标记原样留在那条下面）。
  P  桌面 / 手机 × 浅色 / 深色的版式截图、大图截图、编辑截图存进证据目录。
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
import struct
import sys
import tempfile
import threading
from pathlib import Path
from urllib.parse import unquote, urlparse

from PIL import Image, ImageStat
from playwright.sync_api import sync_playwright
import io

DEFAULT_EVIDENCE = '/root/.alphie/coding_tasks/ct_dc1284a0/evidence'
SITE_THIRD_PARTY = ('https://www.googletagmanager.com/', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/')
PIC_LINE = re.compile(r'^[ \t]+(?:!\[[^\]]*\]\([^()\s]*/s/[^()\s/]+-\d+x\d+\.jpg\))+[ \t]*$')
PIC_REF = re.compile(r'!\[([^\]]*)\]\(([^()\s]*/s/((p[0-9a-f]{16}|p\d{4})_(\d{2}))-(\d+)x(\d+)\.jpg)\)')
REM = 16

results = {'ok': 0, 'fail': 0}


def ok(msg: str) -> None:
    results['ok'] += 1
    print('  ok  ', msg)


def fail(msg: str) -> None:
    results['fail'] += 1
    print('  FAIL', msg)


def check(cond, msg: str) -> bool:
    (ok if cond else fail)(msg)
    return bool(cond)


def squash(s: str) -> str:
    return re.sub(r'\s+', '', s)


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def git_blob_sha(b: bytes) -> str:
    return hashlib.sha1(b'blob %d\0' % len(b) + b).hexdigest()


def jpeg_size(b: bytes):
    """JPEG 的宽高（SOF 段），不靠第三方库。"""
    i = 2
    while i < len(b) - 9:
        if b[i] != 0xFF:
            i += 1
            continue
        m = b[i + 1]
        if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h, w = struct.unpack('>HH', b[i + 5:i + 9])
            return w, h
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        i += 2 + struct.unpack('>H', b[i + 2:i + 4])[0]
    return None


def md_entries(md: str):
    """按 md 的顺序列出每条动态（以 '- ' 开头的行）和它下面的配图：[(文字, [(alt, src, 名字, id, 序号, 宽, 高)])]"""
    out = []
    for line in md.split('\n'):
        if line.startswith('- '):
            out.append([line[2:], []])
        elif PIC_LINE.match(line):
            assert out, '配图行前面没有动态'
            out[-1][1].extend(PIC_REF.findall(line))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('root')
    ap.add_argument('--evidence', default=os.environ.get('BAIBIAN_CHECK_EVIDENCE') or (DEFAULT_EVIDENCE if os.path.isdir(DEFAULT_EVIDENCE) else ''))
    a = ap.parse_args()
    root = Path(a.root).resolve()
    shots = Path(a.evidence) if a.evidence else Path(tempfile.mkdtemp(prefix='baibian_check_'))
    shots.mkdir(parents=True, exist_ok=True)
    print('screenshots ->', shots)

    md_bytes = (root / 'baibian.md').read_bytes()
    md = md_bytes.decode('utf-8')
    entries = md_entries(md)
    with_pics = [(i, e) for i, e in enumerate(entries) if e[1]]
    all_pics = [p for _, e in with_pics for p in e[1]]
    md_nopics = '\n'.join(l for l in md.split('\n') if not PIC_LINE.match(l))
    print(f'baibian.md：{len(entries)} 条动态，{len(with_pics)} 条带图，共 {len(all_pics)} 张')

    # ================= M 仓库里的文件 =================
    check(len(with_pics) > 0, 'M baibian.md 里有配图')
    names = [p[2] for p in all_pics]
    check(len(names) == len(set(names)), 'M 同一张图只出现一次')
    bad_order = [e[0][:16] for _, e in with_pics if len({p[3] for p in e[1]}) != 1 or [int(p[4]) for p in e[1]] != list(range(1, len(e[1]) + 1))]
    check(not bad_order, f'M 每条动态的图属于同一条、编号从 01 连续、顺序不乱{"：" + str(bad_order) if bad_order else ""}')
    missing, orig_meta = [], {}
    for alt, src, name, pid, pos, w, h in all_pics:
        t = root / src
        o = root / 'media/baibian' / (name + '.jpg')
        if not t.is_file() or not o.is_file():
            missing.append(name)
            continue
        ob = o.read_bytes()
        orig_meta[name] = {'sha': sha256(ob), 'size': jpeg_size(ob), 'bytes': len(ob)}
    check(not missing, f'M 每张图的缩略图和原图都在仓库里{"：缺 " + ",".join(missing[:5]) if missing else ""}')
    used_orig = {n + '.jpg' for n in names}
    used_thumb = {Path(p[1]).name for p in all_pics}
    extra = sorted({f.name for f in (root / 'media/baibian').glob('*.jpg')} - used_orig) + sorted({f.name for f in (root / 'media/baibian/s').glob('*.jpg')} - used_thumb)
    check(not extra, f'M media/baibian 下没有页面不用的图（删掉的动态的图不在仓库里）{"：多出 " + ",".join(extra[:5]) if extra else ""}')
    check(all(p[0] == '' for p in all_pics), 'T md 里的图片标记 alt 全为空（不替用户写字）')

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *x):
            pass
    class Server(http.server.ThreadingHTTPServer):
        def handle_error(self, request, client_address):   # 翻页时浏览器掐断还没下载完的图（BrokenPipe），不算错
            pass
    srv = Server(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{srv.server_address[1]}'

    state = {'override': None, 'requests': [], 'external': [], 'puts': [], 'md': md_bytes, 'hold': set(), 'held': []}

    def router(route):
        url = route.request.url
        if url.startswith(origin + '/'):
            p = unquote(urlparse(url).path)
            state['requests'].append(p)
            if p in state['hold']:          # 模拟原图还在路上：先不回，等主流程放行
                state['held'].append(route)
                return
            if p == '/baibian.md' and state['override'] is not None:
                return route.fulfill(status=200, headers={'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache'}, body=state['override'])
            return route.continue_()
        if url.startswith('https://api.github.com/'):
            return fake_github(route)
        if not url.startswith(SITE_THIRD_PARTY):
            state['external'].append(url)
        return route.abort()

    def fake_github(route):
        req = route.request
        cors = {'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, PUT, OPTIONS',
                'access-control-allow-headers': 'Authorization, Content-Type, Accept, X-GitHub-Api-Version'}
        if req.method == 'OPTIONS':
            return route.fulfill(status=204, headers=cors)
        path = unquote(urlparse(req.url).path)
        hdr = {**cors, 'content-type': 'application/json; charset=utf-8', 'x-ratelimit-remaining': '4999'}
        if path == '/repos/godblessbb/bii/contents/baibian.md':
            cur = state['md']
            if req.method == 'GET':
                return route.fulfill(status=200, headers=hdr, body=json.dumps({'type': 'file', 'encoding': 'base64', 'path': 'baibian.md',
                                                                                  'sha': git_blob_sha(cur), 'content': base64.encodebytes(cur).decode()}))
            if req.method == 'PUT':
                data = json.loads(req.post_data or '{}')
                if data.get('sha') != git_blob_sha(cur):
                    return route.fulfill(status=409, headers=hdr, body='{"message":"sha mismatch"}')
                new = base64.b64decode(data['content'])
                state['puts'].append({'old': cur, 'new': new, 'message': data.get('message', '')})
                state['md'] = new
                return route.fulfill(status=200, headers=hdr, body=json.dumps({'content': {'sha': git_blob_sha(new)},
                                                                                 'commit': {'sha': 'f00dfeed' * 5, 'html_url': 'https://github.com/godblessbb/bii/commit/' + 'f00dfeed' * 5}}))
        return route.fulfill(status=404, headers=hdr, body='{"message":"Not Found"}')

    def ready(pg):
        pg.wait_for_function("() => { const v = document.getElementById('view'); return v && v.querySelector('[data-weibo-body]') && !v.querySelector('.loading'); }", timeout=15000)
        pg.wait_for_timeout(300)

    def open_ctx(br, vp, scheme, mobile=False, scale=1):
        ctx = br.new_context(viewport=vp, color_scheme=scheme, reduced_motion='reduce', device_scale_factor=scale, is_mobile=mobile, has_touch=mobile)
        ctx.route('**/*', router)
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        return ctx, pg, errs

    def goto(pg, n=[0]):
        n[0] += 1
        pg.goto(f'{origin}/?probe={n[0]}#/baibian', wait_until='load')
        ready(pg)

    def scroll_to(pg, loc, dy=-140):
        loc.evaluate("e => e.scrollIntoView({ block: 'start' })")
        pg.evaluate(f'window.scrollBy(0, {dy})')
        pg.wait_for_timeout(250)

    def wait_thumbs(pg):
        pg.wait_for_function("""() => [...document.querySelectorAll('.wb-pic img')].filter(i => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })
            .every(i => i.complete && i.naturalWidth > 0)""", timeout=10000)
        pg.wait_for_timeout(150)

    def lb_state(pg):
        return pg.evaluate("""() => { const l = document.querySelector('.wb-lb'); if (!l) return null; const i = l.querySelector('.wb-lb-img');
            return { src: i.getAttribute('src'), abs: i.src, count: l.querySelector('.wb-lb-count').textContent, cls: l.className,
                     natural: [i.naturalWidth, i.naturalHeight], box: i.getBoundingClientRect().toJSON(),
                     stage: (s => [s.scrollHeight, s.clientHeight, s.scrollWidth, s.clientWidth])(l.querySelector('.wb-lb-stage')),
                     focus: document.activeElement && document.activeElement.getAttribute('data-lb') } }""")

    def wait_lb_loaded(pg):
        # 下载完、解码完（is-ready 是 decode() 之后才挂的）、浮层淡入结束，才算「上屏了」
        pg.wait_for_function("() => { const l = document.querySelector('.wb-lb.is-ready'); const i = l && l.querySelector('.wb-lb-img'); return i && i.complete && i.naturalWidth > 0 && getComputedStyle(l).opacity === '1' && getComputedStyle(i).opacity === '1'; }", timeout=20000)
        pg.evaluate("() => document.querySelector('.wb-lb .wb-lb-img').decode().catch(() => {})")
        pg.wait_for_timeout(100)

    def img_pixels(pg):
        """截屏里大图框（.wb-lb-frame）在屏幕内那一块的中间区域：返回各通道标准差的最大值（纯色空框≈0）。"""
        r = pg.evaluate("() => { const b = document.querySelector('.wb-lb .wb-lb-frame').getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom, innerWidth, innerHeight]; }")
        x0, y0, x1, y1 = max(r[0], 0), max(r[1], 0), min(r[2], r[4]), min(r[3], r[5])
        w, h = x1 - x0, y1 - y0
        if w < 20 or h < 20:
            return 0.0
        clip = {'x': x0 + w * 0.2, 'y': y0 + h * 0.2, 'width': w * 0.6, 'height': h * 0.6}
        im = Image.open(io.BytesIO(pg.screenshot(clip=clip))).convert('RGB')
        return max(ImageStat.Stat(im).stddev)

    def shown_ok(pg, label):
        sd = img_pixels(pg)
        bg = pg.evaluate("""() => { const l = document.querySelector('.wb-lb'); return [getComputedStyle(l).backgroundColor, getComputedStyle(l).opacity,
            getComputedStyle(l.querySelector('.wb-lb-ph')).visibility, getComputedStyle(l.querySelector('.wb-lb-img')).opacity]; }""")
        opaque = bg[1] == '1' and not re.search(r'/\s*0?\.\d|rgba\([^)]*,\s*0?\.\d+\)', bg[0])
        check(sd > 12 and opaque and bg[2] == 'hidden' and bg[3] == '1',
              f'V {label}：截图里大图位置确实是照片（像素标准差 {sd:.0f}，不是空框）；画出来的是原图（垫底缩略图已藏、原图不透明）；纸色浮层不透明，背后页面不透出')

    def fetched_sha(pg, src):
        return pg.evaluate("""async (u) => { const b = await (await fetch(u, { cache: 'no-store' })).arrayBuffer();
            return [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join(''); }""", src)

    def name_of(src):
        m = re.search(r'media/baibian/([^/]+)\.jpg$', src or '')
        return m.group(1) if m else None

    DOM_GROUPS = """() => [...document.querySelectorAll('[data-weibo-body] [data-entry]')].map(li => {
        const g = li.querySelector(':scope > .wb-pics');
        return { text: li.textContent, groups: li.querySelectorAll('.wb-pics').length, n: g ? +g.getAttribute('data-n') : 0,
                 pics: g ? [...g.querySelectorAll('.wb-pic')].map(a => ({ href: a.getAttribute('href'), thumb: a.querySelector('img').getAttribute('src'),
                   alt: a.querySelector('img').getAttribute('alt'), long: a.classList.contains('is-long') })) : [] }; })"""

    with sync_playwright() as p:
        br = p.chromium.launch(args=['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'])

        # ================= 桌面浅色：结构、文字、懒加载、版式、大图 =================
        ctx, pg, errs = open_ctx(br, {'width': 1440, 'height': 900}, 'light')
        goto(pg)
        pg.wait_for_timeout(800)
        early = [r for r in state['requests'] if r.startswith('/media/baibian/')]
        check(not [r for r in early if '/s/' not in r], f'Z 刚打开页面时没有下载任何一张原图')
        check(len(early) <= 24, f'Z 刚打开页面时只下载了 {len(early)} 张缩略图（共 {len(all_pics)} 张，其余随滚动懒加载）')

        dom = pg.evaluate(DOM_GROUPS)
        check(len(dom) == len(entries), f'M 页面上 {len(dom)} 条动态，与 md 的 {len(entries)} 条一致')
        wrong = []
        for (text, pics), d in zip(entries, dom):
            want = [(p[2], p[1]) for p in pics]
            got = [(name_of(x['href']), x['thumb'].lstrip('./')) for x in d['pics']]
            if want != got or (pics and (d['groups'] != 1 or d['n'] != len(pics))) or (not pics and d['groups']):
                wrong.append(text[:16])
        check(not wrong, f'M 每条动态的图组就在这一条里、张数和顺序与 md 一致、链接指向同名原图{"：" + str(wrong[:5]) if wrong else ""}')
        check(all(x['alt'] == '' for d in dom for x in d['pics']), 'T 页面上的配图 alt 全为空')
        check(not pg.locator('[data-weibo-body] figcaption').count(), 'T 没有图注')
        body_with = pg.evaluate("() => document.querySelector('[data-weibo-body]').innerText")

        # 版式
        lay = pg.evaluate("""() => [...document.querySelectorAll('.wb-pics')].map(g => { const cells = [...g.querySelectorAll('.wb-pic')].map(a => a.getBoundingClientRect());
            const cols = new Set(cells.map(r => Math.round(r.left))).size;
            return { n: +g.getAttribute('data-n'), cols, cells: cells.map(r => [r.width, r.height]), r: getComputedStyle(g.querySelector('.wb-pic')).getPropertyValue('--r'),
                     long: g.querySelector('.wb-pic').classList.contains('is-long'), gw: g.getBoundingClientRect().width,
                     colw: g.parentNode.getBoundingClientRect().width }; })""")
        multi = [g for g in lay if g['n'] > 1]
        cols_ok = all(g['cols'] == (2 if g['n'] in (2, 4) else 3) for g in multi)
        check(cols_ok, 'L 2、4 张两列；3、5、6 张三列')
        sq = all(abs(w - h) <= 1 for g in multi for w, h in g['cells'])
        check(sq, 'L 多图的格子都是正方形')
        sizes = [w for g in multi for w, h in g['cells']]
        check(sizes and max(sizes) - min(sizes) <= 2, f'L 各组格子一样大（{min(sizes):.0f}–{max(sizes):.0f}px）')
        singles = [g for g in lay if g['n'] == 1]
        single_ok = all(g['cells'][0][0] <= 24 * REM + 1 and g['cells'][0][1] <= 21 * REM + 1
                        and abs(g['cells'][0][1] / g['cells'][0][0] - float(g['r'])) < 0.02 for g in singles)
        check(single_ok, f'L 单张按原比例（长图按 3:4），框不超过 24rem × 21rem（{len(singles)} 组）')
        tallest = max(h for g in lay for w, h in g['cells'])
        check(tallest <= 21 * REM + 1, f'L 长图没有把版面拉成一条：最高的一格 {tallest:.0f}px')
        counts = sorted({g['n'] for g in lay})
        print('     图组张数：', counts, '；含长图的组：', sum(1 for g in lay if g['long']))

        # 截图：各种版式
        def shot_entries(pg, tag):
            picks = {}
            for i, d in enumerate(dom):
                if not d['pics']:
                    continue
                key = (d['n'] if d['n'] > 1 else ('1-long' if d['pics'][0]['long'] else '1'))
                picks.setdefault(key, i)
            for key, i in sorted(picks.items(), key=lambda kv: str(kv[0])):
                li = pg.locator('[data-weibo-body] [data-entry]').nth(i)
                scroll_to(pg, li, -110)
                wait_thumbs(pg)
                pg.screenshot(path=str(shots / f'baibian-{tag}-n{key}.png'))
        shot_entries(pg, 'desktop-light')

        # V 实点图片（桌面）
        six = next(i for i, d in enumerate(dom) if d['n'] == 6)
        g6 = [name_of(x['href']) for x in dom[six]['pics']]
        li = pg.locator('[data-weibo-body] [data-entry]').nth(six)
        scroll_to(pg, li)
        before = [r for r in state['requests'] if r.startswith('/media/baibian/') and '/s/' not in r]
        check(not before, 'Z 点开之前没有下载过原图')
        li.locator('.wb-pic').nth(2).click()
        pg.wait_for_selector('.wb-lb', timeout=5000)
        wait_lb_loaded(pg)
        st = lb_state(pg)
        nm = name_of(st['src'])
        check(nm == g6[2], f'V 点第 3 张，大图 src 指向它的原图 {st["src"]}')
        if nm in orig_meta:
            check(fetched_sha(pg, st['abs']) == orig_meta[nm]['sha'], 'V 大图取回的字节 sha256 与仓库里的原图相同')
            check(tuple(st['natural']) == orig_meta[nm]['size'], f'V 大图 naturalWidth × naturalHeight = 原图 {orig_meta[nm]["size"]}')
        check(st['count'].replace(' ', '') == '3/6', f'V 显示张数「{st["count"]}」')
        check(st['focus'] == 'close', 'V 打开后焦点在关闭按钮上')
        check(st['box']['width'] <= 1440 and st['box']['height'] <= 900, 'V 普通图整张放进屏幕')
        shown_ok(pg, '桌面浅色')
        pg.screenshot(path=str(shots / 'baibian-desktop-light-viewer.png'))
        seq = []
        for _ in range(6):
            pg.keyboard.press('ArrowRight')
            seq.append(name_of(lb_state(pg)['src']))
        check(seq == g6[3:] + g6[:3], f'V → 依次切到同一条动态的下一张，到头回到第一张')
        wait_lb_loaded(pg)
        shown_ok(pg, '切换后')
        pg.keyboard.press('ArrowLeft')
        check(name_of(lb_state(pg)['src']) == g6[1], 'V ← 回到上一张')
        pg.locator('.wb-lb [data-lb="next"]').click()
        check(name_of(lb_state(pg)['src']) == g6[2], 'V 「下一张」按钮切换')
        pg.locator('.wb-lb [data-lb="prev"]').click()
        check(name_of(lb_state(pg)['src']) == g6[1], 'V 「上一张」按钮切换')
        others = {name_of(x['href']) for k, d in enumerate(dom) if k != six for x in d['pics']}
        check(not (set(seq) & others), 'V 切换不会跨到别的动态')
        # 原尺寸：点图切到 1:1
        wait_lb_loaded(pg)
        st = lb_state(pg)
        if 'is-big' in st['cls']:
            pg.locator('.wb-lb-img').click()
            st2 = lb_state(pg)
            check('is-zoom' in st2['cls'] and abs(st2['box']['width'] - st2['natural'][0]) <= 1, f'V 点图看原尺寸：显示宽度 = 原图宽 {st2["natural"][0]}px')
            pg.locator('.wb-lb-img').click()
        pg.keyboard.press('Escape')
        check(not pg.locator('.wb-lb').count(), 'V Esc 退出')
        check(pg.evaluate("() => document.activeElement && document.activeElement.classList.contains('wb-pic')"), 'V 退出后焦点回到点开的那张图')
        check(not pg.evaluate("() => document.documentElement.classList.contains('wb-lb-open')"), 'V 退出后页面恢复滚动')
        li.locator('.wb-pic').first.click()
        pg.wait_for_selector('.wb-lb')
        pg.mouse.click(30, 120)   # 左上方空白
        check(not pg.locator('.wb-lb').count(), 'V 点空白处退出')
        li.locator('.wb-pic').first.click()
        pg.wait_for_selector('.wb-lb')
        pg.locator('.wb-lb [data-lb="close"]').click()
        check(not pg.locator('.wb-lb').count(), 'V 关闭按钮退出')

        # 原图还没到（探针把原图的响应扣住）时，大图位置垫着这张的缩略图，不是空框；原图到了、解码上屏后才换掉
        five = next(i for i, d in enumerate(dom) if d['n'] == 5)
        li5 = pg.locator('[data-weibo-body] [data-entry]').nth(five)
        scroll_to(pg, li5)
        wait_thumbs(pg)
        state['hold'] = {unquote(urlparse(origin + '/' + x['href'].lstrip('./')).path) for x in dom[five]['pics']}
        li5.locator('.wb-pic').nth(0).click()
        pg.wait_for_selector('.wb-lb')
        pg.wait_for_timeout(800)
        loading = pg.evaluate("""() => { const i = document.querySelector('.wb-lb-img'), t = document.querySelector('.wb-lb-ph');
            return !(i.complete && i.naturalWidth) && getComputedStyle(i).opacity === '0' && t.complete && t.naturalWidth > 0 && getComputedStyle(t).visibility === 'visible'; }""")
        sd = img_pixels(pg)
        check(loading and sd > 12, f'V 原图还在下载时：垫着这张的缩略图（像素标准差 {sd:.0f}），不是空框')
        pg.screenshot(path=str(shots / 'baibian-desktop-light-viewer-loading.png'))
        check(len(state['held']) >= 1, f'V 原图请求确实被扣住了（{len(state["held"])} 个）')
        state['hold'] = set()
        for r in state['held']:
            r.continue_()
        state['held'] = []
        wait_lb_loaded(pg)
        check(name_of(lb_state(pg)['src']) == name_of(dom[five]['pics'][0]['href']), 'V 放行后原图到了：还是这张的原图')
        shown_ok(pg, '放行后原图到了')
        pg.keyboard.press('Escape')

        # 单张：没有左右按钮和张数
        one = next(i for i, d in enumerate(dom) if d['n'] == 1 and not d['pics'][0]['long'])
        li1 = pg.locator('[data-weibo-body] [data-entry]').nth(one)
        scroll_to(pg, li1)
        li1.locator('.wb-pic').click()
        pg.wait_for_selector('.wb-lb')
        wait_lb_loaded(pg)
        st = lb_state(pg)
        check(name_of(st['src']) == name_of(dom[one]['pics'][0]['href']) and st['count'] == ''
              and not pg.locator('.wb-lb [data-lb="next"]').is_visible(), 'V 单张：打开它自己的原图，不显示切换按钮和张数')
        pg.keyboard.press('ArrowRight')
        check(name_of(lb_state(pg)['src']) == name_of(dom[one]['pics'][0]['href']), 'V 单张：→ 不会切到别的动态')
        pg.keyboard.press('Escape')

        # 长图
        lg = next(i for i, d in enumerate(dom) if d['n'] == 1 and d['pics'][0]['long'])
        lil = pg.locator('[data-weibo-body] [data-entry]').nth(lg)
        scroll_to(pg, lil)
        lil.locator('.wb-pic').click()
        pg.wait_for_selector('.wb-lb')
        wait_lb_loaded(pg)
        st = lb_state(pg)
        check('is-long' in st['cls'] and st['stage'][0] > st['stage'][1] + 200 and st['stage'][2] <= st['stage'][3] + 1,
              f'V 长图：按屏宽排开，能上下滚着看（{st["natural"][0]}×{st["natural"][1]}）')
        shown_ok(pg, '桌面长图')
        pg.screenshot(path=str(shots / 'baibian-desktop-light-viewer-long.png'))
        pg.keyboard.press('Escape')
        check(not errs, f'V 桌面没有脚本错误{"：" + errs[0] if errs else ""}')
        ctx.close()

        # T 配图不加字：同一页去掉配图行再排一遍，正文文字逐字相同
        ctx, pg, errs = open_ctx(br, {'width': 1440, 'height': 900}, 'light')
        state['override'] = md_nopics.encode('utf-8')
        goto(pg)
        body_without = pg.evaluate("() => document.querySelector('[data-weibo-body]').innerText")
        state['override'] = None
        check(squash(body_with) == squash(body_without), 'T 正文文字与「md 删掉配图行」排出来的逐字相同（配图不带任何字）')
        ctx.close()

        # ================= 桌面深色 & 手机浅色 / 深色 =================
        ctx, pg, errs = open_ctx(br, {'width': 1440, 'height': 900}, 'dark')
        goto(pg)
        shot_entries(pg, 'desktop-dark')
        li = pg.locator('[data-weibo-body] [data-entry]').nth(six)
        scroll_to(pg, li)
        li.locator('.wb-pic').nth(0).click()
        wait_lb_loaded(pg)
        shown_ok(pg, '桌面深色')
        pg.screenshot(path=str(shots / 'baibian-desktop-dark-viewer.png'))
        pg.keyboard.press('Escape')
        ctx.close()

        for w, scheme in [(390, 'light'), (390, 'dark'), (320, 'light')]:
            ctx, pg, errs = open_ctx(br, {'width': w, 'height': 844}, scheme, mobile=True, scale=2)
            goto(pg)
            pg.evaluate("async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 700) { scrollTo(0, y); await new Promise(r => setTimeout(r, 15)); } }")
            pg.wait_for_timeout(300)
            ov = pg.evaluate("""() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
                out: [...document.querySelectorAll('.wb-pics, .wb-pic')].filter(e => { const r = e.getBoundingClientRect(); return r.left < -0.5 || r.right > document.documentElement.clientWidth + 0.5; }).length })""")
            check(ov['sw'] <= ov['cw'] and ov['out'] == 0, f'W 手机 {w} 宽 {scheme}：没有横向溢出（scrollWidth {ov["sw"]} / {ov["cw"]}），图组都在屏幕里')
            if w == 390:
                shot_entries(pg, f'mobile-{scheme}')
                li = pg.locator('[data-weibo-body] [data-entry]').nth(six)
                scroll_to(pg, li, -90)
                li.locator('.wb-pic').nth(0).tap()
                pg.wait_for_selector('.wb-lb', timeout=5000)
                wait_lb_loaded(pg)
                st = lb_state(pg)
                check(name_of(st['src']) == g6[0] and st['box']['width'] <= w + 0.5 and st['stage'][2] <= st['stage'][3] + 1,
                      f'V 手机 {scheme}：点开是原图，宽度不超过屏幕')
                shown_ok(pg, f'手机{scheme}')
                pg.screenshot(path=str(shots / f'baibian-mobile-{scheme}-viewer.png'))
                swipe = """(dx) => { const s = document.querySelector('.wb-lb-stage'); const o = { pointerType: 'touch', isPrimary: true, pointerId: 7, bubbles: true };
                    s.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: 260, clientY: 400 }));
                    s.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: 260 + dx, clientY: 410 })); }"""
                pg.evaluate(swipe, -160)
                check(name_of(lb_state(pg)['src']) == g6[1], 'V 手机：向左滑切到下一张')
                pg.evaluate(swipe, 160)
                check(name_of(lb_state(pg)['src']) == g6[0], 'V 手机：向右滑回到上一张')
                pg.locator('.wb-lb [data-lb="close"]').tap()
                check(not pg.locator('.wb-lb').count(), 'V 手机：点关闭退出')
                if scheme == 'dark':
                    lil = pg.locator('[data-weibo-body] [data-entry]').nth(lg)
                    scroll_to(pg, lil, -90)
                    lil.locator('.wb-pic').tap()
                    wait_lb_loaded(pg)
                    st = lb_state(pg)
                    check(st['box']['width'] <= w + 0.5 and st['stage'][0] > st['stage'][1], 'V 手机：长图贴屏宽、上下滚着看')
                    shown_ok(pg, '手机长图')
                    pg.screenshot(path=str(shots / 'baibian-mobile-dark-viewer-long.png'))
                    pg.keyboard.press('Escape')
            check(not errs, f'V 手机 {w} {scheme} 没有脚本错误{"：" + errs[0] if errs else ""}')
            ctx.close()
        check(not state['external'], f'V 没有任何外网请求（不引外部 CDN）{"：" + state["external"][0] if state["external"] else ""}')

        # ================= E 站长编辑（假 GitHub） =================
        ctx, pg, errs = open_ctx(br, {'width': 1440, 'height': 900}, 'light')
        ctx.add_init_script("try { localStorage.setItem('datode-edit-token', 'probe-token-baibian'); } catch (e) {}")
        goto(pg)
        for _ in range(3):
            pg.keyboard.press('e')
            pg.wait_for_timeout(80)
        pg.wait_for_function("() => document.documentElement.hasAttribute('data-editing') && document.querySelector('#view [data-edit-block]')", timeout=8000)
        target = next(e for e in entries if e[1] and len(e[1]) >= 2)   # 一条带多张图的动态
        snip = target[0][:12]
        li = pg.locator('#view [data-edit-block] li', has_text=snip).first
        scroll_to(pg, li)
        li.click()
        pg.wait_for_selector('.ed-panel .ed-area', state='visible', timeout=5000)
        area = pg.locator('.ed-panel .ed-area')
        shown = area.input_value()
        raw = pg.evaluate("""([t, s]) => { const tok = marked.lexer(t, { gfm: true }).find(k => k.type === 'list' && k.raw.includes(s)); return tok ? tok.raw.replace(/\\n+$/, '') : null; }""", [md, target[0]])
        want_shown = '\n'.join(l for l in (raw or '').split('\n') if not PIC_LINE.match(l))
        check(raw is not None and '![' in raw and shown == want_shown, 'E 编辑带图的块：编辑框里是这一块的原文、只拿掉了配图行（图片标记不当正文显示）')
        caret = pg.evaluate("() => document.querySelector('.ed-area').selectionStart")
        check(shown[caret:].startswith('- ' + target[0][:8]), 'E 光标落在点中的那一条')
        note = pg.evaluate("() => (document.querySelector('[data-note=\"pics\"]') || {}).textContent || ''")
        groups_here = sum(1 for l in raw.split('\n') if PIC_LINE.match(l))
        check(f'{groups_here} 条动态带图' in note, f'E 编辑框下说明这一块有几条带图：「{note[:40]}…」')
        pg.screenshot(path=str(shots / 'baibian-edit-pics-note.png'))

        # 删掉一条带图的动态：先警告，回去改不保存
        line = '- ' + target[0]
        pg.locator('.ed-panel .ed-area').fill(shown.replace(line + '\n\n', '', 1) if line + '\n\n' in shown else shown.replace('\n\n' + line, '', 1))
        pg.locator('.ed-panel [data-ed="save"]').click()
        try:
            pg.wait_for_selector('[data-note="sketch"] [data-ed="force"]', timeout=5000)
            warn = pg.locator('[data-note="sketch"]').text_content()
            check('会消失' in warn and target[1][0][2] + '.jpg' in warn, f'E 删掉带图的那条：保存前警告配图会消失并列出是哪几张')
        except Exception:
            fail('E 删掉带图的那条后没有出现「会消失」警告')
        pg.screenshot(path=str(shots / 'baibian-edit-pics-warning.png'))
        if pg.locator('[data-note="sketch"] [data-ed="back"]').count():
            pg.locator('[data-note="sketch"] [data-ed="back"]').click()
        pg.wait_for_timeout(300)
        check(not state['puts'], 'E 「回去改」不发 PUT')

        # 改那条的字：预览里图还在，保存的字节只改了这几个字
        text0 = target[0]
        chars = [c for c in text0 if re.match(r'[一-鿿]', c)]
        old_c = chars[0]
        new_c = '甲' if old_c != '甲' else '乙'
        text1 = text0.replace(old_c, new_c, 1)
        pg.locator('.ed-panel .ed-area').fill(shown.replace(text0, text1, 1))
        pg.locator('.ed-panel [data-ed="preview"]').click()
        pg.wait_for_timeout(300)
        prev_pics = pg.evaluate("() => [...document.querySelectorAll('.ed-preview-node .wb-pic')].map(a => a.getAttribute('href'))")
        check([name_of(h) for h in prev_pics if name_of(h) in {p[2] for p in target[1]}] == [p[2] for p in target[1]], 'E 改了字以后预览：那条下面的图还在、顺序不变')
        pg.locator('.ed-panel [data-ed="preview"]').click()
        pg.locator('.ed-panel [data-ed="save"]').click()
        try:
            pg.wait_for_function("() => /已保存/.test((document.querySelector('.ed-bar-s') || {}).textContent || '')", timeout=8000)
        except Exception:
            fail('E 保存没有完成：' + (pg.evaluate("() => (document.querySelector('.ed-status') || {}).textContent || ''")))
        if check(len(state['puts']) == 1, 'E 发出了一条 PUT'):
            exp = md_bytes.replace(text0.encode('utf-8'), text1.encode('utf-8'), 1)
            check(state['puts'][0]['new'] == exp, 'E PUT 与「原文件只改这几个字」逐字节相同（配图行原样留在那条下面）')
            check('![' not in state['puts'][0]['message'], 'E 提交信息里没有图片标记')
        pg.wait_for_timeout(300)
        after = pg.evaluate("""(s) => { const li = [...document.querySelectorAll('[data-weibo-body] [data-entry]')].find(l => l.textContent.includes(s));
            return li ? [...li.querySelectorAll('.wb-pic')].map(a => a.getAttribute('href')) : null; }""", text1[:12])
        check(after is not None and [name_of(h) for h in after] == [p[2] for p in target[1]], 'E 保存后页面上那条显示新字，图还在它下面')
        pg.screenshot(path=str(shots / 'baibian-edit-saved.png'))
        check(not errs, f'E 编辑过程没有脚本错误{"：" + errs[0] if errs else ""}')
        ctx.close()
        br.close()

    print(f'\n{results["ok"]} 项通过，{results["fail"]} 项失败')
    return 1 if results['fail'] else 0


if __name__ == '__main__':
    sys.exit(main())
