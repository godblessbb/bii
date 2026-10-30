"""sticker/ storefront end-to-end check (T2): real Chromium + a local static server, no internet.

Usage: /opt/Alphie/.venv/bin/python _dev/sticker_flow_check.py [repo root] [--shots DIR] [--copy-to DIR]

Two passes, each at 1280 and 390 wide:
  A  default site, no backend configured (in-browser mock providers, demo checkout page)
     home (price table = pricing.json, no invented reviews) -> upload (wrong type / too small rejected,
     Continue blocked until photo + rights; the fixture photo is shrunk in the browser) -> cutout (subject found)
     -> style (mock; at 1280 also ?sim=aifail: failure, "Try again", success) -> edit (shape / border / size /
     qty / finish; shown price = price computed here from pricing.json) -> preview -> cart (same total; survives
     a reload, thumbnail still loads from IndexedDB) -> checkout -> demo page -> cancel (back to cart, still there)
     -> checkout -> finish -> success (cart emptied)
  B  backend configured (?api=http://127.0.0.1:8787, loopback only); every backend call is answered by page.route
     with a fake that implements api_contract.md and checks each request: POST /v1/designs (multipart cutout PNG +
     meta, rights confirmed), POST /v1/designs/{id}/generations (first try answered 504 provider_timeout -> the page
     offers "Try again"), PUT /v1/uploads/{upl_uuid} (print.png at >= size x 300 px, cut.svg with one closed
     CutContour path), POST /v1/checkout (Idempotency-Key; body = designs + options only, no price fields, values
     from pricing.json, ids issued by the fake). The page must then navigate to the checkout_url the fake returned.

Throughout: console has zero errors, zero pageerror, zero failed requests, zero HTTP >= 400 from the site, and
nothing goes to the internet (Chromium resolves every host to nothing; requests are routed and counted).
Failed requests: only net::ERR_ABORTED for a request whose frame navigated afterwards is exempt (the browser drops
the old document's subresources); those are printed as notes. Same rule as _dev/sticker_prototype_check.py.
The fake backend's deliberate 504 is the one expected console error; it is matched exactly and printed as a note.
Self-test: STICKER_CHECK_BREAK=<path under sticker/> (e.g. js/render.js) makes the local server answer 404 there.
Screenshots: _dev/sticker/shots/ (both widths); --copy-to also copies them elsewhere.
"""
from __future__ import annotations

import argparse
import functools
import glob
import http.server
import io
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import uuid
import xml.etree.ElementTree as ET
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from PIL import Image, ImageOps
from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

