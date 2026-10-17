# 交付：Task 丙 — 能力上线（B1 + B2 + B3 + B4 + G 组）

- **日期**：2026-10-17
- **状态**：代码已落地。单测绿，wiremock 端到端绿，**真实二进制 + 本地严格假端点端到端已验收**。**未做真机验收**（见 §9）
- **任务来源**：`docs/TASK-fix-custom-provider-capability-pipeline.md` §2「丙：能力上线」
- **上游交付**：`docs/FIX-jia-custom-provider-config-layer.md`（甲）、`docs/FIX-yi-reasoning-effort-honesty.md`（乙）
- **隔离环境**：`GOOSE_DISABLE_KEYRING=1 GOOSE_PATH_ROOT=/tmp/opencode/cortex-bing-probe`，配置在 `<root>/config`
- **未改任何 ACP schema / DTO / `ui/acp-client` 生成物** ⇒ `just generate-acp-types` **不需要重跑**
- **零新增 i18n 键**（G2 的提示走 ACP option description，不是 i18n 资源）

> ## ⚠️ 2026-10-17 审计对本交付的复核结论（`docs/AUDIT-2026-10-17.md`）
>
> 本文档是历史交付记录，**原文保留不改**。审计的判定如下，续接者请先读这一段：
>
> | 声明 | 判定 |
> |---|---|
> | §2.3 那批「纯机械」改动**全在 `#[cfg(test)]` 内**、无生产代码被顺手改 | ✅ **属实**。14/14 处逐个用最近的 `#[cfg(test)]` / `mod tests` 门核对过；`openai_def.rs:222-227`、`lib.rs` 两个导出、`CustomProviderForm.tsx:337-339/370` 也都核对为实 |
> | §11 给乙：`is_reasoning_model()` / `openai_reasoning_for_model()` / `sends_thinking_effort()` **语义一字未动** | ✅ **属实**。三者均不读 `endpoint_capabilities`；变化只在**入参**（B1 注入 `ModelConfig.reasoning`，这在 §11 已写明） |
> | §7.2 的 **④ 保守三元组 `["low","medium","high"]`** 作为最后一级兜底 | ❌ **已删除**。它让「选 Off」发出 `"low"`、「选 Max」发出 `"high"`，**正是你在 §7.2 自己写下的原则「没有证据时发明档位是错的」的反面**。三元组不是无害的兜底，它排在最后但**在 `(None, None)` 分支上是唯一的分支**，而该分支的真实覆盖面远大于「网关闭默型」 |
> | §8.1 的 `cortex --lib` **2236 passed / 16 failed，零回归** | ⚠️ **口径需修正**。那个 16 是在 `--features scheduler,acp-http` 下的数字；`analyze` 扩展挂在 `#[cfg(feature = "tree-sitter")]` 下，补上 `tree-sitter,code-mode` 后是 **2276 passed / 8 failed**——**16 个里有 8 个纯粹是 feature flag 没开** |
> | §8 的验证只覆盖 `--lib` | ⚠️ **三轮都没跑过集成测试**（§8.1 表格里没有 `--test`）。这直接导致 `declared_vision_registry.rs:85` 的 `assert_eq!(requests.len(), 1)` 一直红着——多出来的那个请求正是你在 §9.3 第 4 条写下的、你自己认定的既定行为 `GET /v1/models` |
> | §8.2 的 **UI vitest 13 passed** | ⚠️ **只覆盖了你自己那一个文件**。全量 `pnpm run test` 是 **992 passed / 21 failed / 8 skipped**；其中 `App.test.tsx` 5 个 + `Hub.test.tsx` 15 个报 `useLocation() may be used only in the context of a <Router>`（本轮无人碰过的文件），`CustomProviderForm.test.tsx` 1 个是 5.03 秒的 vitest 超时（3/3 稳定复现，用例不是你加的） |
> | §8.4 的 D6「正解仍待改名的负责人处理」 | ✅ **已修**（`acp_fixtures/server.rs:366`）。`acp_custom_provider_methods_test` 现在不用打补丁就 3/3 通过 |
>
> **另有一处 §9/§10 结论需要收窄**：§9 的「沉默型网关现在：档位按名字启发式发 + 拒绝后落盘」与 §10 Gap A 的「✅ 已覆盖」，**前提是 provider JSON 里写了 `"reasoning": true`**。
> 实测（wiremock 端点声明 `reasoning_supported_efforts: ["high"]` 但不带 `supports_reasoning`）：
> `openai.rs:344` 的 `with_endpoint_capabilities()` **只折进 `endpoint_capabilities` 和默认档位，不回填 `reasoning`**，
> 而闸门只看 `reasoning` ⇒ **`sends_thinking_effort()` 恒为 false，第一轮和第二轮出站都没有 `reasoning_effort`**，
> 端点明明已经声明了词表。**你的测试全绿是因为每一个都预先设了 `reasoning: Some(true)`**（`openai.rs:1884` 的 `reasoning_config()` 助手），
> 「端点是唯一推理证据」这一类模型从来没被测过。

---

## 1. 一句话总结

能力判定不再猜模型名也不再赌静态目录：用户声明、端点自报、目录回填三层按优先级合并，端点**完全沉默**时靠运行时探测兜底并把结论落盘；B1 开闸之前先补齐了三层降级（图像、档位、Responses 路由），并修掉一处此前没人测过的 UI 状态重置——**第 3 条 bug 的真正落点不在甲修的那一层**。

---

## 2. 改了哪些文件

### 2.1 新增

| 文件 | 内容 |
|---|---|
| `crates/cortex-provider-types/src/endpoint_capabilities.rs` | 端点能力类型（`EndpointModelCapabilities`）、`GET /v1/models` 解析、B3 词表双向映射、进程级能力注册表、G1 探测缓存 `ProbeCache`、400 能力拒绝分类 |

### 2.2 Write Scope 内

