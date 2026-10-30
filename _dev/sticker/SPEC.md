# 贴纸站 SPEC（T1：定位 · 定价 · 流程 · 履约 · 架构）

> 运行编号 r1-d7923701 · 写于 2026-10-29 · 站点位置 `datode.com/sticker/`（本仓库 `sticker/`，GitHub Pages）
> 读者：用户（拍板）、T2 前端制作器、T3 Worker + Stripe 后端、T4 联调 / 内容 / SEO / 上线。
> T2–T4 合同与本 SPEC 冲突时，以本 SPEC 为准（四单共同硬约束除外）。

**一页结论（给用户）**

- **卖给谁**：主攻「拿一张合照 / 宠物照，做成一包贴纸送人或自己贴」的美国个人买家（情侣、家人、朋友、宠物主），不和 Sticker Mule 抢小商家批量单（§2）。
- **卖多少钱**：10 / 25 / 50 张一包，2 / 3 / 4 英寸，**$32 起（10 张 2 英寸）**，含美国境内运费；每格毛利 40%–41%（§3，数据在 `sticker/pricing.json`）。
- **怎么做出来**：浏览器里抠图 → AI 画成 8 种风格之一（默认 mock，接真接口走适配器）→ 用户选形状 / 白边 / 尺寸 / 数量 / 表面 → 服务端生成 300 dpi 印刷文件 + 切割线（§4、§6）。
- **怎么寄到**：第一版**人工下单**给 Sticker Mule（它包邮、4 天出货，3 英寸价格在官网能查到）；Printful 做第二供应商兼后续 API 自动化的备选（§5）。
- **还差你定的**：Stripe 账号、AI 接口 key、履约商、品牌名 / 域名、Stripe Tax（§9 决定表，每条有推荐）。
- **原型**：`_dev/sticker/prototype/index.html`，从首页一路点到模拟 Stripe 页、成功页、订单页、邮件页；截图在 `_dev/sticker/mockups/`。

**事实标注规则**：所有关于竞品 / 价格 / 第三方服务的事实都标来源类型：

- **官网写明**：出自厂商自己的域名。本轮云端容器打不开这些网站（直接抓取报 ENOTFOUND），所以全部是通过搜索引擎的结果摘要读到的，没有打开原页面。
- **第三方报道**：评测站、比价站、聚合站。
- **推断**：我根据其他数字推出来的。
- **查不到**：本轮没查到。

所有日期为 2026-10-29。上线前请在厂商后台或购物车里逐条核价（§8 T4 清单里有这一步）。

---

## 1 现状审计（`sticker/index.html`，20KB 单页，10-15 从 04bot 搬来后没改过）

### 1.1 死链接 / 死按钮

| # | 位置 | 现状 | 处理 |
|---|---|---|---|
| A1 | 顶部导航 Home / About / Contact / Login（第 459–462 行） | 全部 `href="#"`，点了只回页顶 | 删掉 About / Contact / Login（第一版不做账号，下单用邮件 + 订单链接）；导航改为 How it works / Pricing / FAQ / Cart |
| A2 | 首屏「Create Now」（第 470 行） | `<button>` 没有任何事件，**整个站唯一的转化入口是死的** | 改成链接到制作器第一步 |
| A3 | 页脚 TikTok / Instagram / X 图标（第 716–730 行） | `href="#"`，没有对应账号 | 删掉，有账号再加 |
| A4 | 全站 | 没有上传、编辑器、购物车、支付、订单页 | T2 / T3 补齐 |
| A5 | 首页英文描述（个人站首页 `js/app.js` 第 84–85 行）写的是 “Describe it in a sentence, get your own sticker”（文字生成表情贴纸） | 与「上传照片做实物贴纸」的定位不一致 | `js/` 是受保护路径，本单和 T2–T4 都不改；记进 §9 由用户决定是否另开单改 |

### 1.2 不实说法

| # | 原文 | 问题 |
|---|---|---|
| B1 | “60-Second Delivery” | 实物贴纸不可能 60 秒送达。竞品最快也要「生产 1–2 个工作日 + 运输」（StickerApp，官网写明，见 §2） |
| B2 | “Global Shipping” | 没有任何履约。第一版只发美国 |
| B3 | “No Minimum” | 推荐的 Sticker Mule 每个设计至少 10 张（官网写明，见 §5）。第一版最少 10 张一包 |
| B4 | “Waterproof” / “Fade-Resistant” | 没有供应商，无从保证。换供应商后，只写供应商自己写明的材质特性 |
| B5 | 风格区 “Which Style Fits You Best?” 列 10 种风格名（Vintage Look / Neon Glow / Pixel Art / Retro Wave / Abstract Art …） | 只有 8 张示例图（`style/1.png`–`8.png`），且 `style/1.png` 在 20 个轮播位里出现 8 次；**名字和图对不上**（例如标 “Neon Glow” 的图是粉彩涂鸦风） |
| B6 | “Checkout & Wait” | 没有结账 |

### 1.3 假数据

| # | 内容 | 处理 |
|---|---|---|
| C1 | “What Our Users Say” 三条评价：Sarah Johnson（San Francisco）、Michael Chen（Austin）、Edward Rodriguez（Chicago），带头像 `src/img/usr/user1-3.png` | 编的。**删掉**，上线后有真实订单再收集；原型里已不出现 |
| C2 | “© 2025 StickerAI” | 年份与品牌待更新（品牌见 §2.3） |
| C3 | 示例照片 `couple.png`（一对真人合照）及 8 张风格图 | 风格图看起来是同一张照片的真实 AI 输出，可以保留作「示例」，并标明 “real results from the sample photo”。**但照片中人物是谁、是否同意商用，仓库里查不到**，列入 §9 决定表 |

### 1.4 其他缺陷（不在三类之内，T2 / T4 一并修）

