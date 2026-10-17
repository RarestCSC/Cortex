# Cortex 技术债清理清单

> 结合 `docs/archive/dead-classes-snapshot-2026-10-17.txt`、`BUG-REPORT-dead-tailwind-classes.md`、`AUDIT-2026-10-17.md`、各 FIX 交付文档汇总。
> 最后更新：**2026-10-17（经 `AUDIT-REPORT.md` 交叉审计修订）**

> ⚠️ 引用归档文档时注意：`AUDIT-2026-10-17.md` **没有 §9、也没有 §7.8**；§3.1 的出处是 `FIX-yi` §7.8、`FIX-bing` §9.1/§9.2。

---

## 1. 死 Tailwind 类（全仓库腐烂，P0）

### 1.1 现状
> ✅ **2026-10-17 第五轮已清理**：修正扫描口径后真实 **394 处 / 85 种 / 60 文件** → **0**。方案 A（`main.css` 别名）+ B（13 个业务文件定点替换）；本地门禁 `scripts/check-dead-classes.sh`（0 死类 exit 0，有死类 exit 1）+ GitHub Actions `.github/workflows/dead-classes.yml`（run `39031487176` success，`SCANNED_FILES=520 TOTAL=0`）。下方 511/119/71 为旧快照口径，仅作历史记录。

- **511 处 / 119 种 / 71 个文件** 确认使用了主题未注册的 token 类
- **Tailwind v4 不为未注册 token 生成任何 CSS** ⇒ 类名写在 DOM 上但无规则命中 ⇒ 元素默默用浏览器默认样式渲染
- **构建、typecheck、单测全通过，无任何报错** —— 这是腐烂扩散的根本原因

### 1.2 影响最重的死类（按「涉及文件数」降序，前 7 行严格符合，末尾 3 行按处数补齐）

| 死类 | 处数 | 涉及文件数 | 主要出现位置 |
|------|------|------------|-------------|
| `text-text-muted` | 66 | 20 | `GitBranchIndicator` / `TelemetryConsentPrompt` / onboarding 全家桶 |
| `border-border-subtle` | 38 | 12 | 全局卡片、输入框、recipes 共享组件 |
| `text-text-default` | 31 | 10 | onboarding 全家桶 |
| `text-textSubtle` | 26 | 9 | `ToolCallWithResponse` / recipes 共享组件 |
| `bg-background-default` | 12 | 8 | onboarding / recipes 共享组件 |
| `bg-background-muted` | 11 | 7 | onboarding / recipes 共享组件 |
| `text-iconStandard` | 8 | 6 | 设置各弹窗 |
| `text-text-standard` | 27 | 5 | — |
| `text-muted-foreground` | 15 | 4 | `MessageQueue` / `ToolApprovalButtons` / `RecipesView` / `tabs` |
| `border-border` | 10 | 4 | `ErrorBoundary` / `MessageQueue` / `ProviderCatalogPicker` / **`CustomProviderForm`** |

> 快照中另有这些种类未进上表（同类、需一并处理）：`border-borderSubtle`(9/4)、`text-destructive`(8/4)、`text-textStandard`(7/4)、`hover:text-destructive`(6/4)、`hover:text-text-default`(6/4)、`text-textProminent`(5/4)、`focus-visible:ring-border-active`(6/3)、`border-primary`(6/3)
>
> 完整清单见 `docs/archive/dead-classes-snapshot-2026-10-17.txt`（119 种全量，快照头 `SCANNED_FILES=520 TOTAL=511 KINDS=119 FILES_AFFECTED=71`）

### 1.3 已修复（全量）
- ✅ `CustomProviderForm.tsx`（用户报障的视觉三态开关）：**15 处选中态死类全部替换为已注册 token**，`tsc` 干净，4 条视觉单测全过。选中态改 `bg-background-tertiary font-medium text-text-primary`（与 hover 的 `bg-background-secondary` 明确区分，否则又变成「看不出变化」）。
- ✅ 第五轮方案 A+B 全仓库清理：真实 **394 处 / 85 种 / 60 文件 → 0**。
- 旧快照 `511 / 119 / 71` 含三类假阳性（透明度修饰符、`theme-tokens.ts` 对象键、复合 data 变体），**仅作历史记录**，不再作为当前待清数。

