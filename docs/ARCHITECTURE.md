# Cortex 项目架构与代码地图

> 基于 `docs/archive/` 全部历史文档提炼。最后更新：**2026-10-17（经 `AUDIT-REPORT.md` 交叉审计修订）**
> ⚠️ 本文件的**所有代码路径与符号归属均已逐条对代码库实测**（grep / 读码 / git ls-tree）。
> ⚠️ 引用归档文档时请注意：`AUDIT-2026-10-17.md` **没有 §7.8、没有 §9**；`§4-C` 应写作 `§5-C`。

---

## 0. 仓库状态（续接必需）

| 项 | 值 |
|----|-----|
| 源码根 | `/home/rarestcsc/Cortex` |
| 分支 | `composer-ui-refactor` |
| HEAD | `3bd8520` |
| 状态 | **改名未提交**；不 reset / 不覆盖 / 不提交 / 不推送 |
| 旧回退副本 | `/home/rarestcsc/Goose_test/goose`（源码 + `.git` 651M 仍在；构建产物已清，回收 11.9G） |
| 已装正式版 | 1.54.0；上游 Goose 1.54.0 仍在 `/usr/bin/goose`，两者并存、数据与深链互不干扰 |
| crate 数 | 15 个（`goose*` → `cortex*` 改名结果） |
| 数据/配置隔离根 | `GOOSE_PATH_ROOT`（绝对路径）；钥匙串落 `~/.local/share/keyrings/login.keyring` |

---

## 1. 核心模块：自定义供应商能力管线

### 1.1 核心职责
解决 **自定义 OpenAI 兼容供应商**（`engine: openai` 的 `custom_*` 声明式供应商）的能力信息“三源不通”问题：
- **用户声明**（`custom_providers/*.json` 的 `ModelInfo.reasoning` / `supports_vision` / `request_params`）
- **端点自报**（`GET /v1/models` 返回的 `supports_images`、`reasoning_supported_efforts`、`reasoning_default_effort`、`can_disable_thinking`、`supports_reasoning`）
- **公共静态目录**（`canonical_models.json` 8279 条，仅覆盖公共 provider）

**历史根因**：Cortex 只消费了第三源，导致第三方网关/自建网关的模型名天然不在目录里，名字启发式又不认 `cn:` / `global:` 等 realm 前缀，三条路全空。

### 1.2 组件交互逻辑（能力解析优先级）

**`ModelConfig.reasoning` 的解析链**（`crates/cortex/src/model_config.rs:176-194`，同步构造时）：
```
用户声明（custom_*/ModelInfo.reasoning，只发布 true）
  > 端点自报 supports_reasoning（GET /v1/models）
  > 端点有 effort_levels 但没声明 supports_reasoning ⇒ 视为 true
  > （随后）目录回填 apply_canonical_limits，只在仍为 None 时填
  > 名字启发式
```
**写入原则**：入参侧的值是权威的（`is_none` 守卫），不做兜底继承。

> ⚠️ **G1 探测缓存不在这条链里**。`endpoint_capabilities::lookup()` 只返回 `{ declared, endpoint }` 两个来源；G1 的 `ProbeCache` 是**独立机制**（`crates/cortex-providers/src/openai.rs` 的 `probe_cache()`），只在 `vision_support` / `should_use_responses_api` / 降级重试三处被查询。
> **方向与直觉相反**：端点声明过的能力**不会**被探测结果覆盖 —— 护栏 `vision_was_guessed` / `effort_was_guessed` 要求声明为 `None` 才走探测。

### 1.3 关键数据流
```
UI (CustomProviderForm.tsx)
  → ACP DTO (CustomProviderUpsertDto.modelCapabilities)
  → acp/server/providers.rs (custom_provider_models)
  → config/declarative_providers.rs (物化落盘)
  → ModelConfig (endpoint_capabilities, reasoning, supports_vision)
  → formats/openai.rs / openai_responses.rs (出站闸门与词表映射)
  → provider/openai.rs (GET /v1/models 消费、G1 探测缓存)
```

---

## 2. 功能-代码路径映射表

### 2.1 后端核心（Rust）

