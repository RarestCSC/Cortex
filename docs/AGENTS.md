# Cortex AI 开发规则（行为准则）

> 基于全部历史文档提炼的**不可触碰底线**与代码规范。每次会话开始时必须遵守。
> 最后更新：2026-10-17（经 `AUDIT-REPORT.md` 交叉审计修订）

---

## 1. 不可触碰的硬边界（红线）

### 1.1 真实配置目录
- **绝不触碰** 真实 `~/.config/cortex` 与 `~/.config/goose`
- 所有测试/验证必须用 `export GOOSE_PATH_ROOT=/tmp/opencode/<your-dir>`，配置在 `<root>/config`（不是 root 本身）
- `GOOSE_PATH_ROOT` 必须是**绝对路径**，非绝对无效
- 真实 `~/.config/goose` 的 mtime/ctime 必须保持 `2026-10-09 17:56:19.234001826 +0800`；变化立即停止报告，不得改回
  - **[需人工确认]**：`FIX-yi` §7.8 记录实测为 `2026-10-16 15:33:19.319533114 +0800`（`~/.config/cortex` 为 `2026-10-16 15:41:44.329279483`），判定为**用户手工改配置**所致、非构建回归；硬边界基线是否修订待确认
  - ⚠️ 归档的 `AUDIT-2026-10-17.md` **没有 §7.8**（该文止于 §8，§7 无子节）。此处出处是 `FIX-yi-reasoning-effort-honesty.md` §7.8，勿再误引为「审计 §7.8」

### 1.2 真实模型请求
- **验收/验证会话全程不发任何真实模型请求**
- ⚠️ **唯一已记录的例外**：`TASK` D10-a / `SUMMARY` §7.5 —— 2026-10-17 主会话为定一个决策**直接打了真 free-lane（`127.0.0.1:8787`）共 5 次**（`low`/`medium`/`max`/`xhigh`/`minimal` 各一次 + 乱值 `banana` 一次返 400）。实测表见 `docs/archive/SUMMARY-custom-provider-capability-pipeline.md` §7.5。**引用「全程未发真实请求」时必须带上这个例外**，否则与 `SUMMARY` §10 自相矛盾
- 出站请求体用 `/tmp` 下自建的严格假端点验证（Python 标准库 `ThreadingHTTPServer`，只落盘请求体并回固定 OK）
- **刻意避开用户环境里两个真实网关端口**：`127.0.0.1:7863`（WorkBuddy）、`127.0.0.1:8787`（free-lane）
- 假端点端口用 7865/7866/7911 等
  - `FIX-bing` §8.3：7865 = **声明型**网关形状（workbuddy2api，能力字段齐全）；7866 = **沉默型**（free-lane，只有 5 个字段）
- 用户环境里 `cn:space-bunny` 默认跑 `max` 思考、倍率 x0.08 —— **不要为了验证去打它**

### 1.3 凭据
- **不读取/打印/复制真实配置或凭据内容**
- `WB2A_API_KEY` 等从 `systemctl --user show-environment` 取值后直接注入子进程环境，输出只报长度（28），值一次也不进输出或日志
- 钥匙串服务名 `cortex`、用户名 `secrets`；`secrets.yaml` 不存在（仅 `.lock`）= 未降级
- 钥匙串不可用时降级写明文，按 `crates/cortex/src/config/base.rs` 的错误特征判定；落盘路径 `~/.local/share/keyrings/login.keyring`

### 1.4 环境变量兼容性
- **`GOOSE_*` 环境变量全部不改**（对外 API，约 900 处）：`GOOSE_PATH_ROOT`、`GOOSE_THINKING_EFFORT`、`GOOSE_DISABLE_KEYRING` 等
- 协议 DTO 保留 `GooseExtension` 等前缀（ACP schema 生成，改名即改 wire 契约）
- 配置键保留 `goose_mode`/`goose_model` 等前缀（wire 契约）
- `KEYRING_SERVICE="cortex"`、`KEYRING_USERNAME="secrets"`

### 1.5 Git 操作
- **本仓库当前处于改名未提交状态，不要用 `git stash` 做局部回退**——会把文件整个撤走并留下 unmerged 索引项
- 不 reset、不覆盖、不提交、不推送，保留全部改动
- 当前分支 `composer-ui-refactor`、HEAD `3bd8520`（`refactor-plan.md` §0）
- 旧回退目录 `/home/rarestcsc/Goose_test/goose` 的**源码（651M）与 `.git` 仍在**，是可回退副本；构建产物已清（回收 11.9G）

