"""datode.com/rapstar/ 播放页离线探针。

用法：/opt/Alphie/.venv/bin/python -I _dev/rapstar_check.py <仓库根> [--evidence <截图目录>]

本地起一个静态服务器（支持 Range，跟 GitHub Pages 一样，Chromium 才能对 mp3 seek），用 Playwright（Chromium）打开 rapstar/ 下的真实页面、跑页面自己的 JS；
外网请求（Google 统计等）一律拦下，Chromium 另外把所有域名解析到不存在。
音频在无头浏览器里拿不到时长 / 放不出来时才替身 HTMLMediaElement 的 duration / play / pause（输出里会写明）。

两张播放页（baby-cover / payphone-cover）逐页判：
  A  844×390 手机横屏：用 touch 手势往上滑，返回、进度条、后退 / 播放 / 前进 都能完整进入视口，且点得到（没被别的东西盖住）；
     竖屏 390×844 与桌面 1280×800 不用滚就全部可见。
  B  进度条：可点热区高度 ≥ 24px（热区上下边缘真能点到进度条），视觉细条仍 ≤ 6px；
     用 touch 类型的 pointer 事件（CDP 触摸）按住拖动：拖动中显示预览、currentTime 不动，松手后 currentTime 到拖到的位置；
     鼠标拖动同样生效；键盘 → / ← 各 seek ±5 秒。
  C  点播放后 navigator.mediaSession.metadata.title 是本页歌名、artwork 指向本页卡片图（og:image 同一张）；
     play / pause / seekbackward / seekforward / seekto 处理器已注册且真能控制播放；setPositionState 报了真实时长。
  D  三页 viewport 不含 user-scalable=no / maximum-scale=1；派发 ended 后播放按钮 aria-label 为「播放」、图标复位；
     真放到结尾时同样复位。
  E  三页 head 里引用的 icon / apple-touch-icon / og:image / twitter:image 文件都在仓库里且 ≤ 300KB，
     apple-touch-icon 实测 180×180，首页 og:image 实测 1200×630。
  P  两张播放页 横屏（顶部 + 滑到底）、竖屏、桌面截图，首页截图，存进证据目录。
"""
from __future__ import annotations

import argparse
import functools
import http.server
import io
import os
import re
import sys
import tempfile
import threading
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

from playwright.sync_api import sync_playwright

PLAYERS = ('baby-cover', 'payphone-cover')
PAGES = ('rapstar/index.html',) + tuple(f'rapstar/{s}.html' for s in PLAYERS)
SITE = 'https://datode.com/'
MAX_BYTES = 300 * 1024
PLAY_PATH = 'M8 5v14l11-7z'
CONTROLS = {'返回': '.back-link', '进度条': '#progressBar', '后退': '#rewindBtn', '播放': '#playBtn', '前进': '#forwardBtn'}
DEFAULT_EVIDENCE = '/root/.alphie/coding_tasks/ct_a469a2df/evidence'

# 在页面脚本之前装上：只记录页面对 mediaSession 的调用，原样转给浏览器
MS_SPY = """(() => {
  const ms = navigator.mediaSession;
  window.__ms = { handlers: {}, pos: [] };
  if (!ms) return;
  const sah = ms.setActionHandler.bind(ms);
  ms.setActionHandler = (a, h) => { window.__ms.handlers[a] = h; return sah(a, h); };
  if (ms.setPositionState) {
    const sps = ms.setPositionState.bind(ms);
    ms.setPositionState = (s) => { window.__ms.pos.push(s); return sps(s); };
  }
  window.__ptypes = [];
  document.addEventListener('pointerdown', (e) => window.__ptypes.push(e.pointerType), true);
})();"""

# 只有无头浏览器拿不到时长 / 放不出来时才用：替身时长与 play/pause，页面自己的 JS 照常跑
STUB_MEDIA = """(dur) => {
  const a = document.getElementById('audio');
  let t = 0, paused = true;
  Object.defineProperty(a, 'duration', { get: () => dur });
  Object.defineProperty(a, 'paused', { get: () => paused });
  Object.defineProperty(a, 'currentTime', { get: () => t, set: (v) => { t = v; a.dispatchEvent(new Event('seeked')); } });
  a.play = () => { paused = false; a.dispatchEvent(new Event('play')); return Promise.resolve(); };
  a.pause = () => { paused = true; a.dispatchEvent(new Event('pause')); };
  a.dispatchEvent(new Event('loadedmetadata'));
}"""

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print('FAIL', msg, flush=True)


