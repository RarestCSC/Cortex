# BUG 汇总：自定义供应商的能力信息全线未被消费（5 个症状，1 个根因家族）

- **日期**：2026-10-16
- **状态**：全部已定位；C1/C2 有深度分析文档，C3/C4 为本次新增分析（均已用真实二进制端到端复现），C5 独立文档。**代码一行未动**
- **影响范围**：所有 `engine: openai` 的声明式自定义供应商。内置供应商因模型名都能在公共目录里查到而基本幸免——这正是问题长期没被当成系统性问题发现的原因

## 0. 症状清单

| 编号 | 症状 | 状态 |
|---|---|---|
| **C1** | WorkBuddy / OpenCode 等自定义模型**不支持思考强度**（下拉只剩一档） | 已定位，深度分析见 `BUG-REPORT-realm-prefixed-model-thinking-effort.md` |
| **C2** | 思考档位是**写死的固定列表**，不是按模型实际支持情况给；中转站模型只有固定几档 | 同上（方案 4） |
| **C3** | WorkBuddy / OpenCode 等自定义模型**没有视觉**（图片被替换成占位文本） | 本次新增，已定位 |
| **C4** | UI 新增的「图片输入 自动/开启/关闭」三态开关**点「自动」清不掉已设的值** | 本次新增，**已端到端复现** |
| **C5** | `"api_key_env": null` 让**整个** custom provider 注册表清空 | 已定位，见 `BUG-REPORT-custom-provider-null-api-key-env.md` |

C1/C2/C3/C4 是同一个根因家族的四个症状，C5 独立（配置层，与能力无关）。

## 1. 统一根因：能力有三套来源，Cortex 只用了最差的那套

自定义供应商的能力信息实际有三个来源：

| 来源 | 具体载体 | Cortex 的消费情况 |
|---|---|---|
| ① 用户声明 | `custom_providers/*.json` 里的 `ModelInfo.reasoning` / `ModelInfo.supports_vision` | **`reasoning` 完全没读**；`supports_vision` 只有 provider 侧一处读（见 §2.2），且 UI 表达不回去（见 §2.3） |
| ② 端点元数据 | `GET /v1/models` 返回的 `supports_images`、`reasoning_supported_efforts`、`reasoning_default_effort`、`can_disable_thinking` | **一个字节都没读**（§2.1） |
| ③ 公共静态目录 | `canonical_models.json`（8279 条） | 唯一真正在用的，但**第三方网关的模型名天然不在里面** |

实际生效的是 ③ + 模型名猜测。对自建网关/中转站，三条全部落空：

- 目录里没有 `wb2api` / `opencode-go` 之外的 provider 键（实测：`workbuddy`、`wb2api` 关键词 0 条；provider 键集合无 `cn`、`global`、`wb2api`）
- 名字猜测依赖 `is_reasoning_model()`（`model.rs:305`）与 `is_openai_responses_model()`（`formats/openai.rs:1877`），**都不认识 `cn:` / `global:` 这种 realm 前缀**

于是声明式供应商的能力判定，本质上是在赌模型名是否碰巧撞上公共目录。**这不是某个 provider 的问题，是整条能力管线的问题。**

## 2. C3 细节：视觉为什么没有

### 2.1 端点其实上报了

实测 `http://127.0.0.1:7863/v1/models`：

```
cn:space-bunny     -> {'supports_images': True}
cn:glm-5.3-flash   -> {'supports_images': True}
```

Cortex 从不发 `/v1/models` 请求去取这些字段（`dynamic_models` 未启用时甚至连列表都不拉）。**信息在门口，进来就被丢了。**

### 2.2 声明式 JSON 里的 `supports_vision` 只有一条消费路径

`crates/cortex-providers/src/openai.rs:473-477`：

```rust
fn vision_support(&self, model_config: &ModelConfig) -> Option<bool> {
    self.declared_model(&model_config.model_name)
        .and_then(|model| model.supports_vision)   // ← 用户声明
        .or(model_config.supports_vision)          // ← canonical 回填
}
```

