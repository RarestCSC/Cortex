# BUG 报告：自定义 OpenAI 兼容供应商的视觉（图片）能力判定失效

- **日期**：2026-10-13
- **状态**：已定位根因，已有临时 workaround，待下版本根治
- **影响范围**：所有 `custom_*` 声明式自定义供应商（engine: openai）；受影响能力不止视觉，还包括 context_limit / reasoning / cost 的 canonical 回填

## 1. 症状

模型 `zai-org/GLM-5.3-Flash`（SiliconFlow，实际支持图片输入）下，所有图片——用户消息里的附件、以及 `read_image` 等工具返回的图片——均在发送给模型前被替换为占位文本：

```
[image omitted: model does not support vision]
This tool result included an image that was omitted as the model does not support vision.
```

注意：模型侧从未收到图片数据（这不是模型拒绝图片），但提示文案却归因于"模型不支持视觉"，具有一定误导性。

## 2. 复现路径

1. 添加自定义供应商（如 `custom_siliconflow`，base_url 为 OpenAI 兼容端点）
2. 模型设置为 `zai-org/GLM-5.3-Flash`（目录数据源中存在该模型的 image 输入记录）
3. 会话中发送任意图片 → 被替换为占位符

## 3. 根因分析

判定链路（engine=openai 的自定义供应商）：

```text
apply_canonical_limits()                                  crates/goose/src/model_config.rs
  └─ with_canonical_vision_support(provider_name)         crates/goose-provider-types/src/model.rs:134
      └─ canonical_model(provider_name)                   model.rs:121
          └─ maybe_get_canonical_model(provider, model)   crates/goose-provider-types/src/canonical.rs:169
              └─ map_to_canonical_model(...)              crates/goose-provider-types/src/canonical/name_builder.rs:67
```

### 断点 ①：`map_provider_name()` 不认识 `custom_*` 前缀

`name_builder.rs` 的 `map_provider_name()` 只列了内置别名（`xai_oauth`→`x-ai`、`gemini_oauth`→`google`、`zhipu`→`zhipuai` 等），没有任何 `custom_` 前缀剥除规则。于是 `custom_siliconflow` 原样传给 `registry.get("custom_siliconflow", ...)`，必然查不到。

### 断点 ②：目录键与查询键不匹配（数据本身是对的）

`canonical_models.json` 中**确实存在**完全正确的条目：

```json
{
  "id": "siliconflow/zai-org/GLM-5.3-Flash",
  "attachment": true,
  "modalities": { "input": ["text", "image"] },
  "reasoning": true,
  "limit": { "context": 1049000 }
}
```

只要查 `registry.get("siliconflow", "zai-org/GLM-5.3-Flash")` 就能命中（`maybe_get_canonical_model` 里 `split_once('/')` 按第一个 `/` 切分，多段模型名没问题）。差的只是把 `custom_siliconflow` → `siliconflow` 这一步。

### 断点 ③：所有兜底推断对该模型名无效

- `infer_provider_from_model("zai-org/GLM-5.3-Flash")` → 只识别 claude/gpt-/o1/o3/o4/chatgpt- 等前缀，**不含 glm**，返回 None
- `strip_common_prefixes()` 的模式表只有 claude-/gpt-/gemini-/gemma-/o1-/llama-/mistral- 等，不剥 `zai-org/`
- `extract_provider_prefix()` 拆出 `("zai-org", "GLM-5.3-Flash")`，但目录供应商键里**不存在** `zai-org`（只有 `zai`、`zhipuai`）

三条路全 None → `canonical_model()` 返回 None → `supports_vision` 保持 `None`。

### 断点 ④：最终保守降级为 false

`crates/goose-providers/src/openai.rs`：

```rust
fn vision_support(&self, model_config: &ModelConfig) -> Option<bool> {   // :473
    self.declared_model(&model_config.model_name)   // 自定义供应商 JSON 的 ModelInfo
        .and_then(|model| model.supports_vision)    // Cortex UI 未写入该字段 → None
        .or(model_config.supports_vision)           // canonical 链没填 → None
}
// ...
let supports_vision = self.vision_support(model_config).unwrap_or_default();  // :816 → false
```

`supports_vision=false` 传入格式层后，`crates/goose-provider-types/src/formats/openai.rs:448-457` 将图片替换为占位文本。

