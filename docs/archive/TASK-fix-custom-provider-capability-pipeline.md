# TASK：修复自定义供应商能力管线（5 个症状，C1–C5）

- **日期**：2026-10-16
- **状态**：待执行。三个会话（甲/乙/丙），两路并行 + 一个串行尾巴
- **驱动文档**：`docs/refactor-plan.md` §0 首条
- **分析依据**：
  - `BUG-REPORT-custom-provider-capability-pipeline.md`（统一索引 + C1~C5 全貌）
  - `BUG-REPORT-realm-prefixed-model-thinking-effort.md`（C1/C2 深度，6 个断点链）
  - `BUG-REPORT-custom-provider-null-api-key-env.md`（C5 深度）
  - `BUG-REPORT-custom-provider-vision.md`（C3 的前史，其方案 B 已落地，见「不可重复实现」）

---

## 0. 调度决策

```text
Scheduling mode: S2（两路并行）+ 一个串行尾巴

并行批
  ├─ 甲：配置层    C5 + C4        （小、独立、跨前端与 DTO）
  └─ 乙：诚实化    A1 + A2        （消除"UI 能调但不发"的静默失效）
                    ↓ 必须等乙绿
串行批
  └─ 丙：能力上线  B1 + B2 + B3    （最大，且与乙有文件+逻辑双重依赖）
```

**Why this size**：三个单元各自 ≥30 分钟、结果彼此独立、写入范围可互不重叠。合并甲乙会因跨层（Rust DTO + schema + TSX）而需要单会话同时持有两种上下文；拆得更细则启动与重复读文档的成本超过收益。

**Why not more agents（不能再并行）**：
1. **构建拿不到并行收益**——见 §1 硬约束，三个会话共用一个 `target/`。
2. **B 组与 A 组有逻辑依赖**——A2 改的是出站闸门，B1/B2 改的是这道闸门的输入；A2 未绿时上 B 组，A2 的一致性回归测不出东西。
3. 丙的文件范围与乙重叠 2 个文件，硬拆会产生 write conflict。

**Why not fully serial**：人在开会话，等待时间不产生价值；并行至少让甲乙的编辑阶段重叠（≈40 分钟）。

**Expected proof**：见 §4 每个会话的 Acceptance Criteria + §5 全局验收。

**并行实际收益的诚实估计**：≈40 分钟 / 总计 ≈4.5 小时（约 15%，低于 S2 常见的 30% 阈值）。之所以仍值得并行，是因为**调度者是人不是 agent**——人的等待时间不可回收。若由单一 agent 调度，应改为串行。

---

## 1. 硬约束（三会话共享，违反会互相破坏）

### 1.1 构建不并行，且当前是冷构建

| 项 | 实测 |
|---|---|
| `target/` | **不存在**（2026-10-16 确认） |
| `CARGO_TARGET_ROOT` | 未设 |
| sccache | 无 |
| `.cargo/config.toml` | 只有 windows/wasm 段，无共享目标目录 |

→ 三个会话共用 `/home/rarestcsc/Cortex/target`，**cargo 会对构建目录加锁**。构建严格串行，只有编辑能并行。

**派活时必须写进每个 prompt**：

> 如果 cargo 报构建目录被锁，等 2 分钟重试。**不要**删 `target/`、**不要**改 `CARGO_TARGET_DIR`。超时会留下半成品锁，导致其他会话构建失败。

**谁先跑 cargo 谁扛冷构建** → 指定甲先跑。

### 1.2 Rust 改动要批量

`docs/refactor-plan.md` §0.2 记录：「改 Rust 一个词也要 12m39s（级联 cortex→cortex-mcp→cortex-cli＋链接 290MB 二进制）」。同一会话内批量改完再编译，不要改一行编一次。

**能省则省**：只动叶 crate 的会话优先用 `cargo test -p <crate>` 验证，避免触发 cortex-cli 的 290MB 链接。

### 1.3 测试隔离（硬边界）

- 全程 `export GOOSE_PATH_ROOT=/tmp/opencode/<你的目录>`
- 配置在 **`<root>/config`** 下，**不是 root 本身**（`paths.rs:9-17`）
- **绝不触碰**真实 `~/.config/cortex` 与 `~/.config/goose`
- **不发送任何真实模型请求**。出站请求体用本地严格假端点验证（`/tmp` 下自建，落盘每个请求体）。refactor-plan §4.11 有先例。
- 已知用户环境里有 WorkBuddy 网关（`~/opt/wb2api`，`127.0.0.1:7863`），`cn:space-bunny` 默认跑 `max` 思考、倍率 x0.08 —— **不要为了验证去打它**。

### 1.4 不可重复实现（已落地的，别重做）

| 事项 | 已落地位置 |
|---|---|
| vision 的方案 B（`custom_` 前缀剥除） | `name_builder.rs:95-104`，含 `test_custom_provider_prefix_resolves_catalog_models` |
| vision 的方案 A'（图片输入三态 UI） | `CustomProviderForm.tsx:864-906` ← **C4 就是把它修能用，不是重做** |
| developer 角色 400 修复 | `BUG-REPORT-developer-role-rejected.md` 方案 A，见 `refactor-plan.md` §0 首条 |

---

## 2. Task Contract

### 甲：配置层（C5 + C4）