### 1.4 两条修法（择一或先 A 后 B）

> **已执行**：方案 A（`main.css` 注册别名）+ B（13 个业务文件定点替换）。以下保留为方案记录。

| 方案 | 优势 | 劣势/阻力 |
|------|------|-----------|
| **A：在 `main.css` `@theme inline` 补注册缺失 token 为别名** | 一次改动让 511 处全生效，不碰 71 个业务文件 | `ui/desktop/src/theme/theme-tokens.ts` 的 `Record<McpUiStyleVariableKey, string>`（`:22`）不接受非 SDK key，需扩类型或 `as` 绕过；且 119 种需逐一决定语义，有些是猜 |
| **B：把死类机械替换成已注册的 token** | 不碰主题，typecheck/vitest 能兜住风险，顺手收敛命名 | 71 文件 511 处需逐类人工确认映射（同一死类不同语境可能对应不同 token），建议分批 + 截图对比 |

**建议**：**先 A 后 B，或只做 A**。A 里凡能直接映射到现有四族的（如 `text-textSubtle` → `text-text-secondary`），在 `main.css` 注册成对应四族别名即可，不必新造语义值。
⚠️ 已注册范围不止四族：还有 `--color-ring`、`--color-sidebar-*` 以及 `neutral/red/blue/green/yellow` 原语（`main.css:33-55,167-171`），映射时别漏。

### 1.5 验收标准
1. `scripts/scan-dead-classes.py` 报 0 处
2. 视觉三态开关：初始态正确高亮、点击有可见变化、保存后重载仍正确
3. `tsc --noEmit` 干净、`pnpm run test` 不新增失败
4. **人工过一遍 onboarding 与设置页截图**——这类问题单测发现不了，只能看

### 1.6 CI 守卫（已接入）
```bash
cd ui/desktop && bash scripts/check-dead-classes.sh
```
- GitHub Actions：`.github/workflows/dead-classes.yml`（push/PR 到 `main` 自动跑）
- 第五轮 run `39031487176` 已绿，输出 `SCANNED_FILES=520 TOTAL=0 KINDS=0 FILES_AFFECTED=0`
> 本 bug 成因就是「写错了不报错」，没有守卫必然复发。

---

## 2. 死代码与废弃样式

### 2.1 改名遗留（goose → cortex）

**量化基线**（`refactor-plan.md` §0.1）：15 个 crate；`goose::`→`cortex::` **593 处**、`goose_xxx::` **776 处**，共 **276 文件**；i18n **432 键**改名、**1626 messages** 不变。

| 文件 | 遗留内容 | 状态 |
|------|----------|------|
| `crates/cortex-cli/src/logging.rs:55` | 断言日志路径含 `"goose"` 分量 | ✅ 已修（P1-8；`cortex-cli --lib` 353/0） |
| `crates/cortex/src/agents/platform_extensions/mod.rs:194` | 环境变量名 `GOOSE_MOIM_MESSAGE_TEXT/FILE` | 故意保留（兼容已有用户 config） |
| `crates/cortex-mcp/src/lib.rs:14-18` | `APP_STRATEGY.app_name="goose"` | 故意保留（Block/goose 兼容既有安装） |
| `crates/cortex-mcp/src/memory/mod.rs:515` | `server_info.name="goose-memory"` | 故意保留（同类） |
| v8 依赖的 `v8-goose-*/build.rs` | build script 文件名仍含 `goose` | ⏸ 未处理（构建失败特征字符串里可见） |

> **注意**：协议 DTO（`GooseExtension` 等）、配置键（`goose_mode`/`goose_model`）、环境变量（`GOOSE_*`）、默认 provider 哨兵（`acp/server.rs:217`）、ACP meta key `"goose"` 均**按契约保留**，不算技术债。
>
> **改名类工作的易漏点**：`pub use` / `pub use {裸模块名}` 里的 crate 名**不带 `::`**；`include_str!` / `include_dir!` 路径里的目录名也不被标识符规则捕获 —— **只有编译器才会暴露**（本次 4 处：`pub use goose_download_manager as download_manager`；`cortex-providers/src/lib.rs` 花括号内裸模块名 `goose_mode`；`include_str!("../goose_apps/clock.html")` ×2）。