| 功能领域 | 核心文件 | 关键函数/结构体 | 说明 |
|---------|---------|----------------|------|
| **能力管线入口** | `crates/cortex/src/model_config.rs` | `base_model_config_from_user_config`, `apply_declared_capabilities` | B1 注入点，必须在 canonical 之前（`apply_declared_capabilities` 定义在 `:169`，**不在** `declarative_providers.rs`） |
| **ModelConfig 定义** | `crates/cortex-provider-types/src/model.rs` | `ModelConfig::{endpoint_capabilities, sends_thinking_effort, reasoning_effort_is_fixed}` | 三层判定合一：`sends_thinking_effort()` 为单一真理 |
| **OpenAI 格式层** | `crates/cortex-provider-types/src/formats/openai.rs` | `create_request_for_model_with_options`, `openai_reasoning_effort_for_endpoint`（内含局部闭包 `accepts`，`:2033-2040`，非独立函数）, `own_effort_word` | 出站闸门、词表映射、Off 兜底修复 |
| **Responses 格式层** | `crates/cortex-provider-types/src/formats/openai_responses.rs` | 闸门镜像乙的收窄（`capability_model_name` 在 `:630`） | B4 路由回落、与 chat 路径一致性。⚠️ **`should_use_responses_api_for_provider` 不在此文件**，在 `crates/cortex-providers/src/openai.rs:708` |
| **端点能力类型** | `crates/cortex-provider-types/src/endpoint_capabilities.rs` | `EndpointModelCapabilities`, `ProbeCache`, `word_for`, `lookup`（`:271`，只返回 `{declared, endpoint}`） | B2/B3/G1 核心：解析、映射、探测缓存 |
| **Canonical 名称映射** | `crates/cortex-provider-types/src/canonical/name_builder.rs` | `map_to_canonical_model`, `strip_realm_prefix`, `infer_provider_stripping_realm` | D5-a realm 前缀剥除、custom_ 前缀剥除 |
| **Provider 实现** | `crates/cortex-providers/src/openai.rs` | `OpenAiProvider::{with_endpoint_capabilities, vision_support, should_use_responses_api, should_use_responses_api_for_provider, probe_cache}` | B2 读 `/v1/models`、G1 降级、B4 路由。⚠️ **`declared_capabilities` 不在此文件**，在 `crates/cortex/src/config/declarative_providers.rs:439` |
| **声明式 Provider 物化** | `crates/cortex/src/config/declarative_providers.rs` | `declared_capabilities`, `publish_declared_capabilities`, `forget_declared_capabilities` | B1 声明发布、权威值契约、失效钩子 |
| **ACP 配置分发** | `crates/cortex/src/acp/response_builder.rs` | `thinking_effort_values`, `current_thinking_effort_value`, `assert_menu_and_payload_agree` | B2 菜单动态档位、D7 判据重写、G2 提示 |
| **ACP Server Providers** | `crates/cortex/src/acp/server/providers.rs` | `custom_provider_models`, `update_custom_provider` | C4 显式 null 透传、预置 existing 值（`:394`） |
| **自定义 Provider 解析** | `crates/cortex-providers/src/declarative.rs` | `load_custom_providers`, `null_to_empty` | C5 `api_key_env: null` 归一化 |
| **重试策略** | `crates/cortex-provider-types/src/retry.rs` | `should_retry` | 能力 400 不重试 |
| **思考枚举** | `crates/cortex-provider-types/src/thinking.rs` | `ThinkingEffort::{Off,Low,Medium,High,Max}`, `ThinkingEffortSupport` | 标准五档与解析别名（`max`/`xhigh` 同义） |

> ⚠️ **不存在的路径**：`crates/cortex-provider-types/src/declarative.rs` **没有这个文件**。`ModelInfo` 在 `base.rs`，`DeclarativeProviderConfig` 在 `crates/cortex-providers/src/declarative.rs`。

### 2.2 前端核心（TypeScript/React）