```text
Task ID: 甲
Objective:
  C5 —— 让 "api_key_env": null 不再炸掉整个 custom provider 注册表。
  C4 —— 让视觉三态开关真正可逆（当前「自动」永久清不掉已设值）。

Dependencies: 无。可立即开工。

Read Scope:
  docs/BUG-REPORT-custom-provider-capability-pipeline.md   §2.3、C5 行
  docs/BUG-REPORT-custom-provider-null-api-key-env.md       §3、§5、§6
  crates/cortex-provider-types/src/declarative.rs            (:155-156 断点①)
  crates/cortex-providers/src/declarative.rs                 (:337-353 断点②)
  crates/cortex/src/config/declarative_providers.rs
  crates/cortex/src/acp/server/providers.rs                  (:390-435)
  crates/cortex-sdk-types/src/custom_requests.rs             (:1236,:1252,:1280)
  crates/cortex/tests/acp_custom_provider_methods_test.rs
  ui/desktop/src/components/settings/providers/modal/subcomponents/forms/CustomProviderForm.tsx
  ui/desktop/src/acp/providers.ts

Write Scope:
  crates/cortex-provider-types/src/declarative.rs
  crates/cortex-providers/src/declarative.rs
  crates/cortex/src/acp/server/providers.rs
  crates/cortex/src/config/declarative_providers.rs     ← C4 需要，见 §2 甲 勘误
  crates/cortex-sdk-types/src/custom_requests.rs
  crates/cortex/tests/acp_custom_provider_methods_test.rs
  ui/desktop/src/components/settings/providers/modal/subcomponents/forms/CustomProviderForm.tsx
  ui/desktop/src/acp/providers.ts
  ACP schema JSON + ui/acp-client/src/generated/     （**C4 实际不需要改 schema**，见勘误）

Forbidden Scope:
  crates/cortex-provider-types/src/formats/openai.rs     ← 乙所有
  crates/cortex-provider-types/src/model.rs              ← 乙所有
  crates/cortex-provider-types/src/base.rs               ← 丙所有
  crates/cortex/src/acp/response_builder.rs              ← 乙所有
  crates/cortex/src/model_config.rs                      ← 丙所有
  crates/cortex-providers/src/openai.rs                  ← 丙所有
  真实 ~/.config/cortex 与 ~/.config/goose

Acceptance Criteria:
  C5:
   - `api_key_env` 为 null / 缺失 / "" / "FOO" 四种输入全部解析成功，
     前三者语义等价于 ""
   - 回归：全部合法文件时加载结果与现状逐字节一致
   - 回归：`*.json.bak` 之类非 .json 后缀仍被 `path.extension()? == "json"` 过滤掉
  C4:
   - 「开启」能写入；再提交「自动」能把 supports_vision 变回 None（端到端）
   - 回归：未提供条目时保持原值不被清（别把「不碰」语义一起改坏）
   - crates/cortex/tests/acp_custom_provider_methods_test.rs 补 model_capabilities /
     supports_vision 覆盖（现为零覆盖，这是它一路漏到真机的原因）
   - 跑过 `just generate-acp-types`（一次跑完 schema + TS 两步）
   - i18n 不得新增/变更任何键（本次无新 UI 文案）
   - cd ui/desktop && node ../node_modules/typescript/bin/tsc --noEmit 通过
     （用工作区二进制，避免触发依赖同步）

Requested handoff: inline 结果。列出结论、涉及文件、验证命令与结果、限制、后续步骤。
```

**甲的实现提示（已验证的根因，别重新推导）**

C4 的根因是 **wire 格式表达不了「显式重置为自动」**，两层叠加：

- `CustomProviderForm.tsx:887` —— UI 选「自动」的实现是 `delete next[name]`，
  删掉后与「UI 没碰过这个模型」在协议上**完全同构**
- `providers.rs:406-411` —— `if let Some(...)` 缺条目时不覆盖，model 保持 clone 来的 existing 值
- `declarative_providers.rs:310` —— `model.supports_vision = model.supports_vision.or(existing.supports_vision)` 兜住

复现命令（真实二进制，未发模型请求）：

```bash
# cortex acp 走 JSON-RPC；CustomProviderCreateRequest 是 #[serde(flatten)] 的
# CustomProviderUpsertDto + toolshim，即字段平铺在请求顶层，没有 "provider" 包装层
send("_goose/unstable/providers/custom/create",
     {**base, "toolshim": False, "modelCapabilities": {}}, 2)
send("_goose/unstable/providers/custom/update",
     {**base, "providerId": pid, "toolshim": False,
      "modelCapabilities": {"cn:space-bunny": {"supportsVision": True}}}, 3)
# → 落盘 supports_vision = True
send("_goose/unstable/providers/custom/update",
     {**base, "providerId": pid, "toolshim": False, "modelCapabilities": {}}, 4)
# → 落盘仍为 True  ← 复现 C4
```

#### 勘误（甲会话提出质疑后修正，2026-10-16）

初版这里写的「改 DTO 语义 + 重跑 schema」**是多余的**。链路实际是**两处**、不是一处：

```text
providers.rs:394   existing.iter().find(name).cloned()
                    ↑ 把旧的 supports_vision（Some(true)）预先塞进入参模型
providers.rs:406   if let Some(sv) = capabilities.get(&name).and_then(|e| e.supports_vision)
                    ↑ UI 发显式 null 时 .and_then 得 None，分支不跑，旧值留下
declarative_providers.rs:310   model.supports_vision = model.supports_vision.or(existing.supports_vision)
                    ↑ 在这条路径上早已是 no-op（:394 已预置），删掉它不改变任何行为
```

**所以只改 `:310` 无效**——它幂等不是因为写得对，而是因为 `:394` 已经把值预置好了。
`update_custom_provider` 的**唯一生产调用方**就是 `providers.rs:743`（其余 3 处
`declarative_providers.rs:835`/`:957` 与 `agents/agent.rs:1880` 均在 `#[cfg(test)]` 内），
而该调用方已经全量预置，因此删 `:310` 对生产路径零影响。

**正确改法是两处一起**：

1. `providers.rs:406-411` —— 用 `match capabilities.get(&model.name)` 区分「无条目
   =不碰」与「有条目但为 null =显式清除」；`Some(entry) => model.supports_vision = entry.supports_vision`
