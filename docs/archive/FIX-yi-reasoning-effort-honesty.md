# 交付：Task 乙 — 思考强度诚实化（A1 + A2）

- **日期**：2026-10-16 ~ 2026-10-17
- **状态**：代码已落地，单测绿，本地严格假端点端到端已验收。**未做真机验收**（见 §7）
- **任务来源**：`docs/TASK-fix-custom-provider-capability-pipeline.md` §2「乙：诚实化（A1 + A2）」
- **分析依据**：
  - `docs/BUG-REPORT-realm-prefixed-model-thinking-effort.md`（C1/C2 深度，§3 断点③④⑥、§4、§6 方案 1/3、§7 测试计划）
  - `docs/BUG-REPORT-developer-role-rejected.md` §82（非推理模型不得发 `reasoning_effort` 的既有用例）
- **隔离环境**：`GOOSE_DISABLE_KEYRING=1 GOOSE_PATH_ROOT=/tmp/opencode/yi-a2-probe`，配置在 `<root>/config`
- **未改任何 ACP schema / DTO** ⇒ `just generate-acp-types` **不需要重跑**（§3.4 有核对说明）

---

## 1. 一句话总结

A1 让 `is_openai_responses_model` 认得 realm 前缀（`cn:gpt-6-sol`、`global:gpt-6-luna` 这类带 `:` 的 id 重新被识别成 OpenAI responses 系）；A2 让「菜单给出思考档位」与「出站真的发 `reasoning_effort`」变成同一个判定的两个出口。

两个症状的共同点是**诚实性**：C1 最恶劣的表现不是「没功能」，而是 `cn:glm-5.3-flash` 的三档滑块是纯装饰——菜单侧 `is_reasoning_model()`（认 glm-5.3 名字）与出站侧 `openai_reasoning_for_model()`（不认）**是两个判定、结论相反**，UI 承诺了它自己不兑现的能力。A2 选的是「让承诺兑现」而不是「把承诺收掉」（路线理由见 §3.2）。

---

## 2. A1：`is_openai_responses_model` 不认 realm 前缀

### 2.1 根因

`crates/cortex-provider-types/src/formats/openai.rs` 的正则只把 `-` 和 `/` 当分隔符：

```rust
Regex::new(r"(?i)(?:^|[-/])(?:o\d+(?:$|-)|gpt-(?:5|6)(?:$|[-.]))")
```

网关给多个上游做命名空间时用 `:`（`cn:` / `global:`），于是 `global:gpt-6-luna` 既不匹配 `^` 也不匹配 `[-/]`：

| 模型 | 改动前 | 改动后 |
|---|---|---|
| `gpt-6-luna` | true | true |
| `/gpt-6-luna` | true | true |
| `-gpt-6-luna` | true | true |
| `global:gpt-6-luna` | **false** | true |
| `cn:gpt-6-sol` | **false** | true |
| `global:gpt-5.6-terra` | **false** | true |

这一个字符同时挡住两件事：`ModelConfig::normalize_effort_suffix` 的 `-high`/`-xhigh` 后缀归一化，以及断点⑥ 的出站闸门（`openai_reasoning_for_model` 的最后一道回落就是它）。

### 2.2 改动

```rust
- Regex::new(r"(?i)(?:^|[-/])(?:o\d+(?:$|-)|gpt-(?:5|6)(?:$|[-.]))")
+ Regex::new(r"(?i)(?:^|[-/:])(?:o\d+(?:$|-)|gpt-(?:5|6)(?:$|[-.]))")
```

**未动 `name_builder.rs` 的 realm 前缀剥除**（A1 的可选第二步）。`name_builder.rs` 在 Read Scope 但**不在 Write Scope**，而 Forbidden Scope 是「其余全部 crate」，故没碰。后果：realm 前缀模型仍拿不到 canonical 的 context_limit / max_tokens 回填（§7.4）。

---

## 3. A2：消灭「UI 能调但出站不发 `reasoning_effort`」

### 3.1 根因（两个判定，结论相反）

```
菜单侧  response_builder.rs:389  thinking_effort_values()  →  model_config.is_reasoning_model()
出站侧  openai.rs:1756          if is_reasoning_model      →  model_config.openai_reasoning_for_model()
```

`is_reasoning_model()` 认 glm-5.3 / claude / gemini-3 / kimi-k3 / xAI 名字启发式；
`openai_reasoning_for_model()` 只认 OpenAI-responses 系（且额外要求 canonical 记录挂在 `openai/` 下）。
`cn:glm-5.3-flash` 两侧结论相反 ⇒ 菜单 3 档、出站 0 字节。