这条**是通的**——所以 `BUG-REPORT-custom-provider-vision.md` 的手写 workaround 有效。当前 `~/.config/cortex/custom_providers/` 里也确实有一处手写生效：

```
custom_siliconflow.json   zai-org/GLM-5.3-Flash   supports_vision=True
```

而 `custom_wb2api.json` 的 9 个模型**一个都没设**（实测确认）。于是 `declared_model()` 返回 `None`，canonical 又查不到 → `unwrap_or_default()` → **`false`** → 图片被 `formats/openai.rs` 替换成 `[image omitted: model does not support vision]`。

所以 C3 的直接原因是「没设值」，但**为什么设不进去**是 C4。

### 2.3 C4：三态开关的「自动」永远清不掉已设值（已端到端复现）

**症状**：在 UI 里点「开启」能存进去；之后再点「自动」，值纹丝不动。

**复现**（隔离配置根 + 真实安装二进制 `cortex acp` 走 JSON-RPC，未发任何模型请求）：

| 步骤 | 请求 | 落盘 `supports_vision` |
|---|---|---|
| 创建 | `modelCapabilities: {}` | `None` / `None` |
| 点「开启」 | `modelCapabilities: {"cn:space-bunny": {"supportsVision": true}}` | **`True`** / `None` ✅ |
| 点「自动」 | `modelCapabilities: {}` | **`True`** / `None` ❌ **没清掉** |

**根因：wire 格式无法表达「显式重置为自动」。**

链路上有两层 `.or()` 把「未设置」和「保持原样」混为一谈：

**第一层** —— `crates/cortex/src/acp/server/providers.rs:406-411`：

```rust
if let Some(supports_vision) = capabilities
    .get(&model.name)
    .and_then(|entry| entry.supports_vision)
{
    model.supports_vision = Some(supports_vision);
}
// capabilities 里没有该模型 → 什么都不做，model 保持上面 clone 来的 existing 值
```

**第二层** —— `crates/cortex/src/config/declarative_providers.rs:310`：

```rust
model.supports_vision = model.supports_vision.or(existing.supports_vision);
```

而 UI 侧「自动」的实现是**删除 key**（`CustomProviderForm.tsx:887`，`if (value === undefined) delete next[name]`）——删除后与「UI 从没碰过这个模型」在 wire 上**完全同构**，后端无法区分，只能理解成「维持现状」。

**所以这个三态控件只有两态能用。** 一旦手动设过，就永久锁死，且 UI 会一直显示「开启」——用户看到的就是「点了自动没反应」。

**附带**：`crates/cortex/tests/acp_custom_provider_methods_test.rs` 是唯一覆盖这条路径的集成测试，而它**完全没有测 `model_capabilities` / `supports_vision`**（实测 grep 无命中），所以这个 bug 一路漏到真机。

**当前可用的绕过**（同 vision 那份）：直接手改 JSON

```jsonc
// ~/.config/cortex/custom_providers/custom_wb2api.json
{ "name": "cn:space-bunny", "supports_vision": true, ... }
```

## 3. C1/C2 细节摘要

完整链路（6 个断点）、实测数据、workaround 与修复方案见 **`BUG-REPORT-realm-prefixed-model-thinking-effort.md`**。要点摘录：

- C1 最恶劣的形态不是「没有功能」而是 **`cn:glm-5.3-flash` 的三档滑块是纯装饰**：`is_reasoning_model()`（菜单侧，认 glm-5.3 名字）与 `openai_reasoning_for_model()`（出站侧，不认）是**两个判定、结论相反**，UI 承诺了它自己不兑现的能力
- 9 个 WorkBuddy 模型**全部不发 `reasoning_effort`**，思考强度恒为网关默认（`cn:space-bunny` 默认 `max` 且关不掉）
- C2 的本质：网关 `/v1/models` 已经按模型返回了 `reasoning_supported_efforts`（如 `cn:hy4-preview` 只有 `high` 一档、`cn:space-bunny` 有 `low/medium/high/xhigh/max`），Cortex 用的是 `thinking_effort_values()` 里写死的 `[off, low, medium, high, max]` 或 `[low, high, max]`，**与模型实际支持逐行不符**
- A/B 实测：调 `GOOSE_THINKING_EFFORT` 对这类模型**完全无效**

