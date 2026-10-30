"""_dev/sticker/prototype/ 全流程离线探针（T1 原型验收）。

用法：/opt/Alphie/.venv/bin/python _dev/sticker_prototype_check.py [仓库根] [--mockups] [--shots <目录>]

本地起一个静态服务器（仓库根），用 Playwright（真 Chromium）从原型首页一路点到成功页 / 订单页 / 邮件页；
外网请求一律拦下并计数（原型应当零外网依赖），Chromium 另外把所有域名解析到不存在。
桌面 1280 和手机 390 两个宽度各走一遍完整流程：
  1  首页：价格表按 sticker/pricing.json 渲染（尺寸行数、每格价格与 Python 按同一规则算的一致）；页面没有编的用户评价
  2  上传：错类型文件、过小图片各给出错误提示且不能继续；用示例照片 + 勾版权声明后才能继续
  3  抠图（mock）→ 4 风格（mock）；桌面另测 ?sim=aifail：AI 失败提示 + 重试成功
  5  编辑：改形状 / 白边 / 尺寸 / 数量 / 表面，页面总价 = Python 按 pricing.json 算的价；停用的表面点不了
  6  实物预览 → 加入购物车 → 购物车合计 = Python 价
  7  模拟 Stripe：先取消（回购物车并提示「Payment canceled」），再付款 → 成功页 → 订单状态页 → 邮件预览
  8  前端 quoteLine 对 pricing.json 所有组合的结果与 Python 逐一相等
每步断言到达（URL + 页面标志元素），整个过程控制台零 error、零 pageerror、零失败请求、零 HTTP 4xx/5xx。
失败请求只豁免一种：net::ERR_ABORTED 且请求发出后所在页面又导航了（旧文档被换掉，浏览器中止它的子资源）；
豁免的逐条打成 note。连接失败、没跟导航的中止、404/5xx 都判红，失败信息带资源路径和 r.failure。
自检：STICKER_CHECK_BREAK=<相对 prototype/ 的资源路径>（如 assets/app.css）让本地服务对该路径回 404，脚本应当判红。
截图：默认写到临时目录；--mockups 写到 _dev/sticker/mockups/（提交用）；--shots 另抄一份到指定目录。
"""
from __future__ import annotations

import argparse
import functools
import glob
import http.server
import json
import os
import re
import shutil
import sys
import tempfile
import threading
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

DEFAULT_ROOT = Path(__file__).resolve().parent.parent
PROTO = '_dev/sticker/prototype'
FAKE_NAMES = ('Sarah Johnson', 'Michael Chen', 'Edward Rodriguez', 'What Our Users Say', '60-Second')

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print('FAIL', msg, flush=True)


def ok(msg: str) -> None:
    print('ok  ', msg, flush=True)


def check(cond, msg: str) -> bool:
    (ok if cond else fail)(msg)
    return bool(cond)


def unit_cents(p: dict, size: str, qty: int, finish: str) -> int:
    base = p['unit_price_cents'][size][str(qty)]
    fin = next(f for f in p['finishes'] if f['id'] == finish)
    return int((Decimal(base) * (100 + fin['surcharge_pct']) / 100).quantize(Decimal(1), ROUND_HALF_UP))


def money(c: int) -> str:
    return f'${c / 100:.2f}'


def tiny_png(path: Path, w: int, h: int) -> None:
    from PIL import Image
    Image.new('RGB', (w, h), (200, 120, 90)).save(path)


