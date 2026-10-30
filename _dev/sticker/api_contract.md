# 贴纸站 API 契约 v1（前后端唯一契约）

> 前端：`sticker/`（T2），后端：`sticker-api/` Cloudflare Worker（T3）。改这里 = 改契约，前后端同时改。
> 金额一律是**美分整数**（`*_cents`），币种固定 `usd`。时间一律 ISO 8601 UTC。

## 0 通用约定

- **基址**：`{API_BASE}/v1`。`API_BASE` 由前端配置常量提供，开发时用 `http://127.0.0.1:8787`，线上域名由 T4 定。
- **请求格式**：除上传外，请求和响应都是 `Content-Type: application/json; charset=utf-8`。
- **CORS**：只允许 `https://datode.com`，开发时加 `http://127.0.0.1:*`。
- **幂等**：所有会产生副作用的 POST 都接受 `Idempotency-Key` 头（UUID）。服务端在 KV 存 24 h，相同键返回第一次的响应。
- **错误体**统一为：

```json
{ "error": { "code": "invalid_option", "message": "Holographic finish is not available yet.", "field": "lines[0].finish", "retryable": false } }
```

  `message` 是可以直接给用户看的英文；`field` 可选。

- **价格不信任前端**：
  - 任何请求里出现的 `price` / `amount` / `*_cents` 字段都**忽略**。
  - 服务端用部署时打进 Worker 的 `sticker/pricing.json`，按下面的公式重新算价：

```
unit_cents = round_half_up(unit_price_cents[size][qty] × (100 + finish.surcharge_pct) / 100)
line_cents = unit_cents × qty
subtotal   = Σ line_cents
total      = subtotal + shipping
```

  - 前端可以带 `pricing_version`。它和服务端的 `version` 不一致时返回 409 `pricing_version_mismatch`，响应里附上新的报价，前端刷新显示后让用户再点一次。
- **选项校验**：`size`、`qty`、`finish`、`shape`、`border_in` 必须是 `pricing.json` 里的值，且对应项 `enabled !== false`。否则返回 422 `invalid_option`。

### 通用错误码

| HTTP | code | 何时 | retryable |
|---|---|---|---|
| 400 | `bad_request` | JSON 解析失败 / 缺字段 | false |
| 401 | `unauthorized` | 订单 token 或管理 token 不对 | false |
| 404 | `not_found` | 资源不存在或已过期删除 | false |
| 409 | `pricing_version_mismatch` | 前端价格版本过期 | true（刷新后） |
| 409 | `conflict` | 状态不允许（如已付款订单再结账） | false |
| 413 | `payload_too_large` | 上传超过 20 MB | false |
| 415 | `unsupported_media_type` | 不是 JPEG / PNG / WebP / HEIC（按文件魔数判断） | false |
| 422 | `invalid_option` | 选项不在 `pricing.json` 或已停用 | false |
| 422 | `image_too_small` | 短边 < 600 px，或印刷文件低于「尺寸 × 150 dpi」 | false |
| 422 | `rights_not_confirmed` | 未声明拥有照片使用权 | false |
| 422 | `content_rejected` | 自动审核拒绝（附 `reason`: `nsfw` / `hate` / `trademark` / `public_figure`） | false |
| 429 | `generation_quota_exceeded` | 该设计 6 次免费生成用完，或同一 IP 当日 30 次 | false |
| 429 | `rate_limited` | 通用限流，响应带 `Retry-After` | true |
| 502 | `provider_error` | AI / 抠图 / Stripe / 邮件上游错误 | true |
| 504 | `provider_timeout` | AI 生成超过 60 s | true |
| 500 | `internal` | 其他 | true |

---

## 1 `GET /v1/pricing`

返回 `pricing.json`，**去掉 `cost_model`**。可以缓存 5 分钟（`Cache-Control: public, max-age=300`）。前端也可以直接读静态 `sticker/pricing.json`，两者内容必须一致，T4 联调时核对。

```json
200
{ "version": "2026-10-29.1", "currency": "usd", "sizes": [ ... ], "quantities": [10, 25, 50],
  "unit_price_cents": { "3": { "10": 390, "25": 304, "50": 272 }, ... },
  "finishes": [ ... ], "shapes": [ ... ], "borders_in": [ ... ], "shipping": { ... }, "ai": { "free_tries_per_photo": 6 }, "limits": { ... } }
```

## 2 `POST /v1/designs`：登记一个设计（抠图已在浏览器完成）

- 请求：`multipart/form-data`
  - `cutout`：PNG（RGBA），≤ 20 MB。
  - `meta`：JSON 字符串。
- 原图**不上传**。抠图结果是生成 AI 风格的输入。

```json
meta = { "rights_confirmed": true, "source": "upload" | "sample", "width": 1080, "height": 1350 }
```