---

## 2. 架构级设计决定（防回归，不可违反）

### 2.1 思考强度判定
- **`ModelConfig::sends_thinking_effort()` 是菜单与出站的单一真理**
- `is_reasoning_model()` 与 `openai_reasoning_for_model()` 语义**一字未动**，各管各的：
  - `is_reasoning_model()` = 「这个模型会不会推理」（模型属性）
  - `openai_reasoning_for_model()` = 「按 OpenAI 契约算不算 OpenAI 推理模型」（请求形状）
- **不要再去改这两个函数**，B2 端点声明应喂 `sends_thinking_effort()` 使其自然为真
  - 理由（`FIX-yi` §8.1）：`is_reasoning_model()` 有 **10 个生产调用点**，其中 `providers.rs:1256/1278` 答的是「模型会不会推理」而非档位菜单 ⇒ 改它的爆炸半径远大于收益
- ⚠️ **双名分叉隐患**（`FIX-yi` §7.5）：`create_request_for_model_with_options` 的 `capability_model_name` **允许与 `model_config.model_name` 不同**（`openai_compatible::stream_for_model`、databricks 路由、`providers/bedrock.rs`）。effort 闸门用 `model_config.model_name`，`openai_reasoning_for_model()` 查 catalog 用传入名。现有调用方都传同一名字，**未观察到差异**；若日后出现真正传不同能力名的 provider，**需重新评估**

### 2.2 用户声明注入
- **注入点必须在 canonical 回填之前**（`with_canonical_limits` 只在 `None` 时回填，顺序反了用户声明被盖回）
- **`ModelInfo.reasoning` 是非 Option `bool` ⇒ 只发布 `true`**；`false` 视为「没说」让启发式/G1 作答
  - `FIX-bing` §3.2 第 4 行补充：**非 `custom_*` 的内置声明式定义连 `true` 都不注入**（内置定义里的 `reasoning` 只是对目录已知模型的粗略提示，目录信息更全，让它继续作目录的最后一搏）
- **误伤方向刻意**：多发 effort 代价可自愈（被拒→降级→落盘），少发代价不可自愈（模型真在思考但开关不掉）

### 2.3 权威值契约
- **入参侧的值是权威的，不做兜底继承**
- `supports_vision`/`reasoning` 同理：`update_custom_provider` 不再把已存值兜底填回传入模型
- 唯一生产调用方已全量预置（`crates/cortex/src/acp/server/providers.rs:394`），安全。另 3 个调用方（`declarative_providers.rs` 与 `agents/agent.rs`）全在 `#[cfg(test)]` 内（`FIX-jia` §7.1）
- **若日后出现新的部分模型调用方，应改为在 DTO 上加显式 `reset_*: Vec<String>` 字段**，不依赖隐含前提

### 2.4 Off 兜底原则
- **没有证据时发明档位是错的**
- `openai_reasoning_effort_for_endpoint` 内 `accepts` 闭包的 `(None, None)` 分支（`formats/openai.rs:2039`）改为「只认本档自己的词」：`Off` 无词故不发字段，`Max` 发 `max`
- 端点声明了但不含某档时用**它声明过的**词兜底，不越界发明
- **但「目录有词表但无『关』的词」时 `Off` 仍会落到 `low`**——属产品决策非机械修复，[需人工确认]
- 每次降级都是「剥掉 → 重试一次 → 落盘」，**没有第二次降级**：图像剥掉后再拒 effort 是两种能力的问题，一次请求只处理一个

### 2.5 三态可逆
- **必须区分「无条目=不碰」与「有条目为 null=显式清除」**
- 用 `HashMap::get` 返回的 `Option<&Dto>` 承担区分，不新增字段、不改 DTO 类型
- ACP schema 没变 ⇒ `just generate-acp-types` 不需要重跑