2. `declarative_providers.rs:310` —— 删掉 `supports_vision` 的 `.or()` 兜底（其余
   `.or()` 保留，它们仍靠 `:394` 的预置生效）
3. `CustomProviderForm.tsx:887` —— `delete next[name]` 改为 `next[name] = undefined`
   并放宽 `Record<string, boolean>` 类型；`Object.entries` 对显式 undefined 仍会产出
   该 key，`acp/providers.ts:107` 的 `?? null` 随即把它序列化成 `null`

**不需要改 DTO / schema / `ui/acp-client`**：`HashMap::get` 的 `Option<&Dto>` 本身
就已区分「无条目」与「有条目为 null」。读回路径 `custom_provider_model_capabilities`
（`providers.rs:419-435`）已正确过滤 `None`，UI 会显示回「自动」——闭环成立。

C5 的修复见 `BUG-REPORT-custom-provider-null-api-key-env.md` 方案 A2：加一个把
`null`/缺失都归一化成 `""` 的 `deserialize_with`，**保持 `String` 类型不变**。
不要改成 `Option<String>`——该类型跨 crate 传递，改动面比看起来大。
方案 B（坏文件跳过而非全灭）与 C（错误对用户可见）**本轮不做**。

---

### 乙：诚实化（A1 + A2）

```text
Task ID: 乙
Objective:
  A1 —— 让 is_openai_responses_model 的正则认得 realm 前缀（`:`）
  A2 —— 消灭「UI 能调但出站不发 reasoning_effort」的静默失效

Dependencies: 无。可立即开工（先编辑，等甲建热 target/ 再编译）。

Read Scope:
  docs/BUG-REPORT-realm-prefixed-model-thinking-effort.md   §3 断点④⑥、§4、§7
  crates/cortex-provider-types/src/formats/openai.rs
    (:67-69 保留名单, :1755-1793 闸门与写入点, :1877-1883 正则)
  crates/cortex-provider-types/src/model.rs
    (:292-303 openai_reasoning_for_model, :305-332 is_reasoning_model)
  crates/cortex-provider-types/src/canonical/name_builder.rs  (:195-213)
  crates/cortex/src/acp/response_builder.rs                  (:341-430)
  ui/desktop/src/components/settings/models/bottom_bar/ThinkingEffortControl.tsx

Write Scope:
  crates/cortex-provider-types/src/formats/openai.rs
  crates/cortex-provider-types/src/model.rs
  crates/cortex/src/acp/response_builder.rs

Forbidden Scope:
  其余全部 crate（甲、丙所有，见 §3 所有权表）
  不新增 i18n 键
  真实 ~/.config/cortex 与 ~/.config/goose

Acceptance Criteria:
  A1:
   - is_openai_responses_model("global:gpt-6-luna") == true
   - is_openai_responses_model("cn:gpt-6-sol") == true
   - is_openai_responses_model("global:gpt-5.6-terra") == true
   - 无回归："gpt-6-luna"、"/gpt-6-luna"、"-gpt-6-luna" 仍为 true
   - 可选第二步：name_builder.rs:202 的 infer_provider_from_model 全用 starts_with("gpt-")，
     在其调用前统一剥 realm 前缀。**注意别误伤 zai-org/GLM-5.3-Flash 这类 / 分隔的
     供应商命名空间**，也别动 :95-104 已落地的 custom_ 剥除
  A2:
   - 一致性回归（核心）：对同一模型断言「菜单档位数 > 1」⟺「出站 payload 含
     reasoning_effort」。这条钉死静默失效不得复现
   - 非推理模型仍不发 reasoning_effort（勿破坏
     BUG-REPORT-developer-role-rejected.md §82 的既有用例）
   - 端到端假端点验证：cn:space-bunny 类模型出站 payload 含 reasoning_effort，
     值取自 GOOSE_THINKING_EFFORT

Requested handoff: inline 结果。必须说明 A2 最终选了哪条路线（见下）与理由。
```

**乙的实现提示**

A2 有两条路线，**动手前必须先评估影响面并显式说明选了哪条**：

- **1b（文档倾向）**：`formats/openai.rs:1756` 的闸门从 `openai_reasoning_for_model()`
  改成 `is_reasoning_model()`。好处是真能力上线；代价是**所有非 OpenAI-responses 的
  推理模型都会开始收到 `reasoning_effort`**，端点不支持时可能 400。
- **1a（保守）**：`response_builder.rs:389` 的 `thinking_effort_values` 改用
  `openai_reasoning_for_model()`，让菜单与出站一致。立刻诚实，代价是
  `cn:glm-5.3-flash` 的三档也一起消失。

倾向 1b：`ThinkingEffort` 的语义本就是「provider 宣称支持推理则允许调」，而
`ModelInfo.reasoning: true` 就是这个宣称，只是被断点①（`model_config.rs:136`
硬编码 `reasoning: None`）挡住了。但 1b 的 400 风险必须写进 handoff 的「限制」栏。

---

### 丙：能力上线（B1 + B2 + B3）——必须等乙绿