### 3.2 路线选择：**1b（放宽出站）**，加两处收窄

**TASK 与分析文档都倾向 1b，本次确认选 1b，未选 1a（收紧 UI）。**

理由：

1. **1a 达不到 C1 的验收标准**。1a 会把 `cn:glm-5.3-flash` 的三档一起收成 1 档——那仍然是「UI 承诺了它不兑现的能力」，
   只是把承诺收窄到「承诺不了」。C1 要的是「三档可拖**且真的生效**」。
2. **1a 会砍掉一个当前已经能用的能力**。xAI `grok-4.5` / `grok-4.3` / `grok-3-mini` 今天就能通过
   `supports_xai_reasoning_effort` 那条专用分支收到 `reasoning_effort`（既有测试
   `test_create_request_applies_grok_4_5_reasoning_controls` 为证），但 `openai_reasoning_for_model()`
   对它们一律返回 false（不是 OpenAI-responses 系、canonical 也挂在 `x-ai/` 下）。菜单若改用它，
   这三个模型的滑块会从「能用」塌成 1 档——变成另一种不诚实：藏起一个真正生效的能力。
   （本次因此把 xAI 分支的判定保留在出站侧、且让它优先于 OpenAI 词表，见 §3.3。）
3. **1a 不消除双判定，只是换个菜单用哪个**。两个谓词仍然并存，下次改名字启发式就会重新分叉；
   1b 落成的是一个两侧共用的 `sends_thinking_effort()`，分叉点在结构上不存在。
4. **1a 会把 C1 的修复推给 B1**。名字启发式认得的族（claude / gemini-3 / xai…）在 1a 下需要
   `ModelConfig.reasoning` 被显式填上（B1）菜单才肯给档位；realm 前缀模型则要等 B2 才拿得到端点声明。
   也就是说 1a 单独做完，C1 在真机上仍然是「一档」。

> 复核记录：初稿曾把「1a 会让 B1 白做」写成理由之一，那是错的——`openai_reasoning_for_model()` 里
> `self.reasoning.or_else(...)`（`model.rs:308`）会优先采用显式声明，canonical 护栏只在解析到
> **非** `openai/` 的记录时才提前 `return false`。B1 落地后 1a 也能自洽，故它不是理由。

**但 1b 不是把 `openai_reasoning_for_model()` 换成 `is_reasoning_model()` 就完事**——实测踩到两个真实回归，
各收窄一处：

| 收窄 | 触发条件 | 不收窄的后果 | 依据 |
|---|---|---|---|
| `reasoning_effort_is_fixed()`：xAI 固定参数族（`grok-4.20-*`、`grok-4-fast-reasoning`）既不发 effort，菜单也收成 1 档 | `is_xai_reasoning_model(name) && !supports_xai_reasoning_effort(name)` | 打破既有钉死的 `test_create_request_keeps_grok_4_20_fixed_reasoning_parameters`（它们本来就 5 档纯装饰） | `openai.rs:5682` `test_xai_reasoning_model_capabilities_are_model_specific` 明确断言这批模型**不支持** xAI effort |
| 非 OpenAI-canonical 模型选 `off` 时保持沉默 | `thinking_effort() == Off && !is_reasoning_model` | `off` 被映射成 `minimal`，直接打挂 `openrouter::tests::stream_downgrades_reasoning_disable_on_mandatory_endpoint`（OpenRouter 靠「先发 `enabled:false`、被拒后降级到自己的下限」工作，字段一旦被预填就再也走不到降级） | 该测试用 `google/gemini-3.5-flash` + `reasoning: Some(true)`，canonical id 是 `google/…` 不是 `openai/…` |

两条收窄都用「让菜单与出站同时收窄」的方式实现，没有制造新的单边分叉。

### 3.3 落地形态：一个判定，两个出口

```rust
// model.rs
fn reasoning_effort_is_fixed(model_name: &str) -> bool {
    is_xai_reasoning_model(model_name) && !supports_xai_reasoning_effort(model_name)
}

impl ModelConfig {
    pub fn sends_thinking_effort(&self) -> bool {
        self.is_reasoning_model() && !reasoning_effort_is_fixed(&self.model_name)
    }
}
```

```rust
// formats/openai.rs:1755-1781（出站）
let sends_thinking_effort = model_config.sends_thinking_effort();
let is_reasoning_model     = model_config.openai_reasoning_for_model(&model_name); // 仅用于请求形状
let supports_xai_effort    = supports_xai_reasoning_effort(&model_name);
let reasoning_effort = if supports_xai_effort { /* xAI 自己的词表 */ }
    else if sends_thinking_effort { match model_config.thinking_effort() {
        Some(ThinkingEffort::Off) if !is_reasoning_model => None,
        Some(effort) => openai_reasoning_effort_for_thinking(&model_name, effort),
        None => legacy_reasoning_effort,
    } }
    else { None };
```

