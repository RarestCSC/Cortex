# BUG 报告：自定义供应商的 `reasoning: true` 是死配置——思考强度不可调、且根本不下发

- **日期**：2026-10-16
- **状态**：已定位根因，已验证可用的配置级 workaround，代码修复待排期
- **范围**：本文是 `BUG-REPORT-custom-provider-capability-pipeline.md`（能力管线汇总）里 **C1 / C2** 两项的深度分析。同批的 C3（视觉缺失）、C4（三态开关不可逆）见汇总文档。**根因家族相同**：声明式 JSON 与端点元数据两套能力来源 Cortex 都不消费，实际只靠静态目录 + 模型名猜
- **影响范围**：所有 `engine: openai` 的声明式自定义供应商中，**模型名无法被内置启发式或 canonical 目录识别**的那部分。本机实例：`custom_wb2api`（WorkBuddy 网关，模型 id 带 `cn:` / `global:` realm 前缀）9 个模型全部中招
- **与既有文档的关系**：`BUG-REPORT-custom-provider-vision.md` §「波及面」已预言本条（"`reasoning`（用户 JSON 里被记录为 false，实际 true）"），本次是第一个被端到端证实的实例。其方案 B（`custom_` 前缀剥除）**已于 2026-10-15 落地**（`name_builder.rs:95-104`，refactor-plan §0.3 ③①），故本条**不是同一个 bug 的复现**，而是暴露了一个更靠上游的原因：目录里压根没有这个网关（见断点 ②）。另额外暴露一个既有文档未覆盖的正则缺陷（见断点 ④）

## 1. 症状

两个叠在一起，且**第二个比第一个严重**：

1. **底栏思考强度不可调**。切到 WorkBuddy 模型后，思考档位下拉只剩一档，UI 提示「该模型没有可调的思考强度」。
2. **即使能调也不会生效**。唯一漏网之鱼 `cn:glm-5.3-flash` 显示 low/high/max 三档可拖，但拖完之后**出站请求里根本没有 `reasoning_effort` 字段**，思考强度始终是网关/模型自己的默认值。

症状 2 是静默的：用户以为改了档位，实际什么都没发生。

## 2. 复现路径

1. 网关已就绪（`~/opt/wb2api`，`127.0.0.1:7863`），`curl /healthz` 返回 `{"healthy":2,"realm_servable":{"cn":true,"global":true}}`
2. 按 `~/opt/wb2api/README-setup.md` §7 的写法落 `~/.config/cortex/custom_providers/custom_wb2api.json`，9 个模型的条目**都写了 `"reasoning": true`**
3. `~/.config/cortex/config.yaml` 注册 `custom_wb2api`
4. 底栏思考档位 → 8 个模型只剩一档；`cn:glm-5.3-flash` 有三档但无效
5. 对照：`curl http://127.0.0.1:7863/v1/models` 显示这 9 个模型全部 `supports_reasoning: true`，且带完整的 `reasoning_supported_efforts`

第 5 步是关键对照——**网关侧的能力元数据是全的，丢在 Cortex 侧**。

## 3. 根因分析

### 断点 ①：`ModelConfig.reasoning` 硬编码 `None`，从不读 `ModelInfo.reasoning`

`crates/cortex/src/model_config.rs:136`（`base_model_config_from_user_config`）：

```rust
let mut model = ModelConfig {
    model_name: model_name.to_string(),
    context_limit: None,
    temperature: get_goose_temperature(config)?,
    max_tokens: None,
    toolshim: get_goose_toolshim(config)?.unwrap_or(false),
    toolshim_model: get_goose_toolshim_model(config)?,
    request_params: None,
    reasoning: None,          // ← 声明式 provider JSON 里的 "reasoning": true 到不了这里
    supports_vision: None,
    request_headers: None,
};
```

provider JSON 里的 `reasoning` 落在 `ModelInfo.reasoning`（`crates/cortex-provider-types/src/base.rs:266-268`，非 Option，默认 `false`）。engine=openai 的出站路径消费 `ModelInfo` 的位置只有两处（`crates/cortex-providers/src/openai.rs`）：

- `declared_model()`（`:474`）→ 只取 `supports_vision`
- `declared_model()`（`:813`）→ 只取 `thinking_preservation_format`

