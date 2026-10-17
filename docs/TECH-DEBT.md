# Cortex 技术债清理清单

> 结合 `docs/archive/dead-classes-snapshot-2026-10-17.txt`、`BUG-REPORT-dead-tailwind-classes.md`、`AUDIT-2026-10-17.md`、各 FIX 交付文档汇总。
> 最后更新：**2026-10-17（经 `AUDIT-REPORT.md` 交叉审计修订）**

> ⚠️ 引用归档文档时注意：`AUDIT-2026-10-17.md` **没有 §9、也没有 §7.8**；§3.1 的出处是 `FIX-yi` §7.8、`FIX-bing` §9.1/§9.2。

---

## 1. 死 Tailwind 类（全仓库腐烂，P0）

### 1.1 现状
> ✅ **2026-10-17 第五轮已清理**：修正扫描口径后真实 **394 处 / 85 种 / 60 文件** → **0**。方案 A（`main.css` 别名）+ B（13 个业务文件定点替换）；CI 门禁 `scripts/check-dead-classes.sh`（0 死类 exit 0，有死类 exit 1）。下方 511/119/71 为旧快照口径，仅作历史记录。

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

### 1.3 已修复（部分）
- ✅ `CustomProviderForm.tsx`（用户报障的视觉三态开关）：**15 处选中态死类全部替换为已注册 token**，`tsc` 干净，4 条视觉单测全过。选中态改 `bg-background-tertiary font-medium text-text-primary`（与 hover 的 `bg-background-secondary` 明确区分，否则又变成「看不出变化」）
- ⚠️ **该文件并非「零死类」**：快照（mtime 15:25，**晚于**该文件修复的 15:04）仍列它为 `border-border`(10处/4文件)、`border-yellow-500`(4处/3文件)、`bg-red-900`(2处/2文件) 的命中文件；实测文件仍含 `border-border` ×3（`:590`/`:607`/`:652`）、`border-yellow-500` ×1、`bg-red-900` ×1。
  **⇒ 511/119/71 是含已修文件的快照口径，不是「当前剩余待清」口径。** 复跑脚本定数后需刷新本节与 `PROGRESS.md` D15/BUG-4/仪表盘。

### 1.4 两条修法（择一或先 A 后 B）

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

### 1.6 CI 守卫（必须接入）
```bash
cd ui/desktop && python3 scripts/scan-dead-classes.py
```
> 本 bug 成因就是「写错了不报错」，没有守卫必然复发。

---

## 2. 死代码与废弃样式

### 2.1 改名遗留（goose → cortex）

**量化基线**（`refactor-plan.md` §0.1）：15 个 crate；`goose::`→`cortex::` **593 处**、`goose_xxx::` **776 处**，共 **276 文件**；i18n **432 键**改名、**1626 messages** 不变。