```text
Task ID: 丙
Objective:
  把能力判定从「猜模型名 / 查静态目录」换成「读端点自己的声明」。
  B2 是正解，一次覆盖 C1 C2 C3 三个症状。

Dependencies: **甲（Task ID: 甲）与乙（Task ID: 乙）都必须已完成且测试绿。**
  - 等乙：理由见 §0（B1/B2 改的是 A2 那道闸门的输入）
  - 等甲：理由见 §3 所有权表（B2 接 /v1/models 可能要碰甲的
    cortex-providers/src/declarative.rs 与 declarative_providers.rs）
  初版只写了「等乙绿」，是漏的，已修正。

Read Scope（行号以甲乙交付后的工作树为准）：
  docs/FIX-jia-custom-provider-config-layer.md   ← 甲交付，§7.1 的 supports_vision 权威值契约
  docs/FIX-yi-reasoning-effort-honesty.md       ← 乙交付，§7.1/§7.2/§7.4/§8.1 全是给丙的
  docs/BUG-REPORT-realm-prefixed-model-thinking-effort.md   §4、§6 方案 2/4、§7
  docs/BUG-REPORT-custom-provider-capability-pipeline.md     §4 B 组
  docs/BUG-REPORT-custom-provider-vision.md                 §7（方案 D 的设计背景）
  crates/cortex/src/model_config.rs                    (:123-144 断点①)
  crates/cortex-provider-types/src/model.rs            (:156-181 canonical 回填,
                                                        :300-311 openai_reasoning_for_model,
                                                        :313-336 is_reasoning_model,
                                                        :334 sends_thinking_effort 新增)
  crates/cortex-provider-types/src/base.rs             (:250-277 ModelInfo, :725-731)
  crates/cortex/src/acp/response_builder.rs            (:341-430)
  crates/cortex-provider-types/src/formats/openai.rs
  crates/cortex-provider-types/src/formats/openai_responses.rs    (:653-680 自己的闸门)
  crates/cortex-provider-types/src/canonical/name_builder.rs      (:195-213 乙未做，移交丙)
  crates/cortex-providers/src/openai.rs               (should_use_responses_api)

Write Scope:
  crates/cortex/src/model_config.rs
  crates/cortex-provider-types/src/model.rs
  crates/cortex-provider-types/src/base.rs
  crates/cortex/src/acp/response_builder.rs
  crates/cortex-provider-types/src/formats/openai.rs
  crates/cortex-provider-types/src/formats/openai_responses.rs
  crates/cortex-provider-types/src/canonical/name_builder.rs    ← 乙 §7.4 移交，见 D5
  crates/cortex-providers/src/openai.rs
  （G1 探测兜底可能需要新的能力缓存模块——落在 cortex-provider-types 或 cortex 下，
    具体位置由你定，但不要新建 crate）
  （B2 接 /v1/models 元数据可能需要 crates/cortex-providers/src/declarative.rs 或
    crates/cortex/src/config/declarative_providers.rs —— 这两个是甲的，必须在甲
    完成后才动。⚠️ declarative_providers.rs 里 supports_vision 的 .or() 兜底
    已被甲删除，params.models 的值现在是权威值，回填 reasoning 时照此办理，见 D3）

Forbidden Scope:
  crates/cortex-sdk-types/src/custom_requests.rs     ← 甲所有
  crates/cortex/src/acp/server/providers.rs          ← 甲所有
  crates/cortex-providers/src/declarative.rs          ← 甲所有（除非甲已完成且确有必要）
  ui/desktop/**                                       ← 甲所有
  ACP schema / ui/acp-client 生成物                   ← 甲所有
  crates/cortex/tests/acp_fixtures/**                 ← 见 D6 的版本名阻断，勿改断言
  不新增 i18n 键

Acceptance Criteria:
  B1:
   - ModelInfo.reasoning = true 的自定义模型，经 model_config_from_user_config 后
     ModelConfig.reasoning == Some(true)
   - 降级路径从「最好有」升级为「必须先有」（乙 §7.1）：B1 一落地，
     cn:space-bunny 这类声明为 true 的模型会立刻走进 1b 的出站闸门，而闸门
     没有任何 400 回落。先有降级，再开 B1。说明策略（重试降级 /
     能力缓存标记 / 探测回退）
   - 回填值是权威值，不做兜底继承（照甲 §7.1 的 supports_vision 契约，见 D3）
  B2:
   - 消费 GET /v1/models：supports_images → supports_vision
   - 消费 reasoning_supported_efforts → 动态档位集合
   - 消费 reasoning_default_effort → 缺省值
   - 端点声明喂 sends_thinking_effort()，不要改 is_reasoning_model() 或
     openai_reasoning_for_model() 的语义（乙 §8.1）——那会把刚统一的契约重新分叉
   - 动态档位回归：网关只支持单档的模型（如 cn:hy4-preview 只有 high），菜单只出现那一档
   - ⚠️ **已实测 free-lane 网关（127.0.0.1:8787，OpenCode 免费车道）的 /v1/models
     只有 id/object/owned_by/name/context_window 五个字段、没有任何能力元数据，
     B2 对它完全无效**。端点不声明能力时必须有明确降级，那就是 G 组的工作
  B3:
   - ThinkingEffort(off/low/medium/high/max) ↔ 网关词表(low/medium/high/xhigh/max)
     双向映射，max ↔ xhigh 双向都要
   - 替换 formats/openai.rs:1969 openai_reasoning_efforts_for_model() 的硬编码
     回落 ["low","medium","high"]（乙 §8.1 第 2 点）——那才是 realm 前缀模型
     实际走到的分支
  B4（新，接自乙 §7.2 + §8.1 第 4 点）:
   - 核对 formats/openai_responses.rs:653-680 的闸门与菜单是否一致。A1 已把 realm
     前缀模型路由到 /v1/responses，这条路径的一致性至今未验证
   - should_use_responses_api 的判定应考虑「端点是否支持 Responses API」，不只模型名
     （见 D9-B：free-lane 网关只放行 /v1/chat/completions）
  G（新，接自 D 组 Gap A/B/C/D —— 用户报的 bug 有一半当前修不了，见 D9）:
   - G1 运行时探测兜底：supports_vision == None 时乐观假设 true，被端点明确拒绝则
     剥图重试一次并把结果持久化（缓存建议 ~/.config/cortex/model_capabilities.json，
     键 = base_url 哈希 + 模型名）。这是唯一对「不声明能力的端点」零配置生效的解
   - G2 端点不声明 reasoning 能力时，给用户可操作的提示而不是静默一档
     （对齐 vision §7「附带诚实性修复」：静默降级要变成一次设置入口）
   - G3 补 UI 层点击复现，确认第 3 条 bug 究竟落在哪一层（见 D9-C）
  回归（必须改判据，见 D7）:
   - 乙留下的 test_effort_menu_matches_the_outgoing_payload 以
     thinking_effort_values().len() > 1 为判据。B2 的动态档位落地后，
     「网关只支持单档」的合法模型会被这个判据误判成不一致。
     判据须改成「菜单档位集合 ⊆ 端点声明的集合且非空」之类
  通用:
   - 保留 workaround 的有效性：is_reserved_request_param_key 单测断言
   - cargo fmt + cargo clippy --all-targets -- -D warnings 通过

Requested handoff: inline 结果。必须包含降级策略的设计说明与「限制」栏。
```