### 2.6 能力缓存
- 落点 `<配置目录>/model_capabilities.json`，键 = `base_url` FNV-1a-64 哈希 + 模型名
- **用 FNV-1a 而非 `DefaultHasher`**：后者跨 Rust 版本不保证稳定
- **键的精确算法**（`FIX-bing` §4.2，后续维护必踩）：
  - `base_url` 用 **host + 请求路径**（`api_client.host()` 与 `base_path` 拼成 `…/v1/chat/completions`），**不是用户填的 `api_url`** —— 同一家网关两个配置项指向同一端点时**必须共享结论**，而 `api_url` 的显示形态（带不带 `/v1`）**不该影响**
  - **末尾斜杠归一化**（`http://a/v1` 与 `http://a/v1/` 是同一把键）
  - **三级粒度不同**：`supports_responses_api` 按**端点**存（与模型无关）；`supports_vision` / `supports_thinking_effort` 按 `base_url + 模型` 存
- `version` 字段读到不认识的值**当空缓存**，不把来历不明的结构解释成结论
- **只在探测得出结论的那一刻写**，整文件读-改-写（进程内 `Mutex` 后面）
- **默认关闭**（`capability_cache: None`），只有生产路径经 `crates/cortex/src/providers/openai_def.rs` 注入
- 所有 I/O 失败静默吞掉：缓存未命中最坏多一次被拒请求
- **声明过的能力根本不会走到探测**（护栏 `vision_was_guessed` / `effort_was_guessed`），改 JSON 立刻生效不受缓存影响
- TTL 30 天（`checked_at` 逐条记录）；结论全是**否定**的；过期后重新乐观一次，代价是**每 30 天一次错误请求（不计费）**

### 2.7 Responses API 路由
- `should_use_responses_api` 判定应考虑「端点是否支持 Responses API」，不只模型名
- 判据从探测缓存初始化（跨进程存活），首次 `/v1/responses` 404 时标记+回落 chat
- **两张 provider 白名单都在模型名之前返回 false**，均保留未动（`BUG-REPORT-developer-role-rejected.md` §2 / `audit.md` §4.11）：
  - `PROVIDERS_NEEDING_STANDARD_CHAT_PARAMS = &["nearai", "pleumrouter"]`（`cortex-providers/src/openai.rs`）
  - `PROVIDERS_NEEDING_REASONING_EFFORT_MAPPING = &["meta"]`（同文件）
- ⚠️ `should_use_responses_api` **没有任何配置开关**（自定义 provider 的 `base_path` 只能显式写 `v1/responses` 或 `v1/chat/completions`，没有「不路由」的中间态）⇒ **探测缓存是唯一的免问途径**
- Responses 路径首个请求带 `reasoning.effort = "none"` 是**该路径的既有行为**（纯 `gpt-5.4` 完全相同），不是 realm 前缀修复引入的

### 2.8 部署前要知道的行为变更（`FIX-bing` §9.3）

升级到含本轮改动的版本时，用户会观察到：

| # | 变更 | 影响面 |
|---|------|--------|
| 1 | `custom_*` 供应商 JSON 里写 `"reasoning": true` 就**开始收** `reasoning_effort` | 所有 `engine: openai` 自定义供应商 |
| 2 | `supports_vision == None` 时开始**乐观发图** | 所有 `engine: openai` 自定义供应商 |
| 3 | realm 前缀模型**第一次请求多一次 404**（之后回落 chat 并记住） | `cn:*` / `global:*` 模型 |
| 4 | **每个声明式 provider 实例多一次 `GET /v1/models`**（5 秒超时，失败静默） | 只对声明式供应商；内置供应商模型目录本就有，不发 |
| 5 | 端点级能力 400 **不再重试 3 次** | 此前「4 个请求里 3 个是白费的」 |

---

## 3. 代码规范

### 3.1 Rust
- **构建不可中断**：v8 build script 先删 `release/gn_out/` 再重下 169MB `.a`，中断=永久丢失
  - 失败特征（判断「这是我踩的还是别人的」）：`URLError: [Errno 111] Connection refused` + `v8-goose-*/build.rs:669` 的 `assertion failed`，**与代码无关**
  - ⚠️ 失败特征里的 `v8-goose-*` 说明 v8 的 build.rs 文件名里还留着 `goose`，是一条未清理的改名遗留