- 没有任何 `@media`，在 390px 宽的手机上，4 列卡片和 280px 固定图会挤坏。
- 没有 meta description / og:image / canonical。
- logo `height: 400%`，靠溢出撑大。
- `sticker.png`、`style/0.jpg` 没有被引用。
- 满屏粉彩圆角卡片 + 图标，属于合同点名反对的「满屏卡片」俗套。

---

## 2 定位

### 2.1 人群：选一个主攻

| 候选 | 场景 | 优势 | 劣势 | 结论 |
|---|---|---|---|---|
| **情侣 / 家人 / 朋友礼物**（拿一张合照） | 纪念日、生日、婚礼回礼、毕业 | 情感价值高，对单价不敏感；AI 风格化对人像的增值最明显（照片 → 卡通形象）；仓库现有素材就是情侣照，示例真实 | 他人肖像需要声明同意；人脸风格化质量要求高 | **主攻** |
| 宠物主 | 宠物头像贴纸、纪念已故宠物 | 肖像 / 版权风险最低；宠物照片多 | 毛发抠图难；Etsy 上手绘宠物贴纸供给多（推断） | **第二人群**：首页文案与 FAQ 明确写 “person, pet or crew”，风格同一套 |
| 小商家（logo 贴纸） | 包装、赠品 | 复购 | 他们要的是忠实还原 logo，不要 AI 风格；批量单价被 Sticker Mule 碾压（下表：3 英寸 50 张 $72） | **不做** |
| 文字生成表情贴纸（个人站首页旧描述） | — | — | 纯数字产品，要印实物，有大量免费 App 竞争（StickerBake 等） | 不做 |

**理由**：我们的成本结构（AI 生成 + 人工审核 + 小批量外包印刷）只在「小数量、高情感价值」的单子上赚得到钱。到了批量单，Sticker Mule / StickerApp 用自家工厂和免费包邮把单价压到每张 $1–2（§2.2）。所以主攻送礼，宠物作为同一流程的第二场景，不另做产品。

### 2.2 竞品对比