def ok(msg: str) -> None:
    print('ok  ', msg, flush=True)


def check(cond, msg: str) -> bool:
    (ok if cond else fail)(msg)
    return bool(cond)


def fmt(sec: float) -> str:
    return f'{int(sec // 60)}:{int(sec % 60):02d}'


def png_size(path: Path) -> tuple[int, int]:
    from PIL import Image
    with Image.open(path) as im:
        return im.size


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('root')
    ap.add_argument('--evidence', default=os.environ.get('RAPSTAR_CHECK_EVIDENCE') or (DEFAULT_EVIDENCE if os.path.isdir(DEFAULT_EVIDENCE) else ''))
    a = ap.parse_args()
    root = Path(a.root).resolve()
    shots = Path(a.evidence) if a.evidence else Path(tempfile.mkdtemp(prefix='rapstar_check_'))
    shots.mkdir(parents=True, exist_ok=True)
    print('screenshots ->', shots)

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *x):
            pass

        def send_head(self):
            # SimpleHTTPRequestHandler 不认 Range；没有 206，Chromium 会把 mp3 当成不可 seek
            m = re.fullmatch(r'bytes=(\d*)-(\d*)', (self.headers.get('Range') or '').strip())
            path = self.translate_path(self.path)
            if not m or not os.path.isfile(path):
                return super().send_head()
            data = Path(path).read_bytes()
            size = len(data)
            a, b = m.groups()
            start, end = (max(0, size - int(b)), size - 1) if a == '' else (int(a), min(size - 1, int(b)) if b else size - 1)
            if start >= size or start > end:
                self.send_error(416)
                return None
            self.send_response(206)
            self.send_header('Content-Type', self.guess_type(path))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.send_header('Content-Length', str(end - start + 1))
            self.end_headers()
            return io.BytesIO(data[start:end + 1])
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{srv.server_address[1]}'
    consoles: list[str] = []
    stubbed: list[str] = []

    def router(route):
        if route.request.url.startswith(origin + '/'):
            return route.continue_()
        return route.abort()

    def local_file(page_url: str, ref: str) -> Path | None:
        """head 里的地址 → 仓库里的文件（https://datode.com/... 按站点根算，相对地址按页面地址算）。"""
        if ref.startswith(SITE):
            rel = ref[len(SITE):]
        else:
            u = urljoin(page_url, ref)
            if not u.startswith(origin + '/'):
                return None
            rel = urlparse(u).path.lstrip('/')
        return root / unquote(rel)

    with sync_playwright() as p:
        br = p.chromium.launch(args=['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'])

        def new_ctx(w, h, mobile):
            ctx = br.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile,
                                 device_scale_factor=2 if mobile else 1)
            ctx.route('**/*', router)
            ctx.add_init_script(MS_SPY)
            return ctx

        def open_player(ctx, slug):
            pg = ctx.new_page()
            pg.on('console', lambda m: consoles.append(f'{m.type}: {m.text}'))
            pg.on('pageerror', lambda e: consoles.append(f'pageerror: {e}'))
            pg.goto(f'{origin}/rapstar/{slug}.html')
            try:
                pg.wait_for_function("() => document.getElementById('audio').duration > 0", timeout=6000)
            except Exception:
                stubbed.append(f'{slug}: duration')
                pg.evaluate(STUB_MEDIA, 120)
            return pg

        def rect(pg, sel):
            return pg.eval_on_selector(sel, "e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right}; }")

        def fully_visible_and_hittable(pg, sel):
            return pg.eval_on_selector(sel, """e => {
              const r = e.getBoundingClientRect();
              if (!(r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && r.width > 0)) return false;
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return !!hit && (hit === e || e.contains(hit));
            }""")

        def touch(cdp, kind, x, y):
            pts = [] if kind == 'touchEnd' else [{'x': x, 'y': y, 'id': 1, 'radiusX': 4, 'radiusY': 4, 'force': 1}]
            cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': pts})

        def touch_swipe_up(pg, cdp, x, y0, dist):
            touch(cdp, 'touchStart', x, y0)
            for i in range(1, 11):
                touch(cdp, 'touchMove', x, y0 - dist * i / 10)
                pg.wait_for_timeout(16)
            touch(cdp, 'touchEnd', 0, 0)
            pg.wait_for_timeout(400)

        def wait_playing(pg, slug, what):
            try:  # paused 在 play() 调用时就变 false，按钮要等 play() 兑现后才变，两样都等到
                pg.wait_for_function("() => !document.getElementById('audio').paused && document.getElementById('playBtn').getAttribute('aria-label') === '暂停'", timeout=5000)
                return True
            except Exception:
                fail(f'{what} [{slug}] 点播放后 audio 没有进入播放状态')
                return False

        for slug in PLAYERS:
            print(f'\n===== {slug} =====')
            card = f'{slug}-card.png'

            # ================= A 横屏 844×390 =================
            ctx = new_ctx(844, 390, True)
            pg = open_player(ctx, slug)
            cdp = ctx.new_cdp_session(pg)
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(shots / f'{slug}-landscape-844x390.png'))
            seen = {k: fully_visible_and_hittable(pg, s) for k, s in CONTROLS.items()}
            play_seen = seen['播放']
            for _ in range(6):
                touch_swipe_up(pg, cdp, 60, 330, 160)  # 从左侧空白处往上滑，避开进度条
                for k, s in CONTROLS.items():
                    seen[k] = seen[k] or fully_visible_and_hittable(pg, s)
                if all(seen.values()):
                    break
            scrolled = pg.evaluate('() => scrollY')
            pg.screenshot(path=str(shots / f'{slug}-landscape-844x390-scrolled.png'))
            check(seen['播放'], f'A [{slug}] 横屏 844×390：播放按钮{"一开始就" if play_seen else "手指上滑后"}完整进入视口且点得到（scrollY={scrolled}）')
            missing = [k for k, v in seen.items() if not v]
            check(not missing, f'A [{slug}] 横屏：返回 / 进度条 / 后退 / 播放 / 前进 都能完整进入视口{"，缺：" + "、".join(missing) if missing else ""}')
            if seen['播放'] and not fully_visible_and_hittable(pg, '#playBtn'):
                pg.eval_on_selector('#playBtn', "e => e.scrollIntoView({block: 'center'})")
            pg.tap('#playBtn')
            try:
                pg.wait_for_function("() => !document.getElementById('audio').paused && document.getElementById('playBtn').getAttribute('aria-label') === '暂停'", timeout=5000)
                ok(f'A [{slug}] 横屏下点得动播放按钮（开始播放，aria-label 变「暂停」）')
            except Exception:
                fail(f'A [{slug}] 横屏下点播放按钮后没有开始播放 / aria-label 没变「暂停」')
            ctx.close()

            for name, (w, h, mobile) in {'portrait-390x844': (390, 844, True), 'desktop-1280x800': (1280, 800, False)}.items():
                ctx = new_ctx(w, h, mobile)
                pg = open_player(ctx, slug)
                pg.wait_for_timeout(300)
                vis = {k: fully_visible_and_hittable(pg, s) for k, s in CONTROLS.items()}
                sh = pg.evaluate('() => document.scrollingElement.scrollHeight')
                check(all(vis.values()) and sh <= h, f'A [{slug}] {name}：不用滚动，全部控件可见（scrollHeight={sh}）')
                pg.screenshot(path=str(shots / f'{slug}-{name}.png'))
                ctx.close()

            # ================= B 进度条 =================
            ctx = new_ctx(390, 844, True)
            pg = open_player(ctx, slug)
            cdp = ctx.new_cdp_session(pg)
            dur = pg.evaluate("() => document.getElementById('audio').duration")
            bar = rect(pg, '#progressBar')
            track_h = pg.evaluate("() => { const t = document.querySelector('#progressBar .progress-track') || document.getElementById('progressBar'); return t.getBoundingClientRect().height; }")
            cx = bar['x'] + bar['w'] / 2
            edges_hit = pg.evaluate("""([x, ys]) => ys.map(y => { const h = document.elementFromPoint(x, y); const b = document.getElementById('progressBar'); return !!h && (h === b || b.contains(h)); })""",
                                    [cx, [bar['y'] + 1, bar['y'] + bar['h'] - 1]])
            check(bar['h'] >= 24 and all(edges_hit), f'B [{slug}] 进度条可点热区高 {bar["h"]:.0f}px（≥ 24），上下边缘都点得到进度条')
            check(track_h <= 6, f'B [{slug}] 视觉细条仍是细的（{track_h:.0f}px）')

            y = bar['y'] + bar['h'] / 2 + 9  # 落在 4px 细条之外、热区之内
            x0, x1, x2 = bar['x'] + bar['w'] * 0.2, bar['x'] + bar['w'] * 0.5, bar['x'] + bar['w'] * 0.75
            t0 = pg.evaluate("() => document.getElementById('audio').currentTime")
            touch(cdp, 'touchStart', x0, y)
            for i in range(1, 9):
                touch(cdp, 'touchMove', x0 + (x2 - x0) * i / 8, y)
            pg.wait_for_timeout(100)
            mid = pg.evaluate("""() => ({ t: document.getElementById('audio').currentTime,
              fill: parseFloat(document.getElementById('progressFill').style.width) || 0,
              label: document.getElementById('currentTime').textContent })""")
            pg.screenshot(path=str(shots / f'{slug}-drag-preview-390x844.png'))
            touch(cdp, 'touchEnd', 0, 0)
            pg.wait_for_timeout(200)
            t1 = pg.evaluate("() => document.getElementById('audio').currentTime")
            ptypes = pg.evaluate('() => window.__ptypes')
            check('touch' in ptypes, f'B [{slug}] 进度条收到的是 touch 类型的 pointer 事件（{sorted(set(ptypes))}）')
            check(abs(mid['fill'] - 75) < 3 and mid['label'] == fmt(0.75 * dur) and abs(mid['t'] - t0) < 0.5,
                  f'B [{slug}] touch 拖动中：进度条预览到 {mid["fill"]:.1f}%、时间显示 {mid["label"]}，currentTime 还没动（{mid["t"]:.2f}）')
            check(abs(t1 - 0.75 * dur) < 1.0, f'B [{slug}] touch 松手后 currentTime = {t1:.2f}（期望 ≈ {0.75 * dur:.2f}，拖前 {t0:.2f}）')

            pg.mouse.move(x2, bar['y'] + bar['h'] / 2)
            pg.mouse.down()
            pg.mouse.move(x1, bar['y'] + bar['h'] / 2, steps=6)
            pg.mouse.up()
            pg.wait_for_timeout(150)
            t2 = pg.evaluate("() => document.getElementById('audio').currentTime")
            check(abs(t2 - 0.5 * dur) < 1.0, f'B [{slug}] 鼠标拖动同样生效：currentTime = {t2:.2f}（期望 ≈ {0.5 * dur:.2f}）')

            pg.focus('#progressBar')
            pg.keyboard.press('ArrowRight')
            t3 = pg.evaluate("() => document.getElementById('audio').currentTime")
            pg.keyboard.press('ArrowLeft')
            pg.keyboard.press('ArrowLeft')
            t4 = pg.evaluate("() => document.getElementById('audio').currentTime")
            check(abs(t3 - t2 - 5) < 0.3 and abs(t4 - t2 + 5) < 0.3, f'B [{slug}] 键盘 → / ← seek ±5 秒（{t2:.1f} → {t3:.1f} → {t4:.1f}）')
            ctx.close()

            # ================= C Media Session + D ended =================
            ctx = new_ctx(390, 844, True)
            pg = open_player(ctx, slug)
            dur = pg.evaluate("() => document.getElementById('audio').duration")
            title = pg.text_content('.meta .title').strip()
            og = pg.get_attribute('meta[property="og:image"]', 'content')
            pg.tap('#playBtn')
            playing = wait_playing(pg, slug, 'C')
            st = pg.evaluate("""() => { const ms = navigator.mediaSession, md = ms && ms.metadata;
              return { title: md ? md.title : null, artist: md ? md.artist : null,
                       art: md ? Array.from(md.artwork || []).map(a => a.src) : [],
                       handlers: Object.keys(window.__ms.handlers).filter(k => typeof window.__ms.handlers[k] === 'function'),
                       state: ms ? ms.playbackState : null, pos: window.__ms.pos }; }""")
            check(bool(st['title']) and st['title'] == title, f'C [{slug}] mediaSession.metadata.title = {st["title"]!r}（页面歌名 {title!r}）')
            check(bool(st['art']) and all(urlparse(s).path == f'/rapstar/{card}' for s in st['art']) and og.endswith('/' + card),
                  f'C [{slug}] artwork 指向本页卡片图 {card}（{st["art"]}；og:image {og}）')
            check((root / 'rapstar' / card).is_file(), f'C [{slug}] 卡片图 rapstar/{card} 真实存在')
            want = {'play', 'pause', 'seekbackward', 'seekforward', 'seekto'}
            check(want <= set(st['handlers']), f'C [{slug}] 已注册处理器 {sorted(st["handlers"])}（要 {sorted(want)}）')
            check(st['state'] == 'playing', f'C [{slug}] 播放中 playbackState = {st["state"]!r}')
            check(any(abs(s.get('duration', 0) - dur) < 0.01 for s in st['pos']), f'C [{slug}] setPositionState 报了真实时长 {dur:.2f}（{len(st["pos"])} 次）')
            if 'seekto' in st['handlers']:
                r = pg.evaluate("""() => { const h = window.__ms.handlers, a = document.getElementById('audio');
                  h.seekto({ action: 'seekto', seekTime: 12 }); const t1 = a.currentTime;
                  h.seekforward && h.seekforward({ action: 'seekforward' }); const t2 = a.currentTime;
                  h.seekbackward && h.seekbackward({ action: 'seekbackward', seekOffset: 5 }); const t3 = a.currentTime;
                  return [t1, t2, t3, document.getElementById('currentTime').textContent]; }""")
                check(abs(r[0] - 12) < 0.3 and abs(r[1] - 22) < 0.3 and abs(r[2] - 17) < 0.3,
                      f'C [{slug}] seekto 12 → seekforward → seekbackward 5：currentTime {r[0]:.1f} / {r[1]:.1f} / {r[2]:.1f}')
            if {'pause', 'play'} <= set(st['handlers']) and playing:
                pg.evaluate("() => window.__ms.handlers.pause({ action: 'pause' })")
                pg.wait_for_timeout(150)
                s1 = pg.evaluate("() => [document.getElementById('audio').paused, document.getElementById('playBtn').getAttribute('aria-label'), navigator.mediaSession.playbackState]")
                pg.evaluate("() => window.__ms.handlers.play({ action: 'play' })")
                try:
                    pg.wait_for_function("() => !document.getElementById('audio').paused && document.getElementById('playBtn').getAttribute('aria-label') === '暂停'", timeout=5000)
                except Exception:
                    pass
                s2 = pg.evaluate("() => [document.getElementById('audio').paused, document.getElementById('playBtn').getAttribute('aria-label'), navigator.mediaSession.playbackState]")
                check(s1 == [True, '播放', 'paused'] and s2 == [False, '暂停', 'playing'], f'C [{slug}] 锁屏 pause / play 处理器真能暂停 / 继续，按钮跟着变（{s1} → {s2}）')

            # D：派发 ended
            pg.evaluate("() => document.getElementById('audio').dispatchEvent(new Event('ended'))")
            pg.wait_for_timeout(100)
            d = pg.evaluate("() => [document.getElementById('playBtn').getAttribute('aria-label'), document.getElementById('playIcon').getAttribute('d')]")
            check(d == ['播放', PLAY_PATH], f'D [{slug}] 派发 ended 后播放按钮 aria-label = {d[0]!r}、图标复位为播放')
            ctx.close()

            # D：真放到结尾
            if not stubbed:
                ctx = new_ctx(390, 844, True)
                pg = open_player(ctx, slug)
                pg.tap('#playBtn')
                if wait_playing(pg, slug, 'D'):
                    pg.evaluate("() => { const a = document.getElementById('audio'); window.__ended = false; a.addEventListener('ended', () => window.__ended = true); a.currentTime = a.duration - 0.6; }")
                    try:
                        pg.wait_for_function('() => window.__ended', timeout=8000)
                        d = pg.evaluate("() => [document.getElementById('playBtn').getAttribute('aria-label'), document.getElementById('playIcon').getAttribute('d')]")
                        check(d == ['播放', PLAY_PATH], f'D [{slug}] 真放到结尾后播放按钮 aria-label = {d[0]!r}、图标复位')
                    except Exception:
                        fail(f'D [{slug}] 跳到结尾前 0.6 秒后没等到 ended')
                ctx.close()

        # ================= D viewport + E 图片 =================
        print('\n===== head =====')
        ctx = new_ctx(390, 844, True)
        for rel in PAGES:
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: consoles.append(f'pageerror: {e}'))
            url = f'{origin}/{rel}'
            pg.goto(url)
            vp = pg.get_attribute('meta[name="viewport"]', 'content') or ''
            squashed = re.sub(r'\s+', '', vp.lower())
            check('user-scalable=no' not in squashed and not re.search(r'maximum-scale=1(\.0*)?(,|$)', squashed),
                  f'D {rel} viewport 允许缩放：{vp!r}')
            refs = pg.evaluate("""() => {
              const out = [];
              document.head.querySelectorAll('link[rel]').forEach(l => {
                const rel = l.getAttribute('rel').toLowerCase().split(/\\s+/);
                if (rel.includes('icon') || rel.includes('apple-touch-icon')) out.push([rel.includes('apple-touch-icon') ? 'apple-touch-icon' : 'icon', l.getAttribute('href')]);
              });
              document.head.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach(m =>
                out.push([m.getAttribute('property') || m.getAttribute('name'), m.getAttribute('content')]));
              return out;
            }""")
            kinds = {k for k, _ in refs}
            check({'icon', 'apple-touch-icon', 'og:image'} <= kinds, f'E {rel} head 里有 icon / apple-touch-icon / og:image（{sorted(kinds)}）')
            for kind, ref in refs:
                f = local_file(url, ref)
                if not check(f is not None and f.is_file(), f'E {rel} {kind} {ref} → 仓库里有这个文件'):
                    continue
                n = f.stat().st_size
                check(n <= MAX_BYTES, f'E {rel} {kind} {f.relative_to(root)} {n / 1024:.0f}KB（≤ 300KB）')
                if kind == 'apple-touch-icon':
                    nat = pg.evaluate("""(src) => new Promise(res => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = src; })""",
                                      f'{origin}/{f.relative_to(root).as_posix()}')
                    check(nat == [180, 180] and png_size(f) == (180, 180), f'E {rel} apple-touch-icon 实测像素 {nat}（浏览器）/ {png_size(f)}（文件）')
                if kind == 'og:image' and rel == 'rapstar/index.html':
                    check(png_size(f) == (1200, 630) and f.name != 'bao.png', f'E {rel} og:image {f.name} 实测 {png_size(f)}（要 1200×630）')
                if kind == 'og:image' and rel != 'rapstar/index.html':
                    check(f.name == Path(rel).stem + '-card.png', f'E {rel} og:image 仍是本页卡片图（{f.name}）')
            if rel == 'rapstar/index.html':
                pg.wait_for_timeout(200)
                pg.screenshot(path=str(shots / 'index-390x844.png'))
            pg.close()
        ctx.close()
        br.close()
    srv.shutdown()

    if stubbed:
        print('\n注意：无头浏览器拿不到音频时长，以下页面替身了 duration / play / pause：', stubbed)
    errs = [m for m in consoles if m.startswith('pageerror')]
    check(not errs, f'页面没有抛出脚本错误{"：" + str(errs[:3]) if errs else ""}')
    print(f'\n{len(failures)} failure(s)')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