```json
201
{ "design_id": "dsg_9f2c…", "cutout_url": "https://…/r2/dsg_9f2c/cutout.png", "tries_left": 6, "expires_at": "2026-11-28T00:00:00Z" }
```

错误：413、415、422 `image_too_small` / `rights_not_confirmed` / `content_rejected`、429 `rate_limited`。

## 3 `POST /v1/designs/{design_id}/generations`：生成一种风格

请求：

```json
{ "style_id": "sunny" }
```

`style_id` 取值：`original | sunny | ink | line | badge | pastel | wash | clay | pop`。其中 `original` 不调用 AI，也不扣次数。

**同步返回**（Worker 内等待上游，上限 60 s）：

```json
201
{ "generation_id": "gen_1a7…", "style_id": "sunny", "image_url": "https://…/r2/dsg_9f2c/gen_1a7.png",
  "width": 1024, "height": 1024, "provider": "mock", "tries_left": 5 }
```

错误与扣次规则：

- 504 `provider_timeout`、502 `provider_error`：**不扣次数**，`tries_left` 不变，在错误体里返回。
- 422 `content_rejected`：不扣次数。
- 429 `generation_quota_exceeded`。

## 4 `GET /v1/designs/{design_id}`

```json
200
{ "design_id": "dsg_9f2c…", "cutout_url": "…", "tries_left": 5,
  "generations": [ { "generation_id": "gen_1a7…", "style_id": "sunny", "image_url": "…", "created_at": "…" } ] }
```

## 5 `POST /v1/quote`：服务端报价（购物车每次变动时调用，可选）

请求：

```json
{ "pricing_version": "2026-10-29.1",
  "lines": [ { "generation_id": "gen_1a7…", "size": "3", "qty": 10, "finish": "glossy", "shape": "diecut", "border_in": 0.125 } ] }
```

响应（金额全部由服务端算出）：

```json
200
{ "pricing_version": "2026-10-29.1",
  "lines": [ { "generation_id": "gen_1a7…", "size": "3", "qty": 10, "finish": "glossy", "shape": "diecut", "border_in": 0.125,
               "unit_cents": 390, "line_cents": 3900 } ],
  "subtotal_cents": 3900, "shipping_cents": 0, "total_cents": 3900, "currency": "usd" }
```

错误：

- 409 `pricing_version_mismatch`（错误体附带 `quote`，内容为上面的整个响应）。
- 422 `invalid_option`。
- 404：`generation_id` 不存在。
- 400：`lines` 为空或超过 `limits.max_lines_per_order`（10）。

## 6 `POST /v1/checkout`：创建订单 + Stripe Checkout Session

请求：`lines` 与 `/v1/quote` 相同，另外带上每行的印刷文件。印刷文件在浏览器端按 300 dpi 生成（见 SPEC §6.4），先用 `PUT /v1/uploads/{upload_id}` 传上来，再在这里引用。

```json
{ "pricing_version": "2026-10-29.1",
  "rights_confirmed": true,
  "lines": [ { "generation_id": "gen_1a7…", "size": "3", "qty": 10, "finish": "glossy", "shape": "diecut", "border_in": 0.125,
               "print_upload_id": "upl_…", "cut_upload_id": "upl_…" } ] }
```

服务端按顺序执行：

1. 校验选项和上传文件：
   - `print.png` 最长边 ≥ 尺寸 × 300 px，误差 ±2%。
   - `cut.svg` 可以解析，且只有一条闭合路径。
2. **按 `pricing.json` 重新算价**。
3. 在 D1 写入 `orders`（status=`pending`）和 `order_lines`。
4. 生成订单页 token：32 字节随机数，库里只存 SHA-256。
5. 创建 Stripe Checkout Session：
   - `mode=payment`。
   - `line_items[].price_data`：`{ currency: "usd", unit_amount: unit_cents, product_data: { name: "Die-cut sticker, 3 in (pack of 10)" } }`，`quantity` 恒为 1，`unit_amount = line_cents`。按包卖，Stripe 收据显示「1 × pack」。
   - `shipping_address_collection.allowed_countries=["US"]`。
   - `customer_creation` 和 `customer_email` 留空，邮箱由 Stripe 收集。
   - `success_url = https://datode.com/sticker/success.html?order={order_id}&session_id={CHECKOUT_SESSION_ID}`。
   - `cancel_url = https://datode.com/sticker/cart.html?canceled=1`。
   - `metadata = { order_id }`，`expires_at = 现在 + 1 h`。

```json
201
{ "order_id": "PL-4821", "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_…", "total_cents": 3900,
  "order_token": "otk_…(只返回这一次，前端存 sessionStorage，用于跳回成功页后查询)" }
```

错误：400、409、422（含 `rights_not_confirmed`、`image_too_small`）、502 `provider_error`（Stripe 调用失败，订单回滚）。