```rust
// response_builder.rs:389 / :410（菜单）
fn thinking_effort_values(c)        { if !c.sends_thinking_effort() { &[Off] } else { … } }
fn current_thinking_effort_value(c) { if !c.sends_thinking_effort() { "off" } else { … } }
```

**刻意保留 `openai_reasoning_for_model()` 的原语义**：它还决定 `max_completion_tokens` vs `max_tokens`
与是否抑制 `temperature`。跟着一起放宽会把刚修好的静默失效换成一批新的 400（见 §7.1）。

### 3.4 `just generate-acp-types` 未跑的理由

本次未改任何 ACP schema、DTO、`providers.rs`、或 `ui/desktop/**`：`ModelConfig::sends_thinking_effort()`
是纯后端新增方法，不进 wire。按 §5「没改就不要跑」——多跑只会制造无谓 diff。schema 与
`ui/acp-client/src/generated/` 保持与甲交付时逐字节一致。

---

## 4. 改动文件清单

| 文件 | 改动 |
|---|---|
| `crates/cortex-provider-types/src/formats/openai.rs` | **A1**：正则分隔符 `[-/]` → `[-/:]`（+doc 一句）。**A2**：出站闸门重写为 §3.3 形态（xAI 词表优先、`off` 对非 OpenAI-canonical 模型沉默）；新增 4 条单测 |
| `crates/cortex-provider-types/src/model.rs` | **A2**：新增 `reasoning_effort_is_fixed()` 与 `ModelConfig::sends_thinking_effort()`；新增 3 条单测 |
| `crates/cortex/src/acp/response_builder.rs` | **A2**：`thinking_effort_values()` 与 `current_thinking_effort_value()` 改用 `sends_thinking_effort()`；新增 9 条测试函数（1 条 7 个 `test_case` 参数化 + 2 条普通） |

**刻意未改**（均在 Write Scope 之外）：

- `crates/cortex-provider-types/src/canonical/name_builder.rs` —— A1 可选第二步，见 §7.4
- `crates/cortex/src/model_config.rs` —— 断点①（`reasoning: None` 硬编码）属丙的 B1，见 §7.3
- `crates/cortex-provider-types/src/formats/openai_responses.rs` —— 有自己的同名闸门变量，丙的 Read/Write Scope，见 §8
- ACP schema JSON、`ui/acp-client/src/generated/`、`ui/desktop/**`、全部 i18n 文件 —— 零改动，**零新增 i18n 键**

---

## 5. 测试覆盖

### 5.1 A1（3 条）

| 测试 | 位置 | 断言 |
|---|---|---|
| `test_is_openai_responses_model_matches_realm_prefixed_models` | `formats/openai.rs` | `global:gpt-6-luna` / `cn:gpt-6-sol` / `global:gpt-5.6-terra` / `cn:o3-mini` 全为 true |
| `test_is_openai_responses_model_still_matches_the_existing_separators` | 同上 | `gpt-6-luna` / `/gpt-6-luna` / `-gpt-6-luna` 仍为 true（**无回归**） |
| `test_create_request_realm_prefixed_model_sends_reasoning_effort` | 同上 | `global:gpt-6-luna` + `thinking_effort=high` ⇒ 出站 `reasoning_effort == "high"` |

既有的 `…_matches_openai_reasoning_families`（13 个模型）与 `…_rejects_other_families`（4 个模型）一字未动且仍通过。

### 5.2 A2（4 组）

| 测试 | 位置 | 断言 |
|---|---|---|
| `sends_thinking_effort::{follows_the_reasoning_families_the_effort_menu_offers, stays_off_for_models_without_a_knob, follows_explicit_metadata}` | `model.rs` | 7 个推理族为 true；`gpt-4o` / `future-model` / `grok-4.20-0309-non-reasoning` / `grok-4.20-0309-reasoning` / `grok-4-fast-reasoning` 为 false；显式 `reasoning` 优先 |
| `test_create_request_off_effort_defers_to_the_endpoint_for_foreign_catalog_models` | `formats/openai.rs` | `google/gemini-3.5-flash` + `reasoning: Some(true)`：`off` ⇒ **不发**；`high` ⇒ 发 `"high"`（钉住 §3.2 第二条收窄） |
| **`test_effort_menu_matches_the_outgoing_payload`**（7 个 `test_case`） | `response_builder.rs` | **核心一致性回归**：对同一模型断言「菜单档位数 > 1」⟺「出站 payload 含 `reasoning_effort`」。覆盖 `gpt-5.4` / `global:gpt-6-luna` / `cn:glm-5.3-flash` / `claude-sonnet-4` / `grok-4.5` / `gpt-4o` / `grok-4.20-0309-reasoning` |
| `test_effort_menu_offers_more_than_one_stop_exactly_for_sendable_models`、`test_non_reasoning_model_effort_menu_is_a_single_stop` | 同上 | 正向清单（5 个可调）与 `&[Off]` 单档断言；`reasoning: Some(false)` 的 `o3-mini` 菜单与当前值都塌成 `off`（`BUG-REPORT-developer-role-rejected.md` §82 语义） |