**丙的实现提示**

#### D1：`formats/openai.rs` 授权给丙

B3 的映射函数是 `openai_reasoning_effort_for_thinking`（`formats/openai.rs:1939`）与
`xai_reasoning_effort_for_thinking`（`:1920`），都在**乙的所有物**里。初版 Contract
把该文件列入丙的 Forbidden Scope，丙一碰就误标 `SHARED_FILE_CONFLICT`。因为丙串在
乙之后，实际是安全的，但必须**明写授权**，不能靠它猜。

#### D2：Dependency 要等甲和乙两个

初版只写「等乙绿」，漏了甲——B2 可能要碰甲的 `cortex-providers/src/declarative.rs`
与 `declarative_providers.rs`（§3 所有权表）。已修正为「甲、乙都必须已完成」。

#### D3：`reasoning` 有和 C4 同类的不可逆 bug，B1 必撞

`declarative_providers.rs:311`：

```rust
model.reasoning |= existing.reasoning;
```

配合 `providers.rs:394` 的 `.cloned()` 预置 —— **`reasoning: false` 永远设不进去**，
一旦为 true 就锁死。这正是 C4（`supports_vision`）的 bool 版本，甲刚在那边踩过。

丙的 B1 做的正是「让 `ModelInfo.reasoning` 生效」，所以一定会撞上。**必须显式表态**：
同批一起修（与甲修 `supports_vision` 同风格），还是标为 out of scope 交回主会话。
默认建议**同批修**——否则 B1 上线后用户会立刻遇到「关不掉」。

注意：若甲已在 `providers.rs:394`/`:406` 与 `declarative_providers.rs:310` 做过
「区分未提供 vs 显式清除」的改造，丙应复用同一套判别方式，**不要引入第二套机制**。

#### D4：B1 的注入顺序必须在 canonical 之前

`ModelInfo` 两个能力字段的注释都是「用户优先级高于目录判定」（`base.rs:266-271`）。
`with_canonical_limits`（`model.rs:148-161`）里的 `if self.reasoning.is_none()` 只在
None 时回填，所以 B1 必须在 `apply_canonical_limits` **之前**注入，否则 canonical 的
值会把用户声明盖回去，B1 白做。

#### B2 的元数据来源与降级

- 查找入口已有：`base.rs:385` 的 `find_declared_model`
- 消费 `GET /v1/models` 的 `supports_images` / `reasoning_supported_efforts` /
  `reasoning_default_effort`
- ⚠️ **不少 OpenAI 兼容中转站的 `/v1/models` 只给 id 列表，没有任何能力字段**
  （见 `BUG-REPORT-custom-provider-vision.md` §7「端点元数据」小节）。因此
  「端点不声明能力」必须有明确降级策略，不能假定字段一定存在
- 能力缓存落点建议 `~/.config/cortex/model_capabilities.json`（键：base_url 哈希 +
  模型名），沿用 vision 那份 §7 方案 D 的设计

---

#### D5：甲乙交付后新增的四点移交（2026-10-17 补）

##### D5-a【接自乙 §7.4】`name_builder.rs` 的 realm 前缀剥除现由丙负责

乙因为它不在 Write Scope 而没做（Forbidden Scope 是「其余全部 crate」）。后果：
`infer_provider_from_model` 全用 `starts_with("gpt-")`，`global:gpt-6-luna` 推断不回
`openai`，因而**拿不到 canonical 的 `context_limit` / `max_tokens` 回填**。

已加进丙的 Write Scope。两条护栏：
- **不能误伤 `zai-org/GLM-5.3-Flash` 这类 `/` 分隔的供应商命名空间**
- **不能动 `name_builder.rs:95-104` 已落地的 `custom_` 剥除**（方案 B，2026-10-15）

##### D5-b【接自甲 §7.1】回填值是权威值，不做兜底继承

甲已在 `declarative_providers.rs` 删掉 `supports_vision` 的 `.or(existing...)` 兜底，
理由和 §7.1 一致：**入参侧的值是权威的**。B1 回填 `reasoning` 时照同一思路办理——
不要写 `model.reasoning = model.reasoning || existing.reasoning` 这种合并。

⚠️ 甲在同一处留下的现状：`declarative_providers.rs:311` 仍是
`model.reasoning |= existing.reasoning`，即 **`reasoning: false` 依然设不进去**
（这就是 D3 说的不可逆）。甲交付 §8.2 明确建议 B1 一并解决。

甲 §7.1 还留了一条给后人的警告：**若日后出现新的部分模型调用方**，应改用
`UpdateCustomProviderParams` 上的显式 `reset_supports_vision: Vec<String>`，
而不是依赖「调用方保证全量预置」这个隐含前提。B1 若引入类似机制请沿用同一形状。

##### D5-c【接自乙 §7.1】B1 的降级路径从「最好有」升级为「必须先有」

初版 AC 写的是「必须先有降级路径」，当时是保守措辞。乙落地 1b 后这句话变成硬约束：