| 竞品 | 模式 | 价格（美元） | 交期 / 运费 | 起订 | AI 风格化 | 来源 |
|---|---|---|---|---|---|---|
| **Sticker Mule** 3×3 in die-cut | 上传现成图，在线打样 | 10 张 $20；50 张 $72（促销页标注的 “normal price”）。100 / 200 / 500 张美元价查不到 | 4 天出货，包邮 | 10 张 / 设计 | 无（查不到它提供 AI 生成） | 官网写明：[die-cut 产品页](https://www.stickermule.com/products/die-cut-stickers)、[deal f167bd20](https://www.stickermule.com/deals/f167bd20)、[deal ee2c2ae3](https://www.stickermule.com/deals/ee2c2ae3) |
| Sticker Mule kiss-cut | 同上 | 10 张 $17 / 100 张 $73 / 500 张 $150（摘要没写尺寸） | 4 天 | 10 | 无 | 官网写明：[kiss-cut](https://www.stickermule.com/products/kiss-cut-stickers) |
| **StickerApp** die-cut | 上传，即时打样 | 29 张 $27 / 50 张 $36 / 100 张 $52 / 200 张 $77 / 500 张 $132（摘要没写尺寸）；3×3 in 价格查不到 | 生产 1–2 个工作日，到手 3–7 个工作日；美国标准运费免费 | 最低订单 $26 | 无 | 官网写明：[die-cut](https://stickerapp.com/stickers/die-cut-stickers)、[运费](https://www.stickerapp.com/support/shipping)、[起订](https://stickerapp.com/support/essentials/ordering/what-is-the-minimum-order-for-custom-stickers) |
| **Printful** 自定义贴纸 | POD（按需印刷），给开店的人用 | kiss-cut $2.34 / 张（3, 4, 5.5 in；页面结构化数据又写 $2.24，不一致）；die-cut 起价 $3.86 / 张（2–6 in） | 生产 2–5 个工作日 + 标准运输 3–4 个工作日；运费 kiss-cut 起 $4.49，die-cut 起 $5.19 | 无起订，25 张以上有批量折扣 | Design Maker 内置 AI 生成，每天 15 次免费 | 官网写明：[kiss-cut](https://www.printful.com/custom/stationery/personalized/kiss-cut-stickers)、[die-cut](https://www.printful.com/custom/product/957)、[运费页](https://printful.com/shipping)、[Design Maker](https://www.printful.com/design-maker) |
| **Sticker Shake**（AI sticker maker） | 文字生成贴纸，可下单寄送 | 生成免费 / 试用；印刷价格查不到 | 查不到 | 第三方称不设起订 | 有，文字生成 | 第三方报道：[creati.ai 目录](https://creati.ai/ai-tools/sticker-shake/) |
| **StickerBake AI**（iOS） | AI 生成数字贴纸，不印刷 | Pro $3.99 / 周或 $7.99 / 月 | — | — | 有 | App Store 页：[链接](https://apps.apple.com/ca/app/stickerbake-ai-creator/id6502862412) |
| Aragon 宠物贴纸生成器 / Fotor AI 贴纸 | 照片 → 数字贴纸，免费下载，不印刷 | 免费档 | — | — | 有（照片输入） | 官网写明：[Aragon](https://www.aragon.ai/photo-editor/pet-sticker-generator)、[Fotor](https://www.fotor.com/features/ai-sticker-generator/) |
| Etsy 手绘定制贴纸（价格参照） | 卖家手绘 | 单张 die-cut $3–6；6 张一页 $6–12 | — | — | 人工 | 第三方报道：[krea.ai 博客](https://www.krea.ai/blog/how-to-make-a-sticker-best-ai-sticker-generators-in-2026) |

**差异化（推断，依据上表）**

本轮搜到的服务，要么只印（Sticker Mule、StickerApp：要用户自己有图），要么只画（StickerBake、Aragon、Fotor：数字贴纸），要么是给开店者用的 POD（Printful）。没搜到一家把「照片 → AI 风格 → 小批量实物 → 寄到家」做成一条面向个人的流程并明码标价的。

我们的定位：

> **“Your favorite photo, as a sticker you can actually hold.”** 一张照片，两分钟，8 种画风，看到成品再付钱，10 张一包寄到家。

我们不比单价：$3.90 / 张（3 in × 10）比 Sticker Mule 的 $2.00 / 张贵，但落在 Etsy 手绘定制 $3–6 / 张的区间里（第三方报道），而且是即时出图。

### 2.3 品牌名：不保留 StickerAI，原型用工作名 **Peelings**

- **不保留 StickerAI 的理由**：
  - 名字只描述品类，搜不出来、记不住。
  - “AI” 放进品牌名，会把「AI 生成」放到情感礼物的前面。礼物买家买的是「我们俩变成了贴纸」，不是 AI。
  - 原页面的 logo 图本身写的是 “Gifted Sticker”，和 StickerAI 不统一。
- **Peelings 的理由**：peel（撕贴纸）+ feelings（情感），直接对准礼物人群，读音好记。
- **风险**：商标 / 同名网站本轮没有查（查不到），列入 §9。没定之前，T2 / T4 把品牌名放在一处常量里，改名只改一处。

---

## 3 定价

### 3.1 规则（单一数据源 `sticker/pricing.json`）

- 卖「包」，不卖单张：10 / 25 / 50 张。理由是第一版供应商 Sticker Mule 每个设计至少 10 张（§5），而且礼物场景天然是「一包分给朋友」。
- 尺寸 2 / 3 / 4 in（指最长边）。不做 5 in 以上：第一版供应商的价格查不到，礼物贴纸也少用大尺寸。
- 形状 die-cut / 圆 / 方，同价。白边 1/16、1/8、3/16、1/4 in，同价，die-cut 时才可调。
- 表面：Glossy / Matte 同价；Holographic +35%，`enabled: false`（供应商还没核实，界面显示 “coming soon”，服务端拒收）。
- **价格含美国境内运费**（三家竞品都包邮，我们再单收运费会显得贵）。`shipping.methods[0].price_cents = 0`。
- 算价公式（前端展示、T3 服务端、`_dev/sticker_prototype_check.py`、`_dev/sticker_margin.py` 全部同一条）：

```
unit_cents = round_half_up(unit_price_cents[size][qty] × (100 + finish.surcharge_pct) / 100)
line_cents = unit_cents × qty
subtotal   = Σ line_cents
total      = subtotal + shipping（第一版恒为 0）
```

### 3.2 价目表（顾客看到的）

| 尺寸 | 10 张 | 25 张 | 50 张 |
|---|---:|---:|---:|
| 2 in | $32（$3.20 / 张） | $62（$2.48） | $110（$2.20） |
| 3 in | $39（$3.90） | $76（$3.04） | $136（$2.72） |
| 4 in | $52（$5.20） | $101（$4.04） | $182（$3.64） |

### 3.3 成本拆解与毛利

成本项（每笔订单）：

| 成本项 | 取值 | 来源 |
|---|---|---|
| 印刷 + 运费（外包，Sticker Mule 包邮价） | 3 in：10 张 $20、50 张 $72 | 官网写明（deal 页标注的 normal price，见 §2.2 链接） |
| 同上，3 in 25 张 | $39.50 = 在 10 张与 50 张之间线性插值 | 推断 |
| 同上，2 in / 4 in | 按 3 in 的 0.8× / 1.35× 估算 | 推断（分尺寸价查不到；上线前必须在 Sticker Mule 购物车核价） |
| Stripe 手续费 | 2.9% + $0.30（美国国内卡）；国际卡再加 1.5% | 官网写明：[stripe.com/pricing](https://stripe.com/pricing) |
| AI 生成摊到每笔付费订单 | $0.80 = $0.04 / 张（FLUX.1 Kontext pro）× 平均每个设计试 3 次 ÷ 15% 的设计者最终下单 | 单价官网写明：[BFL pricing](https://docs.bfl.ai/quick_start/pricing)；次数和转化率是推断 |
| 抠图 | $0（在浏览器里跑） | 见 §6.3 |
| 重印 / 退款预留 | 售价的 3% | 推断 |
| Cloudflare Worker / R2 / D1 | 免费额度内≈$0；超出后 Workers 付费版 $5 / 月起 | 官网写明：[Workers 价格](https://developers.cloudflare.com/workers/platform/pricing/)、[R2 价格](https://developers.cloudflare.com/r2/pricing/) |

逐格毛利由 `python3 _dev/sticker_margin.py` 从 `pricing.json` 直接算出：

- 下表就是它的原样输出。
- 加 `--check` 运行时，任何一格低于 40% 都会退出码 1。
- 「成本来源」一列只针对「印刷 + 运费」一项。

| 尺寸 | 数量 | 售价（含运费） | 每张 | 印刷+运费成本 | Stripe | AI 摊销 | 重印预留 | 单笔毛利 | 毛利率 | 成本来源 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 2 in | 10 | $32.00 | $3.20 | $16.00 | $1.23 | $0.80 | $0.96 | $13.01 | 40.7% | 推断 |
| 2 in | 25 | $62.00 | $2.48 | $31.60 | $2.10 | $0.80 | $1.86 | $25.64 | 41.4% | 推断 |
| 2 in | 50 | $110.00 | $2.20 | $57.60 | $3.49 | $0.80 | $3.30 | $44.81 | 40.7% | 推断 |
| 3 in | 10 | $39.00 | $3.90 | $20.00 | $1.43 | $0.80 | $1.17 | $15.60 | 40.0% | 官网写明 |
| 3 in | 25 | $76.00 | $3.04 | $39.50 | $2.50 | $0.80 | $2.28 | $30.92 | 40.7% | 推断 |
| 3 in | 50 | $136.00 | $2.72 | $72.00 | $4.24 | $0.80 | $4.08 | $54.88 | 40.4% | 官网写明 |
| 4 in | 10 | $52.00 | $5.20 | $27.00 | $1.81 | $0.80 | $1.56 | $20.83 | 40.1% | 推断 |
| 4 in | 25 | $101.00 | $4.04 | $53.32 | $3.23 | $0.80 | $3.03 | $40.62 | 40.2% | 推断 |
| 4 in | 50 | $182.00 | $3.64 | $97.20 | $5.58 | $0.80 | $5.46 | $72.96 | 40.1% | 推断 |

算一格验证（3 in × 10）：

- 售价 $39.00
- 减印刷 + 运费 $20.00
- 减 Stripe（$39 × 2.9% = $1.131 → $1.13，再加 $0.30 = $1.43）
- 减 AI $0.80
- 减重印预留（$39 × 3% = $1.17）

得 $15.60，$15.60 / $39 = 40.0%。

**敏感性（推断）**

- 换成 Printful die-cut 履约时：成本 = 单价 × 张数 + 运费。单价起 $3.86（官网写明），运费 die-cut 起 $5.19（官网写明），之后每多一张加 $0.15（官网旧运费表，可能过期）或加 $0.99（第三方报道，二者冲突）。
- 按 Printful 算，3 in × 10 张单印刷 + 运费就要 $45 以上，售价得 $90 左右才能保住 40% 毛利，没有竞争力。所以 Printful 只作为备份与自动化选项（§5）。
- 不算人工下单的时间成本。

---

## 4 用户流程

### 4.1 主路径（原型逐页实现，括号里是原型文件）

1. **首页**（`index.html`）
   - 首屏：一句话价值主张、「Make your stickers」、「Packs from $32 for 10, shipping included」（价格从 `pricing.json` 读）。
   - 往下依次是 How it works 4 步、同一张照片的 8 种风格（标明是真实示例）、价目表（从 `pricing.json` 渲染）、FAQ（交期 / 材质 / 能印什么 / 售后 / 照片隐私 / 是否寄海外）。
2. **上传**（`upload.html`）
   - 选文件或拖入；没有照片可以用示例照片。
   - 限 JPG / PNG / WebP / HEIC，≤ 20 MB，短边 ≥ 600 px。
   - 必须勾「我拍的或有权使用，照片里的人同意做成贴纸」，才能继续。
3. **抠图**（`cutout.html`）
   - 在浏览器里跑，照片下单前不上传。
   - 显示带白边的抠图结果，「Looks good」/「Use another photo」。
4. **选风格**（`style.html`）
   - 9 个选项：“Just the photo”（不走 AI）+ 8 种 AI 风格。
   - 每张照片免费试 6 次，界面显示剩余次数，失败不计次。
5. **编辑**（`edit.html`）
   - 选项：形状 die-cut / 圆 / 方，白边 4 档（die-cut 时可调），尺寸 2 / 3 / 4 in，数量 10 / 25 / 50，表面 Glossy / Matte（Holographic 灰掉）。
   - 实时预览，实时价格。
6. **实物效果预览**（`preview.html`）
   - 按真实比例把贴纸放到 13 英寸笔记本盖（宽 11.97 in）和水瓶上，另给一张大图。
   - 提示屏幕和印刷的色差。
   - 「Add to cart」。
7. **购物车**（`cart.html`）
   - 多个设计各占一行，可以改数量、删除。
   - 显示小计、运费 Free、预计 7–10 个工作日、合计。
   - 写明「Sales tax, if any, is calculated at checkout」和「Payment is handled by Stripe」。
8. **Stripe Checkout**（原型 `checkout.html` 是模拟页，页面上写明了）
   - 生产环境：购物车调 `POST /v1/checkout`，拿到 `checkout_url` 后跳转到 checkout.stripe.com。
   - 地址只收美国，邮箱由 Stripe 收。
9. **成功页**（`success.html`）
   - 订单号 `PL-xxxx`、实付金额、收据邮箱。
   - 「What happens next」三步时间线，「Track this order」。
10. **订单状态页**（`order.html`）
    - 状态：Paid → Checked（人工审核）→ Printing → Shipped（带物流单号）→ Delivered。
    - 用订单号 + 邮件里的私密 token 访问，不做账号。
11. **邮件**（`email.html` 是预览）
    - 一共发 4 封：下单确认、审核未通过（附退款说明）、已发货（带 tracking）、支付取消（不发，见 4.2）。

### 4.2 异常路径

| 场景 | 前端表现（原型可演示的标 ✅） | 服务端规则 |
|---|---|---|
| 格式不对 | ✅ “That file type won’t work” + 支持的格式 | 上传接口按魔数重验类型，返回 415 `unsupported_media_type` |
| 文件过大 | ✅ “That photo is too large”，上限 20 MB | 413 `payload_too_large` |
| 分辨率过低 | ✅ “too small to print sharply”，给出实际像素 | 422 `image_too_small`（按所选尺寸 × 150 dpi 下限再校一次，见 §6.4） |
| 未勾版权声明 | ✅ 「Continue」不跳转并提示 | 下单请求缺 `rights_confirmed: true` 时，返回 422 |
| 抠图失败 / 检测不到主体 | 提示「试试主体更清楚的照片」，可以跳过抠图直接用圆 / 方形状 | — |
| AI 失败或超时 | ✅（`style.html?sim=aifail`）“That one didn’t come out right… This try wasn’t counted” +「Try again」 | 单次 60 s 超时；失败不扣次数；连续 3 次失败，引导用户换风格或用 “Just the photo” |
| 免费次数用完 | ✅ 提示从已生成的版本里选或换照片 | 429 `generation_quota_exceeded`，按照片的哈希 + IP 计数 |
| 支付取消 | ✅ Stripe 的 `cancel_url` 回到 `cart.html?canceled=1`，显示 “Payment canceled. Nothing was charged.”，购物车保留 | Checkout Session 过期后，订单留在 `pending` 状态，24 h 后清理 |
| 支付成功但 webhook 晚到 | 成功页先显示「Payment received」（以 `session_id` 查询） | 以 `checkout.session.completed` webhook 为准，幂等 |
| **内容审核：版权**（卡通角色、品牌 logo、他人作品） | ✅（`upload.html?sim=blocked`）“We can’t print this photo… trademarked character or logo” + 政策链接 | 生成前做自动分类（见 §6.2，mock 默认放行）；下单后**每单人工复核**才发印刷 |
| **内容审核：NSFW / 仇恨** | 同上，文案改为 “doesn’t meet our content policy” | 自动拒绝；不调用 AI |
| **内容审核：他人肖像 / 名人** | 上传时必须勾同意声明；疑似名人 → 订单进入人工复核 | ✅（`order.html?sim=review`）订单页显示「We’re taking a closer look」；不通过就**全额退款**并发邮件 |
| 未成年人照片 | FAQ 写明家长上传可以；不做年龄识别 | 人工复核时如发现明显不当用途，拒绝 + 退款 |
| 印刷品损坏 / 与预览不符 | FAQ：30 天内发照片，重印或退款 | 订单页加 “Report a problem”（T4） |

---

## 5 履约

### 5.1 供应商对比

| 供应商 | 品类 | 单价 / 运费 | 交期 | API | 适合度 | 来源 |
|---|---|---|---|---|---|---|
| **Sticker Mule** | die-cut / kiss-cut / sheet | 3 in die-cut 10 张 $20、50 张 $72，包邮 | 4 天出货 | 有冲突：2026-08 官方更新帖说上线了公开 API（可下单）；旧 FAQ 说没有下单 API；功能投票板显示 “in progress” | 单价最低且包邮；起订 10 张；包装大概率带它的品牌（推断） | 官网写明：[die-cut](https://www.stickermule.com/products/die-cut-stickers)、[2026-08 更新](https://www.stickermule.com/au/write/stickermule/updates-august-3-16-2026)、[旧 FAQ](https://www.stickermule.com/support/faq/ordering/do-you-offer-an-api-for-placing-orders) |
| **Printful** | kiss-cut（3 / 4 / 5.5 in）、die-cut（2–6 in） | kiss-cut $2.34 / 张、运费起 $4.49；die-cut 起 $3.86 / 张、运费起 $5.19 | 生产 2–5 + 运输 3–4 个工作日 | Orders API v2（beta），文件为公开 URL，PNG / JPEG ≥ 300 DPI | 无起订、白标、API 成熟；小批量单价高 | 官网写明：[kiss-cut](https://www.printful.com/custom/stationery/personalized/kiss-cut-stickers)、[die-cut](https://www.printful.com/custom/product/957)、[文件规范](https://support.printful.com/hc/en-us/articles/41396541153553)、[API v2](https://developers.printful.com/docs/v2-beta/) |
| **Gelato** | 没找到独立的贴纸产品（只有 Gelato+ 的品牌标签 4×3 in） | 标签 $0.49 起（Gelato+） | 查不到 | REST v3，`X-API-KEY` | **不适合** | 官网写明：[包装标签](https://support.gelato.com/en/articles/8996258-what-are-the-size-and-shape-of-packaging-inserts-and-branded-labels)、[API](https://dashboard.gelato.com/docs/products/catalog/get/) |
| Printify | kiss-cut decal $1.21 起；die-cut $3.75 起、运费 $5.29 起 | 2026-10-15 至 2027-01-17 美国单加 $0.40 | 最快供应商平均 1.2 天（贴纸页） | 有（上传图片、下单） | 与 Printful 同类，可作备选 | 官网写明：[custom stickers](https://printify.com/custom-stickers/)、[运费](https://printify.com/shipping-rates/)；API 是第三方报道 |
| Gooten | kiss-cut，6 个尺寸，1–100 张一包 | $1.40 起 | 查不到 | 有 | 会在边上印条码、自动加 1/8 in 白边 | 官网写明（品类）：[链接](https://gooten.com/print-on-demand/kiss-cut-stickers/)；价格是第三方报道 |
| Prodigi | kiss-cut | £0.80 起 | — | 有 | **只在英国 / 欧盟生产**，寄美国慢 | 官网写明：[链接](https://www.prodigi.com/products/stickers/kiss-cut-stickers/) |
| StickerApp | die-cut / kiss-cut | 见 §2.2 | 1–2 + 运输 | 没查到 B2B API | 只能人工下单 | 查不到 |

### 5.2 推荐与第一版做法

- **第一版人工下单给 Sticker Mule**（推荐，需用户在 §9 拍板）。理由：
  - 在所有搜到的供应商里，它的 3 in 单价最低且包邮，§3 的定价才能做到「$39 / 10 张、40% 毛利」。
  - 4 天出货。
  - 早期订单量小，人工下单还能顺便做内容复核（§4.2）。
- **流程**：
  1. 订单付款后进入「待审核」，Worker 给运营邮箱发通知，附订单页 + 印刷文件下载链接。
  2. 运营人工看图，打开 Sticker Mule，按尺寸 / 数量下单，上传印刷文件，填客户的美国地址，确认它发来的打样。
  3. 回到订单后台填外部订单号（`POST /v1/admin/orders/{id}/fulfill`），状态变为 Printing。
  4. 发货后填物流单号，状态变为 Shipped，系统给客户发发货邮件。
- **转自动化的条件**：日均超过 5 单，或者人工下单每周超过 2 小时。到那时：
  - 先核实 Sticker Mule 的公开 API 能不能「新建自定义订单 + 寄到任意地址」。
  - 不能的话，接 Printful Orders API，同时按 §3 敏感性重新定价。
- **上线前必做**：
  - 在 Sticker Mule 购物车核对 2 / 3 / 4 in × 10 / 25 / 50 九格价格，改 `pricing.json.cost_model` 并重跑 `_dev/sticker_margin.py --check`。
  - 确认可以寄到任意地址，以及包装 / 发票里是否有价格单（礼物场景不能把价格寄给收礼人）。

---

## 6 技术架构

### 6.1 总图

```
浏览器（GitHub Pages：datode.com/sticker/）
  ├─ 静态 HTML/CSS/JS（无构建步骤，无框架）
  ├─ 抠图：浏览器内分割模型（适配器：mock | browser-model）
  ├─ 预览渲染：Canvas（白边 / 形状 / 光泽）
  └─ fetch → Cloudflare Worker（api.datode.com 或 *.workers.dev，T4 定）
        ├─ R2：原图（30 天）、风格化结果、印刷文件（180 天）
        ├─ D1：orders、order_lines、designs、generation_log
        ├─ KV：生成次数计数、幂等键（短 TTL）
        ├─ AI 适配器：mock（默认） | flux-kontext | gemini-image | …
        ├─ Stripe：Checkout Session + webhook（签名校验）
        └─ 邮件适配器：mock（写日志） | 邮件服务商（T3 选，占位名 EMAIL_API_KEY）
```

**存储选型**：

- **R2** 放图片：egress 免费；免费额度 10 GB-month；超出 $0.015 / GB-month（官网写明，链接见 §3.3）。
- **D1** 放订单：要事务和查询。免费档每天 5M 行读、100k 行写（官网写明：[D1 价格](https://developers.cloudflare.com/d1/platform/pricing/)），对第一版绰绰有余。
- **KV** 只放计数和幂等键。KV 免费档每天只有 1k 次写（官网写明：[KV 价格](https://developers.cloudflare.com/kv/platform/pricing/)），不能放订单。

**端点清单**：见 `_dev/sticker/api_contract.md`。共 7 个公开端点（pricing / designs / generations / checkout / orders / webhook / health）和 2 个管理端点（admin 列表、fulfill）。

### 6.2 AI 风格化提供方

| 提供方 | 每张成本 | 延迟 | 说明 | 来源 |
|---|---|---|---|---|
| **mock（默认）** | $0 | 0.5–1 s | 确定性的像素滤镜（色阶 + 描边 / 线稿 / 复古色）；示例照片直接返回仓库里的 8 张真实示例图 | 本仓库 |
| **FLUX.1 Kontext [pro]**（BFL 直连，或在 Replicate / fal 上） | $0.04 | 约 5–6 s | 图生图编辑，保留人物身份，适合「把照片改成某种画风」；固定 1 MP 输出 | 官网写明：[BFL 价格](https://docs.bfl.ai/quick_start/pricing)、[Kontext 说明](https://help.bfl.ai/articles/5186006235-what-is-flux-1-kontext)；Replicate / fal 的价格是第三方报道 |
| Gemini 2.5 Flash Image | $0.039（batch $0.0195） | 查不到 | **已宣布弃用，2027-03-15 退役**，不建议新接 | 官网写明：[Gemini 价格](https://ai.google.dev/gemini-api/docs/pricing)、[退役说明](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/2-5-flash-image) |
| OpenAI gpt-image-2 | 1024² 低 / 中 / 高画质 $0.006 / $0.053 / $0.211 | 查不到 | gpt-image-1 已于 2026-10-23 下线；按 token 计价的两处官方页面数字冲突 | 官网写明：[生成指南](https://developers.openai.com/api/docs/guides/image-generation)、[下线公告](https://developers.openai.com/api/docs/deprecations) |
| Replicate SDXL img2img（社区模型） | 约 $0.003–0.011 | 4–12 s | 便宜，但人脸身份保持差（推断） | 官网写明：[asiryan/sdxl](https://replicate.com/asiryan/sdxl) |
| Replicate InstantID | 约 $0.059 | 约 61 s | 太慢 | 官网写明：[链接](https://replicate.com/tgohblio/instant-id-multicontrolnet) |

**推荐**：真接口第一选 **FLUX.1 Kontext pro**：价格、延迟、身份保持三者平衡最好。gpt-image-2 中画质做第二适配器，便于对比质量。

适配器接口（T3 实现）：

```
stylize({ image_url, style_id, seed }) → { image_url, provider, cost_microusd, ms }
```

`STYLE_PROVIDER` 环境变量缺省为 `mock`。8 种风格的提示词写在服务端 `styles.json`，前端只传 `style_id`。

**内容审核**：

- 生成前先做自动分类，适配器名 `moderate()`，默认 mock 全部放行。真接口候选是供应商自带的 safety 结果或单独的分类接口，T3 选，本轮没有比价。
- 拦截 NSFW、暴力仇恨、明显的商标 / 卡通角色。
- 付款后**每单人工复核**，这一步不依赖自动分类的准确率。

### 6.3 抠图放哪：浏览器端

- 理由：
  - 照片在付款前不离开用户设备（隐私卖点，FAQ 有写）。
  - 不花钱。
  - 抠图结果还要让用户确认，在本地跑交互更快。
- 风险（官网写明 / 第三方报道）：
  - 现成的 `@imgly/background-removal` 是 **AGPL** 许可，商用要买授权（[README](https://unpkg.com/@imgly/background-removal@1.5.8/README.md)）。
  - 模型 44–176 MB（第三方报道），移动端首屏下载太重。
  - MediaPipe selfie segmentation 约 450 KB、Apache-2.0，但只针对人像，宠物边缘会差（推断）。
- 做法：
  - 适配器 `cutout(image) → RGBA`，实现有三个：
    - `mock`：原型里的羽化椭圆。
    - `selfie`：MediaPipe，人像，默认。
    - `server`：Replicate 上的 rembg，约 $0.0003 / 次（官网写明：[链接](https://replicate.com/abhisingh0909/rembg)），宠物照或浏览器失败时用。
  - 抠图失败时允许直接选圆 / 方形状，跳过抠图。

### 6.4 印刷文件生成（服务端，下单时）

- **输入**：风格化结果（PNG，带 alpha）+ 形状 + 白边 + 尺寸。
- **输出**：
  1. `print.png`：最长边 = 尺寸 × 300 px（4 in → 1200 px），sRGB。白边实色铺满，再向外留 1/16 in 出血（同色白）。
  2. `cut.svg`：切割路径。
     - die-cut：对 alpha 做膨胀，半径 = 白边，再提取外轮廓并简化，最小内角半径 1/32 in，避免切刀卡尖角。
     - 圆 / 方：几何路径，方形圆角 = 边长 9%。
     - 路径单独一层，命名 `CutContour`（行业惯例，第三方报道：[printkeg 文件规范](https://www.printkeg.com/pages/sticker-file-setup-guide)）。
  3. `proof.png`：带切割线的 72 dpi 校样，给运营人工复核用。
- **分辨率下限**：风格化输出若低于「尺寸 × 150 dpi」，先 2× 超分（适配器 `upscale`，默认 mock = 双三次插值）；仍不够就拒绝该尺寸，返回 `image_too_small`。注意 FLUX Kontext 固定 1 MP 输出（约 1024×1024），印 4 in / 300 dpi 需要 1200 px，必然要超分（推断）。
- **Printful 例外**：它要求贴纸文件「不能有透明背景」（官网写明，§5.1 文件规范链接）。所以 `print.png` 一律铺白底，切割形状单独由 `cut.svg` 给出。若改用 Printful，按它的模板把白边画进图里。
- **实现位置**：Worker 里做像素运算会超出 CPU 限额（免费档每请求 10 ms CPU，官网写明，§3.3 Workers 价格链接）。所以：
  - 印刷文件在**浏览器端**用与预览相同的 Canvas 代码按 300 dpi 生成，随下单上传。
  - Worker 只校验尺寸、DPI 元数据、文件大小与 hash。
  - 人工复核时看 `proof.png`。
  - 自动化阶段再考虑 Workers 付费档或外部函数。

---

## 7 设计语言与原型

- **调性**：「纸 + 墨 + 一个暖色」。
  - 米白纸底 `#f5f0e6`、近黑墨色 `#1e1d1a`、番茄红 `#d9472b` 只给主按钮和步骤编号。
  - 成功状态用墨绿 `#2f6b4a`。
- **字体**：衬线标题（Iowan Old Style / Palatino / Georgia 系统字体栈），无衬线正文。不加载外部字体：零外网请求，首屏快。
- **明确不做**（合同点名反对）：紫色主色、全大写小标题（所有标题都是句首大写）、满屏卡片（信息用细线分隔的编辑式排版，只有交互面板才用卡片）、渐变光斑。
- **真实感**：
  - 贴纸用真实的白边 + 柔和投影，示例照片做成拍立得样式。
  - 实物预览按真实尺寸比例放。
  - 价格全部从 `pricing.json` 渲染。
  - 页面上没有任何评价；所有示例都标明是示例。
- **原型**：`_dev/sticker/prototype/`，11 个页面。
  - 依赖：`assets/app.css`、`assets/app.js`、`assets/sample.jpg`，加上仓库里现有的 `sticker/src/img/style/*.png`。
  - 状态存在 localStorage，失败时退回内存。
  - 顶部黑条写明 “Prototype · nothing is charged or shipped”，带「Reset demo」。
  - 演示异常可在 URL 后加 `?sim=aifail`（style）、`?sim=blocked`（upload）、`?sim=review`（order）。
- **截图**：`_dev/sticker/mockups/`。
  - 1280 和 390 两个宽度。
  - 覆盖首页、上传、抠图、风格、编辑、预览、购物车、模拟 Stripe、成功页、订单页、邮件，再加 3 张异常态（上传错误、内容拒绝、AI 失败）。
- **验收脚本**：`_dev/sticker_prototype_check.py` 用真 Chromium 从首页点到成功页。
  - 断言每步都到达、前端价 = Python 价、控制台零报错、零外网请求。
  - 加 `--mockups` 时重新生成上面的截图。

---

## 8 给 T2 / T3 / T4 的补充要求

### T2 前端制作器（写进 `sticker/`）

1. 把原型的页面结构、文案和设计令牌搬进 `sticker/`。`sticker/index.html` 整页重写，旧页面的死按钮、假评价、不实说法（§1）一条不留。
2. 价格只从 `sticker/pricing.json` 读，**不在 JS 里硬写任何价格**。展示规则与 §3.1 一字不差。`enabled:false` 的选项显示 “coming soon” 且不能选。
3. 抠图 / 风格化 / 审核都走适配器，默认 `mock`。mock 的行为与原型一致：示例照片返回 8 张真实示例图，其他照片用滤镜。
4. API 调用严格按 `_dev/sticker/api_contract.md`。后端没好之前，用同一份契约的本地 mock（`sticker/js/api-mock.js` 一类），用 `?api=mock` 或缺省切换。
5. 印刷文件：用与预览同一份 Canvas 代码按 300 dpi 输出 `print.png` + `cut.svg`（§6.4），下单前上传。
6. 无障碍：
   - 所有选项是真 `<input type=radio>` + `<label>`。
   - 键盘可以走完全程。
   - 错误提示用 `role=alert`。
   - viewport 允许缩放。
7. 390px 宽不能横向滚动；触控目标 ≥ 42px。
8. 不加载任何外部字体 / CDN。GA 代码可以保留（旧页有），但必须在 T4 的隐私说明里写明。
9. 品牌名集中成一个常量，等 §9 拍板。

### T3 Worker + Stripe（写进 `sticker-api/`）

1. 端点、请求 / 响应、错误码以 `api_contract.md` 为唯一契约。改契约要同时改该文件。
2. **服务端按 `pricing.json` 重新算价**。
   - 部署时把同一份 JSON 打进 Worker；`GET /v1/pricing` 原样返回，但去掉 `cost_model`。
   - 前端传来的任何金额字段一律忽略，只在响应里回显服务端价。
   - 价格版本不一致时返回 409 `pricing_version_mismatch`，前端刷新价格后重试。
3. Stripe Checkout：
   - `line_items` 用 `price_data` 动态生成（金额 = 服务端算价）。
   - `shipping_address_collection.allowed_countries = ["US"]`。
   - `success_url` / `cancel_url` 按契约填。
   - `metadata.order_id`。
   - webhook 校验签名，按 `event.id` 做幂等。
4. 所有第三方都是适配器 + 环境变量，缺省走 mock，**仓库里只写占位名**：
   - `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`STYLE_PROVIDER`、`STYLE_API_KEY`、`EMAIL_API_KEY`、`ADMIN_TOKEN`。
   - `wrangler.toml` 里不出现任何真值。
5. 生成配额：每个 `design_id` 6 次，失败不计；同一 IP 每天 30 次。超出返回 429。
6. 数据保留：
   - 未付款的设计和原图，30 天后由 cron 删除。
   - 订单印刷文件保留 180 天。
   - 订单页 token 用 32 字节随机数，库里只存哈希。
7. 不注册、不部署、不花钱。本地用 `wrangler dev` + Stripe 测试模式的 mock 跑通即可，部署交给主会话。

### T4 联调 + 内容与 SEO + 上线清单

1. 用 `api_contract.md` 对一遍前后端，跑通：首页 → Stripe 测试模式付款 → webhook → 订单页 → 邮件（mock）。
2. 上线前核价：在 Sticker Mule（或用户选定的履约商）购物车核对 9 格成本，把 `cost_model.*_verified` 改为 true，并跑 `python3 _dev/sticker_margin.py --check`。
3. 内容：
   - FAQ、Shipping & returns、Content policy、Privacy（照片保留期、GA 说明）、Terms。
   - 不出现「Waterproof / Fade-resistant / 60-second」这类供应商没写明的承诺。
4. SEO：
   - title / meta description / og:image（1200×630，用真实示例图）/ canonical `https://datode.com/sticker/`。
   - `Product` 结构化数据里的价格从 `pricing.json` 取。
   - **不加 `AggregateRating` / `Review`**，因为没有真实评价。
5. 上线清单：
   - Stripe live key 与 webhook 端点。
   - Worker 自定义域名。
   - CORS 只放 `https://datode.com`。
   - R2 生命周期规则。
   - 运营邮箱。
   - 人工下单 SOP（§5.2）。
   - 退款 SOP。
6. 个人站首页对贴纸的描述（`js/app.js`，受保护）与新定位不符，列给用户决定（§1.1 A5、§9）。

---

## 9 要用户拍板的决定

| # | 决定 | 推荐 | 理由 | 不定的后果 |
|---|---|---|---|---|
| D1 | 开 Stripe 账号（美国主体或 Stripe Atlas，费率 2.9% + 30¢） | **开**，用能收美元的主体 | 合同硬约束是美元 + 美国用户；Checkout 无额外费用（官网写明：[链接](https://stripe.com/payments/checkout)） | 只能停在测试模式，无法收款 |
| D2 | AI 风格化接口 key | **BFL FLUX.1 Kontext pro**，先充值 $20（约 500 张） | $0.04 / 张、约 5–6 s、保留人物身份（§6.2）；mock 已能演示全流程 | 线上只能用 mock 滤镜，效果明显不如示例图 |
| D3 | 履约商 | **Sticker Mule，第一版人工下单**；Printful 备选 | 3 in 单价最低且包邮，§3 的 40% 毛利依赖它；量起来再接 API（§5.2） | 定价表的成本假设不成立 |
| D4 | 是否开 Stripe Tax（0.5% / 笔，只在已登记的州收税） | **第一版不开**，等某州销售额接近经济关联门槛再开 | 早期量小；Stripe Tax 费率官网写明（[链接](https://support.stripe.com/questions/understanding-stripe-tax-pricing)）；各州门槛本轮没查（查不到） | 有少量合规风险，需要定期看销售分布 |
| D5 | 品牌名：StickerAI → **Peelings**（或你另起） | **换**，上线前查一次 USPTO 商标和同名域名 | §2.3；本轮未查商标（查不到） | 沿用 StickerAI：辨识度低，和旧 logo “Gifted Sticker” 也不统一 |
| D6 | 是否换域名 / 子域名 | **不换**，留在 `datode.com/sticker/`（合同不可推翻项）；API 用 `api.datode.com` 或 workers.dev | 不新增费用；Stripe 自定义结账域名要 $10 / 月（官网写明），不需要 | — |
| D7 | 示例照片里的两位是谁、能否商用 | **你确认同意后再用**；否则换成你自己或宠物的照片重做 8 张示例 | 他人肖像，仓库里查不到授权（§1.3 C3） | 首页示例要换掉 |
| D8 | 个人站首页对贴纸的旧描述（“Describe it in a sentence…”） | **另开一单改**（`js/` 受保护，本链不动） | 与新定位不符（§1.1 A5） | 首页入口描述和落地页不一致 |
| D9 | 售后承诺：30 天内损坏或与预览不符，重印或退款 | **接受** | 已计入 3% 重印预留；礼物场景信任比成本重要 | 需另写条款 |

---

## 10 来源与可信度说明

- **抓取限制**：本轮在云端容器执行，直接抓取厂商页面被网络策略拦截（`getaddrinfo ENOTFOUND`）。所有「官网写明」都是**搜索引擎结果摘要中出自厂商域名的内容**，不是打开原页面核对的。部分摘要可能是旧缓存，例如 Sticker Mule 德国站的欧元价格摘要约 4 年前；Printful 运费表新旧两版冲突。
- **已知冲突**：
  - Printful kiss-cut：$2.34 与 $2.24 两种说法。
  - Printful 每多一张贴纸的运费：$0.15（官网旧表）与 $0.99（第三方）。
  - Sticker Mule 是否有下单 API：2026-08 更新帖与旧 FAQ 说法相反。
  - OpenAI gpt-image-2 的 token 价：两处官方页面不一致。
- **推断项**：§3.3 的 2 / 4 in 成本系数、3 in 25 张插值、AI 每单摊销（试 3 次、15% 转化）、3% 重印预留、交期「7–10 个工作日」（Sticker Mule 4 天出货 + 人工审核 1 天 + USPS 运输，推断）。
- **核价方法**：上线前在 T4 用浏览器逐条核对，更新 `pricing.json.cost_model`，重跑 `_dev/sticker_margin.py --check`。