既有用例 `test_create_request_non_reasoning_model_omits_reasoning_effort`（`BUG-REPORT-developer-role-rejected.md` §82 同源）**未改一字且仍通过**——注意它是 developer 角色修复那轮留下的**未提交**工作树改动（`git diff HEAD` 里显示为新增），不在 HEAD 中；本次依赖它做回归保护，但未修改其断言。

### 5.3 端到端：本地严格假端点（不发任何真实模型请求）

| 项 | 值 |
|---|---|
| 服务 | `/tmp/opencode/yi-a2-probe/mock_server.py`（Python 标准库 `ThreadingHTTPServer`，**不转发任何请求**，只落盘请求体并回固定 `OK`） |
| 监听 | `127.0.0.1:**7864**` —— 刻意避开用户环境里 WorkBuddy 网关的 `127.0.0.1:7863`，**全程未接触该网关** |
| 请求体落盘 | `/tmp/opencode/yi-a2-probe/requests.jsonl`（每行 `{ts, path, body}`） |
| 隔离配置根 | `GOOSE_PATH_ROOT=/tmp/opencode/yi-a2-probe`（配置在 `<root>/config`） |
| 供应商定义 | `<root>/config/custom_providers/custom_yi_probe.json`，`base_url: http://127.0.0.1:7864/v1`，`requires_auth: false`，`dynamic_models: false` |

实测（`GOOSE_THINKING_EFFORT=low`，`cortex run -t "reply with OK only" --provider custom_yi_probe --model <M>`）：

| 模型 | 抓到的出站请求 | 结论 |
|---|---|---|
| `cn:glm-5.3-flash` | `/v1/chat/completions`，**`reasoning_effort: "low"`** | ✅ C1 的静默失效消除，值取自 `GOOSE_THINKING_EFFORT`（分析文档 §3 断点⑥ 的对照实验第二行是「**未发送** ❌」） |
| `cn:plain-chat`（`reasoning: false`） | `/v1/chat/completions`，**无** `reasoning_effort` | ✅ 非推理模型仍不发 |
| `cn:space-bunny`（`reasoning: true`） | `/v1/chat/completions`，**无** `reasoning_effort` | ⚠️ 断点① 仍挡着（丙的 B1），见 §7.3 |
| `global:gpt-6-luna` | **`/v1/responses`**，`reasoning: {effort: "low", summary: "auto"}` | ⚠️ A1 顺带翻转了端点路由，见 §7.2 |

复现命令：

```bash
cd /tmp/opencode/yi-a2-probe && python3 mock_server.py &
export GOOSE_DISABLE_KEYRING=1 GOOSE_PATH_ROOT=/tmp/opencode/yi-a2-probe GOOSE_THINKING_EFFORT=low
./target/debug/cortex run -t "reply with OK only" --provider custom_yi_probe --model 'cn:glm-5.3-flash'
python3 -c "import json;[print(json.loads(l)['path'], json.loads(l)['body'].get('reasoning_effort')) for l in open('requests.jsonl')]"
```

---

## 6. 验证命令与结果

| 命令 | 结果 |
|---|---|
| `cargo test -p cortex-provider-types --lib` | **641 passed, 0 failed**（本次 +7；`prefix_invariance` 8 条集成测试亦全绿） |
| `cargo test -p cortex-providers --lib` | **262 passed, 0 failed** |
| `cargo test -p cortex --features scheduler --lib -- acp::response_builder` | **28 passed, 0 failed**（本次 +9） |
| `cargo test -p cortex --features scheduler --lib` | **2220 passed, 16 failed** —— 16 个失败全部在本次未触碰的模块，见 §7.6 |
| `cargo clippy -p cortex-provider-types -p cortex-providers --all-targets -- -D warnings` | 干净 |
| `cargo clippy -p cortex --all-targets --features scheduler,acp-http -- -D warnings -A dead_code` | 干净（`-A dead_code` 只为绕开甲在途的 `declarative.rs:211 null_to_empty`，见 §7.6） |
| `rustfmt --edition 2021 --check <本次 3 个文件>` | 干净 |
| 端到端假端点（§5.3） | 4 个模型的请求体均已落盘并核对 |

