# 交付：Task 甲 — 自定义供应商配置层修复（C5 + C4）

- **日期**：2026-10-16 ~ 2026-10-17
- **状态**：代码已落地，单测与集成测试绿。**未做真机验收**（见 §7）
- **任务来源**：`docs/TASK-fix-custom-provider-capability-pipeline.md` §2「甲：配置层（C5 + C4）」
- **分析依据**：
  - `docs/BUG-REPORT-custom-provider-null-api-key-env.md`（C5 深度，方案 A2）
  - `docs/BUG-REPORT-custom-provider-capability-pipeline.md` §2.3（C4）
- **隔离环境**：`GOOSE_DISABLE_KEYRING=1 GOOSE_PATH_ROOT=/tmp/opencode/cortex-jia`，配置在 `<root>/config`

---

## 1. 一句话总结

C5 让 `"api_key_env": null` 不再炸掉整张 custom provider 注册表；C4 让视觉三态开关真正可逆——
「开启」能写入之后，「自动」现在能把值清回 `None`。

两个症状的共同点是**「没表达」而非「没实现」**：一个是非 Option 字段接不住显式 null，一个是 wire
格式表达不了「显式重置为自动」。修复都是在表达层补语义，没有引入新的持久化状态。

---

## 2. C5：`"api_key_env": null` 清空整个注册表

### 2.1 根因（两个断点叠加）

| 断点 | 位置 | 问题 |
|---|---|---|
| ① | `DeclarativeProviderConfig::api_key_env` | `#[serde(default)] pub api_key_env: String`。`default` 只管「字段缺失」，key 存在但值是 `null` 时 serde 直接报 `invalid type: null, expected a string` |
| ② | `cortex-providers/src/declarative.rs:load_custom_providers` | `.collect::<Result<Vec<_>>>()`——单文件解析失败 ⇒ 整个函数 `Err` ⇒ 调用方 `?` 出去 ⇒ **同目录所有自定义供应商一起消失** |

同一份 JSON 里 `headers`、`session_id_header_override` 同样能接 `null`，是因为它们本来就是
`Option`。手写 JSON 时「统一置 null」的习惯只在 `api_key_env` 上出事。

### 2.2 改动

采用 `BUG-REPORT-custom-provider-null-api-key-env.md` **方案 A2**（保持 `String` 类型不变，加
`deserialize_with` 把 `null` / 缺失都归一化成 `""`）。**未选方案 A1（改 `Option<String>`）**：
该类型跨 crate 传递，改动面比看起来大。

```rust
#[serde(default, deserialize_with = "null_to_empty")]
pub api_key_env: String,

fn null_to_empty<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}
```

`String` 类型未变 ⇒ **零调用点变更**，`cortex-providers`、`cortex`、`cortex-cli` 里的所有消费处
（`declarative_providers.rs`、`providers/openai_def.rs`、`acp/server/providers.rs` 等）一行没动。

### 2.3 未做（按 §5 边界）

- **方案 B**（坏文件跳过而非全灭）
- **方案 C**（错误对用户可见）

⚠️ **因此：真正语法坏掉的 JSON 依然会拖垮整张注册表。** 本次只解决 `api_key_env: null` 这一种。

---

## 3. C4：视觉三态开关的「自动」清不掉已设值

### 3.1 根因

**wire 格式表达不了「显式重置为自动」**，两层 `.or()` 把「未设置」和「保持原样」混为一谈：

| 层 | 位置 | 行为 |
|---|---|---|
| UI | `CustomProviderForm.tsx` | 选「自动」的实现是 `delete next[name]`，删掉后与「UI 没碰过这个模型」在协议上**完全同构** |
| ACP | `providers.rs:custom_provider_models` | `if let Some(supports_vision) = capabilities.get(..).and_then(..)`——缺条目时不覆盖，model 保持 clone 来的 existing 值 |
| 持久化 | `declarative_providers.rs` | `model.supports_vision = model.supports_vision.or(existing.supports_vision)` 兜住 |

