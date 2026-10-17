# Cortex 避坑指南与最佳实践

> 合并所有 `docs/archive/FIX-*` 与对应 `BUG-REPORT-*`，按 **【涉及模块】-【现象】-【根因分析】-【最终解决方案】** 格式输出。
> 最后更新：**2026-10-17（经 `AUDIT-REPORT.md` 交叉审计修订）**

> ⚠️ 本文档的「最终解决方案」一栏**不代表该项已完成**——凡标注「**未修 / 待立项 / 部分**」的条目，以 `PROGRESS.md` 的 P0/P1/P2 与 `BUG-*` 为准。
> ⚠️ 引用归档文档时注意：`AUDIT-2026-10-17.md` **没有 §9、也没有 §7.8**。

---

## 1. 自定义供应商配置层

### 【custom_providers 解析】-【`api_key_env: null` 导致整个注册表清空】-【`#[serde(default)]` 只处理字段缺失不处理显式 `null`；`load_custom_providers` 用 `.collect::<Result<Vec<_>>>()` 单文件失败即全灭，且错误只在 `tracing::warn!` 里，GUI 用户看不到】-【`crates/cortex-providers/src/declarative.rs`：`api_key_env` 加 `deserialize_with = "null_to_empty"`，把 `null`/缺失/空串统一归一化为 `""`，保持 `String` 类型不变 ⇒ 零调用点变更。⚠️ **只解决了这一种坏文件**；真正语法错误的 JSON 仍会拖垮整张表（`PROGRESS` BUG-1）。正确写法本就是 `""`】

> 补充：旁边的 `headers` / `session_id_header_override` 同样能接 `null`（它们本来就是 `Option`）——手写 JSON「统一置 null」的习惯**只在 `api_key_env` 上出事**。未来新增非 Option 字段时注意同类风险。

### 【视觉三态开关】-【点「自动」清不掉已设的 `supports_vision` 值】-【Wire 格式无法表达「显式重置为自动」：UI 删 key 与「没碰过」同构；后端 `providers.rs` 与 `declarative_providers.rs` 两层 `.or()` 把两者当同一回事】-【1. UI 显式发送 `{supports_vision: null}`（`delete` → `undefined` 保留 key）；2. `providers.rs` 用 `match capabilities.get()` 区分「无条目=不碰」与「有条目为 null=清除」；3. `declarative_providers.rs` 删掉 `.or(existing)` 兜底；4. `providers.ts` 已有 `?? null` 序列化支持。**ACP schema/DTO 未变** ⇒ 无需重跑 `generate-acp-types`】

> ⚠️ 此项**不等于**用户报的「点了完全没反应」。真根因是 §5 的死 Tailwind 类；本项与 G3 都是「真实但次要」的问题。

### 【剥图占位文案】-【提示文案一律归因「模型不支持视觉」，但实际可能是缓存/配置关掉了】-【判定链有四层，文案只写了一层的归因】-【**已诚实化**：`model does not support vision` → `image input is turned off for this model`。⚠️ `openai.rs`/`openai_responses.rs`/`databricks.rs` **三处各一份且被测试断言**，改文案必须同步三处】

---

## 2. 思考强度诚实化

### 【OpenAI 格式层】-【`global:gpt-6-luna` 等 realm 前缀模型不被识别为 Responses 系】-【正则分隔符只含 `[-/]`，缺 `:`。**任何带 `provider:` 形式前缀的 OpenAI 兼容网关都会踩到**，与 WorkBuddy 无关】-【`crates/cortex-provider-types/src/formats/openai.rs` 正则 `[-/]` → `[-/:]`，`is_openai_responses_model` 识别通过】