隔离核对：`~/.config/cortex` 与 `~/.config/goose` 的 mtime 均早于本会话开始（未被触碰）；所有测试写入落在
`/tmp/opencode/yi-a2-probe/`；未发任何真实模型请求；未接触 WorkBuddy 网关（`127.0.0.1:7863`）。

---

## 7. 限制与已知风险

### 7.1 【最高】1b 的 400 风险：非 OpenAI-responses 的推理模型现在都会收到 `reasoning_effort`

选了 1b 就要把这句话说满：**闸门放宽后，凡是 `is_reasoning_model()` 为真的模型，在 OpenAI 兼容的
chat 请求上都会开始收到 `reasoning_effort`，而用的仍是 OpenAI 的档位词表**（`off → none/minimal/low`、
`max → max/xhigh/high/…`，见 `openai_reasoning_effort_for_thinking`）。端点不认这个字段或这个档位值时，
**可能直接 400**。

- **影响面**：所有 claude / gemini-3 / glm / kimi-k3 / xAI 名字的模型（只要它们走 `formats/openai.rs`
  的 chat 路径，例如经第三方网关或自定义 `engine: openai` 供应商），以及 B1 落地后任何声明了
  `"reasoning": true` 的自定义模型
- **没有任何运行时降级**：本轮没有重试、没有 400 后回落到「不发」的路径。声明错了就直接暴露成 provider 400
- **已收窄的两处**（§3.2）只覆盖「xAI 固定参数族」与「选 `off`」两种情形，不是通用的保护
- **单测绿不能替代真机**：这些模型的端点是否接受该字段，只有真实请求能回答

> 交接给丙（B1）：`ModelConfig.reasoning = Some(true)` 一旦真正接上，`cn:space-bunny` 这类模型就会立刻
> 走进这条 1b 路径。**B1 的「声明为 true 但端点拒绝」的降级路径因此从「最好有」升级为「必须先有」**，
> 否则 B1 会把一批用户直接推进 400。

### 7.2 【高】A1 会顺带翻转端点路由：realm 前缀模型改打 `/v1/responses`

`cortex-providers/src/openai.rs:should_use_responses_api` 在 `base_url` 既不是 `…/responses` 也不是
`…/chat/completions` 时会**按模型名**决定走哪条路径。A1 让 `global:gpt-6-luna` 变成 responses 系模型，
于是这类模型在自定义 base_url 上从 `/v1/chat/completions` **改打 `/v1/responses`**——已在假端点上实测确认。

- **后果**：没有实现 Responses API 的 OpenAI 兼容网关（很可能包括用户环境里的 WorkBuddy）会对这些模型
  404 / 400
- **这一条原始分析文档与 TASK 都没提到**，是本次落地时才发现的副作用
- ⚠️ **上真机前必须拿 WorkBuddy 实测 `global:gpt-6-luna` / `global:gpt-5.6-terra` / `global:gpt-6-sol` 三个模型**，
  否则可能把「思考强度不可调」换成「整个模型不可用」
- 附带确认：Responses 路径首个请求带 `reasoning.effort = "none"` 是**该路径的既有行为**（纯 `gpt-5.4` 完全相同），
  不是 A1 引入的

### 7.3 断点① 未修（丙的 B1）：`cn:space-bunny` 仍然一档且不发

`crates/cortex/src/model_config.rs:136` 仍硬编码 `reasoning: None`，`ModelInfo.reasoning` 到不了
`ModelConfig`，而「space-bunny」这个名字过不了任何启发式。已在假端点实测：无 `reasoning_effort`。

因此 TASK §2 乙 AC 里「端到端假端点验证：**cn:space-bunny 类模型**出站 payload 含 `reasoning_effort`」
这一条**本轮无法达成**——它依赖 B1。本次用 `cn:glm-5.3-flash` 做证据（那才是真正在骗人的模型：
菜单三档、出站 0 字节）。

好消息是**系统现在是一致的了**：菜单一档、出站不发，两侧同时为假。B1 落地时两侧会一起翻，不会出现中间态。

### 7.4 A1 的可选第二步未做：`name_builder.rs` 的 realm 前缀剥除

`infer_provider_from_model` 全用 `starts_with("gpt-")`，`global:gpt-6-luna` 仍无法推断回 `openai`，
因而拿不到 canonical 的 `context_limit` / `max_tokens` 回填。**未做的原因是范围**：`name_builder.rs`
在 Read Scope 但不在 Write Scope，Forbidden Scope 是「其余全部 crate」。AC 里要求的正则识别（A1 本体）已达成。