| 文件 | 改动 |
|---|---|
| `crates/cortex-provider-types/src/model.rs` | `ModelConfig` 新增 `endpoint_capabilities` 字段 + `with_endpoint_capabilities` / `endpoint_capabilities()` / `endpoint_declares_nothing()` / `endpoint_effort_levels()` / `endpoint_default_effort()`；`RawModelConfig` 与 `new()` 同步。**`is_reasoning_model()` 与 `openai_reasoning_for_model()` 的语义一字未动**（乙 §8.1） |
| `crates/cortex-provider-types/src/formats/openai.rs` | **B3**：新增 `openai_reasoning_effort_for_endpoint(model, effort, endpoint)`，`openai_reasoning_effort_for_thinking` 委托给它；回落链改为 端点声明 → canonical → 保守三元组。出站闸门改用它。**补 `is_reserved_request_param_key` 的两条钉桩测试**（AC 通用项，此前无任何测试）<br>🔴 **2026-10-17 审计：「保守三元组」这一级已被删除**，回落链现在是 端点声明 → canonical → **本档自己的词**（`Off` 无词故不发字段）。见文首审计段与 `AUDIT-2026-10-17.md` §1 |
| `crates/cortex-provider-types/src/formats/openai_responses.rs` | **B4**：effort 闸门从 `openai_reasoning_for_model()` 改为 `sends_thinking_effort()`，并镜像乙的两条收窄（`Off` 对非 OpenAI-canonical 保持沉默、`legacy_reasoning_effort` 仍优先）；temperature 抑制仍用较严的 `openai_reasoning_for_model()` |
| `crates/cortex-provider-types/src/retry.rs` | `should_retry` 对**能力拒绝**与**缺失端点**返回 false（同 payload 重发不可能成功；此前一个能力 400 要浪费 4 个请求） |
| `crates/cortex-provider-types/src/canonical/name_builder.rs` | **D5-a**：新增 `strip_realm_prefix` + `infer_provider_stripping_realm`，三处推理调用点改用它。`name_builder.rs:95-104` 的 `custom_` 剥除**一字未动** |
| `crates/cortex/src/model_config.rs` | **B1 + B2**：`base_model_config_from_user_config` 末尾调 `apply_declared_capabilities`；缺省 effort 的解析顺序改为 会话已选 > `GOOSE_THINKING_EFFORT` > 端点 `reasoning_default_effort` |
| `crates/cortex/src/acp/response_builder.rs` | **B2 菜单**（端点声明驱动）、**D7 判据重写**、**G2 提示** |
| `crates/cortex-providers/src/openai.rs` | **B2 读 `/v1/models` 并发布**、**G1 三处降级**、**B4 路由回落** |
| `crates/cortex/src/config/declarative_providers.rs` | **D3/D5-b**：删掉 `model.reasoning \|= existing.reasoning`；新增 `publish_declared_capabilities` + 落盘兜底 memo + 三处失效钩子 |

### 2.3 Write Scope 外（**均有理由，列出供主会话复核**）

| 文件 | 改动 | 理由 |
|---|---|---|
| `crates/cortex/src/providers/openai_def.rs` | 2 行：给 builder 注入 `Paths::in_config_dir("model_capabilities.json")` | 能力缓存路径只有 `cortex` crate 知道（`Paths` 是它私有的）。这是唯一构造自定义 `OpenAiProvider` 的地方。不写则 G1 在生产里永不生效 |
| `ui/desktop/src/components/settings/providers/modal/subcomponents/forms/CustomProviderForm.tsx` | `useEffect` 的依赖从 `initialData` 对象身份改为 `initialDataIdentity`（`catalog_provider_id|display_name|api_url`） | **G3 的结论就是这里**。不修则第 3 条 bug 仍然存在，且甲的修复在 UI 上不可见。§5 有论证 |
| `ui/desktop/.../CustomProviderForm.test.tsx` | 追加 4 条点击用例 | G3 要求 |
| `crates/cortex-provider-types/src/formats/databricks.rs`（9 处）、`crates/cortex-providers/src/openrouter.rs`、`crates/cortex/src/context_mgmt/mod.rs`、`crates/cortex/src/session/session_manager.rs`、`crates/cortex-cli/src/session/mod.rs` | **纯机械**：给 `ModelConfig { … }` 字面量补 `endpoint_capabilities: None`（新增字段的编译后果） | 全部在 `#[cfg(test)]` 里，无行为变化 |
| `crates/cortex-provider-types/src/lib.rs`、`crates/cortex-providers/src/lib.rs` | 各加一行 `pub mod` / `pub use` | 导出新模块 |

### 2.4 刻意未改

- `crates/cortex-sdk-types/src/custom_requests.rs`、`crates/cortex/src/acp/server/providers.rs`、`cortex-providers/src/declarative.rs`（甲所有）——本轮不需要
- `crates/cortex/tests/acp_fixtures/**` —— 见 §8 的 D6 说明
- 全部 i18n 资源、ACP schema、`ui/acp-client` 生成物
- 剥图占位文案 —— 现状已是如实的「image input is turned off for this model」（§0.3 ③② 已做过），且它在三个 format 层各有一份并被测试断言；G2 的可操作提示改走 ACP option description，避免为一句提示制造三处格式不一致

---

## 3. 能力的三层合并与优先级

`apply_declared_capabilities`（`model_config.rs`）与 provider 侧的迟到补偿（`openai.rs` 的 `with_endpoint_capabilities`）按同一张表工作：

```
用户声明（custom_*/ModelInfo.reasoning、ModelInfo.supports_vision）
  > 探测缓存（G1 观测到的直接拒绝）—— 实际上只在「两者都没有」时才有值
  > 端点自报（GET /v1/models）
  > 目录回填（canonical）
  > 名字启发式
```

写入一律 `is_none` 守卫：**入参侧的值是权威的**（甲 §7.1 的 `supports_vision` 契约，D5-b 对 `reasoning` 的同一要求）。

### 3.1 B1 的注入顺序论证（D4）

`with_canonical_limits`（`model.rs:167`）的形状是：

```rust
if self.reasoning.is_none() { self.reasoning = canonical.reasoning; }
```

它只在 `None` 时回填。所以注入点必须在 `apply_canonical_limits` **之前**，否则 canonical 的值会先把字段占住、用户的声明再也进不去。而且顺序反了不只是「盖回去」的问题：目录里**根本没有**网关自己的模型名（实测 `wb2api`/`cn`/`global` 关键词 0 条），所以对这类模型 canonical 通常给不出值，但一旦某个别名碰巧命中了目录，顺序就会决定谁赢——必须是用户。