### 【菜单与出站判定分叉】-【菜单显示多档可调，出站零字节】-【菜单侧 `is_reasoning_model()` 认 glm-5.3 名字，出站侧 `openai_reasoning_for_model()` 不认（要求 canonical 挂 `openai/` 下），两个判定结论相反。实测 `cn:glm-5.3-flash` 的 3 档滑块是纯装饰；调 `GOOSE_THINKING_EFFORT` 对这类模型完全无效】-【新增 `ModelConfig::sends_thinking_effort()` 为单一判定，菜单与出站共用。选路线 1b（放宽出站）而非 1a（收紧 UI）：1a 会砍掉 xAI 已生效的能力；1b 需两处收窄——xAI 固定参数族不发、非 OpenAI-canonical 模型选 Off 沉默。⚠️ **1b 没有运行时降级**：闸门放宽后凡是 `is_reasoning_model()` 为真的模型在 chat 请求上都会开始收 `reasoning_effort`，端点不认时可能直接 400（`PROGRESS` P0-2）】

### 【Off 兜底三元组】-【选「Off」实际发出 `low`】-【`openai_reasoning_effort_for_endpoint` 内 `accepts` 闭包的 `(None, None)` 分支回落硬编码 `["low","medium","high"]`，`Off` 的 preferred 序列 `none → minimal → off → low` 落到 `low`；`Max` 则落到 `high`】-【删除三元组（含 `openai_reasoning_efforts_for_model()` 连同 doc 注释），改为 `own_effort_word()`「只发明词、不发明档位」：`Off` 无词故不发字段，`Max` 发 `max` 而非 `high`】

> ⚠️ **偏离字面指示**：原 TASK D10-b 要求「返回空集」，实测字面空集会打破 **4 处**（其中 2 条是乙/丙的核心不变量）；既有 6 条测试的处理是**改写 3 + 保留 1（跨路径不变量）+ 新增 2**。受影响模型不止「网关闭默型」——`zai-org/GLM-5.3-Flash`、`claude-sonnet-4`、`kimi-k3`、`gemini-3-pro`、`gpt-6.1-sol@eu` 全走这条分支（`openai.rs` 的映射把 provider 写死成 `"openai"`）。
> ⚠️ **同类缺口仍在**：「目录有词表但无『关』的词」时 `Off` 仍发 `low`（`cn:glm-5.3-flash` 实测，含 7865 声明型网关），属产品决策未修（`PROGRESS` P1-2）。

---

## 3. 能力上线

### 【用户声明 `reasoning` 进 ModelConfig】-【声明式 JSON 里的 `reasoning: true` 到不了 ModelConfig】-【`crates/cortex/src/model_config.rs` 的 `base_model_config_from_user_config` 里 `reasoning: None` 是硬编码（当前在 **:147**，不是归档文档写的 :136）。且 engine=openai 出站侧 `declared_model()` 原本只读 `supports_vision` 与 `thinking_preservation_format`，**没有任何一处读 `ModelInfo.reasoning`**】-【函数末尾调 `apply_declared_capabilities`（同文件 `:169`），在 canonical 回填**之前**注入。`ModelInfo.reasoning` 是非 Option `bool` ⇒ 只发布 `true`，`false` 视为「没说」让启发式/G1 作答。⚠️ 且**非 `custom_*` 的内置声明式定义连 `true` 都不注入**】

### 【消费 GET /v1/models】-【端点已上报 `supports_images`/`reasoning_supported_efforts` 等，Cortex 一字节没读】-【`OpenAiProvider::with_endpoint_capabilities` 读取并发布到 `ModelConfig.endpoint_capabilities`；`response_builder.rs` 菜单改为端点声明驱动】-【⚠️ 只对**声明式**供应商发这个请求（内置供应商模型目录本就有，多一次只会得到更差的信息）；`get_or_init` 而非 `get_or_try_init`（否则无 `/v1/models` 的端点会被每请求探一次）；失败（404/坏 JSON/**超时 5s**/鉴权）一律保持注册表原样】

### 【冷启动时序缺陷（已修）】-【`ModelConfig` 同步构造，`/v1/models` 异步 HTTP，首次请求赶不上端点声明】-【`cortex run` 实测**先构造会话的 ModelConfig、之后才初始化 provider 注册表**，注册期发布的声明一个都赶不上】-【双修法：1. `declared_capabilities()` 在注册表未就绪时直接从文件读并 memoize；2. `with_endpoint_capabilities()` 在 `stream()`/`stream_chat()` 里把刚读到的元数据折进早产的 config，**只填空缺**】