留给丙或后续会话：`zai-org/GLM-5.3-Flash` 这类 `/` 分隔的供应商命名空间不能被误伤，
`name_builder.rs:95-104` 已落地的 `custom_` 剥除也不能动。

### 7.5 双名调用方：闸门改按 `model_config.model_name` 判定

`create_request_for_model_with_options` 的 `capability_model_name` 允许与 `model_config.model_name` 不同
（`openai_compatible::stream_for_model`、databricks 路由）。effort 闸门现在用 `model_config.model_name`
（与菜单同一个名字，一致性更强），而 `openai_reasoning_for_model()` 查 catalog 仍用传入名。
现有调用方都用同一模型名构造 config，**未观察到差异**；若日后出现真正传不同能力名的 provider，需重新评估。

### 7.6 既有问题（未处理，按 §5「不修别人的 bug」）

- `crates/cortex/tests/acp_fixtures/server.rs:366` 改名后仍断言 agent 名 `"goose"`（复核仍在），
  **全仓库 ACP 集成测试在 `initialize` 阶段就会 panic**。本轮只跑 `--lib`，未触发它
  → **✅ 2026-10-17 审计已修**（一处字面量）。解锁后 8 个 ACP 测试二进制实测通过、暴露 3 个从未执行过的失败，
  逐条分类见 `AUDIT-2026-10-17.md` §3.3。**同类遗留还剩 `cortex-cli/src/logging.rs:55` 一处**（未修）。
  ⚠️ 另附一条**测试隔离漏洞**：`GOOSE_PATH_ROOT` **不隔离 `~/.agents/skills`**（`skills/mod.rs:401` 走
  `dirs::home_dir()`），所以你 §7.6 列的那 16 个失败里，`sources::tests::list_sources_lists_builtin_skills_without_upstream_doc_guide`
  的真因是**开发者自装的 `~/.agents/skills/web-search` 顶掉了内置那个**（`discover_skills:631` 的 `seen` 去重），
  **不是产品 bug、也不是陈旧预期，干净机器上会通过**。你选的那条 `--features scheduler,acp-http` 绕法本身没问题，
  但它恰好掩盖了一半的假失败——验收集成测试必须带全 `tree-sitter,code-mode`
- 不加 `--features scheduler` 跑 `cargo test -p cortex --lib` → `agents/state_machine/tests/` 下 **24 个编译错误**
- `cargo clippy -p cortex --all-targets --features scheduler` → `E0432: unresolved import cortex::acp::transport`
  （`acp/mod.rs:12` 的 `pub mod transport` 带 `#[cfg(feature = "acp-http")]`，而 `--all-targets` 仍会编那个集成测试）
- 甲在途：`crates/cortex-providers/src/declarative.rs:211` 的 `null_to_empty` 已定义未接线
  （`dead_code`），**会卡住全局 `cargo clippy --all-targets`**，需甲接线后消解
- `cargo test -p cortex --features scheduler --lib` 的 16 个失败全部在本次未触碰的模块：
  `extension_manager` / `prompt_manager` / 三个 `state_machine` 生命周期 / `config::extensions` /
  `chatgpt_codex`（JWT）/ `gcpauth`×3 / `toolshim`×4（纯字符串解析）/ `sources`×2。
  **判定为非本次引入的依据**：首次全量跑是 18 个，其中甲的 `declarative_providers::custom_provider_update_preserves_model_metadata`
  与一个 gitignore 测试在其工作期间自行转绿；且逐条核对失败断言（JWT 时序、gitignore、字符串解析、
  三态视觉语义）均不经过 `formats/openai.rs` 的闸门
  → **2026-10-17 审计的口径修正：这 16 个里有 8 个纯粹是 feature flag 没开**。
  `analyze` 扩展挂在 `#[cfg(feature = "tree-sitter")]` 下，所以 `extension_manager` 1 个 +
  `state_machine` 3 个 + `toolshim` 4 个在缺该 feature 时必红。补上 `--features scheduler,acp-http,tree-sitter,code-mode`
  后是 **2276 passed / 8 failed**，剩下 8 个才是真失败（`prompt_manager` 快照、`config::extensions` 1、
  `chatgpt_codex` 1、`gcpauth` 3 —— 后 4 个是 `jsonwebtoken` 的 `CryptoProvider` 未安装的环境问题 —— `sources` 2）。
  **你选的「-p <crate> 分开 + --features scheduler,acp-http」绕法本身没问题，但它恰好掩盖了一半的假失败**；
  验收集成测试时必须带全 `tree-sitter,code-mode`

