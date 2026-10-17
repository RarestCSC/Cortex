# BUG 报告：自定义供应商 JSON 里 `"api_key_env": null` 会清空**全部**自定义供应商

- **日期**：2026-10-16
- **状态**：已定位根因，已用真实二进制复现，修复方案明确（未实施）
- **影响范围**：任何 `~/.config/<app>/custom_providers/*.json` 写了显式 `null` 的 `api_key_env`（或任何非 Option 但带 `#[serde(default)]` 的字段）。**危害不止于该供应商**——单文件解析失败会中止整个 custom provider 注册表加载，同目录下所有自定义供应商一起消失

## 1. 症状

两种截然不同的表现，来自同一个字段：

**症状 A（被误诊为"密钥不对"）**：`api_key_env: "WB2A_API_KEY"` + `requires_auth: true`，但密钥不在进程环境里 → 切换到该 provider 时报 `Internal error`（UI），后端日志是：

```
missing required key WB2A_API_KEY: Configuration value not found: WB2A_API_KEY
```

**症状 B（真正的 bug，本次记录的主线）**：把 `api_key_env` 改成 `null` 想绕开症状 A 之后，**所有**自定义供应商（含本来完全正常的 `custom_lite-gpt` / `custom_chatanywhere` / `custom_siliconflow`）一起消失，后端报：

```
Unknown provider: custom_wb2api
```

一个供应商的 JSON 写错，炸掉的是整张表。

## 2. 复现路径

`custom_providers/` 下放两个 provider：`custom_wb2api.json`（可任意篡改）与 `custom_lite-gpt.json`（内容正确、始终可用）。

隔离配置根跑 `cortex doctor`（`GOOSE_PATH_ROOT` 指向临时目录，配置在 `<root>/config`）：

| `custom_wb2api.json` 里的 `api_key_env` | 结果 |
|---|---|
| `"WB2A_API_KEY"`（有 env 时） | `✓ extensions ready` |
| `"WB2A_API_KEY"`（无 env 时） | `error: missing required key WB2A_API_KEY` ← 症状 A |
| `null` | `error: Unknown provider: custom_wb2api` ← 症状 B |
| `""` | `✓ extensions ready` ← **正确写法** |

最后两行是本报告的核心对照：**只有 `null` 会炸，`""` 完全正常**。

复现时无需真实网关，无需发任何模型请求。

## 3. 根因分析

### 断点 ①：`#[serde(default)]` 不接受显式 `null`

`crates/cortex-provider-types/src/declarative.rs:155-156`：

```rust
#[serde(default)]
pub api_key_env: String,
```

`#[serde(default)]` 的语义是"**字段缺失**时用 `Default::default()`"，它只对 key 不存在的情况生效。JSON 里 key 存在但值是 `null` 时，serde 会尝试把 `Null` 反序列化成 `String`，直接失败：

```
invalid type: null, expected a string
```

同一份文件里另外两个字段能接受 `null`，是因为它们本来就是 `Option`：`headers: Option<HashMap<String, String>>`（`declarative.rs:159`）、`session_id_header_override: Option<String>`（`:162`）。**`api_key_env` 不是。** 这就是"照着旁边的 `null` 抄"会出事的原因——JSON 里一片 `null` 看起来很整齐，但只有一个字段不接。

### 断点 ②：单文件解析失败会中止整个注册表

`crates/cortex-providers/src/declarative.rs:337-353`：

```rust
std::fs::read_dir(dir)?
    .filter_map(|entry| {
        let path = entry.ok()?.path();
        (path.extension()? == "json").then_some(path)
    })
    .map(|path| {
        let content = std::fs::read_to_string(&path)?;
        deserialize_provider_config(&content)
            .map_err(|e| anyhow::anyhow!("Failed to parse {}: {}", path.display(), e))
    })
    .collect()          // ← 收集进 Result<Vec<_>>，任一 Err 整个函数 Err
```

`.collect()` 的目标是 `Result<Vec<DeclarativeProviderConfig>>`，因此**任意一个文件解析失败，`load_custom_providers` 整体返回 Err**。调用方 `register_declarative_providers`（`crates/cortex/src/config/declarative_providers.rs:408-423`）直接 `?` 出去，于是**一个供应商的语法错误 = 整张自定义供应商表清空**。

这个 fail-fast 语义本身有争议，但对用户是**静默的**：UI 只显示 provider 不见了或 `Unknown provider`，没有任何提示指向"你的某个 JSON 语法错了"。错误信息里有文件名，但只在 `tracing::warn!` 里（`crates/cortex/src/providers/init.rs:252-255`），GUI 用户看不到。

## 4. 附带发现：症状 A 的真正原因是环境变量没进 GUI 进程（不是配置错）

症状 A 很容易被误诊成"密钥写错了"，但配置是对的。根因在进程环境：

`Config::get_secret`（`crates/cortex/src/config/base.rs:920-934`）先读进程环境变量、再退回系统钥匙串。Electron GUI 由 GNOME 会话拉起，**不继承 `systemctl --user set-environment` 在登录之后注入的变量**，也不读 `~/.config/environment.d/`（该文件只在 user manager 启动/登录时读一次）。