> ⚠️ **注意：这条已修，与 `PROGRESS.md` P0-5「冷启动不回填 `reasoning`」是两个不同的 bug。**
> P0-5 是 `openai.rs:344` 的 `with_endpoint_capabilities()` 只折进 `endpoint_capabilities` 与默认档位、**不回填 `reasoning`**，而闸门 `sends_thinking_effort()` 只看 `reasoning`。丙的测试全绿是因为每个都预置了 `reasoning=Some(true)` ⇒ **「端点是唯一推理证据」这一类模型从来没被测过**。

### 【词表双向映射】-【`ThinkingEffort(off/low/medium/high/max)` 与网关词表 `low/medium/high/xhigh/max` 不是一套】-【端点校验取值（真机实测乱值返 400）⇒ 词表映射是必需项不是优化；`max` 与 `xhigh` 都被 free-lane 接受】-【`openai_reasoning_effort_for_endpoint` 回落链：端点词 → 端点词表优先序列 → catalog → 本档自己的词。`max ↔ xhigh` 双向。`Off` 在端点无「关」的词时省略字段而非发最轻档】

### 【/v1/responses 路由回落】-【realm 前缀模型改打 `/v1/responses`，不实现 Responses API 的网关会 404】-【B4 新增「已证明无 Responses API」门，压过模型名；判据从探测缓存初始化（跨进程存活），首次 404 标记+本次回落 chat。⚠️ **`should_use_responses_api` 没有配置开关**（`base_path` 只能显式写 `v1/responses` 或 `v1/chat/completions`）⇒ 缓存是唯一的免问途径】

> ⚠️ 这条副作用是 **A1 落地时才发现**的，原始分析与 TASK 都没提到；上真机前必须实测，否则可能把「思考强度不可调」换成「整个模型不可用」（`PROGRESS` P0-1）。
> ⚠️ Responses 路径首个请求带 `reasoning.effort = "none"` 是**该路径的既有行为**（纯 `gpt-5.4` 完全相同），**不是** A1 引入。

### 【运行时探测兜底 G1】-【完全不声明能力的端点（free-lane 只有 `id/object/owned_by/name/context_window` 5 个字段）A/B 组全无效】-【`supports_vision == None` 乐观发送，400 且消息命中图像拒绝词 → 剥图重试一次 → 落盘；同理 `reasoning_effort`、`/v1/responses`。**一次请求只处理一种能力，没有第二次降级**】-【缓存键：`base_url` FNV-1a-64 哈希 + 模型名，TTL 30 天。⚠️ **「声明过的能力根本不走探测」**——护栏 `vision_was_guessed`/`effort_was_guessed` 要求声明为 `None`；这正是为什么**刻意不往 `custom_cortex-free-opencode.json` 写 `supports_vision`**（会把未经真机确认的声明变权威值，反过来关掉 G1 自愈）】

### 【UI 状态重置 G3】-【点击视觉开关后宿主任何 re-render 都把选择抹掉】-【`CustomProviderForm.tsx` 的 `useEffect`（当前 `:341`）依赖对象身份，两个挂载点（`ProviderGrid.tsx`、`ComposerProviderManager.tsx`）都在 render body 里现造对象。宿主任何一次 re-render（搜索输入、`refresh()` 回来、父级 state 变化）都会让 effect 重跑】-【依赖改为 `initialDataIdentity`（`:337` 定义、`catalog_provider_id|display_name|api_url`，依赖数组在 `:370`），即「换供应商才重新水合」。新增 4 条真实点击用例验证。⚠️ 这也解释了为什么甲在 ACP JSON-RPC + 落盘层验不出它：请求层根本没收到过那份 payload】

