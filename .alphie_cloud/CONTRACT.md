# 你在执行一份目标合同

你在一个隔离的 git 工作区里独立完成一个开发目标。没有人在线陪你，平台只做三件事：
在你每次交回后跑验收命令、请一位独立审查员看 diff、把结果原样交还给你。

规矩：
- **「完成」由平台判定，不由你判定。** 验收命令全部退出码 0，且独立审查员认可，才算完成。你自己也要跑验收命令，但你说「过了」不算数。
- **受保护路径不得修改**，也不得新增同类文件绕过（例如新写一个测试替代被保护的测试）。平台会逐字节检查。
- **规格没写的实现选择（界面形态、默认值、布局、命名……）由你自己决定，不要停下来问。** 选一个合理的，做完，在最后回复的「决定」一节写清：选了什么、还考虑过哪些、为什么。人以后可以推翻。
- **只有这几种情况才停下来问人**：目标自相矛盾或做不到；必须修改受保护路径；需要外部资源、凭证、联网部署；会删除数据。停下时回复最后一行写 `ESCALATE: <一句话问题>`，别的情况一律不要写这一行 —— 没有要问的就整行都不要写，尤其不要写 `ESCALATE: 无`；问题有几个明确的答案可选时写在同一行：`ESCALATE: <问题> 选项：<答案一> | <答案二>`，平台会把选项做成按钮让人一键回答。
- **需要主聊天会话替你在它够得着、你够不着的地方（例如 prod）执行时**：把要跑的步骤写成手册放进 evidence 目录，约定一个输出文件（也在 evidence 目录里，主会话跑完往里写结果），然后这样停下：`ESCALATE: <一句话说要主会话做什么> [handoff runbook=<手册路径> output=<输出文件路径>]`（路径相对 evidence 目录）。不要自己写「已跑完 / 重新验收」这类选项：平台出交接卡、把手册交给主会话，输出文件写出来后自动叫你重新验收。
- 不要 git commit、不要 push、不要改 git 配置。平台每段结束自己存档。
- 每段验收除了合同命令，平台还会拿你这个分支相对分叉点的净改动跑一遍**仓库的 pre-commit 钩子**（合并时提交跑的同一份，例如界面提示中英闸）：它红了这一段就算没过，按它输出里给的出口修。
- **临时文件一律写 `$TMPDIR`**（平台已把它指到这个任务自己的临时目录，tempfile / pytest 的默认 basetemp / `mktemp` 都自动落在那里），**不要自己往 `/tmp` 写**。它在这次开跑结束时整个清掉：要跨开跑保留的东西放进 evidence 目录。
- **技术问题不要问人**（变基、合并冲突、某条测试算谁的、解释器 / 验收命令路径写错）：用户不是工程师，答不了。验收里挂的测试若在主线头上本来就挂，平台会自己判给主线、不挡你；验收命令本身写错了（例如裸 `python` 找不到），在交付里写明，由平台 / AI 改。只有产品取舍（要不要做、做成什么样）才 ESCALATE。
- 最后回复用中文，四节，标题固定写成 `## 做了什么` / `## 验收怎么证明的` / `## 决定` / `## 残留风险`。
  `## 决定` 一节每条一行、以 `- ` 开头，列出到目前为止**仍然有效的全部**决定（不只是这一段新做的）：选了什么、还考虑过什么、为什么。没有就写 `- （无）`。平台会把这一节原样拿给人看，人可以逐条推翻。

## 目标
贴纸站四单串行链的第 3 单。用户 10-29 把整个项目交给我们，不需要他中途确认。站点前端在本仓库 sticker/（GitHub Pages，https://datode.com/sticker/），已由 T2 做到「去支付」；本单写后端。

**开工先读** _dev/sticker/SPEC.md（尤其「给 T2 / T3 / T4 的补充要求」）、_dev/sticker/api_contract.md（T2 若改过，以仓库里的最新版为准）、sticker/pricing.json、T2 的 evidence/report.md。SPEC 与本合同冲突时以 SPEC 为准（硬约束除外）。

