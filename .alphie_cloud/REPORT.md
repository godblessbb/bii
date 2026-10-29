run-id: r1-d7923701
status: done
expected-paths:
_dev/sticker/SPEC.md
_dev/sticker/api_contract.md
_dev/sticker/mockups/
_dev/sticker/prototype/
_dev/sticker_prototype_check.py
_dev/sticker_margin.py
sticker/pricing.json

## 做了什么

- **`_dev/sticker/SPEC.md`**：共 10 节，回答「卖给谁、卖多少钱、怎么做出来、怎么寄到、还差哪几样要你定」。
  - **现状审计**：逐条列出
    - 死按钮 / 死链：「Create Now」是死按钮，导航和社交图标都是 `href="#"`。
    - 不实说法：60-Second Delivery、Global Shipping、No Minimum；10 个风格名和 8 张图对不上。
    - 假数据：Sarah Johnson 等三条编的评价。
  - **定位**：主攻「合照 / 宠物照做成一包贴纸送人」的美国个人买家；不做小商家批量单。
  - **竞品对比**：Sticker Mule、StickerApp、Printful、Sticker Shake、StickerBake、Aragon / Fotor、Etsy 价格参照。
  - **品牌**：不保留 StickerAI，原型用工作名 Peelings。
  - **其余部分**：定价与逐格毛利、完整流程和异常路径（格式、大小、分辨率、AI 失败、配额、支付取消、版权 / NSFW / 他人肖像审核）、履约对比、技术架构（Worker 端点、R2 / D1 / KV 选型、AI 提供方对比、浏览器端抠图、300 dpi 印刷文件与切割线）、给 T2 / T3 / T4 的补充要求、9 条要你拍板的决定。
- **`sticker/pricing.json`**：单一价格数据源，包含：
  - 尺寸 2 / 3 / 4 in × 每包 10 / 25 / 50 张 × 表面（Glossy / Matte 同价；Holographic +35%，暂停用）。
  - 形状、白边档位，价格含美国运费。
  - 算价公式。
  - 只用于毛利计算、不给前端展示的 `cost_model`。
- **`_dev/sticker/api_contract.md`**：前后端唯一契约，共 10 个端点。
  - 统一错误体和错误码表。
  - **服务端按 `pricing.json` 重新算价，忽略前端传来的任何金额**；价格版本不一致时返回 409。
  - Stripe Checkout Session 参数、webhook 金额核对、订单状态机、环境变量占位名。
- **`_dev/sticker/prototype/`**：11 个静态页面，可以从首页一路点到「去支付」（模拟 Stripe 页）、成功页、订单状态页、邮件预览。
  - 抠图和 AI 风格化都走零成本的 mock；示例照片会返回仓库里现成的 8 张真实示例图。
  - 价格全部从 `sticker/pricing.json` 实时读取。
  - 异常态可以演示，在 URL 后加：`?sim=aifail`（AI 失败）、`?sim=blocked`（内容拒绝）、`?sim=review`（人工复核）。另外，上传错类型或过小的图会直接给出错误提示。
- **`_dev/sticker/mockups/`**：25 张截图。11 步各有 1280 和 390 两个宽度，另有 3 张异常态。同一批也复制到了 `.alphie_cloud/shots/`。
- **`_dev/sticker_prototype_check.py`**：真 Chromium，本地静态服务，拦掉所有外网请求，桌面和手机各走一遍全流程，逐步断言。
- **`_dev/sticker_margin.py`**：从 `pricing.json` 算出逐格毛利表（SPEC §3.3 就是它的原样输出）。加 `--check` 时，任何一格低于 40% 就失败。
- 个人站其他页面（`index.html`、`js/`、`css/`、rapstar、微博等）一个字节没动。旧的 `sticker/index.html` 也没改，整页重写留给 T2。

## 验收怎么证明的

云端容器里没有 `/opt/Alphie/.venv/bin/python`，所以涉及它的两条，我用系统 `python3`（3.13，另装了 playwright 1.64.1 + Pillow）跑。7 条验收命令全部退出码 0：

1. `test -s _dev/sticker/SPEC.md` → 0
2. SPEC 里 `^## ` 标题有 10 个（要求 ≥ 8）→ 0
3. `test -s _dev/sticker/api_contract.md` → 0
4. `json.load(open('sticker/pricing.json'))` → 0
5. `_dev/sticker/mockups/*.png` 有 25 张（要求 ≥ 12）→ 0
6. `_dev/sticker_prototype_check.py` → 0：两个宽度 0 个失败，控制台零 error / pageerror / 失败请求，零外网请求。它断言了：
   - 每一步都到达（URL 和页面标志元素）。
   - 首页价格表每格 = Python 按 `pricing.json` 算的价。
   - 编辑页、购物车、模拟 Stripe 页、成功页的金额 = Python 价。
   - 前端 `quoteLine` 与 Python 在全部 27 个组合上逐一相等。
   - 停用的表面选不了。
   - 未勾版权声明时不能继续。
   - 支付取消后回到购物车并显示提示。
   - AI 失败后重试能成功。
7. 受保护路径相对 `merge-base main HEAD` 没有任何 diff → 0

另外：`python3 _dev/sticker_margin.py --check` → 0，9 格毛利在 40.0%–41.4% 之间。

两点运行说明：

- 用户机器上的 `/opt/Alphie/.venv` 如果没装 Pillow，第 6 条会在 import 时失败（脚本用它生成「过小图片」测试文件）。仓库里已有的 `rapstar_check.py` 也用 Pillow，按理已装。
- 默认 Chromium 不可用时，脚本会退到 `STICKER_CHECK_CHROMIUM` 或 `/opt/pw-browsers/chromium`。