**没有任何一处读 `ModelInfo.reasoning`。** 对比 `supports_vision` 有专门的 provider 侧读取路径（也是 `BUG-REPORT-custom-provider-vision.md` §4 workaround 能生效的原因），`reasoning` 连这条路都没有。

### 断点 ②：canonical 目录里没有这个网关——且这不是 Cortex 的 bug，是覆盖缺口

`ModelConfig::with_canonical_limits`（`crates/cortex-provider-types/src/model.rs:148-161`）是唯一会给 `reasoning` 赋非 None 的地方：

```rust
if self.reasoning.is_none() {
    self.reasoning = canonical.reasoning;   // :160
}
```

`canonical_model()`（`:120`）走 `maybe_get_canonical_model(provider_name, model_name)`。对 `custom_wb2api` + `cn:space-bunny`，`map_to_canonical_model`（`crates/cortex-provider-types/src/canonical/name_builder.rs:67`）**已经把能做的都做了**，仍然 miss，原因有两条，且都不是"代码没剥前缀"：

**其一：`custom_` 前缀剥除已经落地。** `name_builder.rs:99-104`：

```rust
if let Some(bare) = registry_provider.strip_prefix("custom_") {
    let bare = map_provider_name(bare);
    if let Some(canonical) = lookup_canonical(registry, bare, model, &normalized_model) {
        return Some(canonical);
    }
}
```

剥完得到 provider 键 `wb2api`。**目录里没有这个键。** 实测 `crates/cortex-provider-types/src/canonical/data/canonical_models.json`（8279 条）：`wb2api` / `workbuddy` 关键词 **0 条**；provider 键集合里也不存在 `cn`、`global`、`wb2api`。这是**静态目录的覆盖缺口**，不是 Cortex 的逻辑缺陷——目录只收录公共 provider，自建网关天然不在其中。

**其二：名字推断链同样被 `:` 前缀击穿。** `name_builder.rs:195-213` 的 `infer_provider_from_model` 全用 `starts_with`：

```rust
if model_lower.starts_with("gpt-") || model_lower.starts_with("o1") || ... {
    return Some("openai");
}
```

`global:gpt-6-luna` 不以 `gpt-` 开头 → 推断失败；且全链路没有任何地方把 `:` 当命名空间分隔符处理。

对照组：`custom_siliconflow` + `zai-org/GLM-5.3-Flash` 在方案 B 落地后能命中 `siliconflow/zai-org/GLM-5.3-Flash`（目录里有 `reasoning: true`），所以 SiliconFlow 的思考档位是好的。**同样是自定义供应商，能不能调档完全取决于模型名是否碰巧落在公共目录里**——这解释了为什么用户此前没觉得这是系统性问题。

### 断点 ③：名字兜底启发式全部落空

`reasoning` 为 `None` 时，`is_reasoning_model()`（`model.rs:305-316`）退化成按名字猜：

```rust
self.is_openai_reasoning_model()
    || self.model_name.to_lowercase().contains("claude")
    || Self::is_gemini3_reasoning_model_name(&self.model_name)
    || self.is_glm_5_3_reasoning_model()
    || self.is_kimi_k3_reasoning_model()
    || is_xai_reasoning_model(&self.model_name)
```

9 个模型逐条比对（脚本复刻了 `splitn(3,'.')` + 非字母数字切分的原始逻辑）：

| 模型 | 命中 | UI 档位 | 菜单显示默认 |
|---|---|---|---|
| `cn:space-bunny` | — | `[off]` | off |
| `cn:glm-5.3-flash` | **glm-5.3** | `[low, high, max]` | high |
| `cn:hy4-preview` | — | `[off]` | off |
| `cn:deepseek-v4.1-flash` | — | `[off]` | off |
| `global:deepseek-v4.1-flash` | — | `[off]` | off |
| `global:gpt-6-luna` | —（见断点 ④） | `[off]` | off |
| `global:gpt-5.6-terra` | —（见断点 ④） | `[off]` | off |
| `global:gpt-6-sol` | —（见断点 ④） | `[off]` | off |
| `global:grok-4.7` | — | `[off]` | off |