| 功能领域 | 核心文件 | 关键组件/函数 | 说明 |
|---------|---------|--------------|------|
| **自定义供应商表单** | `ui/desktop/src/components/settings/providers/modal/subcomponents/forms/CustomProviderForm.tsx` | `modelVision`, `useEffect([initialDataIdentity])`, 三态开关 | C4/G3：显式 null 发送、UI 状态重置修复、死类清理 |
| **ACP Providers 客户端** | `ui/desktop/src/acp/providers.ts` | `updateRequestToCreate`, `toLocalModelCapabilities` | `supportsVision: capability.supports_vision ?? null` 已支持显式清除 |
| **思考强度控件** | `ui/desktop/src/components/settings/models/bottom_bar/ThinkingEffortControl.tsx` | `choices`, `preview`, ACP option description | G2 可操作提示注入、无 i18n 新增键。⚠️ 提示当前**只在 ACP option description**，底栏是否也需要 = 未决项（`FIX-bing` §9.1 / `AUDIT` §5-E #6） |
| **模型弹层** | `ui/desktop/src/components/settings/models/bottom_bar/ComposerModelPopover.tsx` | `toggleProvider`, `placement.maxHeight` | 折叠状态、弹层高度修复 |
| **供应商管理** | `ui/desktop/src/components/settings/providers/ComposerProviderManager.tsx` | `isEditable ?? true`, `setCustom` | 新建时字段全显示、initialDataIdentity 语义 |
| **死类扫描脚本** | `ui/desktop/scripts/scan-dead-classes.py` | 对照 live dev server 生成 CSS 普查 | CI 守卫候选，`ui/desktop/src` 共 520 个源文件 → **511 处 / 119 种 / 71 文件** |

### 2.2b UI 剥图占位文案（三处 format 层各一份）

`openai.rs` / `openai_responses.rs` / `databricks.rs` **各有一份**相同文案，且**都被测试断言**：

```
[image omitted: image input is turned off for this model]
This tool result included an image that was omitted because image input is turned off for this model.
```

改文案必须**同步三处**，否则会产生三处不一致（G2 因此把可操作提示改走 ACP option description，避免制造这种不一致）。

### 2.3 配置与持久化

| 文件 | 作用 |
|------|------|
| `~/.config/cortex/custom_providers/*.json` | 用户声明的自定义供应商（`reasoning`、`supports_vision`、`request_params`、`catalog_provider_id`） |
| `~/.config/cortex/config.yaml` | 全局配置（`active_provider`、`thinking_effort` 等） |
| `~/.config/cortex/model_capabilities.json` | G1 探测缓存（键：`base_url` FNV-1a-64 哈希 + 模型名，TTL 30 天）。⚠️ 位置与「UI 可清除」是**未决项**（`PROGRESS.md` P1-4）。键的精确算法见 `AGENTS.md` §2.6 |
| `~/.config/cortex/sessions.db` | 会话存储（SQLite，含 `model_config_json`） |
| `~/.config/cortex/model_catalog/` | 后端启动时生成的模型目录 |
| `~/.local/share/keyrings/login.keyring` | 钥匙串落盘（`Entry::new("cortex","secrets")`；`secrets.yaml` 不存在=未降级） |

### 2.4 环境变量与兼容性
- **`GOOSE_*` 环境变量全部保留**（对外 API，约 900 处），如 `GOOSE_PATH_ROOT`、`GOOSE_THINKING_EFFORT`、`GOOSE_DISABLE_KEYRING`
- **配置键保留 `goose_mode`/`goose_model` 等前缀**（wire 契约）
- **协议 DTO 保留 `GooseExtension` 等前缀**（ACP schema 生成）
- **默认 provider 哨兵 ID `"goose"`**（`crates/cortex/src/acp/server.rs:217 DEFAULT_PROVIDER_ID`）
- **ACP meta key `"goose"`**（活契约，20+ 处生产代码）
- **钥匙串服务名**：`KEYRING_SERVICE="cortex"`、`KEYRING_USERNAME="secrets"`
- **隔离路径**：`GOOSE_PATH_ROOT` 必须是绝对路径，隔离 config/data/state/plugins
  - ⚠️ **`GOOSE_PATH_ROOT` 不隔离 `~/.agents/skills`**（`crates/cortex/src/skills/mod.rs:401` 用 `dirs::home_dir()`）