三态控件只有两态能用：一旦手动设过就永久锁死，且 UI 会一直显示「开启」，用户看到的就是
「点了自动没反应」。

### 3.2 采用的路线

**让 UI 选「自动」时显式发送该模型条目（而不是删 key），后端区分「显式清除」与「无条目不碰」。**

wire 语义（**不新增字段、不改 DTO 类型**）：

| 请求形态 | 含义 |
|---|---|
| 该模型**无条目** | 不碰已存值（语义不变） |
| 有条目 + `true` / `false` | 设值（语义不变） |
| 有条目 + `null` | **显式重置为自动**（新增） |

区分完全由 `HashMap::get` 返回的 `Option<&CustomModelCapabilityDto>` 承担：条目存在而
`supports_vision` 为 `None` 就是清除信号。

**因为 `Option<bool>` 的 Rust 类型没变，ACP schema 没变，`just generate-acp-types` 不需要跑。**
已核对 `crates/cortex/acp-schema.json` 与 `ui/acp-client/src/generated/` 与改动前逐字节一致。

### 3.3 前后端完整链路

```
UI 选「自动」
  → CustomProviderForm.tsx:  { ...prev, [name]: undefined }        （不再 delete key）
  → submit:  { [name]: { supports_vision: undefined } }              （Object.entries 保留该 key）
  → providers.ts: updateRequestToCreate 已有  { supportsVision: … ?? null }  →  null
  → providers.rs:  if let Some(capability) = capabilities.get(&model.name)
                     model.supports_vision = capability.supports_vision;   （None 也照赋）
  → declarative_providers.rs:  删掉 .or(existing) 兜底，None 得以落盘
```

### 3.4 对 `ui/desktop/src/acp/providers.ts` 的判断

**无需改动。** 复核后发现它现有的

```ts
{ supportsVision: capability.supports_vision ?? null }
```

已经正好产出「显式清除」所需的 `null`；`toLocalModelCapabilities` 同理。所以该文件虽在 Write
Scope 内，实际未动。

---

## 4. 改动文件清单

| 文件 | 改动 |
|---|---|
| `crates/cortex-providers/src/declarative.rs` | **C5**：`api_key_env` 加 `deserialize_with = "null_to_empty"`；新增 `null_to_empty`；补 2 条单测 |
| `crates/cortex/src/acp/server/providers.rs` | **C4**：`custom_provider_models` 改为 `if let Some(capability) = capabilities.get(&model.name)`，即使 `capability.supports_vision` 为 `None` 也赋值 |
| `crates/cortex/src/config/declarative_providers.rs` | **C4**：删除 `model.supports_vision = model.supports_vision.or(existing.supports_vision)`；改写一条依赖旧兜底语义的单测断言表 |
| `ui/desktop/src/components/settings/providers/modal/subcomponents/forms/CustomProviderForm.tsx` | **C4**：`modelVision` 类型 `Record<string, boolean>` → `Record<string, boolean \| undefined>`；`delete next[name]` → `{ ...prev, [name]: value }` |
| `crates/cortex/tests/acp_custom_provider_methods_test.rs` | 新增 2 条集成测试（`model_capabilities` / `supports_vision` 此前是**零覆盖**，这正是它一路漏到真机的原因） |

**刻意未改**：

- `crates/cortex-sdk-types/src/custom_requests.rs` —— DTO 类型未变
- `ui/desktop/src/acp/providers.ts` —— 见 §3.4
- ACP schema JSON + `ui/acp-client/src/generated/` —— 见 §3.2
- 全部 i18n 文件 —— 零新增、零变更键

---

## 5. 测试覆盖

### 5.1 C5（3 组）