### 【G2 提示的三态措辞纪律】-【把「没问过」说成「它不声明」】-【「有没有问过」与「问了但没说」是两个语义，必须在 `endpoint_capabilities` 里区分：`None` = 没人问过；有记录但全 `None` = 问了它没说】-【端点**问了并答了**（哪怕答空）→ 原文案；**被问过且什么都没声明** → 原文案 + 可操作提示；**从没问过**（内置供应商等）→ 原文案。⚠️ **把「没问」说成「它不声明」是另一种撒谎**】

---

## 4. Developer 角色 400

### 【OpenAI 格式层】-【推理模型向兼容端点发 `developer` 角色导致 400】-【`is_reasoning_model` 同时决定系统角色与思考参数，「是否推理模型」与「系统消息用什么角色」被耦合了。已有兼容 shim（`openai.rs` 的 `developer → system` 归一化）被 provider 白名单门控 ⇒ **只有 `nearai`/`pleumrouter` 受益，自定义 provider 永远不执行**】-【方案 A：角色恒为 `system`，不动 `reasoning_effort` 发送条件。同步更新 2 条单测断言为 `system`，新增 canonical 推理模型保留 effort、显式非推理模型省略 effort 的回归测试（流式+非流式各覆盖）。⚠️ **真机验收未做**，见 `PROGRESS` P1-10】

> 方案 B（按 provider 分流）不可行的原因：`create_request_for_model_with_options` 签名里**没有 provider 名**，且「白名单谁该用 developer」正是 `PROVIDERS_NEEDING_*` 已暴露的维护负担。

---

## 5. 架构与工程级教训

### 【测试隔离】-【技能测试读到开发者真实 `~/.agents/skills` 导致失败】-【`GOOSE_PATH_ROOT` 只隔离 config/data/state，**不隔离 `~/.agents/skills`**（`crates/cortex/src/skills/mod.rs:401` 用 `dirs::home_dir()`）；`discover_skills` 的 `seen` 去重让自装技能顶掉内置】-【以后写技能测试要么隔离 `HOME` 要么别依赖 builtin 存在；CI 需干净机器跑。⚠️ **只读未写**，硬边界「真实 config 目录未被触碰」仍成立】

### 【集成测试从未跑过】-【`declared_vision_registry` 陈旧断言活到今天】-【三轮只跑 `--lib`，从没跑 `--test`；且验证清单长期不含 `settings/models` 目录，导致 `ComposerModelPopover.test.tsx` 的 210px 过期断言也一直没跑到】-【验收必须带全 `scheduler,acp-http,tree-sitter,code-mode`，且跑集成测试；⚠️ **测试失败必须回旧仓库跑同一用例确认是否既有，不能默认归因本次改动**】

### 【慢用例假失败】-【~4.4~5.0s 的用例在默认 5s 预算下报超时】-【看起来像断言失败，实际是超时】-【定点跑 UI 测试带 `--testTimeout=15000`（或 `30000`）；见 `PROGRESS` P2-6】

### 【真机验收不可替代】-【视觉开关「点了没反应」三轮都没找到真根因】-【单测断言 `aria-pressed` 属性，用户看的是高亮，中间隔着「CSS 是否真生成规则」】-【**没有任何人在运行中的应用里点过一下**——必须真机验收。真根因是 5 个主题未注册的 Tailwind 类】

### 【Rust 改动要批量】-【改一个字符串触发 release 增量 12m39s（级联 cortex→cortex-mcp→cortex-cli＋链接 290MB）】-【同一会话内批量改完再编译，不要改一行编一次。⚠️ **未收到完成结果前不要重复启动构建或打包，更不可终止现有 Rust 进程**】

### 【构建不可中断】-【v8 build script 先删 `release/gn_out/` 再重下 169MB `.a`，中断＝永久丢失且无副本】-【`CARGO_EXIT=101` 事故教训。失败特征：`URLError: [Errno 111] Connection refused` + `v8-goose-*/build.rs:669` 的 `assertion failed`，**与代码无关**】