## 4. 统一修复方案与顺序

四个方案分属两条线，建议**先做 A 组（止静默失效与假功能），再做 B 组（真正接线）**。

### A 组：诚实化（低风险，先落）

| 编号 | 动作 | 对应 |
|---|---|---|
| **A1** | 正则分隔符纳入 `:`（`formats/openai.rs:1880` 改 `[-/]` → `[-/:]`），修掉 `global:gpt-*` 漏判 | C1 |
| **A2** | 出站闸门与菜单判定对齐，消灭「UI 能调但不发」 | C1 |
| **A3** | 让 `supports_vision` 的三态真正可逆：DTO 增加「显式重置」表达（例如 `supports_vision: null` 与「未提供」区分开，或前端直接透传 `false` 之外的第三态标记） | C4 |
| **A4** | 给 `acp_custom_provider_methods_test.rs` 补 `model_capabilities` / `supports_vision` 的集成覆盖 | C4 |

A3 的实现选择：最干净的做法是让 UI 在选「自动」时**显式发送**该模型的条目（而不是删 key），并在后端区分「显式 null＝清除」与「无条目＝不碰」。需要同步改 `CustomModelCapabilityDto.supports_vision` 的语义（`Option<Option<bool>>` 或加一个 `reset` 标记），**注意这会动 ACP schema，需重跑 `generate-acp-schema` 与 `ui/acp-client` 生成**。

### B 组：真正接线（能力上线，中风险）

| 编号 | 动作 | 对应 |
|---|---|---|
| **B1** | `ModelInfo.reasoning` 进 `ModelConfig`（`model_config.rs:136` 现在硬编码 `None`）。⚠️ 影响**所有** `engine: openai` 自定义供应商，需先设计「声明为 true 但端点拒绝」的降级路径 | C1 |
| **B2** | 消费端点元数据：`GET /v1/models` 的 `supports_images` → `supports_vision`；`reasoning_supported_efforts` → 动态档位集合（替换 `thinking_effort_values()` 的写死列表）；`reasoning_default_effort` → 缺省值 | C1 C2 C3 |
| **B3** | `ThinkingEffort`（off/low/medium/high/max）与网关词表（low/medium/high/**xhigh**/**max**）的双向映射，尤其 `max` ↔ `xhigh`；以及端点不声明支持时的降级策略 | C2 |

B2 是这批症状的**正解**：它把能力判定从「猜模型名」换成「读端点自己的声明」，对任意改名/私有/中转模型零配置生效，同时天然覆盖 C1 C2 C3 三个症状。与 `BUG-REPORT-custom-provider-vision.md` §7 方案 D（运行时探测 + 能力缓存）是同一条路，`/v1/models` 优先、探测兜底。

### D 组：端点不声明能力时的回退（2026-10-17 补）

> **本节是对上面「B2 是正解」的必要限定。** 那句话成立的前提是**端点真的声明能力**。
> 2026-10-17 实测发现该前提对部分网关不成立，而 A/B 全部方案都建立在它之上。

#### Gap A【最高】free-lane 网关（OpenCode 免费车道）不声明任何能力

用户环境里有**两个不同的网关**，此前只验证了其中一个：

| 网关 | 端口 | 服务谁 | `/v1/models` 字段 |
|---|---|---|---|
| workbuddy2api | 7863 | `custom_wb2api` | `id` `supports_images` `supports_reasoning` `reasoning_supported_efforts` `reasoning_default_effort` `can_disable_thinking` `only_reasoning` … **能力齐全** |
| free-lane | 8787 | `custom_cortex-free-opencode` | `id` `object` `owned_by` `name` `context_window` —— **只有 5 个字段，无任何能力元数据** |

free-lane 是用户自写的 `~/.cortex/free-lane/gateway.py`（第 212 行静态构造该列表）。
实测输出：

```json
{"id":"oc-space-bunny-free","object":"model","owned_by":"cortex-free-lane",
 "name":"OpenCode · Space Bunny Free","context_window":262144}
```