### 6.1 `PUT /v1/uploads/{upload_id}`

- 前端自己生成 `upload_id`：`upl_` + UUID。
- 请求体是原始字节：`Content-Type: image/png` 或 `image/svg+xml`，≤ 20 MB。
- 写入 R2 临时区，24 h 后过期。
- 返回 `201 { "upload_id": "upl_…", "bytes": 123456, "sha256": "…" }`。

## 7 `GET /v1/orders/{order_id}?token=…`：订单状态

`token` 来源：

- 成功页用 `/v1/checkout` 返回的 `order_token`。
- 邮件里的链接自带 token。

```json
200
{ "order_id": "PL-4821", "status": "paid" | "in_review" | "on_hold" | "printing" | "shipped" | "delivered" | "canceled" | "refunded",
  "status_note": "A person is taking a closer look at your photo.",
  "total_cents": 3900, "currency": "usd", "created_at": "…", "paid_at": "…",
  "lines": [ { "style_id": "sunny", "size": "3", "qty": 10, "finish": "glossy", "shape": "diecut", "preview_url": "…" } ],
  "shipping": { "name": "J. D.", "city": "Portland", "state": "OR" },
  "tracking": { "carrier": "USPS", "number": "9400…", "url": "https://tools.usps.com/…" } | null,
  "events": [ { "status": "paid", "at": "…" }, { "status": "in_review", "at": "…" } ] }
```

说明与错误：

- 地址只回显城市和州，不回显街道。
- 401：token 错误。
- 404：订单不存在。
- `status = pending`（还没付款）时也返回 200，前端显示「Waiting for payment confirmation」，每 3 s 轮询，最多 10 次。

## 8 `POST /v1/stripe/webhook`：Stripe 回调（Stripe → Worker）

- 用 `STRIPE_WEBHOOK_SECRET` 校验 `Stripe-Signature`，失败返回 400。
- 按 `event.id` 做幂等，记录存在 D1 的 `webhook_events` 表。
- 处理以下事件：

| 事件 | 动作 |
|---|---|
| `checkout.session.completed`（`payment_status=paid`） | 订单从 `pending` 改为 `in_review`。写入 Stripe 收集的邮箱和地址。**核对 `amount_total == orders.total_cents`**，不一致就改为 `on_hold` 并通知运营。之后发「下单确认」邮件，给运营发「新订单待审核」通知。 |
| `checkout.session.expired` | 订单从 `pending` 改为 `canceled`，不发邮件 |
| `charge.refunded` | 订单改为 `refunded`，发退款邮件 |

- 总是快速返回 200；耗时的工作放进 `ctx.waitUntil`。

## 9 管理端点（运营用，`Authorization: Bearer {ADMIN_TOKEN}`）

### `GET /v1/admin/orders?status=in_review`

返回订单列表。每单带 `proof_url`（带切割线的校样）、`print_url`、`cut_url`（R2 签名链接，1 h 有效）。

### `POST /v1/admin/orders/{order_id}/transition`

请求：

```json
{ "to": "printing" | "on_hold" | "shipped" | "delivered" | "canceled",
  "supplier": "stickermule", "supplier_order_id": "SM-…",
  "tracking": { "carrier": "USPS", "number": "…" },
  "note": "Rejected: trademarked character" }
```

合法的状态转换：

- `in_review` → `printing` | `on_hold`
- `on_hold` → `printing` | `canceled`（转 `canceled` 时自动调用 Stripe 全额退款）
- `printing` → `shipped`（必须带 `tracking`，并发「已发货」邮件）
- `shipped` → `delivered`

非法转换返回 409 `conflict`。

## 10 `GET /v1/health`

```json
200 { "ok": true, "pricing_version": "2026-10-29.1", "providers": { "style": "mock", "cutout": "browser", "email": "mock", "stripe": "test" } }
```

---

## 附：环境变量（只有占位名，仓库里不写值）

| 名称 | 用途 | 缺省 |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe API | 不设 → `/v1/checkout` 返回模拟的 `checkout_url`（指向前端模拟页） |
| `STRIPE_WEBHOOK_SECRET` | webhook 验签 | 不设 → 只接受本地 mock 事件 |
| `STYLE_PROVIDER` | `mock` / `flux-kontext` / `gpt-image` | `mock` |
| `STYLE_API_KEY` | AI 供应商 key | — |
| `MODERATION_PROVIDER` | `mock` / … | `mock`（全部放行，人工复核兜底） |
| `EMAIL_PROVIDER` / `EMAIL_API_KEY` | 邮件 | `mock`（写日志） |
| `ADMIN_TOKEN` | 管理端点 | 不设 → 管理端点全部返回 401 |
| `ALLOWED_ORIGIN` | CORS | `https://datode.com` |