仓库里没有 pre-commit 钩子（`.git/hooks` 只有 sample，也没有 `.pre-commit-config.yaml`），所以「界面提示中英闸」本地跑不了，以平台那边的结果为准。原型页面文案全是英文，符合「面向美国用户」的硬约束。

## 决定

- 主攻人群选「合照 / 宠物照做礼物」的美国个人买家，宠物作为同一流程的第二场景；也考虑过小商家、文字生成表情。理由：小批量加 AI 风格化只在高情感价值的单子上赚得到钱，批量单 Sticker Mule 每张 $1–2 碾压我们。
- 品牌不保留 StickerAI，原型用工作名 Peelings；也考虑过沿用 StickerAI。理由：原名纯品类词、记不住，「AI」抢了礼物的戏，旧 logo 还写着 “Gifted Sticker”。商标没查，见 D5。
- 按包卖 10 / 25 / 50 张，不卖单张；也考虑过 1 / 3 / 5 张。理由：推荐的供应商每个设计起订 10 张，小单的运费会吃掉毛利；礼物场景本来就是一包分给朋友。
- 只做 2 / 3 / 4 in；也考虑过 5–6 in。理由：供应商大尺寸价格查不到，礼物贴纸也很少用大尺寸。
- 价格含美国运费，不单列运费；也考虑过另收 $4.99。理由：三家主要竞品都包邮。
- 价目定为 3 in：$39 / $76 / $136，2 in 与 4 in 见 SPEC §3.2；目标每格毛利 ≥ 40%。也考虑过对标 Sticker Mule 的 $20 / 10 张。理由：那个价格做不出 AI 和人工审核的成本；$3.90 / 张落在 Etsy 手绘定制 $3–6 的区间里。
- 第一版人工向 Sticker Mule 下单，Printful 做备选和日后的 API 自动化；也考虑过一开始就接 Printful API。理由：按 Printful 算，3 in × 10 张的印刷加运费超过 $45，售价得到 $90 左右才能保住毛利。
- Holographic 列入价目表但停用（`enabled:false`）；也考虑过直接上架。理由：供应商是否提供、加价多少都没核实。
- 抠图放浏览器端（默认 MediaPipe 人像模型，服务端 rembg 兜底）；也考虑过全部放服务端，或用 @imgly。理由：照片付款前不离开设备，而且省钱；@imgly 是 AGPL 许可，模型 44–176 MB。
- AI 真接口第一选 FLUX.1 Kontext pro，gpt-image-2 做第二适配器；也考虑过 Gemini 2.5 Flash Image 和 SDXL。理由：$0.04 / 张、5–6 s、能保住人物身份；Gemini 2.5 Flash Image 将在 2027-03 退役，SDXL 保不住人脸。
- 印刷文件在浏览器端用与预览同一份 Canvas 代码按 300 dpi 生成，Worker 只做校验；也考虑过在 Worker 里生成。理由：Worker 免费档每个请求只有 10 ms CPU。
- 每单付款后都做人工内容复核再发印刷，不通过就全额退款；也考虑过只靠自动审核。理由：早期量小，肖像和版权风险靠人兜底最稳。
- 每张照片免费试 6 次，失败不计次；也考虑过 3 次或按次收费。理由：按试 3 次、15% 转化估算，每笔订单摊 $0.80，已计入毛利。
- 设计语言：米白纸底、墨色、一个番茄红，衬线标题加系统字体，不加载外部字体；也考虑过沿用旧站的粉彩卡片。理由：合同反对满屏卡片和俗套 AI 风格；系统字体保证零外网请求。
- 原型的状态存在 localStorage，加一个 `?sim=` 开关演示异常态；也考虑过做一个假后端。理由：纯静态，在 GitHub Pages 上也能直接点。
- 截图默认写到临时目录，只有加 `--mockups` 才写进仓库；也考虑过每次都覆盖仓库里的截图。理由：在用户机器上重跑验收不会把工作区弄脏。

## 残留风险

- **价格事实都是从搜索摘要读到的，没打开原页面**：云端容器直接访问厂商网站会被拦（ENOTFOUND）。SPEC §10 列了已知冲突，包括 Printful 的 $2.34 与 $2.24，每多一张贴纸的运费 $0.15 与 $0.99，Sticker Mule 有没有下单 API。
- **成本只有 3 in 的 10 张和 50 张是官网写的**：2 / 4 in 和 25 张的成本都是推断（`cost_model.*_verified=false`）。上线前必须在 Sticker Mule 购物车核价，再跑 `sticker_margin.py --check`，可能需要调价。
- Sticker Mule 能不能寄到任意客户地址、包装里有没有价格单或它的品牌，都没核实。礼物场景很在意这一点。
- 示例照片（`couple.png`）里人物的商用授权查不到（决定表 D7）。
- 个人站首页 `js/app.js` 对贴纸的描述是「一句话生成表情贴纸」，与新定位不一致。它属于受保护路径，本链不改（决定表 D8）。
- 原型的 mock 抠图是羽化椭圆，mock 风格是像素滤镜。只有示例照片能展示真实 AI 效果；真实质量要等接上 AI 接口后再评。
- 「7–10 个工作日送达」是推断（供应商 4 天出货 + 人工审核 + USPS），没有实测。
- 25 张截图同时放在 `_dev/sticker/mockups/` 和 `.alphie_cloud/shots/`，各约 5 MB，仓库体积会增加约 10 MB。