> **闸门放宽后，凡是 `is_reasoning_model()` 为真的模型，在 OpenAI 兼容的 chat 请求上
> 都会开始收到 `reasoning_effort`，而用的仍是 OpenAI 的档位词表。端点不认这个字段或
> 这个档位值时，可能直接 400。本轮没有重试、没有 400 后回落到「不发」的路径。**

B1 一落地，`cn:space-bunny` 这类模型立刻走进这条路径。**先有降级，再开 B1。**

##### D5-d【新增 B4，接自乙 §7.2 + §8.1 第 4 点】`/v1/responses` 路径的一致性未验证

乙的 A1 让 realm 前缀模型变成 OpenAI-responses 系，于是
`cortex-providers/src/openai.rs:should_use_responses_api` 把它们从
`/v1/chat/completions` **改打 `/v1/responses`**——已在假端点实测确认。

`formats/openai_responses.rs:653-680` 有**自己的同名闸门变量**，乙未读未改。丙必须核对
它与菜单是否同样一致。已加为 B4，`openai_responses.rs` 已进丙的 Read/Write Scope。

> ⚠️ **这一条原始 TASK 与全部 BUG 报告都没提到**，是乙落地时才发现的副作用。
> 没有实现 Responses API 的 OpenAI 兼容网关（**很可能包括用户环境里的 WorkBuddy**）
> 会对这些模型 404/400——可能把「思考强度不可调」换成「整个模型不可用」。
> **真机部署前必须拿 WorkBuddy 实测 `global:gpt-6-luna` / `global:gpt-5.6-terra` /
> `global:gpt-6-sol` 三个模型。**

#### D6【接自甲 §7.2 / 乙 §7.6】全仓库 ACP 集成测试当前 panic

> **✅ 2026-10-17 审计已修**：`acp_fixtures/server.rs:366` 的一处字面量改成 `"cortex"`，
> ACP 集成测试已能真正跑起来（8 个二进制，实测结果与逐条分类见 `AUDIT-2026-10-17.md` §3）。
> **同类遗留还剩一处**：`cortex-cli/src/logging.rs:55` 断言日志路径含 `"goose"` 分量，
> 而 `config/paths.rs:22` 的 `app_name` 已是 `"cortex"`——是 `cortex-cli --lib` 唯一的失败，未修。
> 下面保留原文作为背景。

`crates/cortex/tests/acp_fixtures/server.rs:366` 在仓库改名成 `cortex` 之后仍断言 agent
名字是 `"goose"`：

```rust
assert_eq!(
    resp.agent_info.as_ref().map(|info| info.name.as_str()),
    Some("goose"),
    "initialize response must identify the agent"
);
```

于是所有 ACP 集成测试在 `initialize` 阶段就 panic，**到不了任何断言**。甲为跑通验证
临时打过补丁、测完已还原。

- **与本轮改动无关**，是分支既有问题（改名遗留）
- **已在丙的 Forbidden Scope 里列出 `crates/cortex/tests/acp_fixtures/**`**
- 若丙需要跑 ACP 集成测试，只能照甲的做法临时打补丁并在交付前还原，**且必须在
  handoff 里说明**；更正当由改名的负责人处理

#### D7【接自乙 §8.1 第 3 点】一致性回归的判据必须改

乙留下的核心回归 `test_effort_menu_matches_the_outgoing_payload`（`response_builder.rs`，
7 个 `test_case`）以 `thinking_effort_values().len() > 1` 为判据。

**B2 的动态档位落地后这个判据会误判**：「网关只支持单档」的合法模型
（如 `cn:hy4-preview` 只有 `high`）在菜单上只有 1 档，但它**确实应该**收到 effort——
那不是静默失效，是正确行为。

判据须改成「菜单提供的档位集合 ⊆ 端点声明的集合且非空」或「端点声明的档位数 > 0」
之类。**不改判据会让正确的实现被测试判成 bug，或反之。**

#### D8【接自甲 §7.3 / 乙 §7.6】AGENTS.md 的 lint 命令在本分支跑不通

- `cargo clippy --all-targets -- -D warnings` → 不加 `--features scheduler` 时
  `agents/state_machine/tests/` 下 24 个编译错误
- 加了 `--features scheduler` 又撞 `E0432: unresolved import cortex::acp::transport`
  （`acp/mod.rs:12` 的 `pub mod transport` 带 `#[cfg(feature = "acp-http")]`，
  而 `--all-targets` 仍会编那个集成测试）
- 甲与乙各自绕法不同（甲用 `-p <crate>` 分开跑；乙用
  `-p cortex --all-targets --features scheduler,acp-http -- -D warnings -A dead_code`）

**这是分支既有问题，不在本轮范围。** 丙沿用可行的绕法并在 handoff 里写明用了哪条。

#### D9【2026-10-17 补】用户报的 5 个 bug 有一半按现有范围修不了

用户原始报告是 5 条（3 条自报 + 2 条我补的）。逐条核过之后发现：**记是全记下了，
但其中 4 条的「修复路径」有洞。** 根子在于本轮所有方案都建立在「端点会声明能力」这个
前提上，而该前提只对 workbuddy2api 成立。完整分析见
`BUG-REPORT-custom-provider-capability-pipeline.md` §4「D 组」。

| 用户报的 | 对应 | 覆盖情况 |
|---|---|---|
| workbuddy 模型不支持思考强度 | C1 | ✅ 甲乙已修（假端点实测出站带 reasoning_effort） |
| **OpenCode 等模型**不支持思考强度 | C1 | ❌ **A/B 组全部方案对它无效**（Gap A） |
| 没有视觉 | C3 | ⚠️ 只对 wb2api 有效，OpenCode 同上 |
| 档位固定低中高 | C2 | ⚠️ 只对 wb2api 有效（Gap D） |
| 视觉开关点了没反应 | C4 | ⚠️ 修的是「自动清不掉」，**UI 层从未复现**（Gap C） |
| api_key_env: null | C5 | ✅ 甲已修 |
| GUI 读不到 env | C5 §4 | ⚠️ **只进文档，未派给任何人** |