当前 `custom_cortex-free-opencode.json` 的三个模型也都是 `reasoning: false`、`supports_vision` 未设。

**⇒ 对 OpenCode 系，A/B 组全部方案均无效：**

| 方案 | 为什么救不了 |
|---|---|
| A1（realm 正则） | `oc-*-free` 没有 `:` 前缀，正则不命中（实测 7 个模型**无一**会被判成 responses 系） |
| B1（`reasoning` 回填） | 忠实搬运配置里的 `false`，等于没修 |
| B2（端点元数据） | **没有字段可消费** |
| B3（档位映射） | 没有档位集合可映射 |

**⇒ 用户报的第 1 条 bug 里「OpenCode 等模型」那一半，按现有任务范围做完仍然是坏的。**

可行的三条（本轮均不在任务内）：

1. **B1 落地后手写配置**——`"reasoning": true` / `"supports_vision": true` 写进
   `custom_cortex-free-opencode.json`。B1 让声明能生效，所以这条能work，且零代码成本。
   **但它是 workaround，不是修复**，且与 vision 那份 §4 是同一类风险（UI 保存可能丢字段）
2. **扩展 `gateway.py`** 加能力字段（`supports_images` / `reasoning_supported_efforts`）
   ——可行但是改用户的工具，且该文件不在本仓库
3. **运行时探测**（vision §7 方案 D）——`supports_vision == None` 时乐观假设 true、
   被拒则剥图重试并缓存。对**任意**不声明能力的端点零配置生效，是唯一覆盖面最广的解

**D 组应当做的是 3（探测兜底），并同时保留 1 作为即时可用的 workaround。**

#### Gap B free-lane 不实现 `/v1/responses`

`gateway.py:220` 只放行 `/v1/chat/completions`：

```python
if self.path.split('?')[0] != '/v1/chat/completions':
```

B4 发现的「realm 前缀模型被改打到 `/v1/responses`」风险，对 free-lane 是**确定会发生**的。
目前 7 个 `oc-*` 模型都不会被 A1 的正则判成 responses 系（已实测），所以**暂时安全**——
但这是**巧合，不是防护**：任何将来被命名为 `gpt-5*`/`gpt-6*`/`o<数字>` 的免费模型
都会立刻踩中，而 free-lane 会 404。

`should_use_responses_api` 的判定应当考虑「端点是否支持 Responses API」，
而不只是模型名——这是 D 组的一部分。

#### Gap C 第 3 条 bug 的「点击完全没反应」从未在 UI 层复现

甲修的是「**自动**清不掉已设值」，其验证走的是 **ACP JSON-RPC 层 + 落盘**
（`docs/FIX-jia-custom-provider-config-layer.md` §5.2），**不是 UI 点击**。

`CustomProviderForm.test.tsx` 共 3 个用例，grep 不到任何 vision/开关相关断言。

若用户当时体验到的确实是「连点开启都没反应」，则还有**第五层**未被排查：
`CustomProviderForm.tsx:331-359` 的 `useEffect(..., [initialData])` 是否在每次 re-render
重置 `modelVision`。源码层面看 `initialData` 来自 `ComposerProviderManager` 的 `useState`，
应当稳定，**但未在运行中的应用里验证过**。

→ D 组应补一条 UI 层的点击复现，确认症状究竟落在哪一层。

#### Gap D 其余中转站的 `/v1/models` 未核查

已实测：workbuddy2api（能力齐全）、free-lane（无能力字段）。
**未核查**：`custom_lite-gpt`(vortexapi.xyz)、`custom_chatanywhere`、
`custom_siliconflow`。查它们需要用用户的 API key 发真实请求，**尚未进行**。

用户报的第 2 条 bug 说的是「**中转站**模型」。若这三个也不声明能力，则 C2 在它们身上
同样修不好，D 组的覆盖面必须包含它们。

### C 组：配置层（独立，可并行）

`api_key_env: null` 的 serde 修复 + 坏文件容错 + 错误对用户可见，见 `BUG-REPORT-custom-provider-null-api-key-env.md` 方案 A2 / B / C。**不要和 A/B 组混在一个改动里**——后者改的是出站请求行为，出问题时很难二分定位。