`cn:glm-5.3-flash` 的 `is_glm_5_3_reasoning_model()`（`model.rs:318-332`）之所以能中，是因为 `splitn(3,'.')` 对 `cn:glm-5.3-flash` 只切出 2 段，`nth(2)` 为 `None` → `unwrap_or(全名)` 兜住了，再按非字母数字切成 `["cn","glm","5","3","flash"]`，滑窗命中 `["glm","5","3"]`。**这是巧合，不是设计**。

### 断点 ④（独立缺陷）：realm 前缀 `:` 让两处 `starts_with`/正则全部落空

`global:gpt-6-luna` / `global:gpt-6-sol` / `global:gpt-5.6-terra` 本该被认成 OpenAI responses 系模型。两处都栽在同一个字符上：

`crates/cortex-provider-types/src/formats/openai.rs:1877-1883` 的正则要求 `^` 或 `[-/]`：

```rust
Regex::new(r"(?i)(?:^|[-/])(?:o\d+(?:$|-)|gpt-(?:5|6)(?:$|[-.]))")
```

`name_builder.rs:202` 的 `infer_provider_from_model` 要求 `starts_with("gpt-")`：

```rust
model_lower.starts_with("gpt-")
```

`global:` 的 `:` 两者都不满足，于是：

```
global:gpt-6-luna   正则匹配=False   starts_with("gpt-")=False
gpt-6-luna          正则匹配=True    starts_with("gpt-")=True
/gpt-6-luna         正则匹配=True
-gpt-6-luna         正则匹配=True
```

**任何带 `provider:` 形式前缀的 OpenAI 兼容网关都会踩到**，与 WorkBuddy 无关。建议把 `:` 纳入分隔符字符类（正则侧），并在 `infer_provider_from_model` 前统一剥 realm 前缀。

### 断点 ⑤：菜单生成 → 只有一档 → UI 判定不可调

`crates/cortex/src/acp/response_builder.rs`：

- `build_thinking_effort_choices`（`:341-374`）：openai 引擎的 provider 默认 `thinking_effort_support()` 返回 `ThinkingEffortSupport::Unspecified`（`crates/cortex-provider-types/src/base.rs:725-731`，trait 默认实现），走 `Unspecified` 分支
- `thinking_effort_values`（`:389-408`）：`!is_reasoning_model()` → 只返回 `&[ThinkingEffort::Off]`
- `current_thinking_effort_value`（`:410-430`）：非推理模型 → `"off"`；glm-5.3 分支（`:418-425`）把 `GOOSE_THINKING_EFFORT=medium` 钳成 `high`

UI 侧 `ui/desktop/src/components/settings/models/bottom_bar/ThinkingEffortControl.tsx:339-342`：`choices.length <= 1` → 渲染「该模型没有可调的思考强度」。

### 断点 ⑥（比 ①~⑤ 都严重）：`reasoning_effort` 一个字节都不发

`crates/cortex-provider-types/src/formats/openai.rs:1755-1793`：

```rust
let is_reasoning_model = model_config.openai_reasoning_for_model(&model_name);   // :1756
let reasoning_effort = if is_reasoning_model {
    model_config.thinking_effort().map_or(legacy_reasoning_effort, |effort| {
        openai_reasoning_effort_for_thinking(&model_name, effort)
    })
} else if supports_xai_effort {
    ...
} else {
    None
};
// ...
if let Some(effort) = reasoning_effort {
    payload["reasoning_effort"] = json!(effort);   // :1792
}
```

下发条件走的是 `openai_reasoning_for_model()`（`model.rs:292-303`），它读 `self.reasoning`（None）→ 回落 canonical（miss）→ 回落 `is_openai_responses_model`（被断点 ④ 挡掉）→ **false**。

于是**连 `cn:glm-5.3-flash` 那个能拖的三档滑块也是纯装饰**：`is_reasoning_model()`（菜单侧，认 glm-5.3）和 `openai_reasoning_for_model()`（出站侧，不认 glm-5.3）**是两个不同的判定，结论相反**。这是本条最该修的地方——UI 承诺了一个它自己不兑现的能力。

