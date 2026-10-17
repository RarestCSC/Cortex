# BUG 报告：推理模型向 OpenAI 兼容端点发送 `developer` 角色导致 400

- **日期**：2026-10-16
- **状态**：方案 A 已实施并本地验收（含端到端 A/B 复现与修复对照，见 `refactor-plan.md` §4.11）；deb 已打好待安装，**真实端点验证仍待用户配合**
- **影响范围**：所有 `engine: openai` 的自定义/第三方供应商，只要其模型的 canonical `reasoning = true`（本机实测同时命中 siliconflow 与 cortex-free-workbuddy）
- **非本轮回归**：涉事三个文件 mtime 分别为 10-14 / 10-11 / 10-15，均早于 2026-10-16 的唯一改动（`session_naming.rs` @13:03）

## 1. 症状

用 GLM-5.3-Flash（`custom_siliconflow`）或 WorkBuddy 系模型发消息，对端直接返回：

```
Request failed: Bad request (400): Input tag 'developer' found using 'role' does not match
any of the expected tags: 'system', 'user', 'assistant', 'tool'.
```

模型侧从未收到请求内容。`system` 角色的模型（如 `custom_lite-gpt` 的 `gpt-6.1-sol`）正常。

## 2. 根因

### 判定链路

```text
canonical(siliconflow/zai-org/GLM-5.3-Flash).reasoning = true
  └─ with_canonical_limits()          crates/cortex-provider-types/src/model.rs:159-161
       仅当 self.reasoning.is_none() 才回填 → ModelConfig.reasoning = Some(true)
  └─ openai_reasoning_for_model()     model.rs:292-303  → true
  └─ is_reasoning_model                formats/openai.rs:1756
  └─ 系统消息 role 取 "developer"      formats/openai.rs:1772-1778   ← 400 现场
```

`formats/openai.rs:1772-1778`：

```rust
role: if is_reasoning_model { "developer" } else { "system" }.to_string(),
```

**「是否推理模型」与「系统消息用什么角色」被耦合了。** `system` 与 `developer` 语义几乎等价，且 OpenAI 自己的推理模型（gpt-5/gpt-6/o 系列）**仍然接受 `system`**，`developer` 只是新增的首选名、未移除。

### 为什么已有的兼容 shim 没生效

`crates/cortex-providers/src/openai.rs:497-512` 其实**已经有** `developer → system` 的归一化：

```rust
if Self::PROVIDERS_NEEDING_STANDARD_CHAT_PARAMS.contains(&self.name.as_str()) {
    ...
    for message in messages { if role == "developer" { role = "system" } }
}
```

但白名单是 `openai.rs:441` 的 `&["nearai", "pleumrouter"]` —— 只有这两个内置 provider 受益，**自定义 provider 永远不执行**。

## 3. 用户无法自行规避（死锁）

想改配置绕开？不行，且有真实代价：

- **改 JSON 无效**：`declared_model()`（`openai.rs:469-471`）只被用于 `supports_vision`（`:474`）、`thinking_preservation_format`（`:815`）、`request_params`（`:833`），**唯独不读 `reasoning`**。所以 `custom_providers/*.json` 里写 `reasoning: false` 压根不会进入 `ModelConfig`，仍被 canonical 覆盖。
- **即使生效也两难**：`formats/openai.rs:1758-1762` 把 `reasoning_effort` 的计算包在 `if is_reasoning_model` 里。设 `reasoning = false` 能消除 400，但**同时也停止发送 `thinking_effort`** —— 对真推理模型等于砍掉思考能力。

## 4. 证据

| 证据 | 结果 |
|---|---|
| `sessions.db` 该会话 `model_config_json` | `model_name=zai-org/GLM-5.3-Flash, reasoning=True, request_params={'thinking_effort':'medium'}` —— 而用户 JSON 里写的是 `false` |
| `canonical_models.json` | `siliconflow/zai-org/GLM-5.3-Flash` → `reasoning: true` |
| 各 provider 实际 `reasoning` | siliconflow/lite-gpt/chatanywhere/opencode = `False`（不触发）；**cortex-free-workbuddy 4 个模型 = `True`**（触发） |
| 涉事文件 mtime | `providers/openai.rs` 10-14 23:02、`provider-types/model.rs` 10-11 17:46、`formats/openai.rs` 10-15 14:34 —— 全早于本轮唯一改动 |

## 5. 修法方案

### 方案 A（推荐）：解耦角色与推理判定

**只改角色选择，不动 `reasoning_effort` 的发送条件。** 即 `formats/openai.rs:1772-1778` 的 `if is_reasoning_model` 去掉，角色恒为 `"system"`；`is_reasoning_model` 继续只用于 `:1758-1762` 决定是否发 `reasoning_effort`。

