"""datode.com/zhuge/（诸葛神数 · 诸葛武侯巧连神数 215 签）离线端到端探针。

用法：/opt/Alphie/.venv/bin/python _dev/zhuge_check.py [仓库根，默认本文件上一级] [--evidence <截图目录>]

本地起静态服务器，用 Playwright（Chromium）打开仓库里真实的 zhuge/index.html 与主站 index.html，跑页面自己的 JS；
外网请求（Google 统计等）一律拦下，Chromium 另外把所有域名解析到不存在。

  A  三字求签：在浏览器里逐格输入（键盘 type），点「求签」，等结果；页面显示的签号（result[data-n] 与中文签号）
     必须等于 zhuge.js 的 qianNumber，且等于本探针按 qian.json rule 独立重算的号（笔画取自 zhuge.js 的 strokes）；
     页面显示的签文必须逐字等于 qian.json 该号的 text；每格显示的繁体字形 / 笔画数 / 刻度根数与 zhuge.js 一致。
     另核对序言例题「父子一」得第 1 签（签文以「混沌初开」起），「二一田」（215 整除）得第 215 签；
     qian.json 恰 215 签；页面（玩法说明等）不再出现 384，玩法说明写明完整笔画、减 215、整除取第 215 签与出处。
  B  动画：不跳过时从点击到出签 ≤ 4 秒；动画中点签筒区域可跳过，0.5 秒内出签。
  C  prefers-reduced-motion: reduce：点击后不出现签筒、0.3 秒内直接出结果。
  D  输入校验：非汉字（a、1）、查不到笔画的汉字（㐀）各有提示且「求签」不可点；一格粘贴多字会分到后面的格子。
  E  手机 390×844：输入前、出签后都没有横向溢出；截图。桌面 1280×800 出签截图。
  F  复制签文：授权剪贴板时提示「已复制」且剪贴板内容含签文；剪贴板与 execCommand 都失败时给出错误提示（不静默）。
  G  主站 #/tools：出现 zhuge 入口，图标不与其他入口重叠；点开后在站内外框（iframe）里打开 zhuge/，
     在外框里完成一次求签（签号、签文同样核对），外框内无横向溢出；截图。
  H  页面 head 带与其他工具相同的 GA 标签（G-Y5CXD1W4K6）。
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import re
import sys
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print('FAIL', msg, flush=True)


def ok(msg: str) -> None:
    print('ok  ', msg, flush=True)


def check(cond: bool, msg: str) -> bool:
    (ok if cond else fail)(msg)
    return bool(cond)


def rule_number(a: int, b: int, c: int) -> int:
    """按 qian.json rule（《巧连神数》序）独立重算：完整笔画，上×100 + 中×10 + 下×1，过 215 反复减 215。"""
    n = a * 100 + b * 10 + c
    while n > 215:
        n -= 215
    return n


CN = '零一二三四五六七八九'


def cn_num(n: int) -> str:
    h, t, u = n // 100, n // 10 % 10, n % 10
    s = ''
    if h:
        s += CN[h] + '百'
    if t:
        s += (CN[t] if (h or t != 1) else '') + '十'
    elif h and u:
        s += '零'
    if u:
        s += CN[u]
    return s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('root', nargs='?', default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument('--evidence', default=os.environ.get('ZHUGE_CHECK_EVIDENCE', ''))
    a = ap.parse_args()
    root = Path(a.root).resolve()
    shots = Path(a.evidence) if a.evidence else Path(tempfile.mkdtemp(prefix='zhuge_check_'))
    shots.mkdir(parents=True, exist_ok=True)
    print('screenshots ->', shots)

    qian = json.loads((root / 'zhuge/qian.json').read_text(encoding='utf-8'))['qian']
    text_of = {q['n']: q['text'] for q in qian}
    check([q['n'] for q in qian] == list(range(1, 216)), f'A  qian.json 恰 215 签（{len(qian)}）')

    html = (root / 'zhuge/index.html').read_text(encoding='utf-8')
    head = html.split('</head>')[0]
    page_js = (root / 'zhuge/app.js').read_text(encoding='utf-8')
    check('384' not in html + page_js and '三百八十四' not in html + page_js, 'A  页面与脚本不再出现 384')
    howto = html.split('id="howto"')[1].split('</details>')[0]
    check(all(w in howto for w in ('完整笔画', '215', '整除', '第 215 签', '巧连神数》序', '代写')), 'A  玩法说明：完整笔画、减 215、整除取第 215 签、出处、可请人代写')
    check('googletagmanager.com/gtag/js?id=G-Y5CXD1W4K6' in head and "gtag('config', 'G-Y5CXD1W4K6')" in head, 'H  head 带 GA 标签 G-Y5CXD1W4K6')

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *x):
            pass

    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{srv.server_address[1]}'
    errors: list[str] = []

    def router(route):
        if route.request.url.startswith(origin + '/'):
            return route.continue_()
        return route.abort()

    with sync_playwright() as p:
        args = ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']
        try:
            br = p.chromium.launch(args=args)
        except Exception:
            # 本机 Playwright 版本与预装浏览器不配套时退到预装 Chromium
            exe = os.environ.get('ZHUGE_CHROMIUM') or '/opt/pw-browsers/chromium'
            if not os.path.exists(exe):
                cands = sorted(Path('/opt/pw-browsers').glob('chromium-*/chrome-linux*/chrome'))
                exe = str(cands[-1]) if cands else exe
            br = p.chromium.launch(args=args, executable_path=exe)

        def new_ctx(w, h, mobile=False, reduced=False):
            ctx = br.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile,
                                 device_scale_factor=2 if mobile else 1,
                                 reduced_motion='reduce' if reduced else 'no-preference', color_scheme='dark')
            ctx.route('**/*', router)
            return ctx

        def open_tool(ctx):
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
            pg.goto(f'{origin}/zhuge/')
            pg.wait_for_function("() => document.body.dataset.state === 'idle'", timeout=8000)
            return pg

        def js_expect(fr, chars):
            """zhuge.js 自己算：每字 strokes / toTrad，以及 qianNumber。"""
            return fr.evaluate("""async (cs) => {
              const m = await import('./zhuge.js');
              return { s: cs.map(c => m.strokes(c)), t: cs.map(c => m.toTrad(c)), n: m.qianNumber(cs[0], cs[1], cs[2]) };
            }""", chars)

        def type_chars(fr, chars):
            for i, ch in enumerate(chars):
                fr.fill(f'#c{i}', '')
                fr.click(f'#c{i}')
                (fr.page if hasattr(fr, 'parent_frame') else fr).keyboard.type(ch)

        def read_result(fr):
            return fr.evaluate("""() => ({
              n: Number(document.getElementById('result').dataset.n),
              cn: document.getElementById('qn').textContent.trim(),
              poem: Array.from(document.querySelectorAll('#poem span')).map(s => s.textContent).join(''),
              visible: !document.getElementById('result').hidden && document.getElementById('result').getBoundingClientRect().height > 0,
              slots: Array.from(document.querySelectorAll('.slot')).map(s => ({
                trad: (s.querySelector('.trad-ch') || {}).textContent || '',
                n: parseInt((s.querySelector('.trad-n') || {}).textContent || 'NaN', 10),
                ticks: s.querySelectorAll('.ticks i').length,
              })),
            })""")

        def draw(fr, chars, label, skip=True):
            exp = js_expect(fr, list(chars))
            type_chars(fr, chars)
            if not check(fr.eval_on_selector('#go', 'b => !b.disabled'), f'{label}：三字合法后「求签」可点'):
                return None
            t0 = time.monotonic()
            fr.click('#go')
            if skip:
                fr.wait_for_timeout(250)
                fr.click('#stage', force=True) if fr.is_visible('#stage') else None
            fr.wait_for_function("() => document.body.dataset.state === 'done'", timeout=8000)
            dt = time.monotonic() - t0
            r = read_result(fr)
            want = rule_number(*exp['s'])
            check(None not in exp['s'], f'{label}：zhuge.js 查得到三字笔画 {exp["s"]}')
            check(exp['n'] == want, f'{label}：zhuge.js qianNumber={exp["n"]}，按 rule 重算={want}')
            check(r['visible'], f'{label}：签文区可见')
            check(r['n'] == exp['n'], f'{label}：页面签号 {r["n"]} == zhuge.js {exp["n"]}')
            check(r['cn'] == cn_num(exp['n']), f'{label}：中文签号「{r["cn"]}」== 第 {exp["n"]} 签')
            check(r['poem'] == text_of.get(exp['n']), f'{label}：页面签文与 qian.json 第 {exp["n"]} 签逐字一致：{r["poem"]}')
            for i, s in enumerate(r['slots']):
                check(s['trad'] == exp['t'][i] and s['n'] == exp['s'][i] and s['ticks'] == exp['s'][i],
                      f'{label}：第 {i + 1} 字显示繁体「{s["trad"]}」{s["n"]} 画、{s["ticks"]} 根刻度（zhuge.js：{exp["t"][i]} {exp["s"][i]}）')
            return {'n': r['n'], 'dt': dt}

        def no_hscroll(fr, label):
            w = fr.evaluate('() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth })')
            check(w['sw'] <= w['cw'] and w['bw'] <= w['cw'], f'{label}：无横向溢出（scrollWidth {w["sw"]} / body {w["bw"]} ≤ {w["cw"]}）')

        def again(fr):
            fr.click('#again')
            fr.wait_for_function("() => document.body.dataset.state === 'idle' && document.getElementById('result').hidden")

        # ---------- A/B/E 桌面 ----------
        ctx = new_ctx(1280, 800)
        pg = open_tool(ctx)
        cases = [('龙国爱', 3), ('父子一', 1), ('二一田', 215), ('天地人', None), ('诸葛亮', None), ('心诚灵', None)]
        for chars, fixed in cases:
            r = draw(pg, chars, f'A  桌面「{chars}」')
            if r and fixed:
                check(r['n'] == fixed, f'A  「{chars}」按原书规则应得第 {fixed} 签，页面 {r["n"]}')
            if chars == '父子一':
                check(text_of[1].startswith('混沌初开'), f'A  第 1 签以「混沌初开」起：{text_of[1]}')
            if chars == '龙国爱':
                pg.screenshot(path=str(shots / 'zhuge-desktop.png'), full_page=True)
            again(pg)

        # 不跳过：整段仪式 ≤ 4 秒
        r = draw(pg, '春风来', 'B  不跳过「春风来」', skip=False)
        if r:
            check(r['dt'] <= 4.0, f'B  不跳过时从点击到出签 {r["dt"]:.2f}s ≤ 4s')
        again(pg)
        # 跳过
        exp = js_expect(pg, list('明月照'))
        type_chars(pg, '明月照')
        pg.click('#go')
        pg.wait_for_timeout(300)
        stage_seen = pg.is_visible('#stage')
        t0 = time.monotonic()
        pg.click('#stage', force=True)
        pg.wait_for_function("() => document.body.dataset.state === 'done'", timeout=3000)
        dt = time.monotonic() - t0
        check(stage_seen and dt <= 0.5, f'B  动画中点签筒区域即跳过：{dt:.2f}s 内出签（签筒可见={stage_seen}）')
        check(read_result(pg)['n'] == exp['n'], 'B  跳过后签号仍正确')

        # ---------- F 复制 ----------
        ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=origin)
        pg.click('#copy')
        pg.wait_for_function("() => document.getElementById('copyMsg').textContent.length > 0")
        msg = pg.text_content('#copyMsg')
        clip = pg.evaluate('() => navigator.clipboard.readText()')
        check('已复制' in msg and text_of[exp['n']] in clip, f'F  复制签文成功提示「{msg}」，剪贴板含签文')
        pg.evaluate("""() => {
          navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
          document.execCommand = () => false;
          document.getElementById('copyMsg').textContent = '';
        }""")
        pg.click('#copy')
        pg.wait_for_function("() => document.getElementById('copyMsg').textContent.length > 0")
        err = pg.eval_on_selector('#copyMsg', 'e => ({ t: e.textContent, err: e.classList.contains("err") })')
        check(err['err'] and '失败' in err['t'] or '没有成功' in err['t'], f'F  复制失败时提示「{err["t"]}」')
        again(pg)

        # ---------- D 输入校验 ----------
        for bad, word in (('a', '不是汉字'), ('1', '不是汉字'), ('㐀', '笔画表')):
            pg.fill('#c0', '')
            pg.click('#c0')
            pg.keyboard.type(bad)
            m = pg.text_content('#m0')
            check(word in m and pg.eval_on_selector('#go', 'b => b.disabled'), f'D  输入「{bad}」提示「{m}」，求签不可点')
        pg.fill('#c0', '')
        pg.click('#c0')
        pg.keyboard.insert_text('龙国爱')
        vals = pg.evaluate("() => [0,1,2].map(i => document.getElementById('c' + i).value)")
        check(vals == ['龙', '国', '爱'], f'D  一格粘贴「龙国爱」分到三格：{vals}')
        pg.fill('#c1', '国a')
        pg.dispatch_event('#c1', 'input')
        check(len(pg.text_content('#m1')) > 0 and pg.eval_on_selector('#go', 'b => b.disabled'), f'D  一格两个字符提示「{pg.text_content("#m1")}」')
        ctx.close()

        # ---------- C reduced-motion ----------
        ctx = new_ctx(1280, 800, reduced=True)
        pg = open_tool(ctx)
        pg.evaluate("() => { window.__stageShown = false; new MutationObserver(() => { if (!document.getElementById('stage').hidden) window.__stageShown = true; }).observe(document.getElementById('stage'), { attributes: true }); }")
        exp = js_expect(pg, list('平安喜'))
        type_chars(pg, '平安喜')
        t0 = time.monotonic()
        pg.click('#go')
        pg.wait_for_function("() => document.body.dataset.state === 'done'", timeout=2000)
        dt = time.monotonic() - t0
        r = read_result(pg)
        check(dt <= 0.3 and not pg.evaluate('() => window.__stageShown'), f'C  reduced-motion：{dt:.2f}s 直接出结果，签筒未出现')
        check(r['n'] == exp['n'] and r['poem'] == text_of[exp['n']], 'C  reduced-motion 结果签号 / 签文正确')
        ctx.close()

        # ---------- E 手机 ----------
        ctx = new_ctx(390, 844, mobile=True)
        pg = open_tool(ctx)
        no_hscroll(pg, 'E  手机 390×844 输入前')
        pg.screenshot(path=str(shots / 'zhuge-mobile-input.png'))
        # 签文最长的几签也要放得下
        for chars in ('诸葛亮', '风雨晴'):
            draw(pg, chars, f'E  手机「{chars}」')
            no_hscroll(pg, f'E  手机「{chars}」出签后')
            if chars == '诸葛亮':
                pg.screenshot(path=str(shots / 'zhuge-mobile.png'), full_page=True)
            again(pg)
        # 直接把最长（列最多）的签放进结果区，看排版是否溢出
        longest = sorted(text_of, key=lambda k: -len(text_of[k]))[:3]
        for n in longest:
            pg.evaluate("""(t) => { const p = document.getElementById('poem'); p.innerHTML = '';
              (t.match(/[^，。；：、！？]+[，。；：、！？]*/g) || [t]).forEach(x => { const s = document.createElement('span'); s.textContent = x; p.appendChild(s); });
              document.getElementById('result').hidden = false; }""", text_of[n])
            no_hscroll(pg, f'E  手机第 {n} 签（长签）排版')
        ctx.close()

        # ---------- G 主站 #/tools + 外框 ----------
        ctx = new_ctx(1280, 800)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(f'site pageerror: {e}'))
        pg.goto(f'{origin}/index.html#/tools')
        try:
            pg.wait_for_selector('.plane .float a[href="#/tools/zhuge"]', timeout=10000, state='attached')
            found = True
        except Exception:
            found = False
        check(found, 'G  主站 #/tools 出现 zhuge 入口（#/tools/zhuge）')
        if found:
            pg.wait_for_timeout(1200)
            # 每个入口占的整块：图标（.lens）+ 下面的标题 / 说明 / 链接（.float-meta）
            boxes = pg.evaluate("""() => Array.from(document.querySelectorAll('.plane .float')).map(li => {
              const a = li.querySelector('.lens'); const r = a.getBoundingClientRect();
              const m = li.querySelector('.float-meta').getBoundingClientRect();
              const x = Math.min(r.left, m.left), y = Math.min(r.top, m.top);
              return { href: a.getAttribute('href'), x, y, w: Math.max(r.right, m.right) - x, h: Math.max(r.bottom, m.bottom) - y };
            })""")
            me = next((b for b in boxes if b['href'] == '#/tools/zhuge'), None)
            overl = [b['href'] for b in boxes if b is not me and me and
                     b['x'] < me['x'] + me['w'] and me['x'] < b['x'] + b['w'] and b['y'] < me['y'] + me['h'] and me['y'] < b['y'] + b['h']]
            check(me is not None and me['w'] > 0 and not overl, f'G  zhuge 入口（图标 + 文字）不与其他入口重叠（重叠：{overl}）')
            # 把画廊往左拖，让 zhuge 入口进入视口再截图
            g = pg.query_selector('[data-gallery]').bounding_box()
            pg.mouse.move(g['x'] + g['width'] * .8, g['y'] + 200)
            pg.mouse.down()
            pg.mouse.move(g['x'] + g['width'] * .3, g['y'] + 260, steps=12)
            pg.mouse.up()
            pg.wait_for_timeout(1200)
            pg.screenshot(path=str(shots / 'zhuge-site-tools.png'))
            pg.goto(f'{origin}/index.html#/tools/zhuge')
            pg.wait_for_selector('.frame iframe', timeout=10000)
            src = pg.get_attribute('.frame iframe', 'src') or ''
            check('zhuge/' in src, f'G  外框 iframe 指向 zhuge/（{src}）')
            fh = pg.query_selector('.frame iframe')
            fr = fh.content_frame()
            fr.wait_for_function("() => document.body && document.body.dataset.state === 'idle'", timeout=10000)
            r = draw(fr, '龙国爱', 'G  外框内「龙国爱」')
            no_hscroll(fr, 'G  外框内出签后')
            pg.screenshot(path=str(shots / 'zhuge-site-frame.png'))
        ctx.close()
        br.close()

    srv.shutdown()
    for e in errors:
        fail(f'页面脚本错误：{e}')
    print(f'\n{"PASS" if not failures else "FAIL"} zhuge_check: {len(failures)} failure(s); screenshots in {shots}')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