### 【可诊断性缺陷】-【后端根因查了两轮】-【`cortexServe.ts` 的 `onStderrData` **只把 `isFatalError` 落 main.log，所有 `warn!`/`error!` 级后端日志一律丢弃**】-【现新增 `isBackendDiagnostic` 落 `logger.warn`，`Logger` 接口加**可选** `warn?` 不破坏既有实现。⚠️ **这类缺陷会复发**：可观测性缺口比功能 bug 更难查，因为它不会报错】

### 【改名未提交状态禁用 git stash】-【`git stash push -- <path>` 会把文件整个撤走留 unmerged 索引】-【用 `diff` 逐字节确认、用 `git add` 清掉 unmerged 项】

### 【硬边界：真实配置目录不可触碰】-【全程 `GOOSE_PATH_ROOT` 隔离】-【判据：dev 态经隔离根运行不写真实配置 ⇒ 真实配置目录的写入只能来自正式版，可用文件时间戳取证。⚠️ **例外**：2026-10-17 `TASK` D10-a 为定决策直打真 free-lane 5 次】

### 【Tailwind v4 死类不报错】-【511 处死类，构建/typecheck/单测全过，只有真机看不出样式】-【**写错了不报错**：未注册 token 不生成任何 CSS，类名写在 DOM 上但无规则命中 ⇒ 元素默默用浏览器默认样式渲染。`@theme inline` 注册范围见 `ui/desktop/src/styles/main.css`】-【必须接入 CI 守卫（`scan-dead-classes.py` 对照 live dev server 生成 CSS）。⚠️ **单测断言 `aria-pressed` 而不是渲染出的样式，查不出死类**】

### 【非 Option `bool` 语义陷阱】-【`ModelInfo.reasoning` 是 `#[serde(default)] bool`，「声明 false」与「没写」类型上不可区分】-【照搬 `false` 会静默剥掉所有被名字启发式识别为推理模型的自定义模型】-【**只发布 `true`**，沉默比误伤安全：多发 effort 代价可自愈，少发代价不可自愈】

### 【权威值契约】-【入参侧的值是权威的，不做兜底继承】-【`supports_vision`/`reasoning` 同理。唯一生产调用方已全量预置（`providers.rs:394`），安全。⚠️ 若出现新的部分模型调用方应加显式 `reset_*` 字段而非依赖隐含前提——`.or()` 幂等不是因为写得对，是因为上游已预置旧值】

### 【端点不声明能力时的降级策略】-【三层】-【① 端点自报优先 → ② 400 后剥字段重试一次落盘 → ③ **声明来的能力不降级、错误上抛让用户改声明**】-【G1 缓存跨进程存活。⚠️ 第 ③ 条是刻意的：被明确声明过的能力不因一次报错就被静默忽略——那正是「UI 承诺了自己不兑现的能力」的镜像（方向相反）】

---

## 6. 最佳实践清单（写代码前自查）

- [ ] 是否在 `model_config.rs` 注入点**之前**处理用户声明（canonical 回填前）？
- [ ] 是否用 `sends_thinking_effort()` 作为菜单与出站的单一判定？
- [ ] 是否避免在 `(None, None)` 无证据分支发明档位？
- [ ] 是否区分「无条目=不碰」与「有条目为 null=显式清除」？
- [ ] 是否保持 `String` 类型用 `deserialize_with` 处理 `null` 而非改 `Option`？
- [ ] 是否在 `should_retry` 里对能力 400 返回 false（同 payload 重发不可能成功）？
- [ ] 是否用 FNV-1a 而非 `DefaultHasher` 做跨版本稳定缓存键？键是否用 host+请求路径而非用户填的 `api_url`？
- [ ] 是否在 `useEffect` 依赖里用稳定身份键而非对象引用？
- [ ] 是否用已注册的 Tailwind token 而非自造 camelCase？
- [ ] 全程 `GOOSE_PATH_ROOT` 隔离测试，不触碰真实配置？
- [ ] 批量改完 Rust 再编译，避免重复链接 290MB 二进制？
- [ ] 是否跑集成测试（`--test`）而非只跑 `--lib`？带全 feature？
- [ ] **测试失败时是否回旧仓库跑同一用例确认是否既有**？
- [ ] **后端 `warn!`/`error!` 是否会落盘**（可诊断性）？
- [ ] **是否真机点过一下修改的 UI 交互**（不只是断言属性）？