唯一会给非 responses 模型塞 `reasoning_effort` 的旁路是 `PROVIDERS_NEEDING_REASONING_EFFORT_MAPPING`（`crates/cortex-providers/src/openai.rs:452`），当前硬编码 `&["meta"]`，按 provider 名匹配，不含 `custom_wb2api`。

**实测 A/B（本地严格假端点，未发真实模型请求）**：`/tmp/opencode/wb2api-effort-probe/mock_server.py` 落盘每个请求体，隔离配置根跑 `cortex run -t "只回复 OK"`：

| 配置 | 抓到的 `reasoning_effort` |
|---|---|
| 模型带 `request_params: {"reasoning_effort": "low"}`，`GOOSE_THINKING_EFFORT=medium` | `"low"` ✅ |
| 同上但去掉 `request_params`，`GOOSE_THINKING_EFFORT=high` | **未发送** ❌ |

第二行同时证明：**调 `GOOSE_THINKING_EFFORT` 对这类模型完全无效**，它在到达 `formats/openai.rs` 之前就被 `if is_reasoning_model` 拦掉了。

## 4. 当前实际的思考强度 = 网关默认值

既然 Cortex 不下发，真实强度由网关决定。2026-10-16 从 `http://127.0.0.1:7863/v1/models` 实测：

| 模型 | 网关默认 | 支持档位 | 可关思考 |
|---|---|---|---|
| `cn:space-bunny` | **max** | low/medium/high/xhigh/max | 否 |
| `cn:glm-5.3-flash` | high | low/high/max | 是 |
| `cn:hy4-preview` | high | high（仅一档） | 否 |
| `cn:deepseek-v4.1-flash` | high | low/high/max | 是 |
| `global:deepseek-v4.1-flash` | high | high（仅一档） | 否 |
| `global:gpt-6-luna` | high | low/medium/high/xhigh | 否 |
| `global:gpt-6-sol` | high | low/medium/high/xhigh | 否 |
| `global:gpt-5.6-terra` | high | low/medium/high/xhigh/max | 是 |
| `global:grok-4.7` | high | low/medium/high/xhigh | 否 |

（`reasoning_default_effort`，缺 `can_disable_thinking` 字段即视为不可关）

两个反直觉点：

- **`cn:space-bunny` 默认 `max` 不是 `high`**。倍率 x0.08 的日常主力模型一直跑满思考，且 `only_reasoning: true` 且无 `can_disable_thinking`，**关不掉**。成本敏感场景应优先选 `global:deepseek-v4.1-flash`（x0.00）。
- **`global:deepseek-v4.1-flash` 只支持 high 一档**，本来就没有可调空间。

Cortex 侧显示的档位集合与网关实际支持的集合**逐行不符**（例如 UI 给 `cn:hy4-preview` 一档 off，网关只支持 high）。

## 5. 当前可用 workaround（配置级，已验证）

用 `ModelInfo.request_params` 绕过断点 ⑥。`crates/cortex-providers/src/openai.rs:833-834` 在 payload 构造后合并声明的 `request_params`：

```rust
if let Some(params) = declared_model.and_then(|m| m.request_params.as_ref()) {
    apply_declared_request_params(&mut payload, params);
}
```

`apply_declared_request_params`（`:887-900`）只跳过 `is_reserved_request_param_key`（`formats/openai.rs:67-69`），而该名单只有：

```rust
matches!(key, "messages" | "model" | "stream" | "stream_options")
```

**`reasoning_effort` 不在保留名单里**，会被原样插入请求体，且 `sanitize_request_for_compat`（`:479-532`）对不在三个白名单里的 provider 不做任何删改。

写法（`~/.config/cortex/custom_providers/custom_wb2api.json`）：

```jsonc
{
  "name": "cn:space-bunny",
  "context_limit": 1000000,
  "reasoning": true,
  "request_params": { "reasoning_effort": "low" }   // ← 新增这一行
}
```

**局限，必须对用户讲清**：