### 2.2 废弃测试断言（陈旧预期 / flaky / 未运行）

| 测试 | 问题 | 修复方向 |
|------|------|----------|
| ✅ `declared_vision_registry::persisted_vision_declarations_control_registry_requests` | 断言 `requests.len()==1` 实得 2（GET + POST），多出的 GET 是 B2 既定行为 | **已修（P1-5）**：只数 POST，1 passed / 0 failed |
| ✅ `acp_custom_requests_test::test_custom_list_builtin_skill_sources` | 断言 `goose-doc-guide` 出现，但该技能被 `crates/cortex/src/skills/builtin.rs:9-13` 刻意过滤 | **已修（P1-6）**：改断言 `web-search` + 隔离 `HOME`，21/0 |
| ✅ `acp_server_test::test_new_session_uses_current_config_mode` | fixture 5s 预算没算 code-mode 运行时初始化 | **已修（P1-7）**：预算 5s → 30s，59/0（79s） |
| `sources::tests::list_sources_lists_builtin_skills_without_upstream_doc_guide` / `rejects_unsupported_source_type_for_mutation` | 两条都依赖内置 `web-search` 可见；开发者自装 `~/.agents/skills/web-search` 顶掉内置 | **测试侧已修**：两个用例加 `HOME` 隔离（`env_lock`），已验证 |
| `prompt_manager::test_all_platform_extensions` | 快照含 `apps`/`chatrecall`，基线 feature 集未开 `platform-apps`/`chat-recall` | **测试侧已修**：补 `platform-apps,chat-recall`（已验证）；`.snap.new` 已删 |
| `config::extensions::test_default_off_extension_disabled_when_config_empty` | 配置为空时 `chatrecall` 返回 `None`，因为 `chat-recall` 未开 | **测试侧已修**：补 `chat-recall`（已验证） |
| `chatgpt_codex::test_parse_jwt_claims_verified_with_issuer` | `jsonwebtoken` 无 CryptoProvider（`rust_crypto` / `aws_lc_rs` 都未开） | **测试侧已修**：补 `rustls-tls`（已验证） |
| `providers::gcpauth` ×3 | 同上，JWT 签发/刷新需要 CryptoProvider | **测试侧已修**：补 `rustls-tls`（已验证） |
| `ComposerModelPopover.test.tsx` | 断言面板高 210px（旧冻结高度行为） | jsdom 下 `maxHeight=520` 恒定，需更新断言。⚠️ **该测试长期未被执行，因为验证清单不含 `settings/models` 目录** |
| `providers::gemini_cli::tests::initial_prompt_is_sent_on_stdin` | 某一轮全量跑失败过一次，单独跑 4/4 通过 | **已知 flaky**（`spawn` 子进程、本机负载），非本次引入。勿误判为回归 |
| `CustomProviderForm.test.tsx` 的 `does not carry credentials…` / `clears secrets…` | 各耗时 ~4.4~5.0s，**默认 5s 预算顶掉**（非断言失败） | 给两个用例传 `15000`（或该文件设 `testTimeout`） |
| ✅ `session_naming` 的 3 例新回归测试 | 历史上因 `debug/` 目录消失未运行 | **已完成**：现有 debug lib 测试二进制定点跑 3/0（`test_collect_title_candidates_*`）；无需 release profile |
| `App.test.tsx` ×5 / `Hub.test.tsx` ×14 | mock 缺 `acpListRecentSessions` 导出 / 渲染 `Hub` 时缺 `<Router>` | 测试侧修复：补 mock 导出、包 `MemoryRouter` |

### 2.3 未清理的配置层与工作区技术债