---

## 7. [需人工确认] 的冲突/缺失信息

| 冲突点 | 文档 A 说 | 文档 B 说 | 待定事项 |
|--------|-----------|-----------|----------|
| Off 兜底修复方向 | `TASK` D10-b 要求「返回空集」 | `AUDIT` §1 实测字面空集引入 **4 处**回归，采用「只认本档自己的词」 | **已按审计实现，但 `TASK` 文档未同步更新**。注意：4 = 新失败数，6 = 既有测试总数，两数不同集合 |
| OpenCode 系根治路线 | `SUMMARY` §7.5 建议路线 ①（`catalog_provider_id` 参与 canonical 查找） | `AUDIT` §4.4 实测模型名 `oc-*` 与目录对不上（`strip_common_prefixes` 无 `oc-`），改代码也接不通 | **需新立项设计改动，当前靠 workaround**（`PROGRESS` D14/P1-1） |
| `reasoning: false` 能否表达 | 丙 §3.2 刻意只发布 `true` | `AUDIT`/`FIX-bing` §9.1 #5 称需产品决策加三态 | **产品决策待定**（`PROGRESS` P1-3） |
| `model_capabilities.json` 位置 | vision §7 建议配置目录 | `AUDIT` §5-E #7 用户可能偏好其他位置 | **待用户确认**（`PROGRESS` P1-4） |
| 真实 `~/.config/goose` 时间戳 | `refactor-plan` 硬边界要求恒为 `2026-10-09 17:56:19` | `FIX-yi` §7.8 实测 `2026-10-16 15:33:19` 已被用户手工改动 | **需确认修订硬边界还是清理现场**（`PROGRESS` P2-4） |
| G2 提示位置 | `FIX-bing` §9.1 #4 只在 ACP option description | `AUDIT` §5-E #6 问底栏是否也需要 | **取决于真机观感，尚未决策**（`PROGRESS` P1-9） |
| `ui/desktop/src/api` | `AGENTS.md` 旧版禁止 import / 重建该路径 | **该路径在工作区、git HEAD、全部归档文档中均不存在** | 已在修订版中删除，改为指向真实的 `ui/acp-client/src/generated/` |

### 7.1 归档文档中已知的失效引用（勿再沿用）

| 失效引用 | 实情 |
|----------|------|
| `AUDIT-2026-10-17.md` §7.8 / §9.1 / §9.2 | **该文没有 §9，§7 无子节**。这些编号实际出自 `FIX-yi` §7.8 与 `FIX-bing` §9.1/§9.2 |
| `AUDIT-2026-10-17.md` §4-C / §4-D / §4-E | 实为 **`### C.` / `### D.` / `### E.`，隶属 §5** |
| `BUG-REPORT-developer-role-rejected.md` §82 | 该文件只有 **125 行 / 8 节，无 §82**。实指 `test_create_request_non_reasoning_model_omits_reasoning_effort` |
| `crates/cortex-provider-types/src/declarative.rs` | **该文件不存在**（`FIX-jia` §9 已勘误）；结构体在 `crates/cortex-providers/src/declarative.rs` |
| `model_config.rs:136` = `reasoning: None` | 现为 **`:147`** |
| `CustomProviderForm.tsx:331` = `useEffect` | 现为 **`:341`**（`initialDataIdentity` 在 `:337`、依赖数组在 `:370`） |
| `/tmp/opencode/wb2api-effort-probe/mock_server.py` | **该目录已不存在**（`FIX-yi` §9 勘误） |
| 「A1 会让 B1 白做」 | **已被 `FIX-yi` §3.2 自己推翻**（`model.rs` 的 `self.reasoning.or_else(...)` 优先采用显式声明）。勿据此推导 |
| vision 报告 C1/C3 的根因 | `custom_` 前缀剥除（方案 B）**已于 2026-10-15 落地**，故 C1 **不是它的复现** |