##### D9-A【Gap A】两个网关，只验证了一个

| 网关 | 端口 | 服务谁 | `/v1/models` |
|---|---|---|---|
| workbuddy2api | 7863 | `custom_wb2api` | 能力齐全（`supports_images` / `reasoning_supported_efforts` / `reasoning_default_effort` / `can_disable_thinking`） |
| free-lane | 8787 | `custom_cortex-free-opencode` | **只有 `id` `object` `owned_by` `name` `context_window`，零能力元数据** |

free-lane 是用户自写的 `~/.cortex/free-lane/gateway.py`（第 212 行静态构造列表）。
`custom_cortex-free-opencode.json` 的三个模型也全是 `reasoning: false`、无 `supports_vision`。

对 OpenCode：A1 正则不命中（实测 7 个 `oc-*` 模型无一会被判成 responses 系）、
B1 忠实搬运 `false`、B2 无字段可消费、B3 无档位可映射。

**⇒ 新增 G 组（见 Contract 的 Acceptance Criteria）**，并明确三条可行路径的取舍：
1. B1 落地后手写 `"reasoning": true` 进 JSON —— 零代码成本，但属 workaround，
   且有「UI 保存丢字段」的同款风险
2. 扩展用户的 `gateway.py` 加能力字段 —— 可行但改的是用户工具、不在本仓库
3. **运行时探测（G1）** —— 对任意不声明能力的端点零配置生效，覆盖面最广，**推荐**

##### D9-B【Gap B】free-lane 不实现 `/v1/responses`

`gateway.py:220` 只放行 `/v1/chat/completions`。B4 的路由翻转风险对它确定会发生。
目前 7 个 `oc-*` 都不会被判成 responses 系（已实测），所以**暂时安全——但这是巧合，
不是防护**：将来任何被命名为 `gpt-5*`/`gpt-6*`/`o<数字>` 的免费模型都会立刻踩中，
而 free-lane 会 404。故 B4 的 AC 追加：`should_use_responses_api` 的判定应考虑
「端点是否支持 Responses API」，不只模型名。

##### D9-C【Gap C】第 3 条 bug 的症状可能不在甲修的那一层

甲修的是「**自动**清不掉已设值」，验证走 ACP JSON-RPC 层 + 落盘，**不是 UI 点击**。
`CustomProviderForm.test.tsx` 3 个用例里 grep 不到任何 vision/开关断言。

若用户当时的体验是「连点开启都没反应」，则还有第五层未排查：
`CustomProviderForm.tsx:331-359` 的 `useEffect(..., [initialData])` 是否在每次 re-render
重置 `modelVision`。源码看 `initialData` 来自 `useState`、应当稳定，**但从未在运行中的
应用里验证过**。→ G3。

##### D9-D【Gap D】其余中转站的 `/v1/models` 未核查

未核查：`custom_lite-gpt`(vortexapi.xyz)、`custom_chatanywhere`、`custom_siliconflow`
——查它们要用用户的 API key 发真实请求，**用户尚未授权**。若它们同样不声明能力，
C2 在它们身上也修不好，G 组的覆盖面必须包含它们。

#### D10【2026-10-17 补】真机探测结果 + 一个由丙引入的新 bug

##### D10-a 真机探测：OpenCode 免费车道（free-lane）

三个会话全程禁发真实模型请求。为定一个决策，主会话直接打了真 free-lane
（`127.0.0.1:8787`）5 次。**结论推翻「给 JSON 加一行 `"reasoning": true`」的建议。**

| `reasoning_effort` | HTTP | reasoning_tokens |
|---|---|---|
| `low` | 200 | 22 |
| `medium` | 200 | — |
| `max` | 200 | **62** |
| `xhigh` | 200 | 26 |
| `minimal` | 200 | 15 |
| `banana`（乱值） | **400** | — |

- 端点**真实生效**（low→max 差异 22 vs 62 token）
- 端点**校验取值**（乱值 400）⇒ B3 的词表映射是必需项，不是优化
- `xhigh` 与 `max` **都接受** ⇒ B3 的 `max ↔ xhigh` 双向映射对 OpenCode 两条都通

目录里**有**该模型的正确数据，只是命名错位查不到：

```
opencode-go/space-bunny-free   reasoning: true
  reasoning_efforts: [low, medium, high, xhigh, max]
  attachment: true   modalities.input: [text, image, video]   cost: 0
```

provider 键剥 `custom_` 后是 `cortex-free-opencode`（目录里叫 `opencode-go`），
模型名是 `oc-space-bunny-free`（目录里叫 `space-bunny-free`）。
且 `catalog_provider_id` **不参与 canonical 查找**（实测 `canonical/` 与
`model_config.rs` 里零命中），所以「用 catalog_provider_id 打通」这条路当前也走不通。

##### D10-b ⚠️ 丙的兜底三元组让 `Off` 退化成 `low`

`formats/openai.rs:2038` 保留了硬编码 `["low","medium","high"]`，
`:2025` 的 `accepts()` 在「端点与目录都没声明」时正回落到它：

| 菜单选择 | preferred（`:2000-2006`） | 第一个被接受 | 实际发出 |
|---|---|---|---|
| **Off** | `none → minimal → off → low` | `low` | **`"low"`** |
| Max | `max → xhigh → high → …` | `high` | **`"high"`** |

即：**写死 `"reasoning": true` 之后，选「Off」会发 `reasoning_effort: "low"`**——
用户让它别思考，反而发了个 low。现状（`sends_thinking_effort()` 为 false → 不发字段）才是对的。

