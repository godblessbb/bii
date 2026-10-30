# ct_63af598c 报告：sticker_prototype_check.py 偶发红收尾

## 1. 主线上那条红的根因（r.failure 实证）

主线上的报错：`[1280] requestfailed: http://127.0.0.1:43217/_dev/sticker/prototype/assets/app.js`。
老脚本第 125 行把同源的所有 `requestfailed` 都记成错误，**没看 `r.failure`**，所以报错里看不到失败原因。

### 1.1 云端能证实的部分

用的环境：Python Playwright 1.63.0 + `/opt/pw-browsers/chromium`（rev 1243），脚本用的就是这套浏览器。

**(a) 浏览器在页面被换掉时确实会中止旧文档的 app.js。** 复现脚本（只放在云端临时目录，没提交）：本地服务把
`assets/app.js` 的响应体拖慢 1 秒，再照检查脚本的写法「点完 `[data-cta]` 立刻 `pg.goto(...)`」，以及
「goto 一页，不等 app.js 下完就 goto 下一页」。服务端日志在第二个场景出现
`BrokenPipeError: [Errno 32] Broken pipe`，也就是 app.js 还在传的时候浏览器那头把连接断了。断开的时间点
正好在下一次 `framenavigated` 之后：

```
 2.716s framenavigated /_dev/sticker/prototype/index.html
 2.727s request /_dev/sticker/prototype/assets/app.js        ← 旧文档的 app.js，后来没有 requestfinished
 2.742s framenavigated /_dev/sticker/prototype/upload.html   ← 页面被 goto 换掉，同时服务端 BrokenPipe
 2.748s request /_dev/sticker/prototype/assets/app.js
 3.756s requestfinished /_dev/sticker/prototype/assets/app.js
```

**(b) Chromium 对这种中止给的 `r.failure` 就是 `net::ERR_ABORTED`；而真失败给的是别的字符串。**
另一个复现脚本在同一个 Chromium 里看 `r.failure`：

```
requestfailed /slow-img                       r.failure = 'net::ERR_ABORTED'             （window.stop() 中止，之后页面没有导航）
requestfailed http://127.0.0.1:<关着的口>/refused r.failure = 'net::ERR_CONNECTION_REFUSED'（连接失败，之后页面没有导航）
```

所以单看 `ERR_ABORTED` 不够（`window.stop()` 也是 ERR_ABORTED），还得看「请求发出后所在页面有没有导航」。新判据就是这两条都满足才豁免。

**(c) 检查脚本里有三处「点完立刻 goto」，都只在 1280 分支里**，和主线报错的 `[1280]` 对得上：
- 抠图页 `pg.click('[data-next]')`（去 style.html）→ 紧跟 `pg.goto(style.html?sim=aifail)`
- 成功页 `pg.click('[data-track]')`（去 order.html）→ `at()` → 紧跟 `pg.goto(order.html?sim=review)`
- 外加多处 `pg.click(...)` 之后靠 `at()` 里的 `wait_for_load_state('load')` 等。这一句在导航还没开始时会立刻返回（见第 3 节）。

同时，`python -m http.server` 回的 `Last-Modified` 等于文件 mtime。合并闸在新 checkout 的工作区里跑，文件 mtime 非常新，
浏览器按启发式缓存几乎每页都要重新验证 app.js，于是每次换页都有一个 app.js 请求在途。只有它恰好赶上 goto
才会被掐断，所以是偶发的（3 次里红 1 次）。

### 1.2 云端没能证实的部分（如实写）

云端这版 Playwright（1.63）对「被换掉的旧文档里中止的子资源」**不发 `requestfailed` 事件，而是悄悄丢掉**（上面 (a)
里旧的 app.js 既没有 requestfinished 也没有 requestfailed）。我还试过加上 `ctx.route('**/*')` 全量拦截、让 router
晚回 `continue_()`、拖慢响应头或响应体，结果都一样。旧版 Playwright（1.49 / 1.55）的客户端带不起这个 Chromium，
下载它们配套的浏览器又被网络拦了。所以**主线那次 `requestfailed` 的 `r.failure` 原文我在云端拿不到**。

用户机器上 `/opt/Alphie/.venv` 的 Playwright 版本不同，它会发这个事件。新脚本现在把 `r.failure` 打进每条失败信息，
豁免的也逐条打成 `note  导航中止的请求（不算错）：<路径> (net::ERR_ABORTED)`。合并闸下次跑，日志里能直接看到原文：
- 是 `net::ERR_ABORTED` 且之后有导航：证实上面的推断，这次不再判红；
- 是别的原因：照样判红，信息里带原因，按实际原因再修。

结论：根因按上面的证据认定为「goto / 点击跳转把旧页面换掉，浏览器中止了旧文档里还在途的 app.js（net::ERR_ABORTED）」，
不是原型缺陷。云端没拿到的只有那一次的 failure 原文。