2026-10-16 实测（进程 `cortex serve`）：

| 位置 | 有 `WB2A_API_KEY` |
|---|---|
| `~/.config/environment.d/wb2api.conf` | 有 |
| `systemctl --user show-environment` | 有 |
| **GUI 进程 `/proc/<pid>/environ`** | **无** |

`environment.d` 里的 `CORTEX_FREE_LANE_KEY` 进了 GUI 进程，因为它设得早于本次登录。

这不是 Cortex 的 bug，是 README（`~/opt/wb2api/README-setup.md` §5）对 GUI 场景的说明不够——它建议 `systemctl --user set-environment`，但没说那只对 **user manager 拉起的进程**生效，对已登录的 GNOME 会话无效。可行的解法只有**注销重新登录**。建议在 troubleshooting 里补一句。

## 5. 修复方案建议

### 方案 A（必须做）：让 `api_key_env` 接受 `null`

二选一：

- **A1 改成 `Option<String>`**：`pub api_key_env: Option<String>`，消费处 `unwrap_or_default()`。语义最诚实——`null` 就是"没配环境变量名"。**代价**：改的是共享类型，`ModelInfo`/`DeclarativeProviderConfig` 在多个 crate 之间传递，改动面比看起来大
- **A2 加 `deserialize_with`**：保留 `String`，加一个把 `null` / 缺失都归一化成 `""` 的反序列化函数。**改动最小、零调用点变更，推荐**

```rust
fn null_to_empty<'de, D>(d: D) -> Result<String, D::Error> {
    Ok(Option::<String>::deserialize(d)?.unwrap_or_default())
}

#[serde(default, deserialize_with = "null_to_empty")]
pub api_key_env: String,
```

### 方案 B（强烈建议）：坏文件不该炸掉整张表

把 `load_custom_providers` 的 `.collect::<Result<Vec<_>>>()` 改成逐文件容错：坏的跳过 + `tracing::warn!` + 记进一个可查询的状态，让 UI 能显示"1 个自定义供应商配置有误"而不是静默消失。

风险点：**当前的 fail-fast 可能在无意中掩盖配置错误**。改之前先确认没有依赖"加载失败即拒绝启动"的路径；建议保持 fail-fast 语义可选，但至少让错误对用户可见（方案 C）。

### 方案 C：把文件名暴露到用户可见的地方

`register_declarative_providers` 失败时，至少让 provider 列表接口返回可读错误（含**具体是哪个文件**、哪一行），而不是笼统的 `Unknown provider: X`。GUI 用户没有读 `tracing` 的习惯。

### 方案 D（仅文档）：补 README 的 GUI 环境变量说明

`~/opt/wb2api/README-setup.md` §5 补一句：`systemctl --user set-environment` 只对 user manager 拉起的进程生效；GUI 桌面应用需要**注销重新登录**，或用其他方式把变量送进会话环境。

## 6. 测试计划（落修复时验收用）

1. `config_from_json` 单测：`api_key_env` 为 `null` / 缺失 / `""` / `"FOO"` 四种输入，全部成功且语义分别等价于 `""` / `""` / `""` / `"FOO"`
2. `load_custom_providers` 单测：目录里放一个合法文件 + 一个语法错误文件 → **坏文件被跳过，好文件正常加载**（钉住方案 B）
3. 回归：全部合法时加载结果与现状逐字节一致（不能因为容错而漏掉文件）
4. 回归：`custom_providers/` 下放 `*.json.bak` 之类非 `.json` 后缀的文件，仍被过滤掉（`path.extension()? == "json"` 过滤，别顺手改坏）
5. 端到端（隔离 `GOOSE_PATH_ROOT`）：`cortex doctor` 在 `api_key_env: null` 时不再出现 `Unknown provider`
6. 真机：Cortex 桌面端切换自定义 provider 不再报 `Internal error`

## 7. 相关文件速查

| 文件 | 作用 |
|---|---|
| `crates/cortex-provider-types/src/declarative.rs:155-156` | 断点①：`#[serde(default)] pub api_key_env: String`（方案 A2 挂点） |
| `crates/cortex-provider-types/src/declarative.rs:159,162` | 对照：同样是 `null`，但它们是 `Option` 所以安全 |
| `crates/cortex-providers/src/declarative.rs:337-353` | 断点②：`.collect()` 到 `Result<Vec<_>>`，单文件失败即全灭（方案 B 挂点） |
| `crates/cortex/src/config/declarative_providers.rs:408-423` | `register_declarative_providers`，错误直接向上抛 |
| `crates/cortex/src/providers/init.rs:248-259` | `refresh_custom_providers`，错误只进 `tracing::warn!`（方案 C 挂点） |
| `crates/cortex/src/config/base.rs:920-934` | `get_secret`：先环境变量、再钥匙串 |
| `crates/cortex/src/providers/openai_def.rs:167-205` | `resolve_api_key`，症状 A 的报错文案出处 |
| `crates/cortex-providers/src/openai.rs:923-935` | 同上（providers 侧），`requires_auth` 时 bail |