落点选在 `base_model_config_from_user_config` 的**最末尾**（`normalize_effort_suffix()` 之后、`materialize_model_config_*` 之前）。比 `materialize_model_config_inner` 更早有一个好处：`with_default_thinking_effort` 还没跑，端点的 `reasoning_default_effort` 可以作为 `Option` 参与优先级解析，而不是先把用户的选择写死进 params。

回归钉在 `the_declaration_is_injected_before_the_catalog_can_answer`：声明 `gpt-4o-mini` 为推理模型时 `reasoning == Some(true)`（目录说 false 也没用），而不声明时仍由目录回答 `Some(false)`。

### 3.2 D3 / D5-b 的表态：`reasoning` 的不可逆怎么处理

**持久化层（`declarative_providers.rs`）—— 删掉了 `model.reasoning |= existing.reasoning`**，改用与 `supports_vision` 同一套「入参权威」契约，没有引入第二套机制（遵守 TASK 的要求）。安全性核对了甲 §7.1 的同一条依据：唯一生产调用方 `acp/server/providers.rs:743` 在 `custom_provider_models`（`:394`）已从 `loaded.config.models` **全量预置**，且 ACP DTO 的 `models` 是 `Vec<String>`（UI 只传模型名），所以传进来的 `reasoning` 只可能是「已存的值」或「用户改过的值」。

回归：`reasoning_is_reversible_on_update`（true → false → true）。

**注入层 —— 这是本轮最需要解释的一处判断。`ModelInfo.reasoning` 是非 `Option` 的 `bool`，`#[serde(default)]`，因此「声明 false」与「压根没写这个 key」在类型上不可区分。**

我最初实现成「`custom_*` 一律照搬」，端到端实测立刻暴露了它的后果：`custom_cortex-free-opencode.json` 里三个模型全是 `reasoning: false`，而任何 `custom_*` 提供商的模型都会因此拿到 `Some(false)`，**名字启发式被完全遮蔽**——一个从没写过 `reasoning` 字段的自定义网关文件会静默失去所有被名字识别的推理模型。这是把「没说话」当成「说了不」，方向错了。

最终规则（`declared_reasoning`）：**只发布 `true`**。

| 文件里写的 | 注入 `ModelConfig.reasoning` | 理由 |
|---|---|---|
| `"reasoning": true` | `Some(true)` | B1 的 AC 要求它真正生效 |
| `"reasoning": false` | `None`（不注入） | 类型无法区分「否」与「没说」。沉默比误伤安全：名字启发式仍可作答；若启发式答错了，端点会拒绝这个字段，G1 的降级会把拒绝落盘（§4） |
| 字段缺失 | `None` | 同上 |
| **非** `custom_*` 的内置声明式定义 | `None` | 内置定义里的 `reasoning` 是对目录已知模型的粗略提示，目录信息更全，让它继续作目录的最后一搏 |

「误伤方向」的选择是刻意的：多发一个 `reasoning_effort` 的代价是「端点拒绝 → 降级重试 → 落盘结论」，少发一个的代价是「用户的模型真的在思考，但滑块关不掉、声明形同虚设」。前者可自愈，后者不可自愈。回归见 `only_custom_providers_publish_a_reasoning_answer`。

### 3.3 B1 的降级策略

`cn:space-bunny` 这类模型一开 B1 就立刻走进乙 §7.1 警告的 1b 出站路径。本轮给的是**三重降级，按「先自愈、再让用户看见」排序**：

| 层 | 机制 | 触发条件 | 结果 |
|---|---|---|---|
| 1 | **端点自报**（B2） | `/v1/models` 有 `reasoning_supported_efforts` | 不发端点没声明的词；不发整个字段则由端点自己的 `reasoning_default_effort` 决定 | 零请求、零猜测 |
| 2 | **G1 探测降级** | 400 且消息指向 `reasoning_effort` **且**本次请求真的带了它 **且**该能力**不是**声明来的 | 剥掉该字段重试一次 → 成功；结论写进探测缓存，跨进程生效 | 一次错误请求，不计费 |
| 3 | **声明纠正** | 400 **且**该能力是用户声明的（`declared_model().reasoning == true` 或端点发布了非空词表） | **不降级**，错误上抛 | 用户看得见，声明能被改 |

第 3 条是刻意的：**一个被明确声明过的能力不因为一次报错就被静默忽略**——那正是乙花一整轮消灭的静默失效的镜像（这次方向相反：UI 承诺了但出站丢掉）。错误上抛让用户去改 JSON，G2 的提示（§6）也指向同一处。

端点级 400 现在**不再重试 3 次**（`retry.rs`）：同一个 payload 重发不可能成功，此前 4 个请求里 3 个是白费的。

---

## 4. G1：运行时探测兜底

对齐 `BUG-REPORT-custom-provider-vision.md` §7 方案 D。**这是本轮唯一对「完全不声明能力的端点」零配置生效的解**，也是 free-lane 这类网关的唯一出路。

### 4.1 三条降级

| 能力 | 乐观行为 | 触发 | 落盘 |
|---|---|---|---|
| `supports_vision` | 三个来源都为 `None` 时**假设 true、原样发送** | 400 且消息命中图像/视觉类拒绝词，**且**本次 payload 真的带了 `image_url`，**且**支持不是声明来的 | `supports_vision: false` |
| `reasoning_effort` | 用户选了档位就发（这本来就是用户的意思） | 400 且消息命中 `reasoning_effort`，**且**payload 真的带了它，**且**不是声明来的 | `supports_thinking_effort: false` |
| `/v1/responses` | 按模型名路由（乙的 A1 会把 realm 前缀模型路由到 responses） | 404/405/未实现 | `supports_responses_api: false`，之后路由直接走 chat |

每条都是**剥掉 → 重试一次 → 落盘**，没有第二次降级：图像剥掉后再拒 effort 是两种能力的问题，一次请求只处理一个。

「不是声明来的」这条护栏（`vision_was_guessed` / `effort_was_guessed`）是为了不把用户的声明变成一句没人看的注释。

### 4.2 缓存键怎么算

落点 **`<配置目录>/model_capabilities.json`**（Linux 上即 `~/.config/cortex/model_capabilities.json`，`GOOSE_PATH_ROOT` 隔离时在其 `<root>/config` 下）。

键是 `base_url 哈希 + 模型名`，按嵌套 map 存：