- 这是**每个模型一份的静态值**，改要改 JSON + 重启，**不能从 UI 滑块调**
- 9 个模型要各写一份；档位名必须用网关的词表（`low`/`medium`/`high`/`xhigh`/`max`），**和 Cortex 的 `ThinkingEffort`（off/low/medium/high/max）不是一套**——尤其 `max` vs `xhigh`，写错可能被网关拒
- `cn:hy4-preview` / `global:deepseek-v4.1-flash` 网关只支持 `high`，写了别的档位有风险
- **风险（未验证）**：与 `BUG-REPORT-custom-provider-vision.md` §4 同款——§0.3 ③③ 已把 `supports_vision` 做成了 UI 三态开关，但 `request_params` **尚未产品化**。若日后在 Cortex UI 里编辑保存该供应商，UI 层序列化 `ModelInfo` 时可能丢弃手写的 `request_params`，导致静默回归。落 workaround 时需一并验证 UI 保存路径

## 6. 修复方案建议

按「先止静默失效、再补能力」排序。

### 方案 1（必须先做）：消灭「UI 能调但不发」的静默失效

两个判定 `is_reasoning_model()`（菜单侧）与 `openai_reasoning_for_model()`（出站侧）对同一模型给出相反结论，这是本条最恶劣的部分——用户被 UI 误导。

二选一：

- **1a 收紧 UI**：`response_builder.rs:389-408` 改用 `openai_reasoning_for_model()`，让菜单与出站一致。好处是立刻诚实，代价是 `cn:glm-5.3-flash` 的三档也一起消失
- **1b 放宽出站**：`formats/openai.rs:1756` 的条件改为 `is_reasoning_model()`。好处是真能力上线，代价是会给所有非 OpenAI-responses 的推理模型发 `reasoning_effort`，端点不支持时可能 400

倾向 **1b**，因为 `ThinkingEffort` 的语义本就是「provider 宣称支持推理则允许调」，而 `ModelInfo.reasoning: true` 就是这个宣称——只是断点 ① 让它传不下去。配合方案 2 一起做，语义才自洽。

### 方案 2（能力真正上线）：让 `ModelInfo.reasoning` 进入 `ModelConfig`

最小改法，在 `base_model_config_from_user_config`（`model_config.rs:123-144`）之后、物化之前，从 registry 里按模型名取 `ModelInfo` 并回填：

```rust
// 仅在 reasoning 仍为 None 时回填，不覆盖 canonical 与显式配置
if model.reasoning.is_none() {
    model.reasoning = declared_model_reasoning(&provider_name, &model.model_name);
}
```

⚠️ **影响面**：这会改变**所有** `engine: openai` 自定义供应商的行为，而不只是 wb2api。凡是 JSON 里写了 `reasoning: true` 却实际不支持的供应商，都会开始收到 `reasoning_effort`。需要一条「声明为 true 但端点拒绝」的降级路径，或至少在 provider 加载时校验。

### 方案 3（独立小修）：让 realm 前缀 `:` 在识别前被剥掉

两处，**风险低、收益明确，建议独立提交**，不要和方案 1/2 混在一个 commit 里：

- `formats/openai.rs:1880` 正则把分隔符字符类扩成 `[-/:]`
- `name_builder.rs` 在 `infer_provider_from_model` 调用前统一剥 realm 前缀（注意别误伤 `zai-org/GLM-5.3-Flash` 这种 `/` 分隔的供应商命名空间）

只做正则那一行也能修掉断点 ⑥ 对 `global:gpt-*` 的漏判，是性价比最高的单点改动。

### 方案 4（承接 `BUG-REPORT-custom-provider-vision.md` §7）：端点元数据 + `catalog_provider_id`

wb2api 的 `/v1/models` **已经返回了完整的 `reasoning_supported_efforts` / `reasoning_default_effort` / `can_disable_thinking`**——第 4 节那张表就是从这拉的。Cortex 一个字节都没消费。

这是本条的**正解**：能力判定不该靠猜模型名或查静态目录，应该读端点自己的声明。`DeclarativeProviderConfig` 已有 `catalog_provider_id` 字段（`crates/cortex/src/config/declarative_providers.rs`），目前几乎没被消费。

需要新增的映射：Cortex `ThinkingEffort`（off/low/medium/high/max）↔ 网关词表（low/medium/high/xhigh/max），特别是 `max`↔`xhigh` 的双向对齐，以及"网关不声明支持时怎么办"的降级。

### 方案 5（产品侧，与方案 2 配套）