| 文件 | 遗留内容 | 状态 |
|------|----------|------|
| `crates/cortex-cli/src/logging.rs:55` | 断言日志路径含 `"goose"` 分量 | ⏸ 待修（`cortex-cli --lib` 唯一失败） |
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
| `declared_vision_registry::persisted_vision_declarations_control_registry_requests` | 断言 `requests.len()==1` 实得 2（GET + POST），多出的 GET 是 B2 既定行为 | 只数 POST，或排除 GET 后断言 1 |
| `acp_custom_requests_test::test_custom_list_builtin_skill_sources` | 断言 `goose-doc-guide` 出现，但该技能被 `crates/cortex/src/skills/builtin.rs:9-13` 刻意过滤（文件 stem 为 `goose_doc_guide`） | 改为断言 `web-search`（死断言） |
| `sources::tests::list_sources_lists_builtin_skills_without_upstream_doc_guide` | 第二条断言挂在 `expect("expected web-search builtin skill")`，因开发者自装 `~/.agents/skills/web-search` 顶掉内置（`discover_skills` 的 `seen` 去重） | 干净机器上会通过，**非产品 bug**，需隔离 HOME 或改测试 |
| `ComposerModelPopover.test.tsx` | 断言面板高 210px（旧冻结高度行为），已改为 `placement.maxHeight` | jsdom 下 `maxHeight=520` 恒定，需更新断言。⚠️ **该测试长期未被执行，因为验证清单不含 `settings/models` 目录** |
| `providers::gemini_cli::tests::initial_prompt_is_sent_on_stdin` | 某一轮全量跑失败过一次，单独跑 4/4 通过，再跑全量又通过 | **已知 flaky**（`spawn` 子进程、本机负载），非本次引入。勿误判为回归 |
| `CustomProviderForm.test.tsx` 的 `does not carry credentials…` / `clears secrets…` | 各耗时 ~4.4~5.0s，**默认 5s 预算顶掉**（非断言失败） | 跑测试带 `--testTimeout=15000`（或 `30000`） |
| `session_naming` 的 3 例新回归测试 | ⚠️ **从未编译未运行**（因 `debug/` 目录整个消失，原因不明，跨 4 轮） | **补跑需单独授权**（release profile 有再次触发 v8 build script 破坏性清理的风险）。⚠️ 不得据此声称该测试已通过 |

### 2.3 未清理的配置层与工作区技术债

| 事项 | 现状 | 风险 |
|------|------|------|
| `api_key_env: null` 仅解决这一种坏文件 | 真正语法错误的 JSON 依然拖垮整张注册表（方案 B/C 未做），且错误只在 `tracing::warn!` 里、**GUI 用户看不到** | 用户改错 JSON 导致所有自定义供应商消失，且无可见报错 |
| `GOOSE_PATH_ROOT` 不隔离 `~/.agents/skills` | 技能测试读开发者真实家目录 | 测试不可复现、CI 易误报 |
| 剥图占位文案约束 | 已诚实化为 `image input is turned off for this model`，但 **`openai.rs`/`openai_responses.rs`/`databricks.rs` 三处各一份且被测试断言** | 改文案漏改任一处即产生三处不一致（G2 因此把提示改走 ACP option description） |
| 工作区残留 | `crates/cortex/src/agents/snapshots/cortex__agents__prompt_manager__tests__all_platform_extensions.snap.new`（gitignore，来自 `prompt_manager` 快照测试运行） | 低；确认是否需要提交或删除 |
| `cortex doctor` 端到端 | C5 的 `api_key_env` 修复**未跑 `cortex doctor` E2E**（需 cortex-cli 290MB 链接） | 注册表级测试覆盖同一段代码路径，风险低 |

---

## 3. 架构层遗留问题

### 3.1 冷启动不回填 `reasoning`（P0）

> ⚠️ **与 `LESSONS.md` 的「冷启动时序缺陷（已修）」是两个不同的 bug**，勿混。

- **位置**：`crates/cortex-providers/src/openai.rs:344` `with_endpoint_capabilities()`
- **问题**：只折进 `endpoint_capabilities` 和默认档位，**不回填 `reasoning`**（已读码确认该函数体 `:344-369` 无 `reasoning` 写入），而闸门 `sends_thinking_effort()` 只看 `reasoning`
- **后果**：端点声明了词表但第一、二轮出站都无 `reasoning_effort`，「端点是唯一推理证据」的模型菜单 `[Off]`、出站无字段
- **为什么现有测试没发现**：丙的每个测试都预置了 `reasoning=Some(true)`（`reasoning_config()` 助手或 JSON 里 `"reasoning": true`）⇒ **这一类模型从来没被测过**
- **修法**：一行（镜像 `crates/cortex/src/model_config.rs:187-193` 的规则），但按边界未改