| 事项 | 现状 | 风险 |
|------|------|------|
| `api_key_env: null` 仅解决这一种坏文件 | 真正语法错误的 JSON 依然拖垮整张注册表（方案 B/C 未做），且错误只在 `tracing::warn!` 里、**GUI 用户看不到** | 用户改错 JSON 导致所有自定义供应商消失，且无可见报错 |
| `GOOSE_PATH_ROOT` 不隔离 `~/.agents/skills` | 技能测试读开发者真实家目录 | 测试不可复现、CI 易误报 |
| 剥图占位文案约束 | 已诚实化为 `image input is turned off for this model`，但 **`openai.rs`/`openai_responses.rs`/`databricks.rs` 三处各一份且被测试断言** | 改文案漏改任一处即产生三处不一致（G2 因此把提示改走 ACP option description） |
| 工作区残留 | `crates/cortex/src/agents/snapshots/cortex__agents__prompt_manager__tests__all_platform_extensions.snap.new`（gitignore，来自 `prompt_manager` 快照测试运行） | 低；已定位为 feature 集不匹配，对齐 feature 后删除 |
| `cortex doctor` 端到端 | C5 的 `api_key_env` 修复**未跑 `cortex doctor` E2E**（需 cortex-cli 290MB 链接） | 注册表级测试覆盖同一段代码路径，风险低 |

---

## 3. 架构层遗留问题

### 3.1 冷启动不回填 `reasoning`（P0，✅ 已修）

> ⚠️ **与 `LESSONS.md` 的「冷启动时序缺陷（已修）」是两个不同的 bug**，勿混。

- **位置**：`crates/cortex-providers/src/openai.rs:344` `with_endpoint_capabilities()`
- **问题**：只折进 `endpoint_capabilities` 和默认档位，**不回填 `reasoning`**（已读码确认该函数体 `:344-369` 无 `reasoning` 写入），而闸门 `sends_thinking_effort()` 只看 `reasoning`
- **后果**：端点声明了词表但第一、二轮出站都无 `reasoning_effort`，「端点是唯一推理证据」的模型菜单 `[Off]`、出站无字段
- **为什么现有测试没发现**：丙的每个测试都预置了 `reasoning=Some(true)`（`reasoning_config()` 助手或 JSON 里 `"reasoning": true`）⇒ **这一类模型从来没被测过**
- **修法**：一行（镜像 `crates/cortex/src/model_config.rs:187-193` 的规则）
- **状态**：✅ 第五轮已修。`with_endpoint_capabilities` 现在回填 `reasoning`；新增 `a_cold_start_model_takes_its_effort_from_the_endpoint`；`cortex-providers --lib` 270/0；dev 二进制 + 假端点 e2e 主请求带 `reasoning_effort:"high"`

### 3.2 有词表但无「关」的词时 `Off` 的语义（✅ 已决策）
- **决策**（用户 2026-10-17）：不加 `default` 档；默认选 **Off（支持关闭时）**，否则选**最低档**。
- **实现**：`Off` 只在 `can_disable_thinking: true`、词表含 `none`/`off`，或端点完全沉默时出现；显式 Off 且无 off 词时**省略 `reasoning_effort`**，不再降级 `low`。
- **菜单**：按端点/canonical 实际词表渲染；`reasoning_effort` 单档固定；`only_reasoning` 且无 `can_disable_thinking` 时隐藏 Off。
- **不支持 Off 的模型**：菜单不出现 Off；遗留 `Off` 值按默认落到最低档。
- **影响家族**：GLM / kimi-k3 / gpt-5.6-astra。
- **状态**：代码已改，已验证。

### 3.3 探测缓存 400 措辞覆盖不全
- **现状**：G1 只匹配 `image/vision/image_url/multimodal` × 拒绝词、`reasoning_effort/reasoning.effort/thinking_effort` × 拒绝词
- **风险**：真实端点文案不在笛卡尔积里时退化成「错误上抛」（安全方向失败但打扰用户）
- **状态**：**P0-2 用户已验收视觉可用**（free-lane 接受图片 200）；未捕获真实 400 拒图原文。保持 fail-loud，后续有真实样本再扩词表

### 3.4 `reasoning: false` 无法表达
- **根因**：`ModelInfo.reasoning` 是非 Option `bool`，类型上不可区分「否」与「没说」
- **现状**：刻意只发布 `true`，用户想显式关掉被启发式识别的推理模型时无「关」表示
- **方向**：给 `ModelInfo` 加三态是产品决策，本轮未做