## 2. 新判据（修判据，不是放宽）

| 情况 | 结果 |
|---|---|
| `requestfailed`，`r.failure` 含 `ERR_ABORTED`，**且**请求发出后它所在 frame 又发生了导航（或测试结束关页面） | 豁免，打 `note` |
| `requestfailed`，ERR_ABORTED 但之后没导航（如 window.stop） | **红**，`FAIL [tag] requestfailed: <路径> (net::ERR_ABORTED, 所在页面之后没有导航)` |
| `requestfailed` 其他原因（连接被拒 / 断开 / DNS…） | **红**，当场 `FAIL [tag] requestfailed: <路径> (<r.failure>)` |
| 同源响应 HTTP ≥ 400（requestfailed 不覆盖 404） | **红**，当场 `FAIL [tag] HTTP 404: <路径>` |
| 控制台 error（含 `Failed to load resource`） | 红，信息后面带 `@ <资源路径>` |

做法：`framenavigated` 给每个 frame 计导航次数；`request` 记下请求发出时那个 frame 的计数；ERR_ABORTED 的请求
先暂存，跑完统一裁定（发出后计数涨过才豁免）。导航本来就可能在 requestfailed 之后才 commit，所以要等跑完再裁定。
**没有重试，没有加 sleep，没有整体忽略 requestfailed。**

## 3. 顺手修掉的第二个竞态（压力测试里冒出来的）

云端 4 核同时开 4 个 CPU 死循环、4 个检查并发跑，老的 `at()` 16 次里红 7 次，红在
`到达 cart.html（.../cart.html?canceled=1）`。原因有两个：
- `at()` 用 `wait_for_load_state('load')`。点击之后导航可能还没开始，这句会对**旧页面**立刻返回；
- cart 页的 `[data-canceled]` 要等 `loadPricing()` 的 fetch 回来，由 JS 异步显示出来，`is_visible()` 只看一瞬间。

改成按条件等：`wait_for_url(/<page>.html, wait_until='load')` 再 `locator(marker).wait_for(state='visible')`，
各 15 秒上限，等不到就判红。这是等事件，不是 sleep 也不是重试，目标页不对或标志不出现照样红。
改后同样的压力下 16 次全绿。

另外每个视口的流程包在 `try/except` 里：某一步卡死或抛错就记 `FAIL [tag] 流程中断：…`，然后照样走到最后的汇总。
否则缺资源时脚本会在中途抛 Traceback，带路径的汇总 FAIL 根本打不出来。

## 4. STICKER_CHECK_BREAK 自检

`STICKER_CHECK_BREAK=<相对 prototype/ 的路径>`：本地静态服务对 `/_dev/sticker/prototype/<路径>` 回 404。

```
$ STICKER_CHECK_BREAK=assets/app.css python _dev/sticker_prototype_check.py ; echo rc=$?
self-test: local server returns 404 for /_dev/sticker/prototype/assets/app.css
FAIL [1280] HTTP 404: /_dev/sticker/prototype/assets/app.css
...
FAIL 控制台零 error / pageerror / 失败请求 / HTTP 4xx-5xx：['[1280] HTTP 404: /_dev/sticker/prototype/assets/app.css', ...]
rc=1
```
`STICKER_CHECK_BREAK=assets/app.js` 同样 rc=1，FAIL 里带 `assets/app.js`。

## 5. 文案

`_dev/sticker/prototype/index.html` 第 19 行：「we print a pack of waterproof die-cut stickers」改成
「we print a pack of die-cut stickers」。截图里只有 `01-home-1280.png` / `01-home-390.png` 带这句，
用 `--mockups` 重新生成后只保留这两张。其他截图重生成后有的字节不同（随机订单号之类），就恢复成原样没动。

## 6. 验收命令在云端的结果

- 5 连跑 `sticker_prototype_check.py`：5/5 退出码 0（另外不加压 20 次全绿，加压并发 16 次全绿）。
- `STICKER_CHECK_BREAK=assets/app.css`：rc=1，且有 `^FAIL.*assets/app\.css` 行。
- `grep -qi waterproof index.html`：无。
- SPEC / api_contract / pricing.json / mockups 数量：都没动，都满足。
- 受保护路径：本分支只改了 `_dev/sticker_prototype_check.py`、`_dev/sticker/prototype/index.html`、
  两张 `01-home-*.png`，另外新增 `evidence/report.md` 和 `.alphie_cloud/`。
- 解释器：云端没有 `/opt/Alphie/.venv`，用的是临时 venv 里的 Python 3.13 + Playwright 1.63.0。
  脚本的默认 Chromium 起不来，自动退到 `/opt/pw-browsers/chromium`。