把 `reasoning` 和 `request_params` 暴露到 Cortex UI 的模型编辑里，并**保证 UI 保存时不丢弃用户手写字段**（用户优先级高于一切自动判定）。否则方案 5 之前，workaround 随时可能被一次 UI 保存静默抹掉。

## 7. 测试计划（落修复时验收用）

1. `is_openai_responses_model` 单测：`global:gpt-6-luna` / `cn:gpt-6-sol` → `true`；`gpt-6-luna` 仍 `true`（无回归）
2. `apply_declared_request_params` 单测：`reasoning_effort` **不在** `is_reserved_request_param_key` 名单内（钉住 workaround 的有效性，防止将来把保留名单扩大时误伤）
3. 新增：`ModelInfo.reasoning = true` 的自定义模型，经 `model_config_from_user_config` 后 `ModelConfig.reasoning == Some(true)`
4. 新增：非推理模型不发 `reasoning_effort`（回归保护，`BUG-REPORT-developer-role-rejected.md` §82 已有类似用例，别破坏）
5. 菜单/出站一致性回归：对同一模型断言 `thinking_effort_values()` 的档位数 > 1 ⟺ 出站 payload 含 `reasoning_effort`。**这条是防止方案 1 的静默失效复现**
6. 端到端（本地严格假端点，未发真实模型请求）：复用 `/tmp/opencode/wb2api-effort-probe/`，断言 `cn:space-bunny` 在未声明 `request_params` 时发 `reasoning_effort`，值取自 `GOOSE_THINKING_EFFORT`
7. 真机：`custom_wb2api` + `cn:space-bunny`，底栏拖档位，网关 `/status` 的 `usage.json` 或请求日志显示实际 effort 变化

## 8. 相关文件速查

| 文件 | 作用 |
|---|---|
| `crates/cortex/src/model_config.rs:123-144` | 断点①：`reasoning: None` 硬编码 |
| `crates/cortex-provider-types/src/model.rs:148-161` | 断点②：canonical 回填 `reasoning` 的唯一入口 |
| `crates/cortex-provider-types/src/model.rs:292-303` | 断点⑥：`openai_reasoning_for_model` 出站判定 |
| `crates/cortex-provider-types/src/model.rs:305-332` | 断点③：`is_reasoning_model` 菜单判定 + glm-5.3 启发式 |
| `crates/cortex-provider-types/src/canonical/name_builder.rs:95-104` | 方案 B 已落地：`custom_` 前缀剥除重查 |
| `crates/cortex-provider-types/src/canonical/name_builder.rs:195-213` | 断点④：`infer_provider_from_model` 全用 `starts_with` |
| `crates/cortex-provider-types/src/formats/openai.rs:1755-1793` | 断点⑥：`reasoning_effort` 的 `if is_reasoning_model` 闸门与写入点 |
| `crates/cortex-provider-types/src/formats/openai.rs:1877-1883` | 断点④：responses 模型正则（方案 3 挂点） |
| `crates/cortex-provider-types/src/formats/openai.rs:67-69` | workaround 的保留名单（`reasoning_effort` 不在内） |
| `crates/cortex-provider-types/src/base.rs:250-277` | `ModelInfo`（`reasoning` / `request_params` 字段定义） |
| `crates/cortex-provider-types/src/base.rs:725-731` | `thinking_effort_support()` 默认 `Unspecified` |
| `crates/cortex/src/acp/response_builder.rs:341-430` | 断点⑤：档位集合与默认值的生成 |
| `crates/cortex-providers/src/openai.rs:452,479-532` | `PROVIDERS_NEEDING_REASONING_EFFORT_MAPPING` 白名单（仅 `meta`） |
| `crates/cortex-providers/src/openai.rs:833-834,887-900` | workaround 挂点：声明 `request_params` 合并 |
| `crates/cortex-providers/src/openai.rs:469-477,813` | `ModelInfo` 在出站路径的全部消费点（均不读 `reasoning`） |
| `ui/desktop/src/components/settings/models/bottom_bar/ThinkingEffortControl.tsx:331-342` | UI 的三处降级分支 |
| `crates/cortex-provider-types/src/canonical/data/canonical_models.json` | 目录数据（8279 条，无 wb2api / cn / global） |