### 3.5 `catalog_provider_id` 接入 canonical（✅ Phase 1 已实现）
- **现状**：`catalog_provider_id` 现在作为可信 canonical 别名参与查找；`custom_lite-gpt` + `"openai"` 解析 `openai/gpt-6-luna`（1,050,000 context / 128,000 output）。
- **优先级**：端点 `/v1/models` 自己声明的 context/effort > 用户声明 > canonical 别名 > canonical 名字启发式 > 默认。
- **仍未做**：OpenCode 的 `oc-*` 名字本身仍没有 `oc-` 前缀规则；如果 relay 报 context（free-lane 报 262,144），端点值优先；如果 relay 沉默且没有别名，仍会掉默认/名字启发式。
- **风险**：别名填错会静默不命中；后续要补 miss 日志（Phase 1 未做）。
- **状态**：代码已改，**已验证**。

### 3.6 WorkBuddy Responses API 支持未知
- **风险**：A1 让 realm 前缀模型（`global:gpt-6-luna` / `global:gpt-5.6-terra` / `global:gpt-6-sol`）首次打 `/v1/responses`，B4 已降级为「首次 404 回落 chat 并记住」，但**首次仍会 404**
- **状态**：✅ 真机验收：`/v1/responses` → **404**，B4 回落 chat 并缓存 `supports_responses_api:false`。三个 `global:gpt-6-*` 被网关 **503 `personal_free_user`** 拦截；**代码侧闭合，模型可用性由账号决定（用户以后再弄）**

### 3.7 其余中转站 `/v1/models` 核查（部分完成）
- **已探**：`custom_lite-gpt`(vortexapi.xyz) —— 只有 `supported_endpoint_types`，无 context/effort；`gpt-6-luna`/`gpt-6.1-sol` 已在列。已通过 `catalog_provider_id: "openai"` 使用 canonical。
- **未探**：`custom_chatanywhere`、`custom_siliconflow`。
- **缓解**：G1 不依赖端点配合，风险已摊平（核查结果只影响「第一次是否浪费一次请求」，不影响功能）。
- **状态**：其余两家仍需 API key。

### 3.8 `vision` 能力真机确认（✅ 已验）
- **现状**：后端早已具备乐观发图（`vision_support()` 结尾 `.known.or(Some(true))`，`build_chat_payload` 显式传入，不会退化成 `unwrap_or_default()` 的「图片变占位文本」），前端也不按视觉能力禁用附件
- **刻意未做**：**不往 `custom_cortex-free-opencode.json` 写 `supports_vision`** —— 会把未经真机确认的声明变权威值，反而**关掉 G1 自愈降级**
- **状态**：✅ 第五轮已验。GUI 经 Cortex 向 free-lane 发图成功（模型回复 "Blank"），`llm_request.0/1.jsonl` 含 `image_url`，网关接受（200），无需降级。用户确认视觉可用，后续出问题再处理

---

## 4. 测试基线修正（重要）

| 项目 | 原记录 | 第六轮验证 |
|------|--------|------------|
| `cortex --lib` 失败数 | 16 → 8 | **0**（新 feature 集 **2295/0**） |
| `cortex-provider-types` 测试数 | 669 | **682**（+12：context / 档位 / canonical 词表） |
| `cortex-providers` | 269 | **272**（+2：relay context 解析） |
| UI 全量测试 | 丙报「13 passed」 | **1013 passed / 0 failed / 8 skipped** |
| ACP 集成测试 | D6 阻塞全灭 | **11 个二进制 11/11 全绿**（全量重跑） |
| `cortex-cli --lib` | 未记录 | **353 passed / 0 failed / 1 ignored** |
| 死类扫描 | 511/119/71（含假阳性） | **394/85/60 → 0**（本地 + CI 双绿） |

> **教训**：三轮只跑 `--lib` 从没跑 `--test`，导致陈旧断言存活至今。验收必须带全 feature 且跑集成测试。
> ⚠️ **口径提醒**：`cortex --lib` 的 **2295** 只覆盖该 crate 的 lib 测试，不含 `cortex-cli --lib`（353/0）、UI vitest（1013/0/8）与 11 个 ACP 二进制；各层已分别全绿，不可相加成一个「全仓库通过率」。