| 测试 | 位置 | 断言 |
|---|---|---|
| `api_key_env_accepts_null_missing_empty_and_named` | `cortex-providers/src/declarative.rs` | 四种输入全部解析成功，`null` / 缺失 / `""` 三者语义等价于 `""`，`"FOO"` 保留；外加一次重新序列化往返（确认仍序列化成普通字符串） |
| `load_custom_providers_reads_every_valid_file_and_skips_other_suffixes` | 同上 | 全合法时 3 个文件全部加载且 `api_key_env` 归一化；`custom_delta.json.bak` 仍被 `path.extension()? == "json"` 过滤掉 |
| `a_null_api_key_env_does_not_take_the_custom_provider_registry_down` | `acp_custom_provider_methods_test.rs` | 端到端：写入 `null` / `""` / 缺失三种 provider，`refresh_custom_providers()` 不报错，三个都能从注册表解析到；`custom/read` 不返回 `Unknown provider` |

### 5.2 C4（1 条）

`acp_custom_provider_model_capabilities_are_reversible`：

1. 创建时设 `supportsVision: true` → 落盘 `Some(true)`
2. 提交 `{}`（**无条目**）→ 仍为 `Some(true)` ← **「不碰」语义回归**
3. 提交 `{stark-1: {supportsVision: false}}` → `Some(false)`
4. 提交 `{stark-1: {supportsVision: null}}` → **`None`** ← C4 核心回归
5. 再设 `true` → `custom/read` 回报 `supportsVision: true`
6. 再提交「自动」→ 落盘 `None`，且 `custom/read` 的 `modelCapabilities` 整个消失（自动不应被回报成显式 override）

### 5.3 两条测试都验证过「不打补丁就会红」

这是本次最关键的一步——原 bug 能一路漏到真机，正是因为没有任何测试会咬：

```
# 临时还原 C4 旧行为后
acp_custom_provider_model_capabilities_are_reversible ... FAILED
  assertion `left == right` failed: resetting to auto must clear the persisted override
  left: Some(false)   right: None

# 临时还原 C5 旧字段后
a_null_api_key_env_does_not_take_the_custom_provider_registry_down ... FAILED
  a null api_key_env must not abort the registry load:
  Failed to parse .../custom_null_key.json: invalid type: null, expected a string
```

---

## 6. 验证命令与结果

| 命令 | 结果 |
|---|---|
| `cargo test -p cortex-providers --lib` | **262 passed, 0 failed** |
| `cargo test -p cortex --lib --features scheduler declarative` | **23 passed, 0 failed** |
| `cargo test -p cortex --test acp_custom_provider_methods_test` | **3 passed, 0 failed** |
| `cargo clippy -p cortex-providers --all-targets -- -D warnings` | 干净 |
| `cargo clippy -p cortex --lib --features scheduler -- -D warnings` | 干净 |
| `cargo clippy -p cortex --test acp_custom_provider_methods_test --features scheduler -- -D warnings` | 干净 |
| `cargo fmt --check -p cortex -p cortex-providers` | 干净 |
| `cd ui/desktop && node ../node_modules/typescript/bin/tsc --noEmit` | 干净 |

隔离核对：真实 `~/.config/cortex` 与 `~/.config/goose` 的 mtime 均早于本次会话（未被触碰）；
所有测试写入落在 `/tmp/opencode/cortex-jia/config/`；未发任何模型请求，未接触用户环境里的
WorkBuddy 网关（`127.0.0.1:7863`）。

---

## 7. 限制与已知风险

### 7.1 行为变更：`supports_vision` 现在是权威值而非增量

`update_custom_provider` 不再把已存的 `supports_vision` 兜底填回传入模型。因此**传入部分
`ModelInfo` 的调用方会静默清掉视觉**，而不是继承已存值。

已核实安全性：

- **唯一生产调用方**是 `acp/server/providers.rs:743`，它在 `custom_provider_models`（`:394`）已从
  `loaded.config.models` **全量预置**，因此传到这里的 `None` 只可能表示「用户显式设回自动」
- 另外 3 个调用方（`declarative_providers.rs` 的 2 处、`agents/agent.rs:1880`）全在 `#[cfg(test)]` 内
  → **2026-10-17 审计复核：属实**。三处分别在 `declarative_providers.rs:962/1028/1219`（测试门在 716 行）
  与 `agents/agent.rs:1880`，逐处用最近的 `#[cfg(test)]` / `mod tests` 门核对过。且 2026-10-17 的
  ACP 集成测试解锁后，`acp_custom_provider_methods_test` 3/3 通过（含你的三态可逆用例），**该契约在集成层确认无回归**