- **Rust 改动要批量**：改一个字符串触发 release 增量 12m39s（级联 cortex→cortex-mcp→cortex-cli＋链接 290MB）。同一会话内批量改完再编译
- **未收到完成结果前不要重复启动构建或打包，更不可终止现有 Rust 进程**
- 只动叶 crate 时优先 `cargo test -p <crate>`，避免触发 cortex-cli 的 290MB 链接
- 错误用 `anyhow::Result`，不加无信息错误上下文
- 测试优先放 crate 内（`crates/cortex/tests/`）
- **日志可诊断性**：`cortexServe.ts` 的 `onStderrData` 必须把 `warn!`/`error!` 级后端日志也落盘（`isBackendDiagnostic` → `logger.warn`），**不能只落 `isFatalError`（`panicked at`/`RUST_BACKTRACE`/`fatal error`）**。原实现丢弃全部 `warn!`，导致会话命名根因查了两轮
- 日志：清理已有 logs，只在错误或安全事件时添加新日志
- 注释只写「为什么」而非「什么」，禁止复述代码

### 3.2 TypeScript/UI
- 使用 ACP SDK types 或本地 `src/types/*` 类型；**禁止** import ACP schema 自动生成的类型去手写请求体
- **禁止在 `ui/desktop` 引入 `@hey-api/openapi-ts`**；`ui/acp-client` 保留它作为 schema→TS 生成器（`devDependencies`），生成物在 `ui/acp-client/src/generated/`（与 `crates/cortex/acp-schema.json` 逐字节一致）
  - ⚠️ 归档文档里出现过的 `ui/desktop/src/api` 路径在**工作区、git HEAD、全部归档文档中均不存在**，勿再引用
- **i18n 基线**：当前 **1683 messages / 16 语言**。改文案必须 `i18n:extract` 生成 en（**不手插键顺序**）→ 同步其余 15 语言 → compile → `i18n:check`
- i18n 零新增键为默认要求（若确实需要，16 语言×N 键的人工翻译成本要单独评估并先问用户）
- **Tailwind 类必须用已注册 token**，禁止自造 camelCase 类（`surfaceHover`/`textStandard`/`textSubtle` 之类一律不生成 CSS）
  - 已注册范围（`ui/desktop/src/styles/main.css`）：四族语义 token `--color-background-*`/`--color-text-*`/`--color-border-*`/`--color-ring-*`（:64-110），加 `--color-ring`（:167）、`--color-sidebar-*`（:168-171），以及原语 `--color-neutral-*`/`red`/`blue`/`green`/`yellow`（:33-55）
- 优先用工作区二进制跑 typecheck：`node ui/node_modules/typescript/bin/tsc --noEmit`（避免触发 pnpm 依赖同步）
- ⚠️ **DOM 陷阱**：按钮组不能用嵌套 `<button>`（非法且点击会冒泡触发父级折叠）；组头折叠要用 `div` 包住折叠 toggle 与 `+` 两个**兄弟** button

### 3.3 测试
- **验收必须带全 feature**：`scheduler,acp-http,tree-sitter,code-mode`（`analyze` 扩展挂 `tree-sitter`）
- **必须跑集成测试**（`--test`），不能只跑 `--lib`——三轮只跑 `--lib` 导致陈旧断言存活
- ⚠️ **测试失败必须回旧仓库跑同一用例确认是否既有，不能默认归因本次改动**
- ⚠️ **验证清单必须覆盖改动所在目录**：`settings/models` 长期不在清单里，导致 `ComposerModelPopover.test.tsx` 的过期断言（210px vs `maxHeight` 520px）存活到今天
- ⚠️ **vitest 慢用例**：默认 5s 预算会把 ~4.4~5.0s 的用例顶成假失败（**不是断言失败**）。定点跑 UI 测试带 `--testTimeout=15000`（或 `30000`）
- 技能类测试要么隔离 `HOME` 要么别依赖 builtin 的存在（`GOOSE_PATH_ROOT` 不隔离 `~/.agents/skills`；`crates/cortex/src/skills/mod.rs:401` 用 `dirs::home_dir()`，去重逻辑在 `discover_skills` 的 `seen`）
- 假端点用 Python 标准库 `ThreadingHTTPServer`，不转发任何请求，只落盘请求体
- 新增测试要验证「不打补丁就会红」（临时还原旧行为确认失败）
- ⚠️ **dev 态验收取证方法**：dev 态经 `GOOSE_PATH_ROOT` 隔离根运行，**不写真实 `~/.config/cortex`** ⇒ 真实配置目录的时间戳变化只能来自正式版，可用文件时间戳证明隔离合规