- 一次修好全部兼容端点（siliconflow、workbuddy、以及后续任何同类 provider）
- 不破坏 OpenAI 官方路径（推理模型接受 `system`）
- 顺带让 `openai.rs:497-512` 那段只处理 `reasoning_effort` 清理即可，`developer` 归一化可一并删除

**须同步更新的测试**（断言了 `"role": "developer"`）：

- `formats/openai.rs:3403` `test_create_request_o1_default`（断言在 `:3418`）
- `formats/openai.rs:3604` `test_create_request_o3_custom_reasoning_effort`（断言在 `:3621`）

### 方案 B：按 provider 分流

仅对 OpenAI 官方用 `developer`，其余用 `system`。

**阻碍**：`create_request_for_model_with_options`（`formats/openai.rs:1744`）的签名里**没有 provider 名**（只有 `model_config` / `wire_model_name` / `capability_model_name` / `system` / `messages` / `tools` / `image_format` / `for_streaming` / `format_options`），需额外穿参，改动面比 A 大，且要维护一份「谁需要 developer」的白名单 —— 正是当前 `PROVIDERS_NEEDING_*` 那套白名单已经暴露出的维护负担。

### 方案 C（可与 A 同做）：让 `declared_model()` 也读 `reasoning`

对齐 `supports_vision` 的既有范式（`openai.rs:473-477`），让用户在 `custom_providers/*.json` 声明的 `reasoning` 能覆盖 canonical。这修的是「用户无法表达意图」这个次级缺陷，**不单独解决本 bug**（A 已经解决 400）。

## 6. 测试计划

**实施结果**：下面第 1–4 项已由 `cargo test --offline -p cortex-provider-types --lib formats::openai::` 验证通过（134 passed / 0 failed）；新增两条测试均覆盖流式与非流式，canonical 推理模型另覆盖低/中/高 effort。第 5 项未执行，不能以请求 JSON 单测替代真实端点验收。

1. `test_create_request_o1_default`、`test_create_request_o3_custom_reasoning_effort` 改断言为 `"system"` 后全绿
2. **新增**：canonical `reasoning=true` 的模型（如 `zai-org/GLM-5.3-Flash`）走 chat-completions 时，请求体首个 message 的 `role` 必须是 `"system"` 且 `reasoning_effort` **仍然存在**（证明解耦没写反）
3. **新增**：`reasoning=false` 的模型不发 `reasoning_effort`（回归保护现有行为）
4. 回归：`formats/openai` 全部单测全绿
5. 端到端（需用户配合）：真机用 `custom_siliconflow` + `GLM-5.3-Flash` 发消息不再 400，且思考档位（底栏「高/中/低」）仍可调

## 7. 验收与环境注意

- 前端零改动，只需重编 Rust + 重新打包 deb
- **构建命令**见 `docs/refactor-plan.md` §3
- **⚠️ Rust 构建一旦启动绝不可中断**：v8 build script 会先删 `release/gn_out/` 再重下 169MB 的 `librusty_v8.a`，中断＝永久丢失且无副本可恢复（`~/.cache/rusty_v8` 为空）。历史事故见 `docs/refactor-plan.md` §4.10
- `-p cortex` 的测试/clippy 必须显式 `--features acp-http,scheduler,rustls-tls,system-keyring`
- `~/.config/goose` 时间戳不得改动；sudo 动作交用户
- 真实凭据不可读取；不要自行发送模型请求做验证

## 8. 相关文件速查

| 文件:行 | 作用 |
|---|---|
| `crates/cortex-provider-types/src/formats/openai.rs:1772-1778` | **400 现场**：角色选择 |
| `crates/cortex-provider-types/src/formats/openai.rs:1758-1762` | `reasoning_effort` 只在推理模型时发送 |
| `crates/cortex-provider-types/src/formats/openai.rs:1744` | `create_request_for_model_with_options` 签名（无 provider 名） |
| `crates/cortex-provider-types/src/model.rs:292-303` | `openai_reasoning_for_model` 判定 |
| `crates/cortex-provider-types/src/model.rs:159-161` | canonical 回填（仅 `None` 时） |
| `crates/cortex-providers/src/openai.rs:441` | `PROVIDERS_NEEDING_STANDARD_CHAT_PARAMS` 白名单 |
| `crates/cortex-providers/src/openai.rs:497-512` | 已存在但被白名单门控的归一化 |
| `crates/cortex-providers/src/openai.rs:469-477` | `declared_model()` / `vision_support` 范式 |
| `crates/cortex-provider-types/src/canonical/data/canonical_models.json` | `siliconflow/zai-org/GLM-5.3-Flash` 的 `reasoning: true` |