- 但其中 `custom_provider_update_preserves_model_metadata` **确实断言了旧的 `.or()` 兜底**，其视觉
  断言表已按新契约重写为 `(None, None), (Some(false), …), (None, None), (Some(true), …)`；
  该测试其余断言（context limit、costs、`request_params` 的保留）一字未动且仍通过

**若日后出现新的部分模型调用方，应改为在 `UpdateCustomProviderParams` 上加显式的
`reset_supports_vision: Vec<String>` 字段，而不是依赖「调用方保证全量预置」这个隐含前提。**

### 7.2 一个既有 bug 挡住全仓库所有 ACP 集成测试

`crates/cortex/tests/acp_fixtures/server.rs:366` 在仓库改名成 `cortex` 之后仍断言 agent 名字是
`"goose"`，于是所有 ACP 测试在 `initialize` 阶段就 panic，到不了任何断言。

- **与本次改动无关**，是分支既有问题
- 为能跑通验证，**临时**打了补丁，测完已还原（内容已确认回到 `"goose"`，`git status` 无变化）
- 需要由改名的负责人真正修掉
  → **✅ 2026-10-17 审计已修**（一处字面量）。解锁后 `acp_custom_provider_methods_test` 不用打补丁就 3/3 通过
  （含你的 `…model_capabilities_are_reversible`），**你的 C4 三态改动在集成层确认无回归**。
  暴露出的 3 个失败与逐条分类见 `AUDIT-2026-10-17.md` §3.3。**同类遗留还剩 `cortex-cli/src/logging.rs:55` 一处**（未修）

### 7.3 其他既有问题（未处理）

- 不加 `--features scheduler` 跑 `cargo build -p cortex --tests` → `state_machine/tests/recipe_scheduling_lifecycle.rs`
  与 `tests/agent.rs` 共 24 个错误。也就是说 AGENTS.md 里的 `cargo clippy --all-targets` 在当前分支
  本来就走不通
- 工作区遗留 `crates/cortex/src/agents/snapshots/cortex__agents__prompt_manager__tests__all_platform_extensions.snap.new`
  （已被 gitignore，来自某次 `prompt_manager` 快照测试运行，非本次产生）

### 7.4 未做的验证

- **C5 报告测试计划第 5 条的 `cortex doctor` 端到端未跑**——需要 `cortex-cli` 的 290MB 链接，
  §1.2 要求避开、§5 划出本轮。注册表级测试覆盖同一段代码路径
- **未做真机验收**：单元测试与假数据对真实端点的结论没有任何证明力

---

## 8. 对其他会话的影响

- **乙（A1 + A2）**：无文件重叠，未受影响
- **丙（B1 + B2 + B3）**：唯一需要知会的是 `crates/cortex/src/config/declarative_providers.rs`——
  本次在该文件落了 `supports_vision` 契约变更（§7.1）。若 B2 要在同处写 `/v1/models` 推导出的
  视觉信息，需基于新契约：**`params.models` 里的值是权威的，不要再兜底**

---

## 9. 文档勘误

原分析文档中的两处路径已过时，记录在此以免后人重蹈：

| 文档 | 写的 | 实际 |
|---|---|---|
| `BUG-REPORT-custom-provider-null-api-key-env.md` §3/§7 | `crates/cortex-provider-types/src/declarative.rs:155-156` | 该文件**不存在**；结构体在 `crates/cortex-providers/src/declarative.rs` |
| `TASK-fix-custom-provider-capability-pipeline.md` §2 甲 Write Scope | 同上路径 | 同上（7 个源文件里实际只有 6 个真实路径 + 1 个失效路径） |
| `BUG-REPORT-...pipeline.md` §2.3 | `CustomProviderForm.tsx:887` | 行号正确 |