### 3.4 验证命令与结果隔离
```bash
export GOOSE_DISABLE_KEYRING=1
export GOOSE_PATH_ROOT=/tmp/opencode/<your-dir>
```
- `cargo clippy --all-targets -- -D warnings` 在本分支跑不通（feature 门控 + 改名遗留），可行写法：`-p <crate>` 分开 + `--features scheduler,acp-http` + `-A dead_code`
  - 时间线：`refactor-plan.md` §4④（2026-10-15）曾全绿（`CLIPPY_EXIT=0`，6m58s）；2026-10-17 又跑不通 ⇒ 状态反转源自改名引入的 feature 门控，**以当前实测为准**
- UI 全量 `pnpm run test` 是 992 passed / 21 failed / 8 skipped（App/Hub 夹具问题、CustomProviderForm 超时），非全绿
- ⚠️ **Vite 生产构建会 mangle 标识符**，grep 压缩后的 asar 找组件名不可靠（`StartupSplash` 在生产包中 0 命中）；判二进制是否过期要用 `find crates -name '*.rs' -newer <bin>`

### 3.5 不可过度宣称（`refactor-plan.md` §2 / `audit.md` §2）

以下能力**未经实测**或**仅有弱证据**，不得因类型检查或 happy-path 测试宣称闭合：

| 类别 | 未验证项 |
|------|---------|
| 协议/网络 | 真实 HTTP reasoning/wire 抓包（**从未做过**）；真实凭据下的 provider 与任务 |
| 平台 | macOS Dock 与跨平台原生窗口；`app.setName` 的平台级呈现 |
| 会话状态机 | **完整断线/超时 uncertain 恢复、连接 generation、默认哨兵实际 provider 回读、跨窗口一致性、未保存管理表单放弃确认** |
| UI | `ChatInput.layout.test.ts` **仅 AST 结构契约**、`NavigationPanel.test.tsx` 为 **mock 渲染** —— **测试或标签变化不证明真实 wire** |
| 其它 | 外部 MCP 服务器实际拉起；图像/语音/dictation；长时间稳定性与断线恢复；rpm/flatpak 打包；install 版的真实端点结论 |

> 原则：**mock 通过不证明竞态闭合**；**「尚需授权后专门核查」的项不得顺手扩张**；需要此类任务时定点审源码与用例，不自动扩大范围。

---

## 4. 协议与 wire 契约（不可随意改）

| 保留前缀 | 原因 |
|----------|------|
| `GOOSE_*` 环境变量 | 对外 API，约 900 处 |
| `GooseExtension` 等 ACP DTO | ACP schema → `ui/acp-client` 链式生成，改名即改 wire 契约 |
| `goose_mode`/`goose_model` 配置键 | wire 契约 |
| 默认 provider 哨兵 ID `"goose"` | 兼容标识（`crates/cortex/src/acp/server.rs:217 DEFAULT_PROVIDER_ID`） |
| meta key `"goose"`（ACP meta） | 活契约（20+ 处生产代码） |
| `GOOSE_MOIM_MESSAGE_TEXT/FILE` | 环境变量名，兼容已有用户（`crates/cortex/src/agents/platform_extensions/mod.rs:194`） |
| `APP_STRATEGY.app_name="goose"`（cortex-mcp） | 兼容已有用户 config/data 目录（`crates/cortex-mcp/src/lib.rs:14-18`） |
| `server_info.name="goose-memory"`（memory） | 同类（`crates/cortex-mcp/src/memory/mod.rs:515`） |

> **协议 DTO 改语义需重跑 `just generate-acp-types`（一次跑完 schema + TS 两步）**——本轮所有交付均未改 DTO 故未跑

---

## 5. 文件所有权（改前先确认）