def launch(p):
    args = ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']
    try:
        return p.chromium.launch(args=args)
    except Exception as e:  # 本机 playwright 自带浏览器没装时，退到系统里已有的 Chromium
        for exe in [os.environ.get('STICKER_CHECK_CHROMIUM', ''), '/opt/pw-browsers/chromium', *sorted(glob.glob('/opt/pw-browsers/chromium-*/chrome-linux*/chrome'))]:
            if exe and os.path.exists(exe):
                print('note: default Chromium unavailable, using', exe)
                return p.chromium.launch(executable_path=exe, args=args)
        raise e


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('root', nargs='?', default=str(DEFAULT_ROOT))
    ap.add_argument('--mockups', action='store_true', help='write screenshots into _dev/sticker/mockups/')
    ap.add_argument('--shots', default='', help='also copy screenshots here')
    a = ap.parse_args()
    root = Path(a.root).resolve()
    pricing = json.loads((root / 'sticker' / 'pricing.json').read_text())
    tmp = Path(tempfile.mkdtemp(prefix='sticker_check_'))
    out = root / '_dev' / 'sticker' / 'mockups' if a.mockups else tmp / 'shots'
    out.mkdir(parents=True, exist_ok=True)
    print('screenshots ->', out)
    bad_txt = tmp / 'notes.txt'
    bad_txt.write_text('not an image')
    small_png = tmp / 'small.png'
    tiny_png(small_png, 320, 240)

    # 自检用：STICKER_CHECK_BREAK=<相对 prototype/ 的资源路径> 时，本地服务对这个路径回 404，用来证明真缺资源照样判红
    brk = os.environ.get('STICKER_CHECK_BREAK', '').strip().lstrip('/')
    brk_path = f'/{PROTO}/{brk}' if brk else ''
    if brk_path:
        print('self-test: local server returns 404 for', brk_path)

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *x):
            pass

        def send_head(self):
            if brk_path and self.path.split('?')[0].split('#')[0] == brk_path:
                self.send_error(404, 'STICKER_CHECK_BREAK')
                return None
            return super().send_head()
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{srv.server_address[1]}'
    base = f'{origin}/{PROTO}'
    errors: list[str] = []
    external: list[str] = []
    # 失败请求的判据：net::ERR_ABORTED 且请求发出后它所在的 frame 又发生了导航（或页面被关掉）= 旧文档被换掉时
    # 浏览器中止了它的子资源，不是原型缺陷，记成 note 照常输出；其余失败（连接失败、没跟导航的中止……）一律判红。
    # HTTP 4xx/5xx 不触发 requestfailed，另由 response 事件按状态码判红。
    navs: dict = {}          # frame -> 已发生的导航次数（含页面关闭）
    started: dict = {}       # request -> 发出时所在 frame 的导航次数
    aborted: list = []       # (tag, request, failure)，跑完后统一裁定
    exempt: list[str] = []

    def rel(url: str) -> str:
        return url.replace(origin, '') or '/'

    def bad_request(msg: str) -> None:  # 真失败的请求：当场打 FAIL（带资源路径），汇总里再列一次
        errors.append(msg)
        fail(msg)

    def router(route):
        if route.request.url.startswith(origin + '/') or route.request.url.startswith('data:') or route.request.url.startswith('blob:'):
            return route.continue_()
        external.append(route.request.url)
        return route.abort()

    with sync_playwright() as p:
        br = launch(p)
        for tag, (w, h, mobile) in {'1280': (1280, 800, False), '390': (390, 844, True)}.items():
            print(f'\n===== {tag} =====')
            ctx = br.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, device_scale_factor=1)
            ctx.route('**/*', router)
            pg = ctx.new_page()
            pg.on('console', lambda m, t=tag: m.type == 'error' and errors.append(f'[{t}] console: {m.text} @ {rel(m.location.get("url", ""))}'))
            pg.on('pageerror', lambda e, t=tag: errors.append(f'[{t}] pageerror: {e}'))
            pg.on('framenavigated', lambda f: navs.__setitem__(f, navs.get(f, 0) + 1))
            pg.on('request', lambda r: started.__setitem__(r, navs.get(r.frame, 0)))
            pg.on('response', lambda r, t=tag: r.url.startswith(origin) and r.status >= 400 and bad_request(f'[{t}] HTTP {r.status}: {rel(r.url)}'))

            def on_failed(r, t=tag):
                if not r.url.startswith(origin):
                    return  # 外网请求由 router 拦下计数，这里不重复算
                failure = r.failure or '(no failure text)'
                if 'ERR_ABORTED' in failure:
                    aborted.append((t, r, failure))
                else:
                    bad_request(f'[{t}] requestfailed: {rel(r.url)} ({failure})')
            pg.on('requestfailed', on_failed)

            def shot(name):
                pg.wait_for_timeout(150)
                pg.screenshot(path=str(out / f'{name}-{tag}.png'), full_page=True)

            def at(page_name, marker):
                # 点击后导航可能还没开始、标志元素可能由 JS 异步显示：按条件等（URL 到了且 load 完、标志可见），等不到就判红
                try:
                    pg.wait_for_url(re.compile(rf'/{page_name}\.html([?#]|$)'), wait_until='load', timeout=15000)
                    pg.locator(marker).first.wait_for(state='visible', timeout=15000)
                    okk = True
                except PWTimeout:
                    okk = False
                return check(okk, f'[{tag}] 到达 {page_name}.html（{pg.url.replace(origin, "")}）')

            try:
                # ---------- 1 首页 ----------
                pg.goto(f'{base}/index.html')
                at('index', 'h1')
                pg.wait_for_selector('[data-price-table] tbody tr')
                n_rows = pg.locator('[data-price-table] tbody tr').count()
                check(n_rows == len(pricing['sizes']), f'[{tag}] 首页价格表 {n_rows} 行 = pricing.json 尺寸数 {len(pricing["sizes"])}')
                cells = pg.eval_on_selector_all('[data-price-table] tbody td', 'els => els.map(e => e.childNodes[0].textContent.trim())')
                want = [money(unit_cents(pricing, s['id'], q, pricing['finishes'][0]['id']) * q) for s in pricing['sizes'] for q in pricing['display_quantities']]
                check(cells == want, f'[{tag}] 首页每格价格与 pricing.json 一致（{cells[:3]}…）')
                html = pg.content()
                check(not any(n in html for n in FAKE_NAMES), f'[{tag}] 首页没有编的评价 / 不实承诺（{", ".join(FAKE_NAMES)}）')
                lowest = min(unit_cents(pricing, s['id'], q, 'glossy') * q for s in pricing['sizes'] for q in pricing['quantities'])
                check(f'from {money(lowest).rstrip("0").rstrip(".")}' in pg.text_content('.hero .fine'), f'[{tag}] 首页「Packs from …」= 最低套餐价 {money(lowest)}')
                shot('01-home')
                pg.click('[data-cta]')

                # ---------- 2 上传 ----------
                at('upload', '.dropzone')
                pg.set_input_files('#file', str(bad_txt))
                pg.wait_for_selector('[data-error]:not([hidden])')
                check('file type' in pg.text_content('[data-error]'), f'[{tag}] 上传 .txt → 「file type」错误提示')
                pg.set_input_files('#file', str(small_png))
                pg.wait_for_function("() => document.querySelector('[data-error]').textContent.includes('too small')")
                ok(f'[{tag}] 上传 320×240 小图 → 「too small」错误提示')
                if tag == '1280':
                    shot('02b-upload-error')
                pg.click('[data-next]', force=True)  # aria-disabled：真点一下，确认不跳转
                check(pg.url.endswith('/upload.html'), f'[{tag}] 没有可用照片时「Continue」不跳转')
                pg.click('[data-sample]')
                pg.wait_for_selector('[data-ok]:not([hidden])')
                pg.click('[data-next]', force=True)
                check(pg.url.endswith('/upload.html') and 'right to use' in pg.text_content('[data-error]'), f'[{tag}] 未勾版权声明时不能继续，并提示')
                pg.check('#rights')
                shot('02-upload')
                pg.click('[data-next]')

                # ---------- 3 抠图 ----------
                at('cutout', '[data-stage]')
                pg.wait_for_selector('body[data-ready]')
                check(pg.locator('[data-stage] canvas').count() == 1, f'[{tag}] 抠图结果画出来了（mock）')
                shot('03-cutout')
                pg.click('[data-next]')

                # ---------- 4 风格 ----------
                if tag == '1280':
                    pg.goto(f'{base}/style.html?sim=aifail')
                    at('style', '[data-styles]')
                    pg.click('label[for=st-ink]')
                    pg.wait_for_selector('[data-error]:not([hidden]) [data-retry]')
                    ok(f'[{tag}] ?sim=aifail：AI 失败提示 + 「Try again」')
                    shot('04b-style-aifail')
                    pg.click('[data-retry]')
                    pg.wait_for_selector('body[data-ready=ink]')
                    check(pg.locator('[data-error]').is_hidden(), f'[{tag}] 重试后出图，错误提示消失')
                else:
                    at('style', '[data-styles]')
                pg.click('label[for=st-sunny]')
                pg.wait_for_selector('body[data-ready=sunny]')
                check(pg.get_attribute('[data-next]', 'aria-disabled') == 'false', f'[{tag}] 选风格出图后「Use this one」可点')
                shot('04-style')
                pg.click('[data-next]')

                # ---------- 5 编辑 ----------
                at('edit', '[data-form]')
                pg.wait_for_selector('body[data-ready]')
                disabled = [f['id'] for f in pricing['finishes'] if not f['enabled']]
                for fid in disabled:
                    check(pg.is_disabled(f'#finish-{fid}'), f'[{tag}] 停用的表面 {fid} 不能选')
                choice = {'shape': 'diecut', 'size': '4', 'qty': 25, 'finish': 'matte'}
                pg.click('label[for=shape-circle]')
                pg.click('label[for=shape-diecut]')
                pg.fill('#border', '3')
                pg.dispatch_event('#border', 'input')
                pg.click(f'label[for=size-{choice["size"]}]')
                pg.click(f'label[for=qty-{choice["qty"]}]')
                pg.click(f'label[for=finish-{choice["finish"]}]')
                exp = unit_cents(pricing, choice['size'], choice['qty'], choice['finish']) * choice['qty']
                got = int(pg.get_attribute('[data-total]', 'data-cents'))
                check(got == exp and pg.text_content('[data-total]') == money(exp), f'[{tag}] 编辑页总价 {money(got)} = Python 按 pricing.json 算的 {money(exp)}')
                check(pg.text_content('[data-border-label]') == pricing['borders_in'][3]['label'], f'[{tag}] 白边滑块 → {pricing["borders_in"][3]["label"]}')
                shot('05-edit')
                pg.click('[data-next]')

                # ---------- 6 预览 → 购物车 ----------
                at('preview', '[data-laptop]')
                pg.wait_for_selector('body[data-ready]')
                check(pg.locator('[data-laptop] img.placed').count() == 1, f'[{tag}] 实物预览：贴纸按比例放到笔记本上')
                shot('06-preview')
                pg.click('[data-add]')
                at('cart', '[data-lines]')
                pg.wait_for_selector('body[data-ready]')
                ship = pricing['shipping']['methods'][0]
                total = exp + (0 if exp >= ship['free_over_cents'] else ship['price_cents'])
                got = int(pg.get_attribute('[data-grand]', 'data-cents'))
                check(got == total, f'[{tag}] 购物车合计 {money(got)} = Python 价 {money(total)}')
                check(pg.text_content('[data-cart-count]').strip() == '1', f'[{tag}] 头部购物车计数 = 1')
                shot('07-cart')

                # ---------- 7 Stripe（模拟）：取消 → 再付款 ----------
                pg.click('[data-checkout]')
                at('checkout', '[data-pay]')
                check(pg.text_content('[data-amount]') == money(total), f'[{tag}] 模拟 Stripe 页金额 = {money(total)}')
                shot('08-checkout')
                pg.click('.right [data-cancel]')
                at('cart', '[data-canceled]')
                check(pg.locator('[data-canceled]').is_visible(), f'[{tag}] 取消支付 → 回购物车并提示「Payment canceled」，商品还在')
                pg.click('[data-checkout]')
                at('checkout', '[data-pay]')
                pg.click('[data-pay]')
                at('success', '[data-order-id]')
                pg.wait_for_selector('body[data-ready]')
                oid = pg.text_content('[data-order-id]')
                check(oid.startswith('PL-') and pg.text_content('[data-paid]') == money(total), f'[{tag}] 成功页：订单号 {oid}，实付 {money(total)}')
                check(pg.text_content('[data-cart-count]').strip() == '0', f'[{tag}] 付款后购物车清空')
                shot('09-success')
                pg.click('[data-track]')
                at('order', '[data-timeline]')
                check(pg.text_content('[data-order-id]') == oid, f'[{tag}] 订单状态页显示同一订单号')
                shot('10-order')
                if tag == '1280':
                    pg.goto(f'{base}/order.html?order={oid}&sim=review')
                    check(pg.locator('[data-hold]').is_visible(), f'[{tag}] ?sim=review：内容人工复核提示')
                    pg.goto(f'{base}/upload.html?sim=blocked')
                    check('can’t print' in pg.text_content('[data-error]'), f'[{tag}] ?sim=blocked：内容审核拒绝提示')
                    shot('02c-upload-blocked')
                pg.goto(f'{base}/email.html')
                at('email', '.email-frame')
                check(pg.text_content('.email-frame [data-order-id]') == oid, f'[{tag}] 邮件预览带订单号')
                shot('11-email')

                # ---------- 8 前端算价 = Python 算价（全组合） ----------
                combos = [(s['id'], q, f['id']) for s in pricing['sizes'] for q in pricing['quantities'] for f in pricing['finishes']]
                js = pg.evaluate("""(cs) => window.Peelings.loadPricing().then(p => cs.map(([s, q, f]) =>
                    window.Peelings.quoteLine(p, {size: s, qty: q, finish: f}).line_cents))""", combos)
                py = [unit_cents(pricing, s, q, f) * q for s, q, f in combos]
                check(js == py, f'[{tag}] 前端 quoteLine 与 Python 在 {len(combos)} 个组合上逐一相等')
            except Exception as e:  # 某步卡死 / 抛错：记红，照样走到最后的汇总（失败请求清单里有路径）
                fail(f'[{tag}] 流程中断：{type(e).__name__}: {str(e).splitlines()[0]}')
            for f in pg.frames:  # 关页面同样会换掉文档，此后才中止的请求按导航中止算
                navs[f] = navs.get(f, 0) + 1
            ctx.close()
        br.close()
    srv.shutdown()

    for t, r, failure in aborted:
        if r in started and navs.get(r.frame, 0) > started[r]:
            exempt.append(f'[{t}] {rel(r.url)} ({failure})')
        else:
            bad_request(f'[{t}] requestfailed: {rel(r.url)} ({failure}, 所在页面之后没有导航)')
    for e in exempt:
        print('note  导航中止的请求（不算错）：', e)

    check(not external, f'原型零外网请求{"：" + str(external[:3]) if external else ""}')
    check(not errors, f'控制台零 error / pageerror / 失败请求 / HTTP 4xx-5xx{"：" + str(errors[:8]) if errors else ""}')
    if a.shots:
        dst = Path(a.shots)
        dst.mkdir(parents=True, exist_ok=True)
        for f in out.glob('*.png'):
            shutil.copy2(f, dst / f.name)
        print('copied screenshots ->', dst)
    print(f'\n{len(list(out.glob("*.png")))} screenshot(s), {len(failures)} failure(s)')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