```jsonc
{
  "version": 1,
  "endpoints": {
    "8739e867a9759cee": {                       // FNV-1a-64(host + 请求路径) 的 16 位十六进制
      "base_url": "http://127.0.0.1:8787/v1/chat/completions",  // 冗余存一份，让哈希可人工核对
      "supports_responses_api": { "supported": false, "checked_at": 1792205501 },
      "models": {
        "oc-space-bunny-free": {
          "supports_vision": { "supported": false, "checked_at": 1792205501 },
          "supports_thinking_effort": { "supported": false, "checked_at": 1792205501 }
        }
      }
    }
  }
}
```

- **`base_url` 用 `host + 请求路径`**（`api_client.host()` 与 `base_path` 拼成 `…/v1/chat/completions`），不是用户填的 `api_url`。同一家网关两个配置项指向同一个端点时必须共享结论，而 `base_url` 的显示形态（带不带 `/v1`）不该影响。末尾斜杠被归一化（`http://a/v1` 与 `http://a/v1/` 是同一把键），有单测 `endpoint_key_is_stable_and_distinguishes_hosts_and_paths`。
- **哈希用 FNV-1a 而不是 `DefaultHasher`**：后者跨 Rust 版本不保证稳定，缓存会随一次工具链升级集体失效；FNV 无依赖且确定性。`supports_responses_api` 按端点存（与模型无关），另两项按 `base_url + 模型` 存——这正是 TASK 要求的复合键。
- `version` 字段：读到不认识的版本就当空缓存，不会把来历不明的结构解释成结论（单测 `probe_cache_ignores_a_foreign_version_instead_of_trusting_it`）。

### 4.3 什么时候写

**只在探测得出结论的那一刻写**，而且是「整文件读-改-写」（在进程内的 `Mutex` 后面）：`record_*` 三个方法。整个文件几十字节，写一次是一次 rename 量级的操作，不需要额外线程。探测缓存默认关闭（`capability_cache: None`），只有生产路径经 `openai_def.rs` 注入。

所有 I/O 失败**静默吞掉**：缓存未命中最坏多一次被拒请求，为写缓存而让请求失败是严格更差的交易。

### 4.4 怎么失效

- **TTL 30 天**（`checked_at` 逐条记录）。结论全是**否定**的（端点拒绝过），只在网关被升级后才会过期；过期后重新乐观一次，代价是每 30 天一次错误请求（不计费）。反过来永不过期意味着「网关修好了」这件事只能靠手删文件——单测 `expired_probe_verdicts_are_re_probed`。
- **版本不匹配** → 整体丢弃。
- **用户手删文件** → 下次探测重建。
- ✅ 用户声明优先级最高：**声明过的能力根本不会走到探测**，所以改 JSON 立刻生效，不受缓存影响。

---

## 5. G3：第 3 条 bug 落在哪一层

**结论：不在甲修的那一层。甲的 C4 修复是对的、也仍然需要，但它修的是「点『自动』清不掉已设值」；用户描述的「点了没反应」是另一个 bug，落在 UI 组件本身，现在已修。**

复现方式：`ui/desktop/.../CustomProviderForm.test.tsx` 追加 4 条**真实点击**用例（此前该文件 3 条用例里 grep 不到任何 vision/开关断言）。其中决定性的一条 `keeps a click made before an unrelated parent re-render`：点「开启」→ 让宿主以一个**内容相同、对象全新**的 `initialData` 重新渲染 → 提交。

**根因**：`CustomProviderForm.tsx:331` 的 `useEffect(…, [initialData])` 依赖的是**对象身份**，而两个挂载点都在自己的 render body 里现造这个对象：

- `ProviderGrid.tsx:288` — `const initialData = editingProvider && { … }`
- `ComposerProviderManager.tsx` — `setCustom({ … initialData: { … } })`，`editCustom` 是 `async`

于是宿主**任何一次 re-render**（搜索框输入、`refresh()` 的 provider 列表回来、任何父级 state 变化）都会让该 effect 重跑，`setModelVision` 把用户的点击全部抹掉。实测确认：点击后 re-render，`On` 按钮的 `aria-pressed` 变回 `false`。

这也解释了为什么甲在 ACP JSON-RPC + 落盘层验不出它：**请求层根本没收到过那份 payload**。

**修复**：把依赖换成 `initialDataIdentity`（`catalog_provider_id|display_name|api_url` 的拼接），即「换了一个供应商才重新水合」。语义上严格更好——同一供应商的数据刷新不应该覆盖用户正在编辑的内容。

**验证这条测试会咬**：把 `}, [initialDataIdentity])` 改回 `}, [initialData]);` → `keeps a click made before…` FAILED（`aria-pressed` 期望 `true` 实得 `false`）；改回后 13/13 通过。

附带确认另外三条：
- 点「开启」→ 提交 payload 为 `{'cn:space-bunny': {supports_vision: true}}`（只影响被点的那个模型）
- 点「自动」→ **key 保留**、值为 `undefined`，由 `providers.ts:updateRequestToCreate` 的 `?? null` 序列化成显式 `null`。甲 §3.2 的契约在 UI 层成立
- 已存状态读回渲染正确（「On」高亮、「自动」不高亮）

---

## 6. G2：端点不声明 reasoning 能力时的提示

**形态**：ACP `thinking_effort` 这个 select option 的 `description` 从固定文案改为条件文案。**不新增 i18n 键**（该 description 不是 i18n 资源，是 `SessionConfigOption` 上的诊断串）。

- 端点**问了并答了**（哪怕答的是空）→ 原文案，不打扰
- 端点**被问过、且什么都没声明** → 原文案 **+ 一句可操作的话**：点名是哪个模型、指出这是端点没声明而不是 Cortex 判断它不能推理、给出**唯一的设置入口**（在供应商 JSON 的该模型条目里加 `"reasoning": true`），并顺带说明端点侧的做法（`GET /v1/models` 返回 `reasoning_supported_efforts`）
- **从没问过**（内置供应商等）→ 原文案。**不能把「没问」说成「它不声明」**，那是另一种撒谎

「静默收成一档」这件事本身没有发生：`sends_thinking_effort()` 为假时菜单给 `[Off]`，但同时**这一档本身就是解释**，而 description 现在把「为什么只有一档、怎么变成多档」说清楚。这正是 vision §7「附带诚实性修复」与方案 A'（静默降级要变成一次设置入口）的做法。