| 文件 | 所有者 | 备注 |
|------|--------|------|
| `crates/cortex-provider-types/src/formats/openai.rs` | 乙 → 审计 | 出站闸门、词表映射 |
| `crates/cortex-provider-types/src/model.rs` | 乙 → 丙 | `sends_thinking_effort()` 等 |
| `crates/cortex-provider-types/src/base.rs` | 丙 | `ModelInfo`（不需要改） |
| `crates/cortex-provider-types/src/retry.rs` | 丙 | 能力 400 不重试（`TASK` Write Scope 曾漏列） |
| `crates/cortex-providers/src/declarative.rs` | 甲 | C5 已修（`null_to_empty` 在此文件） |
| `crates/cortex-providers/src/openai.rs` | 丙 | B2/B4/G1 |
| `crates/cortex/src/model_config.rs` | 丙 | B1 注入点 |
| `crates/cortex/src/acp/response_builder.rs` | 乙 → 丙 | 菜单动态档位 |
| `crates/cortex/src/acp/server/providers.rs` | 甲 | C4 已修 |
| `crates/cortex/src/config/declarative_providers.rs` | 甲 → 丙 | 权威值契约 |
| `crates/cortex-sdk-types/src/custom_requests.rs` | 甲 | DTO 未变 |
| `ui/desktop/**` | 甲 → 丙（仅 CustomProviderForm） | |
| ACP schema + `ui/acp-client/src/generated/` | 甲 | 未变 |
| `crates/cortex/tests/acp_fixtures/**` | 审计已修 `:366` | 其余勿动 |

> ⚠️ **不存在的文件**：`crates/cortex-provider-types/src/declarative.rs` **没有这个文件**（`BUG-REPORT-custom-provider-null-api-key-env.md` §3/§7 与 `TASK` 甲的 Write Scope 曾误写，`FIX-jia` §9 已勘误）。`ModelInfo` 在 `crates/cortex-provider-types/src/base.rs`，`DeclarativeProviderConfig` 在 `crates/cortex-providers/src/declarative.rs`

> 任一会话发现自己在写非自己所有的文件 → **立即停止该文件写入**，标记 `SHARED_FILE_CONFLICT` 交回主会话

---

## 6. 已知陷阱速查

| 陷阱 | 症状 | 规避 |
|------|------|------|
| `git stash` 局部回退 | 文件整个撤走、unmerged 索引 | 本仓库改名未提交状态禁用 |
| 只跑 `--lib` 不跑 `--test` | 陈旧的集成断言存活 | 带全 feature 且跑集成测试 |
| 改一行编一次 Rust | 12m39s/次 | 批量改完再编译 |
| 发真实模型请求 | 触碰用户网关 | 只用 `/tmp` 严格假端点 |
| 用未注册 Tailwind 类 | 样式静默失效 | 只用已注册 token，跑 `scan-dead-classes.py` |
| `DefaultHasher` 做缓存键 | 跨 Rust 版本不稳定 | 用 FNV-1a |
| 缓存键用用户填的 `api_url` | 同一端点两份配置不共享结论 | 用 host + 请求路径 |
| 在 `(None, None)` 分支发明档位 | Off 发 low、Max 发 high | 只认本档自己的词 |
| 注入点在 canonical 之后 | 用户声明被盖回 | 必须在 `apply_canonical_limits` 之前 |
| `useEffect([initialData])` 对象身份 | re-render 抹掉用户状态 | 用稳定身份键（`initialDataIdentity`） |
| 覆盖 `.or()` 兜底不区分 null | 三态只有两态能用 | `match get()` 区分「无条目」与「有条目为 null」 |
| 改 `Option<String>` 类型 | 跨 crate 改动面大 | 用 `deserialize_with` 保持 `String` |
| 死类不报错 | 界面朴素但说不清 | 接入 CI 守卫 |
| 裁掉 `acp-http` feature | `cortex serve` 报 `unrecognized subcommand`，**GUI 静默失败** | 打包/裁剪时保留全部 feature |
| 不设 `ELECTRON_MIRROR` | 打包卡死在 `SHASUMS256.txt` | 打包前必设 |
| 加 `packagerConfig.ignore` | 覆盖 Vite 默认忽略，依赖解析失败 | 不要加 |
| 在 `~` 下用相对路径 `apt install ./x.deb` | `E: 命令行中有不支持的文件` | **是路径不存在**，不是包有问题 |
| GNOME 下 `Icon=cortex` 写相对名 | 被解析成 `ThemedIcon` 回退占位图 | 写**绝对路径** |
| 测试失败就归因本次改动 | 误报回归 | 回旧仓库跑同一用例确认 |
| 后端 `warn!` 不落盘 | 根因查不到 | `onStderrData` 必须落 `warn`/`error` |
| 嵌套 `<button>` | DOM 非法 + 点击冒泡误折叠父级 | 用 `div` 包兄弟 button |

