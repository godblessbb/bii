run-id: r1-16364eb5
status: done
expected-paths:
_preview/kinetic/index.html
_preview/kinetic/css/site.css
_preview/kinetic/js/app.js
_preview/kinetic/icon.svg
_preview/kinetic/fonts/anybody-var.woff2
_preview/kinetic/fonts/OFL.txt
_preview/kinetic/vendor/marked.min.js
_preview/kinetic/vendor/marked.LICENSE.md
.alphie_cloud/REPORT.md
.alphie_cloud/shots/

## 做了什么

在 `_preview/kinetic/` 做了一整版「动态字体 / 新粗野」站点（入口 `_preview/kinetic/index.html`）。纯静态，没有构建步骤，根目录文件一个字节都没碰。

**设计说明**

- **参考站**（Awwwards 收录条目。云端只能搜到这些页面，确认不了每一条是不是 Site of the Day，见「残留风险」）：
  1. [Variable font animation – Safari Riot（Van Holtz Co）](https://www.awwwards.com/inspiration/variable-font-animation-safari-riot)：借了「每个字母按到鼠标的距离实时改字重 / 宽度」的做法，首屏三行字就是这个机制。
  2. [Tim Grover's Brutalist & Typographic Site](https://www.awwwards.com/inspiration/tim-grovers-brutalist-typographic-site)：借了「字就是版面」的思路、裸露的分隔线和单栏滚动叙事；栏目页头直接是 18vw 的「文章 / 工具 / 作品」。
  3. [Uncanny Valley Studio Typography Animation](https://www.awwwards.com/inspiration/uncanny-valley-studio-typography-animation)：借了滚动驱动的字形拉伸。字滚出视口时会纵向拉长（scaleY），宽度轴同时收窄。
  4. [Dropbox Brand Guidelines · Typography Cursors（Daybreak Studio）](https://www.awwwards.com/inspiration/typography-cursors-dropbox-brand-guidelines)：借了光标和字互动、每块一种纯色的分区方式。四个栏目面板分别是灰 / 荧光黄绿 / 墨黑 / 信号橙。
  5. [Horizontal scroll（Locomotive）](https://www.awwwards.com/inspiration/horizontal-scroll-2)：借了「纵向滚动、内容横移」的钉住式栏目条。
- **字体**：英文展示字体用 Anybody 可变字体（OFL；wght 100–900，wdth 50–150）。用的是 Fontsource 的拉丁子集 woff2，**57 KB**，自托管在 `fonts/`，许可证放在 `fonts/OFL.txt`。倾斜靠 `skewX` 连续驱动，所以不需要再加载一份斜体文件。中文用系统黑体（PingFang / 雅黑 / Noto Sans CJK），weight 900 重排，不自托管中文字体。等宽用系统 `ui-monospace`。
- **配色**（不用紫色）：
  - 亮色：水泥灰 `#e9e9e2`、墨黑 `#0b0b0b`、荧光黄绿 `#cfff1a`（大色块）、信号橙 `#ff4f00`（点缀和悬停）。
  - 暗色：沥青黑 `#0a0a0a`、骨白 `#f0f0e8`、黄绿 `#d4ff00`。大色块换成信号橙 `#ff5a1a`，硬投影换成黄绿，代码块是黑底黄绿字。
  - 两套是分别配的，不是反色。
- **动效清单**：
  1. 首屏装置「fragrant, / crispy, / caihua.」（香又脆的菜花），三行各自撑满屏宽。电脑上每个字母跟鼠标距离实时改 wght / wdth / skew，滚出时纵向拉伸；鼠标不动时整句缓慢起伏。
  2. 栏目页头和作品页的「rapstar」用同一套动态字引擎。
  3. 反色光标：白点加 `mix-blend-mode: difference`，悬停链接时放大，切换是硬切、没有渐变。
  4. 无限跑马灯，首页一条，作品页一条反向。
  5. 首页四栏目横向条：电脑上钉住，纵向滚动驱动横移；手机上是原生横滑加 scroll-snap。
  6. 路由转场：一块荧光色块分 5 格（`steps(5)`）切进切出，不是柔和渐变。
  7. 悬停全部是硬切：目录行整行变黄绿，序号字重和宽度跳到最大，按钮按下吃掉硬投影。
  8. 文章页顶部的阅读进度条。

**各栏目**

- **首页**：meta 结构条、动态字装置、黄绿色块里的「香又脆的菜花 / 一个社会"闲达"的起居注和食货志」配头像、三条主线（取自 `_coverpage.md`）、跑马灯、四栏目横向条、微博金句。
- **`#/articles`**：目录表 / 索引式排版，不是卡片。有筛选按钮（全部 / 学习笔记 / 随笔杂文 / 微博存档），按类别分组带色标签，8 篇全列出，链接是 `#/<路径去掉 .md>`。
- **`#/tools`**：同样是索引表，8 个工具加 clip.gpubuy.com 外链。站内工具「在这里打开」会进 `#/tools/<slug>` 的站内外框（iframe）。
- **`#/works`**：只有 rapstar，做成专题：
  - 整屏宽的动态字「rapstar」；
  - 文案加数据块；
  - 两首曲目，每首有封面卡片、`<audio preload="none">` 和歌词页链接；
  - 站内外框入口；
  - 一条反向跑马灯。
  - 页面上没有 mahjong / 04bot。
- **`#/about`**：渲染 `README.md`，配头像。
- **文章页**：正文 18px、行距 1.9、最多约 37 字宽。有 3 个以上二级标题时，电脑上显示粘性目录；底部有上一篇 / 下一篇。

## 验收怎么证明的

- 平台的验收脚本 `/root/.alphie/cloud_lane_checks/datode_variant_check.py` 和 `/opt/Alphie/.venv` **在云端容器里不存在，没法跑**，以用户机器上的结果为准。
- 作为替代，我用 Playwright + Chromium 写了一份自测，把 `http://127.0.0.1` 以外的请求全部拦掉，模拟外网不可用。脚本在会话的临时目录里，按云端附录没有放进 `.alphie_cloud/`。结果是 **ALL OK**：
  - 电脑 1440×900 和手机 390×844 × 亮色 / 暗色，共 4 种组合，各跑 18 条路由：首页、四栏目、`#/weibo`、`#/README`、`#/_weibo/weibo0`、7 篇 `_study/_works`（含 URL 编码的中文文件名）、`#/tools/stock`、`#/works/rapstar`、一条 404。
    - 没有 JS 报错，没有同源 4xx。
    - 390 宽下每页 `scrollWidth ≤ innerWidth`。
    - 文章正文都渲染出来了。
    - 页面上没有 `text-transform: uppercase`，也没有 mahjong / 04bot。
  - 首页同源传输量 0.2–0.3 MB，上限是 3 MB。
  - 减少动态效果（`reducedMotion: reduce`）：电脑和手机各看了首页 / 作品 / 文章 / 微博。移动鼠标、滚动、切换路由之后：
    - `document.getAnimations()` 为 0，没有任何元素的 `animation-name` 不是 none；
    - 字母上没有 JS 写入的内联变量，说明 rAF 没在跑；
    - 没有钉住横移，没有自定义光标，`scroll-behavior` 是 auto；
    - 动态字有高度，画面是定格海报，不是空白（截图 `home-desktop-reduced.png`）。
  - 明暗：body 底色亮色是 `rgb(233,233,226)`，暗色是 `rgb(10,10,10)`。
  - 中英切换：默认 `lang="zh-CN"`；点 `data-lang-toggle` 后刷新，仍然是 `en`（存在 localStorage 的 `datode-lang`）。英文模式下扫了首页 / 四栏目 / 文章页，正文以外没有剩下中文界面文字；全大写只出现在文章正文原文里（例如「VPN」）。
- **搬到根目录的模拟**：把 `_preview/kinetic/` 的内容盖到一份根目录内容副本的根上，换端口起服务。首页、关于、`#/weibo`、中文文件名文章、`#/tools/clock` 的 iframe、作品页的图片都正常，没有 404。内容根自动变成 `./`。
- 截图在 `.alphie_cloud/shots/`：
  - 首页：`home-desktop.png`、`home-mobile.png`、`home-desktop-dark.png`、`home-mobile-dark.png`、`home-desktop-en.png`、`home-desktop-reduced.png`、`home-desktop-pointer.png`、`home-desktop-strip.png`；
  - 各栏目和文章：`articles-*`、`tools-desktop.png`、`works-*`、`about-desktop.png`、`article-*`。
- 第二条验收命令（只改了 `_preview/kinetic/` 和 `.alphie_cloud/`）：本地 `git diff --name-only` 相对分叉点核对过，只有这两个目录。注意本地克隆里没有 `main` 分支，平台那边需要有 `main` 才能算 merge-base。

**每条硬性要求怎么满足的**

1. **纯静态、离线可用**：marked v12.0.2 放在 `vendor/`，字体在 `fonts/`，不从 CDN 加载。保留了 GA（G-7DEXQT23DE），它被拦时只是加载失败，不影响页面。favicon 用自己目录里的 `icon.svg`，避免请求 `/favicon.ico` 产生同源 404。
2. **根目录一个文件没动**：页面在浏览器里 fetch `.md` 再用 marked 渲染。
3. **旧链接都能打开**：路由先 `decodeURIComponent`，`#/weibo`、`#/README`、`#/_weibo/…`、`#/_study/…`、`#/_works/…` 都能打开（含编码后的中文）。`?id=` 锚点也兼容。
4. **工具页没动**：只在新站里做入口和站内外框。
5. **手机 390 不溢出，重效果有降级**：触屏设备不跑任何 JS 动效，只在一行字上用 CSS `steps(8)` 呼吸；横向条在手机上是原生横滑，不钉住。
6. **减少动态效果**：CSS 里全局关掉 animation、transition 和平滑滚动。JS 里每处都先查 `reduced()`，而且监听媒体查询变化，切换后立刻停掉 rAF、清掉内联变量、取消转场动画、解除钉住和光标。
7. **明暗**：跟随 `prefers-color-scheme`，两套色板分别配。
8. **中英切换**：带 `data-lang-toggle` 的按钮，切换 `<html lang>`，存 localStorage，`<head>` 里有一行内联脚本提前生效防闪烁。英文覆盖导航、栏目名、首屏、工具和作品介绍、文章标题、按钮、页脚；正文保持中文。
9. **风格禁区**：主色是黄绿和橙，没有紫色；没有 uppercase，英文都是首字母大写或小写（切换按钮写作「En」）；文章和工具都是索引表，没有满屏卡片。

**这一版和根目录杂志版差在哪**

| | 杂志版 | 这一版 |
|---|---|---|
| 色调 | 米白底、朱砂、衬线体 | 水泥灰 / 沥青黑配荧光黄绿和信号橙，几乎不用圆角 |
| 主角 | 衬线标题、逐字升起、幕布转场、颗粒纹理 | 字本身：拉丁可变字体随鼠标和滚动实时改字重 / 宽度 / 倾斜 / 拉伸 |
| 结构 | 细腻的留白 | 结构线全部裸露（2px 实线网格），色块大面积平铺 |
| 交互 | 柔和渐变 | 硬切：转场是分格色块，悬停整行反色 |
| 首页 | 期刊目录 | 一个会动的巨型文字装置，加一条钉住横移的栏目条 |
| 作品 | 三张小条目 | 一个 rapstar 专题页 |

## 决定

- 首屏句子用英文「fragrant, / crispy, / caihua.」，中英两种语言下都一样，中文标题放在下面的色块里。考虑过直接让「香又脆的菜花」变形，但系统中文字体不是可变字体，字重只有几档，做不出连续变形，所以动态部分交给拉丁可变字体。
- 字体选 Anybody（wdth 50–150 的跨度很大，变形最戏剧化），只自托管正体拉丁子集（57 KB），倾斜用 skewX 模拟。考虑过 Roboto Flex：轴更多，但子集后体积是它的好几倍，而且气质偏工整。
- 强调色定为荧光黄绿 `#cfff1a`（亮色）/ `#d4ff00`（暗色），配信号橙。暗色模式的大色块换成橙，让两种模式明显不同。
- 明暗只跟随系统，不另加手动切换按钮。合同只要求跟随系统，多一个按钮会增加状态。
- 手机和触屏的降级方式：不跑 JS 跟手动效，只在一行字上做 CSS 分格呼吸，横向条改原生横滑。也考虑过陀螺仪驱动，但耗电，而且 iOS 要权限弹窗。
- 内容根的判断写在 `js/app.js` 顶部：路径里有 `/_preview/<名字>/` 就用 `../../`，否则用 `./`。所有内容路径只经过 `C()`；头像和 favicon 也不写死在 HTML 里，favicon 用自己目录里的 `icon.svg`。
- 作品页的音频用 `<audio preload="none">` 直接引用 rapstar 的 mp3（点播放才加载），封面卡片懒加载，这样不增加首页和作品页的首屏传输。
- 工具和 rapstar 默认在站内外框（iframe）里打开，同时给出「新窗口打开」。延续上一版的交互，用户习惯不变。
- 语言偏好的 localStorage 键沿用上一版的 `datode-lang`，换版后用户的选择能保留。
- 文章列表顺序：学习笔记 → 随笔杂文 → 微博存档，编号 01–08 按这个顺序排。
- 自测脚本放在会话的临时目录，没有放进 `.alphie_cloud/`。合同正文要求放 `.alphie_cloud/`，但云端附录说信封里只放报告和截图，以附录为准。
- 分支 `claude/ct_cab546a3` 是从当前分支（含合同那一次提交）开出来的，只推这一个分支。

## 残留风险

- 平台的验收脚本在云端不存在，没有亲自跑过。如果它对「控制台错误」的判定把被拦掉的 GA 脚本加载失败（`net::ERR_FAILED`）也算进去，会误报。GA 是合同要求保留的，这个失败没法消除。
- 参考站都来自 Awwwards 的收录 / 灵感条目，云端搜索确认不了每条是不是 Site of the Day / FWA 获奖。如果需要严格的「获奖站」，可以再换。
- 电脑端鼠标不动时，首屏会持续缓慢起伏：只在字可见、标签页可见时跑 rAF，每帧改约 20 个字母的可变轴，会触发文字重排。主流电脑上没问题，很老的机器可能略费电。
- 手机上的 CSS 呼吸动画也在改 `font-variation-settings`，会重排，但只作用于一行 7 个字母，帧率用 `steps(8)` 压低了。没在真机上测过。
- 中文全靠系统字体：Windows 雅黑没有 900 字重，会退到粗体，中文大标题的视觉冲击会比 Mac / iOS 弱一些。
- 截图是 Linux 无头 Chromium 拍的，中文字形是 Noto / 文泉驿一类，和用户机器上的苹方观感不同。
- 本地克隆里没有 `main` 分支，第二条验收命令要在有 `main` 的环境里跑；按 `ca-base/ct_cab546a3` 核对过，只改了两个允许的目录。