单测：`test_silent_endpoint_description_names_the_setting_that_would_fix_it`、`test_endpoint_that_declares_capabilities_gets_the_plain_description`、`test_never_queried_endpoint_is_not_reported_as_declining_to_declare`。

---

## 7. B2 / B3 / B4 / D7

### 7.1 B2：消费 `GET /v1/models`

| 端点字段 | 去向 |
|---|---|
| `supports_images` | `ModelConfig.supports_vision` |
| `architecture.input_modalities` 含 `image` | 同上（OpenRouter 例外，vision §7 提过；`supports_images` 优先） |
| `supports_reasoning` | `ModelConfig.reasoning` |
| `reasoning_supported_efforts` | `ModelConfig.endpoint_capabilities` → **菜单档位集合**（B2 动态档位）＋ **出站词的取值集合**（B3） |
| `reasoning_default_effort` | `reasoning_default_effort()` → 缺省档位（优先级最低，见 §3.1） |
| `can_disable_thinking` | 解析并保留（当前未参与判定，`Off` 是否可表达由词表里有没有 `none`/`off` 决定） |

**读的位置**：`OpenAiProvider` 每个实例一次（`tokio::sync::OnceCell`），**只对声明式供应商**（`custom_models.is_some()`）发这个请求；内置供应商的模型目录本来就有，多一次请求只会得到更差的信息。失败（404/坏 JSON/超时 5s/鉴权）一律保持注册表原样，即 B2 之前的行为。**用 `get_or_init` 而不是 `get_or_try_init`**：没有 `/v1/models` 的端点否则会被每个请求重新探一次。

**端点不声明能力时的降级**：
1. 模型在 `/v1/models` 里但没有任何能力字段 → 发布一条「全 None」的记录。`endpoint_capabilities: None`（没人问过）与「有记录但全 None」（问了，它没说）在语义上被区分开，前者不会被 G2 说成「端点不声明」，后者会。这是 D9-A 里 free-lane 那种网关的常态。
2. 完全查不到该模型 → 不发记录，退回目录 + 名字启发式 + G1 探测。
3. 三个来源全空 → 图像走 G1 的乐观发送；档位走「不发字段，由端点自己决定」。

**冷启动时序缺陷（端到端实测发现并修掉）**：`ModelConfig` 是**同步**从 provider 名构造的，而 `/v1/models` 是 HTTP 请求。实测发现 `cortex run` 先构造会话的 `ModelConfig`、**之后**才初始化 provider 注册表，于是注册期发布的声明一个都赶不上，B1 在第一次请求上完全失效。修法有两处：
- `declarative_providers::declared_capabilities()` 在注册表尚未就绪时**直接从文件读**并 memoize（每进程每 provider 一次读盘），写/删 provider 时清 memo
- `OpenAiProvider::with_endpoint_capabilities()` 在 `stream()` 里把**刚读到**的端点元数据折进那个早产的 config，**只填空缺**：已被用户/声明/目录决定的值一律不动

### 7.2 B3：词表双向映射

`openai_reasoning_effort_for_endpoint(model_name, effort, endpoint)` 的回落链：

```
① 端点声明的词（word_for）
② 端点声明的词表 → 匹配优先序列（受声明约束）
③ canonical 的 reasoning_efforts → 匹配优先序列
④ 保守三元组 ["low","medium","high"]
```

`max ↔ xhigh` 双向：`ThinkingEffort::Max` 的**出站**词按端点声明解析——声明里有 `max` 就发 `max`，只有 `xhigh` 就发 `xhigh`；**入站**解析由既有的 `ThinkingEffort::from_str` 承担（`xhigh`/`max` → `Max`，`none`/`off`/`disabled` → `Off`）。`effort_levels()` 把两种写法折叠成一档，所以声明 `low/medium/high/xhigh/max` 的模型菜单显示 4 档（`max`），而发出去的仍是端点自己的词。

⚠️ 关于「替换硬编码回落 `["low","medium","high"]`」（TASK B3 的字面要求）的处理：该三元组**保留为最后一级兜底**，不再是第一来源。我不认为可以在没有证据的情况下改它——端点既没声明也不在目录里时，发 `xhigh`/`max` 是**发明**一个档位而不是发现它，而 TASK §5 断言的正是「端点不声明支持时怎么办」。真正被替换掉的是它的**优先级**：以前它是 realm 前缀模型实际走到的唯一分支，现在端点声明排在它前面。对 workbuddy 的 `cn:space-bunny`，`max` 从静默降级成 `high` 变成了真的发 `max`——这才是 C2 抱怨的那件事。

**端点声明了但不含该档**时用**它声明过的**词兜底，不越界发明：`cn:hy4-preview` 只有 `high`，任何档位都落到 `high`（菜单也只有这一档）。唯一例外是 `Off`——端点没有「关」的词时**省略字段**而不是发 `high`（对关不掉的模型说「别思考」没有可发的表示）。

### 7.3 B4：一致性结论与路由改动

**一致性核对结论：改之前是不一致的。** `openai_responses.rs:657` 用的是 `openai_reasoning_for_model()`（比菜单的 `sends_thinking_effort()` 窄：它额外要求 canonical 挂在 `openai/` 下），而乙的 A1 已经把 realm 前缀模型路由到了这条路径。后果是「菜单给出档位、这条路径不发 `reasoning.effort`」——**和 C1 一模一样的静默失效，只是换了条路径**。已把闸门统一到 `sends_thinking_effort()`，并镜像乙的两条收窄。单测 `test_responses_effort_gate_matches_the_chat_path_and_the_menu` 用 4 个模型交叉断言「菜单给多档 ⟺ 出站带上」。

**`should_use_responses_api` 改成什么样**：新增一道**在模型名之前**的门——

```rust
fn should_use_responses_api_for_provider(&self, model_name: &str) -> bool {
    if Self::PROVIDERS_NEEDING_STANDARD_CHAT_PARAMS.contains(&self.name.as_str()) { return false; }
    // 模型名说 gpt-6* 要走 Responses API；在只代理 chat/completions 的网关上
    // 这个答案是 404，会把「思考强度不可调」换成「整个模型不可用」，
    // 所以「已证明没有 Responses API」压过模型名。
    if self.responses_api_support.load(Ordering::Relaxed) == RESPONSES_NO { return false; }
    …原有逻辑不变…
}
```