DEFAULT_ROOT = Path(__file__).resolve().parent.parent
SITE = 'sticker'
API = 'http://127.0.0.1:8787'
STRIPE = 'https://checkout.stripe.com'
FIXTURE = '_dev/sticker/fixtures/pet-on-plain-background.jpg'
FAKE_NAMES = ('Sarah Johnson', 'Michael Chen', 'Edward Rodriguez', 'What Our Users Say', '60-Second')
PRICE_KEY = re.compile(r'price|amount|cents|total', re.I)
UPL = re.compile(r'^upl_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

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


def line_cents(p: dict, o: dict) -> int:
    return unit_cents(p, o['size'], int(o['qty']), o['finish']) * int(o['qty'])


def cart_total(p: dict, lines: list[dict]) -> int:
    sub = sum(line_cents(p, o) for o in lines)
    m = p['shipping']['methods'][0]
    return sub + (0 if not lines or sub >= m['free_over_cents'] else m['price_cents'])


def money(c: int) -> str:
    return f'${c // 100:,}.{c % 100:02d}'


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


def multipart(body: bytes, ctype: str) -> dict[str, tuple[dict, bytes]]:
    m = re.search(r'boundary=("?)([^";]+)\1', ctype or '')
    if not m:
        return {}
    out = {}
    for part in body.split(b'--' + m.group(2).encode())[1:]:
        if part.startswith(b'--'):
            break
        head, _, data = part.lstrip(b'\r\n').partition(b'\r\n\r\n')
        hdrs = {}
        for line in head.decode('utf-8', 'replace').split('\r\n'):
            k, _, v = line.partition(':')
            hdrs[k.strip().lower()] = v.strip()
        name = re.search(r'name="([^"]*)"', hdrs.get('content-disposition', ''))
        if name:
            out[name.group(1)] = (hdrs, data[:-2] if data.endswith(b'\r\n') else data)
    return out


class FakeBackend:
    """api_contract.md, answered inside the browser via page.route; every request is checked."""

    def __init__(self, pricing: dict, tag: str, page_origin: str):
        self.p = pricing
        self.tag = tag
        self.page_origin = page_origin
        self.designs: dict[str, bytes] = {}
        self.gens: dict[str, bytes] = {}
        self.uploads: dict[str, tuple[str, bytes]] = {}
        self.calls: list[str] = []
        self.checkout_bodies: list[dict] = []
        self.checkout_headers: list[dict] = []
        self.timeouts_sent = 0
        self.checkout_url = ''
        self.expected_console: list[str] = []

    def cors(self, extra=None):
        h = {'Access-Control-Allow-Origin': self.page_origin, 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
             'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, Accept', 'Vary': 'Origin'}
        h.update(extra or {})
        return h

    def json(self, route, status, obj):
        route.fulfill(status=status, headers=self.cors({'Content-Type': 'application/json; charset=utf-8'}), body=json.dumps(obj))

    def err(self, route, status, code, message, **extra):
        self.json(route, status, {'error': {'code': code, 'message': message, 'retryable': status >= 500, **extra}})

    def handle(self, route):
        rq = route.request
        path = rq.url[len(API):].split('?')[0]
        self.calls.append(f'{rq.method} {path}')
        t = self.tag
        if rq.method == 'OPTIONS':
            return route.fulfill(status=204, headers=self.cors())
        if rq.method == 'POST' and path == '/v1/designs':
            parts = multipart(rq.post_data_buffer or b'', rq.headers.get('content-type', ''))
            cut = parts.get('cutout', ({}, b''))[1]
            check(cut[:8] == b'\x89PNG\r\n\x1a\n', f'[{t}] POST /v1/designs: cutout part is a PNG ({len(cut)} bytes)')
            try:
                meta = json.loads(parts.get('meta', ({}, b'{}'))[1])
            except ValueError:
                meta = {}
            check(meta.get('rights_confirmed') is True and meta.get('source') in ('upload', 'sample') and isinstance(meta.get('width'), int) and isinstance(meta.get('height'), int),
                  f'[{t}] POST /v1/designs: meta = {meta}')
            im = Image.open(io.BytesIO(cut))
            check(im.mode == 'RGBA' and im.getextrema()[3][0] == 0, f'[{t}] cutout PNG has a transparent background ({im.mode} {im.size})')
            check(not any(k for k in parts if k not in ('cutout', 'meta')), f'[{t}] the original photo is not uploaded (parts: {list(parts)})')
            did = 'dsg_' + uuid.uuid4().hex[:12]
            self.designs[did] = cut
            return self.json(route, 201, {'design_id': did, 'cutout_url': f'{API}/r2/{did}/cutout.png', 'tries_left': self.p['ai']['free_tries_per_photo'], 'expires_at': '2026-11-29T00:00:00Z'})
        m = re.fullmatch(r'/v1/designs/([^/]+)/generations', path)
        if rq.method == 'POST' and m:
            did = m.group(1)
            body = json.loads(rq.post_data or '{}')
            check(did in self.designs and set(body) == {'style_id'} and body['style_id'] in ('original', 'sunny', 'ink', 'line', 'badge', 'pastel', 'wash', 'clay', 'pop'),
                  f'[{t}] POST /v1/designs/{did}/generations {body}')
            if self.timeouts_sent == 0:  # first try: the provider times out (not counted), the page must offer a retry
                self.timeouts_sent += 1
                self.expected_console.append(f'{API}{path}')
                return self.err(route, 504, 'provider_timeout', 'The style generator took too long.', tries_left=self.p['ai']['free_tries_per_photo'])
            src = Image.open(io.BytesIO(self.designs[did])).convert('RGBA')
            alpha = src.getchannel('A')
            styled = ImageOps.posterize(src.convert('RGB'), 3).convert('RGBA')  # the fake's "mock" provider
            styled.putalpha(alpha)
            buf = io.BytesIO()
            styled.save(buf, 'PNG')
            gid = 'gen_' + uuid.uuid4().hex[:12]
            self.gens[gid] = buf.getvalue()
            return self.json(route, 201, {'generation_id': gid, 'style_id': body['style_id'], 'image_url': f'{API}/r2/{did}/{gid}.png',
                                          'width': styled.width, 'height': styled.height, 'provider': 'mock', 'tries_left': self.p['ai']['free_tries_per_photo'] - 1})
        m = re.fullmatch(r'/r2/[^/]+/(gen_[0-9a-f]+)\.png', path)
        if rq.method == 'GET' and m and m.group(1) in self.gens:
            return route.fulfill(status=200, headers=self.cors({'Content-Type': 'image/png'}), body=self.gens[m.group(1)])
        m = re.fullmatch(r'/v1/uploads/([^/]+)', path)
        if rq.method == 'PUT' and m:
            uid, ctype, data = m.group(1), rq.headers.get('content-type', ''), rq.post_data_buffer or b''
            check(bool(UPL.match(uid)) and ctype in ('image/png', 'image/svg+xml') and 0 < len(data) <= self.p['limits']['max_upload_bytes'],
                  f'[{t}] PUT /v1/uploads/{uid[:12]}… ({ctype}, {len(data)} bytes)')
            self.uploads[uid] = (ctype, data)
            return self.json(route, 201, {'upload_id': uid, 'bytes': len(data), 'sha256': 'x'})
        if rq.method == 'POST' and path == '/v1/checkout':
            body = json.loads(rq.post_data or '{}')
            self.checkout_bodies.append(body)
            self.checkout_headers.append(rq.headers)
            total = self.verify_checkout(body, rq.headers)
            self.checkout_url = f'{STRIPE}/c/pay/cs_test_{uuid.uuid4().hex[:16]}'
            return self.json(route, 201, {'order_id': 'PL-4821', 'checkout_url': self.checkout_url, 'total_cents': total, 'order_token': 'otk_' + uuid.uuid4().hex})
        fail(f'[{t}] unexpected backend call {rq.method} {path}')
        return self.err(route, 404, 'not_found', 'Not found.')

    def verify_checkout(self, body: dict, headers: dict) -> int:
        t, p = self.tag, self.p
        key = headers.get('idempotency-key', '')
        check(re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', key) is not None, f'[{t}] checkout: Idempotency-Key is a UUID ({key})')
        check(headers.get('content-type', '').startswith('application/json'), f'[{t}] checkout: Content-Type application/json')
        check(set(body) == {'pricing_version', 'rights_confirmed', 'lines'}, f'[{t}] checkout body keys = pricing_version, rights_confirmed, lines ({sorted(body)})')
        check(body.get('pricing_version') == p['version'] and body.get('rights_confirmed') is True, f'[{t}] checkout: pricing_version {body.get("pricing_version")} = pricing.json, rights_confirmed true')

        def price_keys(o, at='body'):
            if isinstance(o, dict):
                return [f'{at}.{k}' for k in o if PRICE_KEY.search(k)] + [x for k, v in o.items() for x in price_keys(v, f'{at}.{k}')]
            if isinstance(o, list):
                return [x for i, v in enumerate(o) for x in price_keys(v, f'{at}[{i}]')]
            return []
        check(not price_keys(body), f'[{t}] checkout body carries no price / amount / cents / total field {price_keys(body)}')
        lines = body.get('lines') or []
        check(0 < len(lines) <= p['limits']['max_lines_per_order'], f'[{t}] checkout: {len(lines)} line(s)')
        want = {'generation_id', 'size', 'qty', 'finish', 'shape', 'border_in', 'print_upload_id', 'cut_upload_id'}
        for i, ln in enumerate(lines):
            check(set(ln) == want, f'[{t}] line {i} keys = contract keys ({sorted(ln)})')
            fin = next((f for f in p['finishes'] if f['id'] == ln.get('finish')), None)
            valid = (ln.get('size') in [s['id'] for s in p['sizes']] and ln.get('qty') in p['quantities'] and fin and fin.get('enabled') is not False
                     and ln.get('shape') in [s['id'] for s in p['shapes']] and ln.get('border_in') in [b['inches'] for b in p['borders_in']])
            check(bool(valid), f'[{t}] line {i} options are pricing.json values ({ln.get("size")} in, {ln.get("qty")}, {ln.get("finish")}, {ln.get("shape")}, {ln.get("border_in")} in)')
            check(ln.get('generation_id') in self.gens, f'[{t}] line {i} generation_id was issued by the backend')
            pr, cu = self.uploads.get(ln.get('print_upload_id')), self.uploads.get(ln.get('cut_upload_id'))
            if check(pr is not None and pr[0] == 'image/png', f'[{t}] line {i} print_upload_id refers to an uploaded PNG'):
                im = Image.open(io.BytesIO(pr[1]))
                need = float(ln['size']) * 300
                check(max(im.size) >= need * 0.98, f'[{t}] line {i} print.png {im.size} longest side >= {ln["size"]} in x 300 px ({need:.0f})')
                corner = im.convert('RGB').getpixel((1, 1))
                check(corner == (255, 255, 255), f'[{t}] line {i} print.png sits on solid white (corner {corner})')
            if check(cu is not None and cu[0] == 'image/svg+xml', f'[{t}] line {i} cut_upload_id refers to an uploaded SVG'):
                root = ET.fromstring(cu[1])
                paths = root.findall('.//{http://www.w3.org/2000/svg}path')
                d = paths[0].get('d', '') if paths else ''
                check(len(paths) == 1 and paths[0].get('id') == 'CutContour' and d.count('M') == 1 and d.rstrip().endswith('Z'),
                      f'[{t}] line {i} cut.svg: one closed path named CutContour ({len(paths)} path(s), {d.count("L")} segments)')
                if pr:
                    vb = [float(x) for x in root.get('viewBox', '0 0 0 0').split()]
                    im = Image.open(io.BytesIO(pr[1]))
                    check(vb[2:] == [float(im.size[0]), float(im.size[1])], f'[{t}] line {i} cut.svg viewBox {vb[2:]} lines up with print.png {im.size}')
        return cart_total(p, [{'size': ln['size'], 'qty': ln['qty'], 'finish': ln['finish']} for ln in lines])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('root', nargs='?', default=str(DEFAULT_ROOT))
    ap.add_argument('--shots', default='', help='screenshot directory (default _dev/sticker/shots/)')
    ap.add_argument('--copy-to', default='', help='also copy the screenshots here')
    a = ap.parse_args()
    root = Path(a.root).resolve()
    pricing = json.loads((root / SITE / 'pricing.json').read_text())
    out = Path(a.shots).resolve() if a.shots else root / '_dev' / 'sticker' / 'shots'
    out.mkdir(parents=True, exist_ok=True)
    print('screenshots ->', out)
    tmp = Path(tempfile.mkdtemp(prefix='sticker_flow_'))
    bad_txt = tmp / 'notes.txt'
    bad_txt.write_text('not an image at all')
    small_png = tmp / 'small.png'
    Image.new('RGB', (320, 240), (200, 120, 90)).save(small_png)
    fixture = root / FIXTURE
    fw, fh = Image.open(fixture).size

    brk = os.environ.get('STICKER_CHECK_BREAK', '').strip().lstrip('/')
    brk_path = f'/{SITE}/{brk}' if brk else ''
    if brk_path:
        print('self-test: local server returns 404 for', brk_path)

    class Quiet(http.server.SimpleHTTPRequestHandler):
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json'}

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
    base = f'{origin}/{SITE}'
    errors: list[str] = []
    external: list[str] = []
    navs: dict = {}
    started: dict = {}
    aborted: list = []
    exempt: list[str] = []
    expected_notes: list[str] = []

    def rel(url: str) -> str:
        return url.replace(origin, '') or '/'

    def bad_request(msg: str) -> None:
        errors.append(msg)
        fail(msg)

    def flow(br, tag: str, w: int, h: int, mobile: bool, with_api: bool) -> None:
        name = f'{"B api" if with_api else "A mock"} {tag}'
        print(f'\n===== {name} =====')
        ctx = br.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, device_scale_factor=1)
        backend = FakeBackend(pricing, name, origin)

        def router(route):
            u = route.request.url
            if u.startswith(origin + '/'):
                return route.continue_()
            if u.startswith(API + '/'):
                if not with_api:
                    fail(f'[{name}] backend called in mock mode: {u}')
                    return route.abort()
                return backend.handle(route)
            if with_api and backend.checkout_url and u.split('#')[0] == backend.checkout_url:
                return route.fulfill(status=200, headers={'Content-Type': 'text/html'}, body='<!doctype html><title>Stripe Checkout (intercepted)</title><h1>Stripe test checkout</h1>')
            external.append(u)
            return route.abort()
        ctx.route('**/*', router)
        pg = ctx.new_page()

        def on_console(m, t=name):
            if m.type != 'error':
                return
            loc = m.location.get('url', '')
            if loc in backend.expected_console and '504' in m.text:
                backend.expected_console.remove(loc)
                expected_notes.append(f'[{t}] expected console error from the fake backend\'s deliberate 504: {loc}')
                return
            errors.append(f'[{t}] console: {m.text} @ {rel(loc)}')
        pg.on('console', on_console)
        pg.on('pageerror', lambda e, t=name: errors.append(f'[{t}] pageerror: {e}'))
        pg.on('framenavigated', lambda f: navs.__setitem__(f, navs.get(f, 0) + 1))
        pg.on('request', lambda r: started.__setitem__(r, navs.get(r.frame, 0)))
        pg.on('response', lambda r, t=name: r.url.startswith(origin) and r.status >= 400 and bad_request(f'[{t}] HTTP {r.status}: {rel(r.url)}'))

        def on_failed(r, t=name):
            if not r.url.startswith(origin):
                return
            failure = r.failure or '(no failure text)'
            if 'ERR_ABORTED' in failure:
                aborted.append((t, r, failure))
            else:
                bad_request(f'[{t}] requestfailed: {rel(r.url)} ({failure})')
        pg.on('requestfailed', on_failed)

        def shot(label):
            if with_api:
                return
            pg.wait_for_timeout(120)
            pg.screenshot(path=str(out / f'{label}-{tag}.png'), full_page=True)

        def at(page_name, marker):
            try:
                pg.wait_for_url(re.compile(rf'/{page_name}\.html([?#]|$)'), wait_until='load', timeout=15000)
                pg.locator(marker).first.wait_for(state='visible', timeout=15000)
                good = True
            except PWTimeout:
                good = False
            return check(good, f'[{name}] reached {page_name}.html ({rel(pg.url)})')

        def ready(value=None, timeout=20000):
            sel = f'body[data-ready="{value}"]' if value is not None else 'body[data-ready]'
            pg.wait_for_selector(sel, timeout=timeout, state='attached')

        try:
            # ---------- home ----------
            pg.goto(f'{base}/index.html' + (f'?api={API}' if with_api else ''))
            at('index', 'h1')
            ready()
            if not with_api:
                n_rows = pg.locator('[data-price-table] tbody tr').count()
                check(n_rows == len(pricing['sizes']), f'[{name}] home price table has {n_rows} rows = sizes in pricing.json')
                cells = pg.eval_on_selector_all('[data-price-table] tbody td', 'els => els.map(e => e.childNodes[0].textContent.trim())')
                fin0 = next(f for f in pricing['finishes'] if f.get('enabled') is not False)['id']
                want = [money(unit_cents(pricing, s['id'], q, fin0) * q) for s in pricing['sizes'] for q in pricing['display_quantities']]
                check(cells == want, f'[{name}] every price cell = pricing.json ({cells[:3]}…)')
                html = pg.content()
                check(not any(n in html for n in FAKE_NAMES), f'[{name}] no invented reviews or untrue promises on the home page')
                lowest = min(unit_cents(pricing, s['id'], q, fin0) * q for s in pricing['sizes'] for q in pricing['quantities'])
                check(f'from {money(lowest).replace(".00", "")}' in pg.text_content('.hero .fine'), f'[{name}] "Packs from …" = cheapest pack {money(lowest)}')
                check(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'[{name}] no horizontal scrolling')
                shot('01-home')
            pg.click('[data-cta]')

            # ---------- upload ----------
            at('upload', '[data-dropzone]')
            ready()
            if not with_api:
                pg.set_input_files('[data-file]', str(bad_txt))
                pg.wait_for_selector('[data-error]:not([hidden])')
                check('file type' in pg.text_content('[data-error]'), f'[{name}] .txt upload -> "file type" error')
                pg.set_input_files('[data-file]', str(small_png))
                pg.wait_for_function("() => document.querySelector('[data-error]').textContent.includes('too small')")
                ok(f'[{name}] 320x240 photo -> "too small" error')
                if tag == '1280':
                    shot('02b-upload-error')
                pg.click('[data-next]', force=True)
                check(pg.url.endswith('/upload.html'), f'[{name}] Continue does nothing without a photo')
            pg.set_input_files('[data-file]', str(fixture))
            pg.wait_for_selector('[data-thumb] img.photo-thumb')
            tw, th = int(pg.get_attribute('.photo-thumb', 'data-w')), int(pg.get_attribute('.photo-thumb', 'data-h'))
            check(max(tw, th) == 1600 and abs(tw / th - fw / fh) < 0.01, f'[{name}] {fw}x{fh} fixture shrunk in the browser to {tw}x{th}')
            pg.click('[data-next]', force=True)
            check(pg.url.endswith('/upload.html') and 'right to use' in pg.text_content('[data-error]'), f'[{name}] rights box unchecked -> cannot continue, and says why')
            pg.check('[data-rights]')
            shot('02-upload')
            pg.click('[data-next]')

            # ---------- cutout ----------
            at('cutout', '[data-stage]')
            ready('cutout')
            check(pg.locator('[data-stage] canvas').count() == 1, f'[{name}] cutout drawn')
            check(pg.locator('[data-fallback]').is_hidden(), f'[{name}] the mock cutout found the subject (no fallback notice)')
            shot('03-cutout')
            pg.click('[data-next]')

            # ---------- style ----------
            at('style', '[data-styles]')
            ready('none')
            if with_api:
                pg.click('label[for=st-pop]')
                pg.wait_for_selector('[data-error]:not([hidden]) [data-retry]', timeout=20000)
                check('wasn’t counted' in pg.text_content('[data-error]'), f'[{name}] backend 504 -> "didn’t come out right", try not counted, "Try again"')
                pg.click('[data-retry]')
                ready('pop')
                check(pg.locator('[data-error]').is_hidden(), f'[{name}] retry worked; error cleared')
                style_used = 'pop'
            else:
                if tag == '1280':
                    pg.goto(f'{base}/style.html?sim=aifail')
                    at('style', '[data-styles]')
                    ready('none')
                    pg.click('label[for=st-ink]')
                    pg.wait_for_selector('[data-error]:not([hidden]) [data-retry]')
                    ok(f'[{name}] ?sim=aifail: failure message + "Try again"')
                    shot('04b-style-retry')
                    pg.click('[data-retry]')
                    ready('ink')
                    check(pg.locator('[data-error]').is_hidden(), f'[{name}] retry produced the sticker, error cleared')
                pg.click('label[for=st-sunny]')
                ready('sunny')
                style_used = 'sunny'
                left = pg.text_content('[data-left]')
                tries = pricing['ai']['free_tries_per_photo']
                used = 2 if tag == '1280' else 1
                check(f'{tries - used} of {tries}' in left, f'[{name}] free tries shown: "{left.split(".")[0]}"')
            check(pg.get_attribute('[data-next]', 'aria-disabled') == 'false', f'[{name}] "Use this one" enabled after {style_used}')
            shot('04-style')
            pg.click('[data-next]')

            # ---------- edit ----------
            at('edit', '[data-form]')
            ready()
            for f in pricing['finishes']:
                if f.get('enabled') is False:
                    check(pg.is_disabled(f'#finish-{f["id"]}'), f'[{name}] disabled finish {f["id"]} cannot be picked')
            choice = {'shape': 'diecut', 'size': '4', 'qty': 25, 'finish': 'matte', 'border_in': pricing['borders_in'][-1]['inches']} if not with_api else \
                {'shape': 'diecut', 'size': '2', 'qty': 50, 'finish': 'glossy', 'border_in': pricing['borders_in'][0]['inches']}
            pg.click('label[for=shape-circle]')
            ready(f'circle|{0.125}|3|10|glossy')
            w_circle = pg.eval_on_selector('[data-stage] canvas', 'c => c.width')
            pg.click('label[for=shape-diecut]')
            bid = str(choice['border_in']).replace('.', '_')
            pg.click(f'label[for=border_in-{bid}]')
            pg.click(f'label[for=size-{choice["size"]}]')
            pg.click(f'label[for=qty-{choice["qty"]}]')
            pg.click(f'label[for=finish-{choice["finish"]}]')
            ready(f'{choice["shape"]}|{choice["border_in"]}|{choice["size"]}|{choice["qty"]}|{choice["finish"]}')
            exp = line_cents(pricing, choice)
            got = int(pg.get_attribute('[data-total]', 'data-cents'))
            check(got == exp and pg.text_content('[data-total]') == money(exp), f'[{name}] edit page total {pg.text_content("[data-total]")} = {money(exp)} computed from pricing.json')
            check(pg.locator('[data-stage] canvas[data-shape=diecut]').count() == 1 and w_circle > 0, f'[{name}] die-cut preview re-rendered on the canvas')
            shot('05-edit')
            pg.click('[data-next]')

            # ---------- preview -> cart ----------
            at('preview', '[data-laptop]')
            ready()
            check(pg.locator('[data-laptop] img.placed').count() == 1 and pg.locator('[data-bottle] img.placed').count() == 1, f'[{name}] sticker placed on the laptop and the bottle')
            shot('06-preview')
            pg.click('[data-add]')
            at('cart', '[data-lines]')
            ready('1')
            total = cart_total(pricing, [choice])
            check(int(pg.get_attribute('[data-grand]', 'data-cents')) == total and pg.text_content('[data-grand]') == money(total), f'[{name}] cart total {pg.text_content("[data-grand]")} = {money(total)}')
            check(pg.text_content('[data-cart-count]').strip() == '1', f'[{name}] header cart count = 1')
            pg.reload()
            at('cart', '[data-lines]')
            ready('1')
            loaded = pg.eval_on_selector('.line .thumb img', 'i => i.complete && i.naturalWidth > 0')
            check(pg.locator('.line').count() == 1 and loaded and int(pg.get_attribute('[data-grand]', 'data-cents')) == total,
                  f'[{name}] after a reload the design, its thumbnail (IndexedDB) and the total are still there')
            check(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'[{name}] cart has no horizontal scrolling')
            shot('07-cart')

            # ---------- checkout ----------
            pg.click('[data-checkout]')
            if with_api:
                try:
                    pg.wait_for_url(lambda u: bool(backend.checkout_url) and u == backend.checkout_url, timeout=30000)
                    arrived = True
                except PWTimeout:
                    arrived = False
                check(arrived, f'[{name}] browser went to the checkout_url the backend returned ({pg.url[:60]}…)')
                check(len(backend.checkout_bodies) == 1, f'[{name}] exactly one POST /v1/checkout ({len(backend.checkout_bodies)})')
                check(backend.calls.count('POST /v1/designs') == 1 and sum(c.startswith('PUT /v1/uploads/') for c in backend.calls) == 2,
                      f'[{name}] backend calls: {", ".join(dict.fromkeys(c if not c.startswith("PUT") else "PUT /v1/uploads/…" for c in backend.calls))}')
            else:
                at('checkout-demo', '[data-pay]')
                ready()
                check(int(pg.get_attribute('[data-grand]', 'data-cents')) == total, f'[{name}] demo checkout total (re-priced by the mock backend) = {money(total)}')
                shot('08-checkout-demo')
                pg.click('[data-cancel]')
                at('cart', '[data-canceled]')
                ready('1')
                check(pg.locator('.line').count() == 1, f'[{name}] cancel -> back in the cart with "Payment canceled", design still there')
                pg.click('[data-checkout]')
                at('checkout-demo', '[data-pay]')
                ready()
                pg.click('[data-pay]')
                at('success', '[data-order-id]')
                ready()
                oid = pg.text_content('[data-order-id]')
                check(re.fullmatch(r'PL-\d{4}', oid or '') is not None and pg.locator('[data-demo-note]').is_visible(), f'[{name}] success page: order {oid}, labelled as a demo order')
                check(pg.text_content('[data-cart-count]').strip() == '0', f'[{name}] cart emptied after the order')
                shot('09-success')
        except Exception as e:
            fail(f'[{name}] flow stopped: {type(e).__name__}: {str(e).splitlines()[0]}')
            print('      at', rel(pg.url), '| backend calls:', backend.calls[-6:], '| alert:', (pg.text_content('[role=alert]:not([hidden])') if pg.locator('[role=alert]:not([hidden])').count() else ''))
        for f in pg.frames:
            navs[f] = navs.get(f, 0) + 1
        if backend.expected_console:
            pass  # Chromium does not always log a console line for a fetch 5xx; nothing to require
        ctx.close()

    with sync_playwright() as p:
        br = launch(p)
        for with_api in (False, True):
            for tag, (w, h, mobile) in {'1280': (1280, 800, False), '390': (390, 844, True)}.items():
                flow(br, tag, w, h, mobile, with_api)
        br.close()
    srv.shutdown()

    for t, r, failure in aborted:
        if r in started and navs.get(r.frame, 0) > started[r]:
            exempt.append(f'[{t}] {rel(r.url)} ({failure})')
        else:
            bad_request(f'[{t}] requestfailed: {rel(r.url)} ({failure}, and its page did not navigate afterwards)')
    for e in exempt:
        print('note  request aborted by a navigation (not an error):', e)
    for n in expected_notes:
        print('note ', n)

    check(not external, f'zero requests to the internet{": " + str(external[:3]) if external else ""}')
    check(not errors, f'zero console errors / page errors / failed requests / HTTP 4xx-5xx{": " + str(errors[:8]) if errors else ""}')
    if a.copy_to:
        dst = Path(a.copy_to)
        dst.mkdir(parents=True, exist_ok=True)
        for f in out.glob('*.png'):
            shutil.copy2(f, dst / f.name)
        print('copied screenshots ->', dst)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'\n{len(list(out.glob("*.png")))} screenshot(s), {len(failures)} failure(s)')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