### 波及面（同一条链的其他受害者）

`with_canonical_limits()`（model.rs:149）同样依赖 `canonical_model()`，因此 `custom_*` 供应商的模型全部拿不到 canonical 的：
- `context_limit`（用户 JSON 里为 null，实际 1,049,000）
- `reasoning`（用户 JSON 里被记录为 false，实际 true）
- `cost`（价格表无法回填）

## 4. 当前已上线的临时 workaround（v 现版本可用）

利用 `ModelInfo.supports_vision` 的"覆盖 canonical 判定"语义（`crates/goose-provider-types/src/base.rs:270` 注释原文 *"when set, overrides canonical detection"*），在用户配置 JSON 的模型条目里手写该字段：

```
~/.config/cortex/custom_providers/custom_siliconflow.json
→ models[] 中 zai-org/GLM-5.3-Flash 条目加 "supports_vision": true
```

`vision_support()` 第一优先级（declared_model）直接命中 Some(true)，完全绕开 canonical 断链。已在真实环境验证通过（截图可正常识别）。

**风险**：如后续在 Cortex UI 里编辑保存该供应商，UI 层序列化 ModelInfo 时需确认不丢弃用户手写的 `supports_vision`；否则回归。

## 5. 修复方案建议

### 方案 B：最小修复（推荐先落，几行代码）

在 `map_to_canonical_model()` 的直查失败后、进入推理链之前，增加 `custom_` 前缀剥除重查：

```rust
// name_builder.rs, map_to_canonical_model()
let normalized_model = strip_version_suffix(model);
if let Some(c) = registry.get(registry_provider, &normalized_model) { /* 原有直查 */ }

// 新增：Cortex 自定义供应商命名习惯为 custom_<目录键>，剥前缀重查
if let Some(bare) = provider.strip_prefix("custom_") {
    if let Some(c) = registry.get(bare, &normalized_model).or_else(|| registry.get(bare, model)) {
        return Some(c.id.clone());
    }
}
```

- 低风险：剥前缀后查不到就走原有推理/None 流程，行为不变
- 命中即一次性修好 vision + context_limit + reasoning + cost
- 注意点：`strip_version_suffix` 等现有归一化逻辑保持复用；混合大小写（`GLM-5.3-Flash`）目录键本身可命中（已用实际数据验证）

### 方案 C：正规修法（可并行推进）

`DeclarativeProviderConfig` 已有 `catalog_provider_id` 字段（`crates/goose/src/config/declarative_providers.rs:153,172`），目前已仅被 ollama_cloud 的 provider matching 消费（`crates/goose/src/providers/ollama_cloud.rs:35`），**canonical 查找链完全没读它**。

建议：在构建/物化 declarative provider 的 ModelInfo 时，以 `catalog_provider_id`（未设则回退方案 B 的 custom_ 剥前缀）作为 canonical 查询键，逐模型回填 `supports_vision / context_limit / reasoning / cost`。由于 `with_canonical_*` 只拿得到 provider name 字符串，需要将 catalog id 透传进 `ModelConfig` 或在 declarative provider 构造期完成回填，改动比 B 大但语义最正。

### 方案 A：产品侧兜底（可选）

在 Cortex UI 的模型编辑里暴露"支持图片输入"开关，持久化到 ModelInfo.supports_vision——让用户无需改 JSON 就能绕过目录缺失（与本次 workaround 等价，但可用、可见、可迁移）。

## 6. 测试计划（落修复时验收用）

1. `name_builder` 单测：`map_to_canonical_model("custom_siliconflow", "zai-org/GLM-5.3-Flash")` → `"siliconflow/zai-org/GLM-5.3-Flash"`
2. `ModelConfig` 单测：该模型经 `apply_canonical_limits("custom_siliconflow")` 后 `supports_vision == Some(true)`、`max_tokens`/`context_limit` 按 canonical 回填
3. 回归：`custom_` 供应商 + 目录中不存在的模型 → 结果仍为 None（保持现状，无误报能力）
4. 回归：内置供应商路径不受影响（现有 canonical 测试全绿）
5. 端到端：formats/openai.rs 在 `supports_vision=true` 时用户消息与 tool 消息中的图片均原样透传（可参照 `crates/goose-providers/tests/declared_vision.rs` 的写法补 custom provider 用例）
6. 真机：Cortex 桌面端 `custom_siliconflow` + GLM-5.3-Flash 发截图成功被模型解析