`responses_api_support` 是 tri-state（未探/有/无），**从探测缓存初始化**，所以网关换掉之后不需要每次启动重探。第一次仍然按模型名试：404/405/未实现 → 标记 + 落盘 + **本次就用 chat 路径重试一次**（模型立刻可用），之后同一 `base_url` 不再问。成功一次也会标记为「有」。free-lane 与 WorkBuddy 这类网关因此**第一次 404、之后正常**，代价是一次错误请求。

⚠️ 这条把「原来因 A1 才开始打 `/v1/responses`」的模型从「不可用」变成了「可用」，但**第一次请求会多一次 404**。`should_use_responses_api` 本身没有任何配置开关（自定义 provider 的 `base_path` 只能显式写 `v1/responses` 或 `v1/chat/completions`，没有「不路由」的中间态），所以缓存是唯一的免问途径。

### 7.4 D7：判据怎么改的

`test_effort_menu_matches_the_outgoing_payload` 原来断言 `thinking_effort_values().len() > 1 ⟺ payload 含 reasoning_effort`。B2 落地后这个判据会把「网关只支持单档」的合法模型判成不一致。现在断言的是三条更强也更有意义的不变式（`assert_menu_and_payload_agree`）：

1. **菜单 ⊆ 端点声明**（端点声明了档位时）；**菜单非空**
2. **菜单显示的当前值 ∈ 菜单提供的档位**（`current_thinking_effort_value` 会把端点没声明的档位吸附到最近的已声明档位）
3. **可调模型必须把档位送上线**，唯一例外是乙 §3.2 那条收窄（`Off` + 非 OpenAI-canonical → 沉默）；不可调模型则菜单 `[Off]` 且出站无字段

第 3 条保留了原判据**真正要防的东西**（「UI 能调但不发」的静默失效），并且**没有**被档位数绑架。配套：`test_declared_single_level_gateway_offers_only_that_level_and_sends_it`（单档网关：菜单一档 + 出站有 effort，明确钉成正确行为）、`test_declared_vocabulary_drives_the_menu_instead_of_the_hardcoded_list`。

---

## 8. 验证命令与结果

### 8.1 Rust

| 命令 | 结果 |
|---|---|
| `cargo fmt` | 干净（只触及本次 11 个文件；`find -newermt` 核对过没有波及其它文件） |
| `cargo clippy -p cortex-provider-types -p cortex-providers --all-targets -- -D warnings` | **干净** |
| `cargo clippy -p cortex --all-targets --features scheduler,acp-http -- -D warnings -A dead_code` | **干净**（沿用乙的写法，见下 D8） |
| `cargo test -p cortex-provider-types --lib` | **669 passed, 0 failed**（基线 641，本次 +28） |
| `cargo test -p cortex-providers --lib` | **269 passed, 0 failed**（基线 262，本次 +7） |
| `cargo test -p cortex --features scheduler --lib` | **2236 passed, 16 failed** —— 16 个失败**逐条与乙 §7.6 的基线完全一致**（`extension_manager` / `prompt_manager` / 3× `state_machine` / `config::extensions` / `chatgpt_codex` / 3× `gcpauth` / 4× `toolshim` / 2× `sources`），全部在本次未触碰的模块。**零回归** |

**D8 说明**：AGENTS.md 的 `cargo clippy --all-targets -- -D warnings` 在本分支跑不通（不加 `--features scheduler` 时 `agents/state_machine/tests/` 下 24 个编译错误；加了又撞 `E0432: unresolved import cortex::acp::transport`，因为 `acp/mod.rs:12` 的 `pub mod transport` 带 `#[cfg(feature = "acp-http")]` 而 `--all-targets` 仍会编那个集成测试）。本次沿用**乙的可行写法**（`-p <crate>` 分开 + `--features scheduler,acp-http` + `-A dead_code`）。`-A dead_code` 本轮**其实不再需要**（甲的 `null_to_empty` 已接线），保留以与乙一致；实测未因此掩盖任何警告。

**已知的一处负载抖动**：`providers::gemini_cli::tests::initial_prompt_is_sent_on_stdin` 在某一轮全量跑里失败过一次，单独跑 4/4 通过，再跑全量又通过。它 `spawn` 子进程，是本机负载下的既有抖动，非本次引入。

### 8.2 UI

| 命令 | 结果 |
|---|---|
| `cd ui/desktop && node ../node_modules/typescript/bin/tsc --noEmit` | **干净** |
| `npx vitest run src/.../CustomProviderForm.test.tsx --testTimeout=30000` | **13 passed / 0 failed**（基线 9） |
| 同上，去掉 `--testTimeout` | 12 passed / 2 failed —— 两个**既有**用例（`does not carry credentials…`、`clears secrets…`）各耗时 ~4.4~5.0s，**默认 5s 超时把它们顶掉了**。在 HEAD 版本上单跑它们是过的，且本文件总耗时加/不加我的 4 条用例几乎不变（12.2s vs 12.3s），属这台机器的既有临界，不是本次引入。**未改这两个用例** |

### 8.3 端到端：真实二进制 + 严格假端点（不发任何真实模型请求）

`/tmp/opencode/cortex-bing-probe/mock_server.py`（Python 标准库，**不转发任何请求**，落盘每个请求体）起了两个网关，刻意做成用户环境里那两个的样子：

| 端口 | 形状 |
|---|---|
| **7865** | 声明型（workbuddy2api 形状）：`supports_images` / `supports_reasoning` / `reasoning_supported_efforts` / `reasoning_default_effort` / `can_disable_thinking` 齐全 |
| **7866** | 沉默型（free-lane 形状）：只有 `id` / `object` / `owned_by` / `name` / `context_window` |

两个都不实现 `/v1/responses`（404），并对指定模型的图像/档位各拒一次以观察降级。**7863（WorkBuddy）与 8787（free-lane）全程未接触。**

隔离配置根 `/tmp/opencode/cortex-bing-probe`，`cortex run` 打 `./target/debug/cortex`。落盘结果：