- **深链** `cortex://`；**memory MCP 数据路径** `.cortex/memory`

---

## 3. 关键设计决定（防回归）

1. **`ModelInfo.reasoning` 是非 Option `bool`** → 只发布 `true`，`false` 视为「没说」，让启发式/G1 作答（丙 §3.2）。且**非 `custom_*` 的内置声明式定义连 `true` 都不注入**（让内置定义继续作目录的最后一搏）
2. **`sends_thinking_effort()` 为菜单与出站的单一判定**（乙 A2），`is_reasoning_model()` 与 `openai_reasoning_for_model()` 语义不变（乙 §8.1）。`is_reasoning_model()` 有 10 个生产调用点，其中 2 处语义与档位菜单无关 ⇒ 不要改
3. **端点声明了但不含某档时用它声明过的词兜底，唯独 `Off` 在端点无「关」的词时省略字段**（丙 ②）。`accepts` 是 `openai_reasoning_effort_for_endpoint` 内的局部闭包，不是独立函数
4. **权威值契约**：`update_custom_provider` 不再兜底继承 `supports_vision`/`reasoning`，入参即权威（甲 §7.1、丙 D5-b）
5. **`catalog_provider_id` 目前不参与 canonical 查找**（SUMMARY §7.5、`AUDIT` §2 ①；`canonical/` 与 `model_config.rs` 中该字段零命中），OpenCode 系需另立项
6. **Rust 改动要批量**——改一个字符串触发 release 增量 12m39s（级联 cortex→cortex-mcp→cortex-cli＋链接 290MB）
7. **剥图占位文案已诚实化**：`model does not support vision` → `image input is turned off for this model`，三处 format 层各一份且被测试断言（`BUG-REPORT-custom-provider-vision.md` §7 附带项）

---

## 4. 测试与验证基线（2026-10-17 审计口径）

| 测试层 | 命令 | 结果 |
|--------|------|------|
| `cortex-provider-types` | `cargo test -p cortex-provider-types --lib` | **670 passed** |
| `cortex-providers` | `cargo test -p cortex-providers --lib` | **269 passed** |
| `cortex --lib` | `cargo test -p cortex --lib --features scheduler,acp-http,tree-sitter,code-mode` | **2276 passed / 8 failed**（8 个真失败：prompt_manager 快照、config::extensions、chatgpt_codex、gcpauth×3、sources×2） |
| `cortex-cli --lib` | `cargo test -p cortex-cli --lib` | **352 passed / 1 failed**（`logging.rs:55` 改名遗留） |
| ACP 集成测试 | 8 个 `acp_*_test.rs` + `session_id_propagation_test` + `custom_provider_command_auth_test` + `declared_vision_registry` = **11 个测试二进制** | **8 绿 3 红**（3 个失败已分类：陈旧断言、死断言、预算过紧） |
| UI TypeScript | `cd ui/desktop && node ../node_modules/typescript/bin/tsc --noEmit` | 干净 |
| UI Vitest | `cd ui/desktop && pnpm run test` | **992 passed / 21 failed / 8 skipped**（App/Hub 夹具问题、CustomProviderForm 超时） |
| 死类扫描 | `cd ui/desktop && python3 scripts/scan-dead-classes.py` | 520 个源文件 → **511 处 / 119 种 / 71 文件**（2026-10-17 15:25 快照口径）。`CustomProviderForm.tsx` 的 **15 处选中态死类已换**，但快照仍记录本文件 3 类死类（`border-border`/`border-yellow-500`/`bg-red-900`）⇒ **「该文件零死类」的说法待复跑脚本确认**，见 `PROGRESS.md` D15 |

> ⚠️ **口径提醒**：上表 `cortex --lib` 的 2276/2284 只覆盖该 crate 的 lib 测试，**不含** `cortex-cli --lib`（352/1）、UI vitest（992/21/8）与 11 个 ACP 测试二进制，不可读成「全仓库 99.6%」。

> **注意**：`cargo clippy --all-targets -- -D warnings` 在本分支跑不通（feature 门控 + 改名遗留），三轮均沿用可行写法：`-p <crate>` 分开 + `--features scheduler,acp-http` + `-A dead_code`。