## 7. 设计演进讨论（2026-10-13，作者确认）：名字匹配不是可靠根基

真实场景：第三方中转站（one-api / new-api 等聚合代理）的模型名是**自定义的**（如 `premium-chat-ultra`、改名的 glm、甚至同 URL 混卖各家模型），单靠内置目录按名字匹配**永远覆盖不全**。因此能力判定应从"静态名字猜测"转向三层体系，运行时探测才是基石：

### 方案 D（新推荐优先级 #1）：运行时探测 + 能力缓存（乐观发送，失败回退）

- `supports_vision == None`（未知）时**乐观假设 true，原样发送**；OpenAI 兼容端点对不支持图片的模型返回明确的 `invalid_request_error`（通常不产生计费），捕获到该错误 → 剥图重试一次，并把探测结果持久化到本地能力缓存（建议键：`base_url 哈希 + 模型名`，例如 `~/.config/cortex/model_capabilities.json`）
- 优点：对任意中转站、任意改名模型零配置生效；错误响应成本≈0
- 已知能力（Some(true/false)）则不探测，零额外开销
- 同样的机制可顺带探测 reasoning 兼容性等其他能力

### 方案 A'（优先级 #2）：能力编辑进 UI + 用户可手写配置（本次 workaround 的产品化）

- 自定义供应商 JSON 的 ModelInfo 已支持 `supports_vision`（base.rs:270，覆盖 canonical 判定）——把它暴露到 Cortex UI 的模型编辑里，并**保证 UI 保存时不丢弃手写字段**（用户优先级高于一切自动判定）
- 剥图占位符出现时，UI 呈现可操作的提示："当前模型未启用图片输入，点击开启"——把静默降级变成一次设置入口

### 端点元数据（优先级 #3，有则用之）

- `GET /v1/models`：siliconflow 官方可用（列表精确，但无能力字段）；one-api 系中转站普遍只给 id 列表，**能力元数据不可期待**
- OpenRouter 例外：`/models` 返回 `architecture.input_modalities`，属"有就消费、没有就退化"的可选增强

### 名字/前缀推断（优先级 #4，降级为兜底启发）

- 原 BUG 报告的方案 B（`custom_` 前缀剥除）与 glm 系前缀启发仍值得保留，但定位降为**兜底暖启动**（缩短首次探测前的错误降级），不再作为根本依赖

### 修订后的落地顺序

1. D（探测+缓存）——根治任意命名，无感
2. A'（UI 能力编辑 + 字段保全 + 占位符引导）——手动override层
3. C（`catalog_provider_id` 接入 canonical）——只在名字能匹配目录时锦上添花（context/cost/reasoning 回填）
4. B（custom_ 剥前缀直查）——并入 3，作为其查找的回退之一

### 附带诚实性修复

无论哪层判定失败，剥图提示应如实报告归属："已按缓存/配置剥离图片（可在设置中修改该模型能力）"，而非一律归因于"模型不支持视觉"。

## 8. 相关文件速查

| 文件 | 作用 |
|---|---|
| `crates/goose-provider-types/src/canonical/name_builder.rs` | 断点①②③：provider/model 名归一与反解 |
| `crates/goose-provider-types/src/canonical.rs:169` | `maybe_get_canonical_model` 入口 |
| `crates/goose-provider-types/src/canonical/data/canonical_models.json` | 目录数据（siliconflow 条目正确） |
| `crates/goose-provider-types/src/model.rs:121,134,149` | canonical 回填 supports_vision/context/reasoning |
| `crates/goose/src/model_config.rs:45-51` | `apply_canonical_limits` 调用点 |
| `crates/goose-providers/src/openai.rs:473,285,816` | vision 判定消费点 + 保守降级 |
| `crates/goose-provider-types/src/formats/openai.rs:448-457` | 占位符替换现场 |
| `crates/goose-provider-types/src/base.rs:250-270` | `ModelInfo`（含 supports_vision 覆盖语义） |
| `crates/goose/src/config/declarative_providers.rs:153,172` | `catalog_provider_id` 字段定义（方案 C 挂点） |