### 3.2 目录有词表但无「关」的词时 `Off` 仍发 `low`
- **现状**：`cn:glm-5.3-flash` 实测 `Off → "low"`（在 7865 声明型网关上同样复现）
- **分析**：`(None, Some(values))` 分支上，`preferred = [none, minimal, off, low]` 一路落到 `low`
- **定性**：比网关闭默型更常见，但「发最轻档」vs「不发（端点默认可能更多）」是**产品决策非机械修复**
- **影响家族**：GLM / kimi-k3 / gpt-5.6-astra
- **状态**：[需人工确认]

### 3.3 探测缓存 400 措辞覆盖不全
- **现状**：G1 只匹配 `image/vision/image_url/multimodal` × 拒绝词、`reasoning_effort/reasoning.effort/thinking_effort` × 拒绝词
- **风险**：真实端点文案不在笛卡尔积里时退化成「错误上抛」（安全方向失败但打扰用户）
- **状态**：待真机核对各网关 400 措辞

### 3.4 `reasoning: false` 无法表达
- **根因**：`ModelInfo.reasoning` 是非 Option `bool`，类型上不可区分「否」与「没说」
- **现状**：刻意只发布 `true`，用户想显式关掉被启发式识别的推理模型时无「关」表示
- **方向**：给 `ModelInfo` 加三态是产品决策，本轮未做

### 3.5 `catalog_provider_id` 不参与 canonical 查找
- **现状**：`canonical/` 与 `model_config.rs` 里**零命中**该字段（已实测确认）
- **影响**：OpenCode 系（`oc-*` 模型名、`cortex-free-opencode` provider 键）与目录（`space-bunny-free`、`opencode-go`）命名错位，无法通过该字段打通；且 `name_builder.rs` 的 `strip_common_prefixes` 有 24 个前缀、**没有 `oc-`**
- **风险**：目录里 `opencode-go` / `opencode` / `cortex-free-opencode` 三个都存在，**填错会静默不命中**，要求命中失败时留日志
- **状态**：`AUDIT` §2 ① 建议走「让 `catalog_provider_id` 参与 canonical 查找」而非手写声明，**需新立项设计改动**（约 10 行）

### 3.6 WorkBuddy Responses API 支持未知
- **风险**：A1 让 realm 前缀模型（`global:gpt-6-luna` / `global:gpt-5.6-terra` / `global:gpt-6-sol`）首次打 `/v1/responses`，B4 已降级为「首次 404 回落 chat 并记住」，但**首次仍会 404**
- **状态**：约束禁止打 7863，**需用户真机验收**（`PROGRESS` P0-1）

### 3.7 其余中转站 `/v1/models` 未核查
- **对象**：`custom_lite-gpt`(vortexapi.xyz)、`custom_chatanywhere`、`custom_siliconflow`
- **风险**：若同样不声明能力，B2/C2 修复在它们身上也接不通
- **缓解**：G1 不依赖端点配合，风险已摊平（核查结果只影响「第一次是否浪费一次请求」，不影响功能）
- **状态**：需用户 API key，用户决定推迟（`PROGRESS` P2-1）

### 3.8 `vision` 能力仍缺一次真机确认
- **现状**：后端早已具备乐观发图（`vision_support()` 结尾 `.known.or(Some(true))`，`build_chat_payload` 显式传入，不会退化成 `unwrap_or_default()` 的「图片变占位文本」），前端也不按视觉能力禁用附件
- **刻意未做**：**不往 `custom_cortex-free-opencode.json` 写 `supports_vision`** —— 会把未经真机确认的声明变权威值，反而**关掉 G1 自愈降级**
- **唯一缺口**：free-lane 对这些模型收不收图，**未发真实请求所以没验**（`AUDIT` §5-E #3 / `PROGRESS` P0-3）

---

## 4. 测试基线修正（重要）