### 7.7 未做的验证

- **未做真机验收**：单测与本地假端点对真实端点的结论**没有任何证明力**。特别是 §7.1 的 400 风险与
  §7.2 的路由翻转，只有真实网关能回答
- 假端点的 Responses SSE 未实现 `sequence_number` 字段，故 `/v1/responses` 那几次运行最终以
  「Stream decode error」收尾。**请求体已完整落盘，结论不受影响**；这只说明假端点不够真，不是 Cortex 的问题

### 7.8 ⚠️ 硬边界告警：`~/.config/goose` 的 mtime/ctime 已不是 §0 记录的值

`refactor-plan.md` §0 末条要求真实 `~/.config/goose/` 的 mtime/ctime 恒为
`2026-10-09 17:56:19.234001826 +0800`，「变化立即停止报告，不得改回」。本次实测：

```
~/.config/goose   mtime=ctime=2026-10-16 15:33:19.319533114 +0800
~/.config/cortex  mtime=2026-10-16 15:41:44.329279483 +0800
```

两者都已在此前的会话里被改动过（15:33 / 15:41，早于甲、乙两个会话的作业窗口）。

- **不是本次改动**：本会话第一条命令在 23:45，全程 `GOOSE_PATH_ROOT` 指向 `/tmp/opencode/yi-a2-probe`；
  `find ~/.config/cortex ~/.config/goose -newermt '2026-10-16 23:45'` **无输出**
- **按硬边界处理：已报告，未改回，未触碰这两个目录**
- 需主会话确认是谁在 15:33 写入了 `~/.config/goose`（该目录下同时存在 `config.yaml.bak-before-wb2api`
  与 `custom_providers/`，时间戳 15:11~15:12），并决定是修订硬边界记录还是清理现场

---

## 8. 对其他会话的影响

### 8.1 给丙（B1 + B2 + B3）——先看职责边界

A2 落地后三个判定的职责**不再是重叠的两套**，而是三层，各管一件事：

| 判定 | 回答的问题 | 谁在用（本次未改其语义） | 能否被 B2 取代 |
|---|---|---|---|
| `ModelConfig::is_reasoning_model()` | 「这个模型会推理吗」（显式声明 + 名字启发式） | 10 个生产调用点：`cortex-providers` 的 `ollama.rs:214`、`openrouter_format.rs:119`/`:133`、`databricks.rs:512`、`databricks_v2.rs:259`、`azure_foundry.rs:419`、`base.rs:367`（默认实现），`cortex-cli` 的 `configure.rs:987`（交互式配置问「要不要选思考强度」），`cortex` 的 `acp/server/providers.rs:1256`/`:1278`（**目录/价格元数据 DTO 的 `reasoning` 字段**，答的是「模型会不会推理」，与档位菜单无关） | **不要动它的语义**。它是「模型属性」；B2 的端点声明应喂它或绕开它 |
| `ModelConfig::openai_reasoning_for_model(name)` | 「按 OpenAI 的请求契约，算不算 OpenAI 推理模型」（额外要求 canonical 挂在 `openai/` 下） | 仅 `formats/openai.rs:1763` 决定 `max_completion_tokens` vs `max_tokens` 与是否抑制 `temperature`；以及 effort 映射时的 catalog 查询 | 同上，**只管 OpenAI 请求形状** |
| **`ModelConfig::sends_thinking_effort()`**（本次新增） | 「用户选的档位能不能落到 `reasoning_effort`」 | **ACP 档位菜单（`thinking_effort_values` / `current_thinking_effort_value`）＋ OpenAI 出站闸门，共用同一个函数** | ✅ **B2 接 `/v1/models` 时以它为准** |

**给 B2 的具体建议**：

1. 端点的 `reasoning_supported_efforts` / `reasoning_default_effort` 应进
   `ModelConfig.reasoning`（B1）或一个「端点声明的档位集合」新字段，让 `sends_thinking_effort()`
   自然为真——**不要**再去改 `is_reasoning_model()` 或 `openai_reasoning_for_model()`，否则刚统一的
   契约会重新分叉
2. B3 的 `max ↔ xhigh` 映射应替换 `openai_reasoning_effort_for_thinking` 里硬编码的
   `openai_reasoning_efforts_for_model() → ["low","medium","high"]` 回落，那才是 realm 前缀模型
   实际走到的分支
   → **2026-10-17 审计：你这条判断是对的，丙当时以「不能在无证据时改它」为由保留了它，
   那个理由站不住**——三元组排在最后，但**在「端点与目录都没声明」这条分支上它是唯一的分支**，
   而该分支的覆盖面远大于「网关闭默型」（`zai-org/GLM-5.3-Flash`、`claude-sonnet-4`、`kimi-k3`、
   `gemini-3-pro`、`gpt-6.1-sol@eu` 全走它）。后果：选 **Off** 发 `"low"`、选 **Max** 发 `"high"`。
   **现已删除**，回落链末级改为「只认本档自己的词，`Off` 无词故不发字段」。论证见 `AUDIT-2026-10-17.md` §1