---

## 5. 清理优先级建议

| 优先级 | 任务 | 预估工作量 | 备注 |
|--------|------|------------|------|
| ✅ P0 | 死 Tailwind 类全仓库清理（方案 A+B） | 已完成 | 394/85/60 → 0；本地 + CI 双绿 |
| ✅ P0 | 冷启动不回填 `reasoning` | 已完成 | 270/0；e2e 已验 |
| ✅ P0 | 真机验收 P0-1~P0-3 | 已关闭 | P0-1 环境阻断、P0-2 用户验收、P0-3 通过 |
| ✅ P1 | UI 21 个测试侧失败（App mock / Hub Router / 超时） | — | **已验证**：UI 1013/0/8 |
| **P1** | prompt 快照 feature 集对齐 + 删除 `.snap.new` | 0.1 天 | **已改，已验证** |
| **P1** | 其余 6 个 Rust 失败（gcpauth×3 / config::extensions / chatgpt_codex / sources×2） | 1-2 天 | **已改（feature 集 + HOME 隔离），已验证** |
| ✅ P1 | ACP 11 个二进制全量重跑 | — | **已验证**：11/11 全绿 |
| ✅ P1 | `catalog_provider_id` 接入 canonical（Phase 1，lite-gpt → openai） | — | 代码已改，已验证；OpenCode 的 `oc-` 名字规则仍未做 |
| ✅ P1 | 档位菜单 / Off 语义（Phase 2） | — | 已决策并实现：默认 Off/最低档；菜单按实际档位；已验证 |
| ✅ P1 | G2 提示位置决策（底栏是否也要） | — | **已完成**：底栏弹层显示 ACP option description（沉默型网关的可操作提示），零 schema/i18n 改动 |
| ✅ P1 | developer 角色修复的真机验收 | — | 暂缓（用户决定） |
| **P2** | `api_key_env` 坏文件跳过 + 错误可见化 | 1 天 | 方案 B/C |
| **P2** | 测试隔离漏洞修复（隔离 HOME） | 0.5 天 | 技能测试专用 |
| ✅ P2 | `session_naming` 3 例回归补跑 | — | **已完成**：debug lib 定点 3/0 |
| **P2** | `cargo clippy --all-targets` 跑通整理 | — | **基本已通**：新 feature 集下 `clippy --all-targets -D warnings` **exit 0**（2026-10-18 实测，仅修 1 处 bedrock 测试构造器缺新字段）。⚠️ 仅裸 `--features aws-providers` 单独跑仍有 24 个既有编译错误（缺 `scheduler` feature），与 clippy 无关 |
| **P2** | v8 build script 的 `v8-goose-*` 文件名改名 | 0.5 天 | 依赖上游，风险待评估 |
| ✅ P2 | token 优化第二批（chatrecall 逐条上限 / image 缩放 / 缓存感知压缩） | — | **已取消**（用户 2026-10-17 决定不做） |
| **暂缓** | Windows 构建 | 待定 | 用户要求等没大 bug 后再做 |

---

## 6. [需人工确认] 的决策项

1. ✅ **Off 语义（已决策 2026-10-17）**：默认选 Off（支持关闭时）或最低档；菜单只显示实际声明档位；无 off 词时显式 Off 省略字段；不支持 Off 的模型不显示 Off。
2. **`reasoning` 三态**：是否给 `ModelInfo.reasoning` 加 `Option<bool>` 或三态 enum，让用户能显式表达「不推理」？
3. **探测缓存位置**：✅ 已决策（2026-10-18）——位置不动，新增 `cortex capability-cache [--clear]` 查看/清除。
4. **G2 提示位置**：桌面端底栏（`ThinkingEffortControl.tsx`）是否也需要同一句可操作提示？
5. ✅ **真实 `~/.config/goose` 时间戳（已决策 2026-10-18）**：硬边界基线修订为实测值 `2026-10-16 15:33:19.316532991`（出处 `FIX-yi` §7.8），判定为用户手工改配置；不再作为回归信号基线的旧值。