要做的（sticker-api/，Cloudflare Worker，普通 ES 模块 + fetch handler，**零 npm 依赖**，Node 22 里用 node --test 直接测）：
1. 按 api_contract.md 实现全部端点（至少：风格化、创建 checkout、Stripe webhook、查订单状态）。
2. 风格化：提供方适配层，默认 mock（未配置 key 时自动用）；真提供方按 SPEC 选的那家写适配器，只用假传输测。限制图片大小、按 IP 限流（防别人拿我们的 AI 额度白嫖）、按 SPEC 做内容审核钩子。
3. 创建 checkout：用 Stripe REST API（fetch，不用 SDK）创建 Checkout Session；**金额全部按 sticker/pricing.json 在服务端重算**（打包时导入同一份文件，不要拷第二份），忽略请求里的任何价格字段；收货地址和邮箱由 Stripe 收。设计图存 R2（或 SPEC 选的存储），订单先记为 pending。
4. webhook：用 WebCrypto HMAC-SHA256 自己校验 Stripe-Signature（常量时间比较 + 时间戳容差防重放），同一事件重复投递只处理一次；checkout.session.completed → 订单记为 paid、生成打印文件（按 SPEC 的 300dpi + 切割线方案；Worker 里做不了的部分写清楚放在哪一步）、给店主发通知（邮件提供方同样走适配层 + mock）。
5. CORS 只允许 https://datode.com 和本地开发源；所有错误按契约返回，不泄露内部信息。
6. sticker-api/wrangler.toml：绑定和密钥只写占位名（STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / AI 提供方 key 等用 wrangler secret）；sticker-api/README.md 写部署步骤。
7. sticker-api/dev/server.mjs：零依赖的本地运行器（Node http 包一层，内存版 KV/R2，Stripe 走 fake 模式：创建 checkout 返回本地成功地址并用同一个假 webhook secret 给自己发一个签好名的 completed 事件），供 T4 做端到端。
8. 测试 sticker-api/test/*.test.mjs（node --test），至少覆盖：签名错 / 过期 / 缺失都拒、正确签名通过；重复事件幂等；请求里篡改价格无效、服务端金额等于按 pricing.json 算的值（期望值从文件现算，不写死）；非法规格 / 数量拒；CORS 拒外源；限流；没 key 时走 mock。evidence/report.md 附至少 5 个变异探针（关掉签名校验 / 改成信任前端价格 / 去掉幂等 / 放开 CORS / 去掉时间戳容差 → 对应测试转红）。

硬约束（T1–T4 共同）：不注册任何账号、不花钱、不部署、仓库里不写任何密钥（测试里的假 secret 用明显是假的字符串，不要长得像 sk_test_ / whsec_ 真格式）；本单只动 sticker-api/、_dev/sticker/（必要时改 api_contract.md 并在报告写明），不动 sticker/ 前端和个人站其他页面。注意 sticker-api/ 会被 GitHub Pages 公开，源码里不能有任何不该公开的东西。

以下决定不得推翻：T1 SPEC 的定价、存储选型和 API 契约；服务端重算价格；前端留在 GitHub Pages。

用户怎么判断做完了：主会话拿到他的 Stripe key 后，照 README 一条命令部署就能收真钱，而且没人能改价、伪造付款通知或白嫖 AI 额度。

（重派补充，10-29）原单 ct_73cee0f9 因链上 T1 合并卡住而重派，合同以上原文不变。

## 验收命令（平台会在你交回后自己跑）
- `node --test sticker-api/test/*.test.mjs`
- `test "$(node --test sticker-api/test/*.test.mjs 2>&1 | sed -n 's/^# pass //p')" -ge 15`
- `test -s sticker-api/wrangler.toml`
- `test -s sticker-api/dev/server.mjs`
- `! git diff $(git merge-base main HEAD) HEAD | grep -qE '(sk|rk|pk)_(live|test)_[0-9A-Za-z]{8,}|whsec_[0-9A-Za-z]{8,}'`
- `git diff --quiet $(git merge-base main HEAD) HEAD -- index.html js css rapstar stock media _weibo weibo.md baibian.md sticker/index.html`
- `test -s evidence/report.md`

## 受保护路径
- `index.html`
- `js/`
- `css/`
- `rapstar/`
- `stock/`
- `media/`
- `_weibo/`
- `weibo.md`
- `baibian.md`
- `sticker/index.html`

## 验收命令判不了、由独立审查员判的条款
1) 签名校验正确（常量时间、时间戳容差、支持多个 v1 签名），对照 Stripe 官方文档抽查。2) 金额只来自 pricing.json，没有第二份价格表。3) webhook 幂等。4) 限流和大小限制真的挡住白嫖。5) CORS 不是 *。6) 源码与 wrangler.toml 无密钥。7) 变异探针真实可复现。8) dev/server.mjs 跑的是同一个 handler，不是另写一套。

## 云端容器里的验证手段
- 你在一个云端容器里：能装依赖、能跑测试；装没装浏览器、能不能截图要自己试，试不成就在报告里写明。
- 验收命令会在用户的机器上重跑，**以那边的结果为准**。云端能跑就跑；跑不了的写明哪条没跑、为什么。

## 云端附录（你在云端执行这份合同，这一节的规矩优先于上面的同类条款）

- **你在云端容器里**：没有用户机器上的路径、数据库、数据，也碰不到任何线上环境。不要 ssh、不要部署、不要尝试读或打印任何令牌和凭证的值。仓库里 CLAUDE.md 等文件若写着某台机器 / 线上环境的规矩，那些动作一律不做。
- **分支纪律（上面那条「不要 git commit、不要 push」在云端不适用）**：从当前分支开出 `claude/ct_04947df2`，自己提交、自己推送，**只推这一个分支**；不改 main、不 force、不开 PR、不动别的分支。
- **有问题不能问，只能写进报告**：没有人在会话里。遇到合同规定的停下来问人的情况，把 `status: escalated` 写进报告头部、正文最后一行写 `ESCALATE: <一句话问题>`，推送，然后结束。
- **交付 = 最后一次推送**。那次推送里必须有 `.alphie_cloud/REPORT.md`：
  - 头部固定几行（各占一行，顶格）：`run-id: r1-781c42c5`、`status: done`（做不成写 `failed`，要问人写 `escalated`）、`expected-paths:`（下面一行一个你实际改动的仓库相对路径）。
  - 空一行之后是正文，四节，标题固定写成 `## 做了什么` / `## 验收怎么证明的` / `## 决定` / `## 残留风险`。
  - 截图放 `.alphie_cloud/shots/`（png / jpg）。
- `.alphie_cloud/` 是平台和你之间的信封：除了上面说的报告和截图，不要往里放别的；也不要删 `.alphie_cloud/CONTRACT.md`。
- 本轮编号是 `r1-781c42c5`：报告里的 run-id 必须逐字等于它，平台只认这一个。

开始。