| 模型 | 网关 | 抓到的出站 | 结论 |
|---|---|---|---|
| `cn:space-bunny`（声明 `reasoning: true`，声明 `low/medium/high/xhigh/max`，默认 `max`） | 7865 | `reasoning_effort: "low"`（一次性辅助调用），主轮 **`"max"`** | ✅ B2/B3：用了端点自己的 `max`；`Off` 在这个网关上没有对应词，落到它声明过的最轻一档 `low` |
| `cn:hy4-preview`（声明单档 `high`） | 7865 | 主轮 **`"high"`** | ✅ **动态档位回归**：网关只支持一档 → 出站就是那一档，不是静默降级 |
| `cn:text-only`（声明 `reasoning: false`，端点 `supports_reasoning: false`） | 7865 | **无 effort** | ✅ 声明与端点都说不推理，就不发 |
| `cn:glm-5.3-flash`（`reasoning: false`、**名字启发式**认它是推理模型；`GOOSE_THINKING_EFFORT=high`） | 7866（沉默型） | 第一次 `reasoning_effort: "high"` → **400** → 第二次**无 effort** → 成功 | ✅ **G1 档位降级端到端**：剥一次重试成功，结论落盘 |
| 同上，第 2 次 `cortex run` | 7866 | 缓存已生效 | ✅ 结论跨进程存活 |
| `global:gpt-6-luna` | 7866 | 先打 `/v1/responses` → **404** → 自动改打 `/v1/chat/completions` → 成功 | ✅ **B4 路由回落**；`model_capabilities.json` 里留下 `supports_responses_api: false` |

落盘的探测缓存（沉默型网关）：

```json
{ "version": 1,
  "endpoints": { "8739e867a9759cee": {
      "base_url": "http://127.0.0.1:7866/v1/chat/completions",
      "supports_responses_api": { "supported": false, "checked_at": 1792205501 },
      "models": { "cn:glm-5.3-flash": {
          "supports_thinking_effort": { "supported": false, "checked_at": 1792205501 } } } } } }
```

图像降级分支**没有**在真实二进制上跑（`cortex run` 没有图片附件入口，见 §9）；它由 wiremock 端到端覆盖（`a_refused_image_is_stripped_once_and_remembered` 断言第一个请求**真的带** `image_url`、重试**真的不带**、缓存里落 `false`）。

### 8.4 ACP 集成测试（D6）

`cargo test -p cortex --test acp_custom_provider_methods_test` → **3 个全部在 `initialize` 阶段 panic**，因为 `crates/cortex/tests/acp_fixtures/server.rs:366` 仍断言 agent 名 `"goose"`（`left: Some("cortex") right: Some("goose")`）。与本次无关（改名遗留，甲 §7.2 已报）。

按甲的做法**临时**把 `"goose"` 改成 `"cortex"` 跑了一遍：3/3 通过（含甲的 `acp_custom_provider_model_capabilities_are_reversible`）——**证明我删掉 `model.reasoning |= existing.reasoning` 与新增的 memo 失效钩子没有破坏 ACP 落盘路径**。随后已还原，`grep 'Some("goose")'` 确认 `:366` 恢复原状，`git diff` 该文件只剩仓库既有的 goose→cortex 改名 diff。

### 8.5 隔离核对

- 全程 `GOOSE_PATH_ROOT=/tmp/opencode/cortex-bing-probe`，配置写在 `<root>/config` 下
- **未触碰** `~/.config/cortex` 与 `~/.config/goose`
- **未发任何真实模型请求**；假端点不转发，只落盘
- **未接触** `127.0.0.1:7863`（WorkBuddy）与 `127.0.0.1:8787`（free-lane）；假端点另起 7865/7866
- `crates/cortex/tests/acp_fixtures/server.rs` 的临时补丁已还原

---

## 9. 限制

### 9.1 只能我判断、需要你或真机回答的

| 项 | 状态 |
|---|---|
| **⚠️ B4 的 Responses API 风险（最高）** | 乙 §7.2 与 TASK D5-d 都要求**真机实测** WorkBuddy 的 `global:gpt-6-luna` / `global:gpt-5.6-terra` / `global:gpt-6-sol`。本轮**没有做**，因为约束禁止打 7863。代码侧已把风险从「整个模型不可用」降级为「第一次请求多一次 404，之后走 chat」，但**首次请求仍会打 `/v1/responses`**。WorkBuddy 到底实现没实现 Responses API，只有真机能回答 |
| **G1 的图像乐观发送在真网关上够不够安静** | 假端点上每次拒绝只花一次错误请求。真实中转站/官方 API 对「不支持图片」的 400 文案各异，我只匹配了一组常见措辞（`image`/`vision`/`image_url`/`multimodal` × 拒绝词），**措辞不同时会退化成「错误上抛」而不是静默降级**——安全方向的失败，但会打扰用户 |
| **档位 400 的措辞覆盖** | 同上，只匹配 `reasoning_effort` / `reasoning.effort` / `thinking_effort` + 拒绝词。workbuddy 真实文案未经真机核对 |
| **G2 提示的位置够不够** | 目前只在 ACP option description。桌面端底栏（`ThinkingEffortControl.tsx`）是否需要同样一句话，要看真机上的实际观感 |
| **`reasoning: false` 无法表达** | §3.2 的取舍。一个名字被启发式认成推理模型、而用户想显式关掉它的自定义模型，当前没有「关」的表示（要么改名，要么让端点拒绝一次让 G1 落盘）。要不要给 `ModelInfo` 加三态是**产品决策**，本轮没做 |
| **`model_capabilities.json` 的位置** | 按 vision §7 的建议放在配置目录。若用户偏好另一个位置（或希望它可由 UI 清除），需要一次改动 |

### 9.2 未做的验证

- **未做真机验收**。单测、wiremock、严格假端点对真实端点（workbuddy2api / free-lane / vortexapi / chatanywhere / siliconflow）的结论**没有证明力**。特别是 §9.1 第一条。
- **Gap D 未动**：`custom_lite-gpt` / `custom_chatanywhere` / `custom_siliconflow` 的 `/v1/models` 仍未核查（需用户 API key，本轮按你的指示不做）。若它们同样不声明能力，G1 的覆盖面必须包含它们——好消息是 G1 不需要任何端点配合。
- **图像降级未过真实二进制**：`cortex run` 没有图片附件入口；桌面端要真机会话 + 一次工具返回图片才能触发。覆盖来自 wiremock。
- **`cortex-cli` 的 ACP 集成测试**受 D6 阻断（§8.4）。