---

## 7. 明确「勿改 / 勿追查」清单

| 项 | 说明 | 出处 |
|----|------|------|
| **托盘 GNOME 下不显示** | `Impossible to get basic properties: GDBus.Error`，Electron↔libayatana 属性读取失败，**Cortex 侧无可改之处** | `refactor-plan.md` §0.3 ④ |
| `config.yaml` 的 `active_provider=custom_lite-gpt` | 用户主动添加，**非残留，勿追查** | `refactor-plan.md` §0 |
| 「图形化配置」需求 | **已取消**，不要再提 | `refactor-plan.md` §0 |
| `session_naming` 3 例回归测试 | **补跑需单独授权**（release profile 有触发 v8 破坏性清理的风险） | `refactor-plan.md` §4 末条 |
| `nearai`/`pleumrouter` 兼容 shim | 保留未动，勿"顺手清理" | `audit.md` §4.11 |
| `strip_xml_tags` 的贪婪标签剥离 | 上游行为，改它有回归风险且**未被证明是本例成因** | `audit.md` §4.9 |

**未获批准勿做**：下一批 token 优化候选（chatrecall 逐条上限、image 缩放、缓存感知压缩）、rpm/flatpak 打包、删除旧仓库源码、自行开窗口、超出定点范围的全量 Rust 测试、真实端点验收（交用户，不自行发模型请求）。

---

## 8. [需人工确认] 的开放决策

1. **Off 语义**：目录有词表但无「关」的词时，`Off` 应发最轻档还是不发字段？
2. **`reasoning` 三态**：是否给 `ModelInfo` 加三态 enum 让 `false` 可表达？
3. **`model_capabilities.json` 位置**：配置目录是否合意？是否需 UI 清除入口？
4. **OpenCode 系根治**：`catalog_provider_id` 接入 canonical 需改 `name_builder.rs`（乙/丙文件），需 TASK 授权
5. **真实 `~/.config/goose` 时间戳**：硬边界记录（`2026-10-09 17:56:19`）是否修订为实测值（`2026-10-16 15:33:19`），还是清理现场恢复基线？出处是 `FIX-yi` §7.8（**不是** `AUDIT-2026-10-17` §7.8，该节不存在）
6. **`api_key_env` 坏文件容错**：方案 B/C（跳过+错误可见）是否立项
7. **G2 提示位置**：桌面端底栏（`ThinkingEffortControl.tsx`）是否也需要同一句可操作提示？（当前只在 ACP option description，出处 `FIX-bing` §9.1 / `AUDIT` §5-E #6）

---

## 9. 启动检查清单（每次会话前）

```bash
# 1. 环境隔离
export GOOSE_DISABLE_KEYRING=1
export GOOSE_PATH_ROOT=/tmp/opencode/<your-dir>

# 2. 确认真实配置未被触碰（任一文件不存在时 ls 会整体报错，故加 2>&1 || true）
ls -la ~/.config/cortex/config.yaml ~/.config/goose/config.yaml 2>&1 || true

# 3. 确认无残留进程占用假端点端口（7863/8787 应由用户自己的进程持有）
ss -tlnp | grep -E '7863|8787|7865|7866|7911'

# 4. 确认工作区状态与分支
git branch --show-current        # 期望 composer-ui-refactor
git rev-parse --short HEAD       # 期望 3bd8520
git status --short | head -20

# 5. 批量改完 Rust 后再编译（不要改一行编一次）
```

### 环境基线（不要重装、不要改动）
| 工具 | 版本 | 禁令 |
|------|------|------|
| Node | **v24.21.0** | 不要重装 |
| pnpm | **12.11.2** | 不要重装；`pnpm run typecheck` 会触发依赖同步，改用 `node ui/node_modules/typescript/bin/tsc` |
| Rust | **1.99.0**（`~/.cargo`，`rust-toolchain.toml`） | **不要 apt cargo 1.75、不要 source hermit** |

> 构建、打包、安装的完整 runbook 见 `docs/BUILD-RUNBOOK.md`。