## 5. 测试计划

A/B 组落修复时统一按此验收（细节见 thinking-effort 那份 §7）：

1. `is_openai_responses_model`：`global:gpt-6-luna` / `cn:gpt-6-sol` → `true`；`gpt-6-luna`、`/gpt-6-luna`、`-gpt-6-luna` 仍 `true`
2. `ModelInfo.reasoning = true` 的自定义模型经 `model_config_from_user_config` 后 `ModelConfig.reasoning == Some(true)`
3. **一致性回归（钉死 C1 的静默失效）**：对同一模型断言「菜单档位数 > 1」⟺「出站 payload 含 `reasoning_effort`」
4. 非推理模型不发 `reasoning_effort`（勿破坏 `BUG-REPORT-developer-role-rejected.md` §82 的既有用例）
5. **三态可逆回归（钉死 C4）**：设置 `true` → 再提交「自动」→ 断言 `supports_vision` 变回 `None`
6. 动态档位回归（B2）：网关只支持单档（如 `cn:hy4-preview`）的模型，菜单只出现那一档
7. `is_reserved_request_param_key` 单测：`reasoning_effort` **不在**名单内（钉住 workaround 有效性）
8. 端到端：本地严格假端点（`/tmp` 下自建，落盘每个请求体），**全程不发真实模型请求**

## 6. 相关文件速查

| 文件 | 作用 |
|---|---|
| `crates/cortex/src/model_config.rs:123-144` | C1：`reasoning: None` 硬编码（方案 B1 挂点） |
| `crates/cortex-provider-types/src/model.rs:148-161` | C1：canonical 回填 `reasoning` 的唯一入口 |
| `crates/cortex-provider-types/src/model.rs:292-303` | C1：出站侧 `openai_reasoning_for_model` |
| `crates/cortex-provider-types/src/model.rs:305-332` | C1：菜单侧 `is_reasoning_model` + glm-5.3 启发式 |
| `crates/cortex-provider-types/src/formats/openai.rs:1755-1793` | C1：`reasoning_effort` 的闸门与写入点 |
| `crates/cortex-provider-types/src/formats/openai.rs:1877-1883` | C1：`is_openai_responses_model` 正则（方案 A1 挂点） |
| `crates/cortex-provider-types/src/formats/openai.rs:67-69` | C1 workaround 的保留名单 |
| `crates/cortex/src/acp/response_builder.rs:341-430` | C1/C2：写死的档位集合与默认值生成（方案 B2 挂点） |
| `crates/cortex-providers/src/openai.rs:469-477` | C3：`ModelInfo` 在出站路径的消费点（只取 `supports_vision`） |
| `crates/cortex-providers/src/openai.rs:833-834,887-900` | C1 workaround 挂点：声明 `request_params` 合并 |
| `crates/cortex/src/acp/server/providers.rs:406-411` | **C4 第一层**：capabilities 缺条目时不覆盖 existing |
| `crates/cortex/src/config/declarative_providers.rs:310` | **C4 第二层**：`.or(existing.supports_vision)` |
| `crates/cortex-sdk-types/src/custom_requests.rs:1252,1280` | `model_capabilities` DTO 定义（方案 A3 挂点；改语义需重跑 `generate-acp-schema`） |
| `ui/desktop/src/components/settings/providers/modal/subcomponents/forms/CustomProviderForm.tsx:864-906` | C4：三态开关 UI；`:887` 用「删 key」表达自动 |
| `ui/desktop/src/acp/providers.ts:95-118` | C4：`updateRequestToCreate`，create/update 共用 |
| `crates/cortex/tests/acp_custom_provider_methods_test.rs` | 唯一覆盖该路径的集成测试，**未测 `model_capabilities`**（方案 A4 挂点） |
| `crates/cortex-provider-types/src/canonical/data/canonical_models.json` | 目录数据（8279 条，无 wb2api / cn / global） |
| `crates/cortex-provider-types/src/base.rs:250-277` | `ModelInfo` 字段定义 |
| `crates/cortex-provider-types/src/base.rs:725-731` | `thinking_effort_support()` 默认 `Unspecified` |