现有的 Off 保护在 `:1763` 的 `Some(Off) if !is_reasoning_model => None`，只覆盖
「非 OpenAI-canonical 模型」；写死 `true` 后 `openai_reasoning_for_model()` 返回
**true**（它优先取 `self.reasoning`），保护不触发。

**这是乙花一整轮消灭的「UI 承诺了自己不兑现的能力」，从兜底路径上又溜了回来。**
丙在 `:2035-2037` 自己写了原则「没有证据时发送 xhigh 或 max 是发明而非发现」，
但三元组让 Off 退化成 low，违背了自己的原则。

**修复方向**：`accepts()` 的「端点与目录都没声明」分支返回**空集**而非三元组——
没有任何证据时不发明档位。修完后再谈让 `oc-*` 拿到 `reasoning`，顺序不能反。

> **【2026-10-17 审计结论：字面的「空集」未采用，实测它会引入 4 处新回归】**
>
> 实现并测试后，`(None, None)` 分支的真实覆盖面**远大于「网关闭默型」**：
> `zai-org/GLM-5.3-Flash`（目录挂在 `siliconflow/` 下，而 `openai.rs` 的映射把 provider
> **写死成 `"openai"`**）、`claude-sonnet-4`、`kimi-k3`、`gemini-3-pro`、`gpt-6.1-sol@eu`
> **全部走这条分支**。空集会让它们变成「菜单多档、出站 0 字节」——正是乙花整轮消灭的那个病，
> 只是从一个模型扩散到一族模型；并直接打破 `test_responses_effort_gate_matches_the_chat_path_and_the_menu`
> 与 `assert_menu_and_payload_agree` 这两条本轮的核心不变量。
>
> **实际采用**：`accepts()` 的第三条分支改为**只认本档自己的词**，`Off` 无词故不发字段，
> 其余各档发自己的名字（`Max` → `"max"`，不再降级成 `"high"`）。
> ⇒ **本节的两条验收标准（Off 省略字段、Max 不发 high）都满足，且零回归**，
> 菜单仍然兑现（选 Max 就真发 `max`，端点若拒绝走 G1 剥一次并落盘）。
> 论证、实测、补的单测见 `AUDIT-2026-10-17.md` §1。
>
> **另有一个同类缺口未修**（审计 §1.5）：`(None, Some(values))` 分支上，
> **目录有词表但没有「关」的词**时 `Off` 仍会落到 `low`
> （实测 `cn:glm-5.3-flash` → `"low"`）。**比网关闭默型更常见**，
> 但「发最轻档」vs「不发（端点默认可能更多）」是产品决策不是机械修复，故按边界未动。

## 3. 文件所有权表（三会话据此避让）

| 文件 | 所有者 |
|---|---|
| `cortex-provider-types/src/formats/openai.rs` | **乙** |
| `cortex-provider-types/src/model.rs` | 乙 → 丙（串行，乙先） |
| `cortex-provider-types/src/base.rs` | 丙 |
| `cortex-provider-types/src/declarative.rs` | 甲 |
| `cortex-providers/src/declarative.rs` | 甲（丙写前须确认甲已收工） |
| `cortex-providers/src/openai.rs` | 丙 |
| `cortex/src/model_config.rs` | 丙 |
| `cortex/src/acp/response_builder.rs` | 乙 → 丙（串行，乙先） |
| `cortex/src/acp/server/providers.rs` | 甲 |
| `cortex/src/config/declarative_providers.rs` | 甲（丙写前须确认甲已收工） |
| `cortex-sdk-types/src/custom_requests.rs` | 甲 |
| `crates/cortex/tests/acp_custom_provider_methods_test.rs` | 甲 |
| `ui/desktop/**` | 甲 |
| ACP schema + `ui/acp-client/src/generated/` | 甲 |

任一会话发现自己在写非自己所有的文件 → **立即停止该文件写入**，在结果里标记
`SHARED_FILE_CONFLICT` 交回主会话，不要覆盖已有改动。

---

## 4. 全局验收（三个会话都完成后）

```bash
cargo fmt
cargo clippy --all-targets -- -D warnings

# 隔离配置根，配置在 <root>/config 下
export GOOSE_DISABLE_KEYRING=1
export GOOSE_PATH_ROOT=/tmp/opencode/cortex-capability-final

# 造一个带 realm 前缀的自定义 provider，指向本地假端点
# 断言 1：菜单档位数 > 1 ⟺ 出站 payload 含 reasoning_effort
# 断言 2：网关声明单档的模型，菜单只出现那一档
# 断言 3：设 true → 提交「自动」→ supports_vision 变回 None
# 断言 4：api_key_env 为 null 时不再 Unknown provider，同目录其他 provider 照常加载
```

UI 侧：`cd ui/desktop && node ../node_modules/typescript/bin/tsc --noEmit`，
以及三个会话涉及页面的手动点击验证。

**收尾必做**：更新 `docs/refactor-plan.md` §0 首条的状态，逐项标注哪个会话做了什么、
哪些是已知限制、哪些仍待用户真机验收（假端点与单测**不能替代**真实端点结论）。

---

## 5. 明确不做（本轮边界）

- 不动 `custom_` 前缀剥除（已落地，`name_builder.rs:95-104`）
- 不动 developer 角色 400 的修复（已落地，见 `refactor-plan.md` §0）
- 不做 C5 的方案 B（坏文件跳过而非全灭）与方案 C（错误对用户可见）——留后续
- 不做 `BUG-REPORT-custom-provider-vision.md` §7 的方案 D（运行时探测 + 能力缓存）
  的探测侧；丙只做 `/v1/models` 元数据直读
- 不新增/变更 i18n 键（本次全程无新 UI 文案。若确实需要，16 语言 × N 键的人工翻译
  成本要单独评估并先问用户）
- 不重编、不打包、不安装；deb 与真机验收由用户另行安排