### 9.3 已知的行为变更（部署前要知道）

1. **`custom_*` 供应商的模型，只要写了 `"reasoning": true` 就会开始收 `reasoning_effort`。** 端点不接受时按 §3.3 三层降级；声明来的能力会**把错误上抛**而不是静默忽略。
2. **`supports_vision == None` 的模型现在会乐观发送图片。** 端点拒绝则剥图重试一次并落盘。这是对所有 `engine: openai` 自定义供应商生效的。
3. **realm 前缀模型（`global:gpt-*` 等）第一次会打 `/v1/responses`**，404 则回落 chat 并记住。
4. **每个声明式 provider 实例多一次 `GET /v1/models`**（5s 超时，失败即静默）。启动时的模型列表请求本来就会打这个端点，所以不是全新流量。
5. **`declarative_providers.rs` 的 `reasoning` 权威值契约**：`update_custom_provider` 不再把已存的 `reasoning` 兜底填回传入模型。唯一生产调用方全量预置，安全（同甲 §7.1 对 `supports_vision` 的核对）。

---

## 10. D 组四个 Gap 的收口情况

| Gap | 状态 |
|---|---|
| **A**（free-lane 不声明能力 ⇒ A/B 组对它无效） | ✅ **G1 + G2 已覆盖**。沉默型网关现在：图像乐观发送 + 拒绝后落盘；档位按名字启发式发 + 拒绝后落盘；菜单给出可操作提示而不是静默一档。端到端已在 7866 验证 |
| **B**（free-lane 不实现 `/v1/responses`） | ✅ **B4 已覆盖**。第一次 404 → 回落 chat → 落盘，之后不再问。端到端已验证 |
| **C**（第 3 条 bug 未在 UI 层复现） | ✅ **G3 已定位并修复**（§5）。根因是 `useEffect([initialData])` 的对象身份依赖，已改成供应商身份 |
| **D**（其余中转站未核查） | ⏸ **按你的指示本轮不做**。风险已由 G1 摊平：它不依赖端点配合，核查结果只影响「第一次是否浪费一次请求」，不影响功能 |

---

## 11. 与甲/乙的交接

- **给甲**：`ui/desktop/.../CustomProviderForm.tsx` 被我改了（§2.3）。改动只在 `useEffect` 的依赖与其上新增的一个常量，不碰三态控件、不碰 `modelVision` 的类型、不碰 `providers.ts`。C4 的权威值契约（入参侧权威、不兜底继承）原样保留
- **给乙**：`is_reasoning_model()` / `openai_reasoning_for_model()` / `sends_thinking_effort()` 三者的语义**一字未动**。B2 只在两个新入口喂它们：声明与端点元数据先进 `ModelConfig.reasoning` / `endpoint_capabilities`，`sends_thinking_effort()` 自然为真。你的两条收窄（xAI 固定参数族、`Off` 对非 OpenAI-canonical 沉默）在 `openai_responses.rs` 上被**镜像**了一次（此前那条路径上没有），这是 B4 要求的一致性，不是新语义
- **D6 的正解**仍待改名的负责人处理：`acp_fixtures/server.rs:366` 的 `"goose"` → `"cortex"`，一处字面量，解锁全仓库 ACP 集成测试
  → **✅ 2026-10-17 审计已修**。解锁后 8 个 ACP 测试二进制实测通过；`acp_custom_provider_methods_test` 不用打补丁就 3/3 通过（含甲的 `…model_capabilities_are_reversible`），证明你删掉 `model.reasoning |= existing.reasoning` 与新增的 memo 失效钩子确实没破坏 ACP 落盘路径。**同类遗留还剩 `cortex-cli/src/logging.rs:55` 一处**（未修）

---

## 12. 文档勘误

| 文档 | 写的 | 实际 |
|---|---|---|
| `TASK-...md` §2 丙 Read Scope | `crates/cortex-provider-types/src/base.rs (:250-277 ModelInfo, :725-731)` | 行号准确，但 `ModelInfo` **不需要改**（`reasoning: bool` 的非 Option 性质正是 §3.2 的由来）。`:725-731` 的 `thinking_effort_support()` 未触碰 |
| `TASK-...md` §2 丙 Write Scope | 未列 `crates/cortex-provider-types/src/retry.rs`、`lib.rs` | 本轮需要改 retry（能力 400 不重试） |
| `TASK-...md` D3 | `declarative_providers.rs:311` | 甲落地后行号有漂移，现为 `:313` 附近 |
| `FIX-yi-...md` §9 | `openai_reasoning_effort_for_thinking` 在 `formats/openai.rs:1939` / `xai_...` 在 `:1920` | 乙落地后分别为 `:1943` / `:1924`。`xai_reasoning_effort_for_thinking` **未被本轮触碰**（xAI 有自己的词表，优先于通用映射） |
| `BUG-REPORT-...-pipeline.md` §6 | `declarative_providers.rs:310` 是 C4 第二层 `.or()` | 甲已删；`:311` 的 `reasoning \|=` 是同类问题的 reasoning 版，本轮一并处理（§3.2） |
| **`TASK-...md` D10-b** | 「`accepts()` 的『端点与目录都没声明』分支返回**空集**而非三元组」 | 🔴 **2026-10-17 审计：字面的空集会引入 4 处新回归，未采用**。`(None, None)` 分支的真实覆盖面包含 `zai-org/GLM-5.3-Flash`、`claude-sonnet-4`、`kimi-k3`、`gemini-3-pro`、`gpt-6.1-sol@eu`，空集会让它们「菜单多档、出站 0 字节」。改为「只认本档自己的词」，D10-b 的两条验收标准（Off 省略字段、Max 不发 high）仍全部满足。见 `AUDIT-2026-10-17.md` §1 |
| **`SUMMARY-...md` §6 测试基线** | 「`cortex --lib` 2236 passed 16 failed，零回归」 | ⚠️ **口径修正**：补上 `tree-sitter,code-mode` 后是 2276 passed / 8 failed，16 个里有 8 个纯粹是 feature flag 没开（`analyze` 挂在 `#[cfg(feature = "tree-sitter")]` 下）。同时 `cortex-provider-types` 现为 670 |