3. **一致性回归测试要跟着 B2 调整**：B2 的动态档位一旦落地，「网关只支持单档的模型（如 `cn:hy4-preview`
   只有 `high`）」会让**菜单 1 档但出站确实要发 effort**——此时 `test_effort_menu_matches_the_outgoing_payload`
   的 `thinking_effort_values().len() > 1` 判据会把合法的单档模型判成不一致。判据应改成
   「菜单提供的档位集合 ⊆ 端点声明的集合且非空」或「端点声明的档位数 > 0」
4. `formats/openai_responses.rs` 有自己的同名闸门变量（`:653-680`），**本次未读未改**（丙的 Scope）。
   §7.2 已把 realm 前缀模型路由到那条路径，请核对它与菜单是否同样一致——实测 `global:gpt-6-luna`
   在该路径上确实带上了 `reasoning.effort`，但「是否对所有模型都一致」未验证

### 8.2 给甲（C5 + C4）

无文件重叠、未受影响。唯一相关事实：甲 §7.1 的 `supports_vision` 权威值契约与本轮的
`sends_thinking_effort()` 是同一种思路（**入参侧的值是权威的，不做兜底继承**），B1 回填 `reasoning`
时建议照此办理。

### 8.3 全局验收脚本的注意事项

TASK §4 的断言 1（「菜单档位数 > 1 ⟺ 出站 payload 含 `reasoning_effort`」）在本轮落地后成立，
但**在 B2 落地后需要按 §8.1 第 3 点改判据**。断言 3（视觉三态）与断言 4（`api_key_env: null`）属甲。

---

## 9. 文档勘误

原始分析文档中的路径/行号失效，记录在此以免后人重蹈：

| 文档 | 写的 | 实际 |
|---|---|---|
| `BUG-REPORT-realm-prefixed-model-thinking-effort.md` §3 断点① | `crates/cortex/src/model_config.rs:136` | 仍准确（`reasoning: None` 仍在 `:136`），**但这行属丙的 Write Scope，乙不能改** |
| 同上 §8 速查表 | `model.rs:292-303`（`openai_reasoning_for_model`）、`:305-332`（`is_reasoning_model`）、`:148-161`（`with_canonical_limits`）、`:318-332`（glm 启发式） | 本次新增代码后整体下移：现为 `:300-311` / `:313-336` / `:156-181` / `:338-352`；新方法 `sends_thinking_effort()` 在 `:334` |
| 同上 §3 断点④ / §8 | `formats/openai.rs:1877-1883`（responses 正则） | 现为 `:1891-1897`（本次 §3.2 收窄加了注释与分支） |
| 同上 §3 断点⑥ / §8 | `formats/openai.rs:1755-1793` | 闸门本体仍起于 `:1755`，但写入点 `payload["reasoning_effort"]` 已下移 |
| 同上 §3 断点⑤ / §8 | `response_builder.rs:341-374` / `:389-408` / `:410-430` | **行号全部仍准确**（三个函数的起止行未变） |
| 同上 §3 断点⑥ 实测 A/B | `/tmp/opencode/wb2api-effort-probe/mock_server.py` | **该目录已不存在**（`/tmp/opencode` 下无此项）。本次新建 `/tmp/opencode/yi-a2-probe/`（见 §5.3） |
| 同上 §7 测试计划第 6 条 | 「`cn:space-bunny` 在未声明 `request_params` 时发 `reasoning_effort`」 | **该条依赖断点①，属丙的 B1，乙无法达成**；A1+A2 之后该模型仍是一档且不发（见 §7.3）。乙的替代证据是 `cn:glm-5.3-flash` |
| 同上 §3 断点② | 「`with_canonical_limits` 是唯一会给 `reasoning` 赋非 None 的地方」 | 仍准确（`:156-181`，`if self.reasoning.is_none()` 分支未动） |
| `TASK-fix-custom-provider-capability-pipeline.md` §2 乙 Write Scope | 三个源文件 | 全部真实存在且路径准确；`Read Scope` 里的 `name_builder.rs (:195-213)` 行号也准确——但该文件**不在 Write Scope**，故 A1 可选第二步无法执行（§7.4） |