| 项目 | 原记录 | 审计修正后 |
|------|--------|------------|
| `cortex --lib` 失败数 | 16 个 | **8 个真失败**（另 8 个纯 feature flag 没开：`analyze` 挂 `tree-sitter`） |
| `cortex-provider-types` 测试数 | 669 | **670**（+1） |
| UI 全量测试 | 丙报「13 passed」 | **992 passed / 21 failed / 8 skipped**（丙只覆盖自己一个文件） |
| ACP 集成测试 | D6 阻塞全灭 | **11 个测试二进制，8 绿 3 红**（8 个 `acp_*_test.rs` + `session_id_propagation_test` + `custom_provider_command_auth_test` + `declared_vision_registry`） |
| `cortex-cli --lib` | 未记录 | **352 passed / 1 failed**（`logging.rs:55`） |

> **教训**：三轮只跑 `--lib` 从没跑 `--test`，导致陈旧断言存活至今。验收必须带全 feature 且跑集成测试。
> ⚠️ **口径提醒**：`cortex --lib` 的 2276/2284 **只覆盖该 crate 的 lib 测试**，不含 `cortex-cli --lib`、UI vitest 与 11 个 ACP 二进制，不可读成「全仓库通过率」。

---

## 5. 清理优先级建议

| 优先级 | 任务 | 预估工作量 | 备注 |
|--------|------|------------|------|
| **P0** | 死 Tailwind 类全仓库清理（方案 A 优先） | 2-3 天 | 接入 CI 守卫同步进行；**先复跑脚本定死当前剩余数** |
| **P0** | 冷启动不回填 `reasoning`（一行镜像） | 0.5 天 | 影响「端点是唯一推理证据」模型 |
| **P0** | 真机验收 P0-1~P0-3（WorkBuddy Responses、400 措辞、图像乐观发送） | 需用户配合 | 约束禁止打真实网关端口 |
| **P1** | `catalog_provider_id` 接入 canonical（OpenCode 系根治） | 1-2 天 | 需 TASK 授权改 `name_builder.rs` |
| **P1** | 腐烂/flaky 测试断言修复（§2.2 前 6 行） | 0.5 天 | 非产品决策，改断言即可 |
| **P1** | G2 提示位置决策（底栏是否也要） | 0.2 天 | 取决于真机观感 |
| **P1** | developer 角色修复的真机验收 | 需用户配合 | 装新版后确认不再 400 |
| **P1** | `cortex-cli/src/logging.rs:55` 改名遗留 | 0.1 天 | 一行字面量 |
| **P2** | `api_key_env` 坏文件跳过 + 错误可见化 | 1 天 | 方案 B/C |
| **P2** | 测试隔离漏洞修复（隔离 HOME） | 0.5 天 | 技能测试专用 |
| **P2** | `session_naming` 3 例回归补跑 | 需单独授权 | ⚠️ release profile 有触发 v8 破坏性清理风险 |
| **P2** | `cargo clippy --all-targets` 跑通整理 | 1-2 天 | Feature 门控重构 |
| **P2** | v8 build script 的 `v8-goose-*` 文件名改名 | 0.5 天 | 依赖上游，风险待评估 |
| **P2** | token 优化第二批（chatrecall 逐条上限 / image 缩放 / 缓存感知压缩） | 待估 | 未获批准 |

---

## 6. [需人工确认] 的决策项

1. **Off 语义**：目录有词表但无「关」的词时，`Off` 应「发最轻档」还是「不发字段（听端点默认）」？
2. **`reasoning` 三态**：是否给 `ModelInfo.reasoning` 加 `Option<bool>` 或三态 enum，让用户能显式表达「不推理」？
3. **探测缓存位置**：`~/.config/cortex/model_capabilities.json` 位置是否合意？是否需 UI 清除入口？
4. **G2 提示位置**：桌面端底栏（`ThinkingEffortControl.tsx`）是否也需要同一句可操作提示？
5. **真实 `~/.config/goose` 时间戳**：硬边界记录是否修订为实测值 `2026-10-16 15:33:19`（出处 `FIX-yi` §7.8），还是清理现场恢复基线 `2026-10-09 17:56:19`？