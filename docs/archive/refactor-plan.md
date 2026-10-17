# Cortex（基于 Goose）独立应用：当前状态与续接指南

> 更新：2026-10-16。仅保留现行状态与必要规则；被取代的方案、历史测试计数与执行日志已删除。
> 主文档管决策/运行/验证；`audit.md` 只存源码证据与限制。

## 0. 当前状态与硬边界

- **🔴 第四轮：定点审计三份交付（2026-10-17 完成）——交付文档 `docs/AUDIT-2026-10-17.md`**
  - **随后追加了真机验收轮**（用户开窗实测），修了两件遗留、又挖出两件此前没人发现的事 ——
    ①**workbuddy 切不过去不是代码 bug**：GUI 进程环境里没有 `WB2A_API_KEY`（它只存在于 `systemctl --user` 的用户环境）。
      **从带该变量的环境启动窗口即恢复，不必注销重登**（比 SUMMARY §6 第 6 条记的原方案省事）；
    ②**视觉开关「点了完全没反应」的真根因是死 Tailwind 类**：`surfaceHover` / `textStandard` / `textSubtle` /
      `borderSubtle` / `borderStandard` **在主题里根本没注册**，Tailwind v4 不为其生成任何 CSS
      ⇒ 选中态只剩 `font-medium`，**点击与提交一直正确，缺的只是反馈**。
      **甲的 C4 与丙的 G3 都是真实但次要的问题，三轮都没找到真根因——因为没有任何人在运行中的应用里点过一下**。
      已修，并立项全仓库普查（详见下方待办条目）
  - **修了两件遗留**：①**丙的兜底三元组已删除**——它让「选 Off」发出 `reasoning_effort: "low"`、让「选 Max」发出 `"high"`；②**D6 已修**（`acp_fixtures/server.rs:366` 一处字面量），**全仓库 ACP 集成测试首次真正跑起来**
  - ⚠️ **审计偏离了 TASK D10-b 的字面修复方向，理由充分**：D10-b 要求「`accepts()` 的『端点与目录都没声明』分支返回**空集**」。实现并实测后，**空集打破 6 条既有测试**，其中 2 条是乙/丙本轮的核心不变量。原因：`(None, None)` 分支的覆盖面远大于「网关闭默型」——`zai-org/GLM-5.3-Flash`（目录挂在 `siliconflow/` 下，而 `openai.rs` 的映射把 provider 写死成 `"openai"`）、`claude-sonnet-4`、`kimi-k3`、`gemini-3-pro`、`gpt-6.1-sol@eu` 全走这条分支，空集会让它们「菜单多档、出站 0 字节」，正是乙花整轮消灭的那个病。**实际实现：只发明「词」、不发明「档位」**——`Off` 无词故不发字段，其余各档发自己的名字（`Max` 发 `max`）。两条验收标准（Off 省略字段、Max 不发 high）都满足，且零回归
  - **三处新发现（均只报告未改）**：①**B2 在冷启动上失效**——`openai.rs:344` 的 `with_endpoint_capabilities()` 不回填 `reasoning` 而闸门只看它，实测端点声明了 `["high"]`、`GET /v1/models` 也确实被问、能力确实进了注册表，**第一轮和第二轮出站都没有 `reasoning_effort`**；丙的测试全绿是因为每一个都预先设了 `reasoning: Some(true)`，「端点是唯一推理证据」这一类从没被测过。②**`cortex-cli/src/logging.rs:55`** 是 D6 的同族改名遗留（`paths.rs:22` 的 `app_name` 已是 `"cortex"`，断言仍找 `"goose"` 分量），是 `cortex-cli --lib` 唯一的失败。③**「目录有词表但没有关的词」时 `Off` 仍发 `low`**（`cn:glm-5.3-flash` 实测），**比网关闭默型更常见**，但「发最轻档」vs「不发（端点默认可能更多）」是产品决策不是机械修复
  - ⚠️ **对「16 个基线失败」的修正**：那个数字只在 `--features scheduler,acp-http` 下成立。**补上 `tree-sitter,code-mode` 后是 2276 passed / 8 failed**——`analyze` 扩展挂在 `#[cfg(feature = "tree-sitter")]` 下，16 个里有 8 个纯粹是 feature flag 没开。**三轮都只跑过 `--lib`，从没跑过集成测试**（丙 §8.1 的表格里没有 `--test`），这是 `declared_vision_registry` 的陈旧断言能活到今天的原因
  - **`acp_custom_provider_methods_test` 现在不用打补丁就 3/3 通过**（丙 §8.4 曾需临时改字面量）
  - **给续接者的坑**：本仓库当前处于**改名未提交**状态，**不要用 `git stash` 做局部回退**——它会把工作树文件整个撤走并留下 unmerged 索引项（审计 §6 记录了一次已复原的事故）
- **✅ 覆盖度自查已收口（2026-10-17，丙完成）**：三会话（甲/乙/丙）全部落地。交付文档 **`docs/FIX-bing-capability-wiring.md`**（丙，B1+B2+B3+B4+G 组）。**「4 个修复路径有洞」的根因是所有方案都建立在「端点会声明能力」这个前提上，而该前提只对 workbuddy2api 成立**——G 组就是为此存在的，现已把「端点沉默」变成一等公民。下方 Gap A/B/C 是**发现时的记录（原文保留）**，各自的现状见本条末尾与交付文档 §10。**（2026-10-17 审计：丙的三处「Write Scope 外」改动确认为纯机械且全在 `#[cfg(test)]` 内；「三函数语义一字未动」属实；但兜底三元组已由审计删除，见上条）**
  - **Gap A【最高】用户环境有**两个**网关，此前只验证了一个**：workbuddy2api(7863) 的 `/v1/models` 能力齐全；**free-lane(8787，OpenCode 免费车道) 只有 `id`/`object`/`owned_by`/`name`/`context_window` 五个字段、零能力元数据**（实测；那是用户自写的 `~/.cortex/free-lane/gateway.py` 第 212 行静态构造）。而 `custom_cortex-free-opencode.json` 三个模型也全是 `reasoning: false`、无 `supports_vision`。⇒ **对 OpenCode：A1 正则不命中（实测 7 个 `oc-*` 无一会被判成 responses 系）、B1 忠实搬运 `false`、B2 无字段可消费、B3 无档位可映射——A/B 组全部方案无效**。已给丙新增 **G 组**：G1 运行时探测兜底（唯一对任意端点零配置生效，推荐）／G2 端点不声明能力时给可操作提示而非静默降级／G3 补 UI 层点击复现。零代码成本的即时 workaround 是 B1 落地后手写 `"reasoning": true` 进 JSON，但有「UI 保存丢字段」的同款风险。**✅ 已收口（丙 G1/G2）**：端点沉默不再等于「无能力」——图像走乐观发送＋被拒后落盘，档位走名字启发式＋被拒后落盘（键＝`base_url` 哈希＋模型名，落 `~/.config/cortex/model_capabilities.json`，TTL 30 天），菜单给出可操作提示而非静默一档。已在**沉默型假端点（7866，free-lane 同形状）**上用真实二进制端到端验证。**（2026-10-17 审计补一条：该验证的前提是 provider JSON 里写了 `"reasoning": true`；**「端点是唯一推理证据」的模型在冷启动上仍拿不到档位**，见上条新发现①。`oc-*` 要真正接通，审计建议走「让 `catalog_provider_id` 参与 canonical 查找」而非手写声明——论证见 `AUDIT-2026-10-17.md` §2，**未实施**）**
  - **Gap B**：free-lane **不实现 `/v1/responses`**（`gateway.py:220` 只放行 `/v1/chat/completions`）。B4 的路由翻转风险对它确定会发生；目前 `oc-*` 名字不命中 A1 正则所以暂时安全，**但这是巧合不是防护**——将来任何 `gpt-5*`/`gpt-6*`/`o<数字>` 命名的免费模型都会踩中并 404。故 B4 追加：`should_use_responses_api` 判定要考虑端点是否支持 Responses API，不只模型名。**✅ 已收口（丙 B4）**：`should_use_responses_api` 新增一道**压过模型名**的门——「该 `base_url` 已被证明没有 Responses API」则直接走 chat。判据从探测缓存初始化（跨进程存活），首次 `/v1/responses` 404 时标记＋本次即回落重试。端到端已在 7866 验证（`global:gpt-6-luna`：先 404，再 chat 成功，缓存留下 `supports_responses_api: false`）
  - **Gap C**：第 3 条 bug 用户描述的是「点击完全没反应」，甲修的是「**自动**清不掉已设值」且**验证走 ACP JSON-RPC 层、不是 UI 点击**；`CustomProviderForm.test.tsx` 3 个用例里 grep 不到任何 vision/开关断言。若症状确在 UI 层，还有第五层未排查：`CustomProviderForm.tsx:331-359` 的 `useEffect([initialData])` 是否在 re-render 重置 `modelVision`（源码看应稳定，**但从未在运行中的应用里验证过**）。**✅ 已定位并修复（丙 G3）——猜测是对的，症状也确实是 UI 层**：两个挂载点（`ProviderGrid.tsx:288`、`ComposerProviderManager`）都在自己的 render body 里**现造** `initialData` 对象，而 `useEffect(..., [initialData])` 依赖的是**对象身份**，于是宿主任何一次 re-render 都会把 `modelVision` 抹回空。已改为按**供应商身份**（`catalog_provider_id|display_name|api_url`）而非对象身份触发水合。新增 4 条**真实点击**用例（此前该文件 3 条用例 grep 不到任何 vision 断言），并验证「去掉修复 → 该用例变红」。**甲的 C4 修复仍然正确且仍然需要**，它修的是另一件事（「自动」清不掉已设值）
  - **Gap D**：`custom_lite-gpt`(vortexapi.xyz)、`custom_chatanywhere`、`custom_siliconflow` 的 `/v1/models` **未核查**——需用户 API key 发真实请求，**用户尚未授权**。若同样不声明能力，C2 在它们身上也修不好
- **任务文档已完成执行（2026-10-16 文档就绪 / 2026-10-17 三会话全部落地）：`TASK-fix-custom-provider-capability-pipeline.md`** —— 修复下述 5 个症状的完整调度与 Task Contract。**两个并行会话（甲/乙，文件所有权零重叠）+ 一个串行尾巴（丙，必须等甲乙都绿）**。含硬约束（三会话共用一个 target 故**构建不并行**、cargo 锁超时处理）、文件所有权表、逐会话 Read/Write/Forbidden Scope 与验收标准、全局验收、本轮明确不做的边界。**进度：甲、乙、丙均已落地并绿**——`docs/FIX-jia-custom-provider-config-layer.md`（C5+C4，单测绿）、`docs/FIX-yi-reasoning-effort-honesty.md`（A1+A2，选路线 1b，假端点端到端已验收）、**`docs/FIX-bing-capability-wiring.md`（B1+B2+B3+B4+G 组，单测／wiremock／真实二进制＋严格假端点端到端三层绿；`cortex-provider-types` 669、`cortex-providers` 269、`cortex --lib` 2236 通过且 16 个失败与乙的基线逐条一致）**；三份交付**均未做真机验收**。**（2026-10-17 审计修正：`cortex-provider-types` 现为 670；那 16 个失败里 8 个只是 feature flag 没开；丙 §8.2 的「UI vitest 13 passed」只覆盖了他自己那一个文件，全量 `pnpm run test` 是 992 passed / 21 failed。完整基线见 `AUDIT-2026-10-17.md` §5）**
  - **甲（C5 + C4）已完成** → `FIX-jia-custom-provider-config-layer.md`。C5 用 `deserialize_with` 归一化 `api_key_env: null`；C4 让视觉三态真正可逆（`supports_vision` 入参侧权威、不兜底继承）
  - **乙（A1 + A2）已完成** → `FIX-yi-reasoning-effort-honesty.md`。A1 正则纳入 `:`；A2 **选路线 1b（放宽出站）**而非 1a，理由与两处必要收窄见其 §3.2
  - **丙（B1 + B2 + B3 + B4 + G 组）已完成** → `FIX-bing-capability-wiring.md`。B1 声明接线（注入点必须在 canonical 之前）／B2 消费 `GET /v1/models`（声明型网关）／B3 `max ↔ xhigh` 双向词表／B4 统一 `/v1/responses` 的闸门并加路由回落／G1 运行时探测＋能力缓存／G2 端点沉默时的可操作提示／G3 修掉 UI 层的状态重置。**乙 §8.1 的三条判定语义一字未动**；D7 的一致性判据已重写为「菜单 ⊆ 端点声明」＋「可调模型必须把档位送上线」
  - ⚠️ **测试隔离的一个坑（2026-10-17 审计查实）**：`GOOSE_PATH_ROOT` 只隔离 config / data / state，
  **`skills/mod.rs:401` 的 `dirs::home_dir()` → `~/.agents/skills` 不受它约束**，会被 `discover_skills`
  当作全局技能目录扫描。⇒ **技能类测试会读到开发者真实的家目录**，在本机就表现为
  `sources.rs:1817` 那条失败（你自装的 `web-search` 顶掉了内置那个，`discover_skills:631` 的 `seen` 去重）。
  以后写技能相关测试要么隔离 `HOME`，要么别依赖 builtin 的存在
- **丙的两个设计决定值得记住**：①`ModelInfo.reasoning` 是**非 Option 的 bool**，所以「声明 false」与「没写这个 key」类型上不可区分——最终**只发布 `true`**，让名字启发式与 G1 探测去回答其余情况（照搬 `false` 会静默剥掉所有被启发式识别的自定义模型）；②端点声明了但不含某档时用**它声明过的**词兜底，唯独 `Off` 在端点没有「关」的词时**省略字段**——没有证据时发明档位是错的。**（2026-10-17 审计：②的原则是对的，但丙的兜底三元组 `["low","medium","high"]` 违反了它自己的②，已删除；且②目前只在「端点/目录都没有声明」时成立，「目录有词表但没有关的词」时 `Off` 仍会落到 `low`，见上条新发现③）**
  - ⚠️ **仍待用户真机验收（单测与本地假端点不能替代真实端点结论）**：
    0. **（2026-10-17 审计已把这一节重排成两档共 9 条，每条带可直接跑的命令，见 `AUDIT-2026-10-17.md` §5-E。free-lane 侧已由主会话的真机探测定论，勿重复发请求）**
    1. **【最高】A1 翻转的端点路由 ＋ B4 的回落**——realm 前缀模型（`global:gpt-6-luna` / `global:gpt-5.6-terra` / `global:gpt-6-sol`）在自定义 base_url 上会先打 `/v1/responses`。B4 已把「整个模型不可用」降级为「**第一次请求多一次 404，之后走 chat 并记住**」，但**首次仍会打那个路径**，且**没有真机实测过 WorkBuddy 到底实现没实现 Responses API**。约束禁止打 7863，本轮未做
    2. **1b 的 400 风险**已从「无降级」降为「三层降级」（丙交付 §3.3）：端点自报优先 → 400 后剥字段重试一次并落盘 → **声明来的能力不降级、错误上抛让用户改声明**。但**各网关 400 文案的措辞覆盖未经真机核对**，措辞不同时会退化成「错误上抛」（安全方向的失败）
    3. **G1 的图像乐观发送**已对所有 `engine: openai` 自定义供应商生效（`supports_vision == None` 时假设 true）。假端点上每次拒绝只花一次错误请求，**真网关的 400 文案只匹配了一组常见措辞**
    4. **G1 的图像降级分支未过真实二进制**——`cortex run` 没有图片附件入口，覆盖来自 wiremock；桌面端需真机会话＋一次返回图片的工具调用
    5. **Gap D 未核查**：`custom_lite-gpt` / `custom_chatanywhere` / `custom_siliconflow` 的 `/v1/models` 仍未知（需用户 API key，按用户指示本轮不做）。风险已由 G1 摊平——它不依赖端点配合
    6. ~~**D6 仍挡住全仓库 ACP 集成测试**~~ → **✅ 2026-10-17 审计已修**（`acp_fixtures/server.rs:366`，一处字面量）。8 个 ACP 测试二进制实测通过，其中 3 个失败已分类：①`declared_vision_registry` 多出的那个请求就是丙 B2 自己写进 §9.3 的 `GET /v1/models`，属陈旧断言；②`goose-doc-guide` 那条集成断言是**死断言**（该技能被 `skills/builtin.rs:9-13` 刻意过滤掉了），改成断言 `web-search` 即可，**不需要产品决策**；③`code-mode` 让 fixture 的 5 秒 `AvailableCommandsUpdate` 预算超时，产品响应顺序本身是被测的不变量。**同类遗留还剩 `cortex-cli/src/logging.rs:55` 一处**。⚠️ 另附一条**测试隔离漏洞**：`GOOSE_PATH_ROOT` 不隔离 `~/.agents/skills`（`skills/mod.rs:401` 用 `dirs::home_dir()`），技能类测试会读开发者真实家目录——这正是 `sources.rs:1817` 那条 lib 测试失败的真因（你自装的 `web-search` 顶掉了内置那个），干净机器上会通过
    7. 部署前要知道的行为变更：`custom_*` 模型一旦写 `"reasoning": true` 就会开始收 `reasoning_effort`；`supports_vision == None` 的模型开始乐观发图；realm 前缀模型第一次多一次 404；每个声明式 provider 实例多一次 `GET /v1/models`（5s 超时，失败静默）
- **自定义供应商能力管线的原始分析记录（2026-10-16，均在 `docs/`，均已用真实二进制端到端复现；以下分析原文保留，落地状态见上条与 C1/C2 末尾的「现状」）**。**统一索引：`BUG-REPORT-custom-provider-capability-pipeline.md`**，深度分析分列 `BUG-REPORT-realm-prefixed-model-thinking-effort.md`（C1/C2）与 `BUG-REPORT-custom-provider-null-api-key-env.md`（C5）。
  - **统一根因**：能力信息有三套来源——①用户声明的 `ModelInfo`（`reasoning` **完全没读**，`supports_vision` 只有 provider 侧一处读）、②端点 `GET /v1/models` 的 `supports_images` / `reasoning_supported_efforts` / `reasoning_default_effort`（**一个字节都没读**）、③公共静态目录 `canonical_models.json`（唯一在用，但第三方网关模型名天然不在里面，实测 `workbuddy`/`wb2api` 关键词 0 条、provider 键无 `cn`/`global`/`wb2api`）。实际生效的只有 ③ + 模型名猜，而名字猜测不认 `cn:`/`global:` realm 前缀
  - **C1** 思考强度不可调；最恶劣的不是「没功能」而是 **`cn:glm-5.3-flash` 三档滑块是纯装饰**——`is_reasoning_model()`（菜单侧，认 glm-5.3 名字）与 `openai_reasoning_for_model()`（出站侧，不认）**是两个判定、结论相反**，UI 承诺了它自己不兑现的能力。后果：9 个 WorkBuddy 模型**全部不发 `reasoning_effort`**，思考强度恒为网关默认（`cn:space-bunny` 默认 `max` 且关不掉——倍率 x0.08 的日常主力一直跑满思考）。A/B 实测：**调 `GOOSE_THINKING_EFFORT` 对这类模型完全无效**。**现状（甲乙丙全部完成）**：菜单与出站统一到 `ModelConfig::sends_thinking_effort()`；断点①（`model_config.rs` 硬编码 `reasoning: None`）已由**丙的 B1** 修掉——供应商 JSON 里的 `"reasoning": true` 现在真的会生效（注意语义：**只发布 `true`**，`false` 因为是非 Option 类型分不清「否」与「没说」故按沉默处理，理由见丙交付 §3.2）。加上 B2（端点自报）与 G1（拒绝后落盘），**9 个 WorkBuddy 模型全部可调**（假端点与真实二进制端到端实测：`cn:space-bunny` 发 `max`、`cn:hy4-preview` 发它唯一声明的 `high`）。**两个判定并未合并成一个**：`is_reasoning_model()` 仍是「模型会不会推理」，`openai_reasoning_for_model()` 仍是「按 OpenAI 契约算不算 OpenAI 推理模型」（多一条 canonical 必须挂 `openai/` 下的护栏），详见 `FIX-yi-reasoning-effort-honesty.md` §8
  - **C2** 思考档位写死在 `thinking_effort_values()`，与模型实际支持**逐行不符**（网关 `cn:hy4-preview` 只有 `high` 一档、`cn:space-bunny` 有 `low/medium/high/xhigh/max`）；`ThinkingEffort`(off/low/medium/high/max) 与网关词表(low/medium/high/**xhigh**/**max**) 不是一套，`max`↔`xhigh` 需双向映射。**现状（乙对齐了闸门，丙补上了档位本身）**：`thinking_effort_values()` 的写死集合**只在端点没有声明时**才用；**端点声明了什么就显示什么**（B2），出站也用**端点自己的词**（B3，`max ↔ xhigh` 双向）。假端点与真实二进制端到端实测：`cn:hy4-preview` 菜单只有 `high` 一档且出站就是 `high`；`cn:space-bunny` 选 `max` 时端点收到 `max`。⚠️ **D7 判据已按要求重写**（「菜单 ⊆ 端点声明」＋「可调模型必须把档位送上线」，不再用档位数做判据，见丙交付 §7.4）
  - **C3** 无视觉。网关实测**已上报** `supports_images: true`，Cortex 不读；`custom_wb2api.json` 9 个模型均未手写 `supports_vision`（对照：`custom_siliconflow.json` 的 `zai-org/GLM-5.3-Flash` 手写了 `true`，workaround 生效中）。**现状（丙已完成）**：B2 消费 `supports_images`，**G1 对完全不声明能力的端点走乐观发送＋被拒后落盘**——不需要任何端点配合，也不依赖用户手写 `supports_vision`
  - **C4** 视觉三态开关的「自动」**永久清不掉已设值**（已用 `cortex acp` JSON-RPC 复现：设 true 落盘 True → 提交空 capabilities → 仍是 True）。根因：**wire 格式无法表达「显式重置为自动」**——UI 删 key（`CustomProviderForm.tsx:887`）与「没碰过」同构，后端 `providers.rs:406-411` 与 `declarative_providers.rs:310` 两层 `.or()` 把两者当同一回事。唯一覆盖该路径的集成测试 `acp_custom_provider_methods_test.rs` **完全没测 `model_capabilities`**，故一路漏到真机。**现状（甲已修协议层，丙补了 UI 层）**：甲把「显式 null」贯通到落盘；**丙的 G3 发现并修掉了另一个独立的 UI 层 bug**——`useEffect([initialData])` 依赖对象身份，宿主任何一次 re-render 都把用户刚点的开关抹掉，那才是「点了没反应」的真正落点（详见 `FIX-bing-capability-wiring.md` §5）
  - **C5** `"api_key_env": null` 让**整个**注册表清空。字段是 `String` + `#[serde(default)]`，`default` 只管缺失不接显式 `null`；`load_custom_providers` 又 `.collect::<Result<Vec<_>>>()` 单文件失败即全灭。**正确写法是 `""`**。附带：切换 provider 报 `Internal error` **不是配置错**，根因是 `systemctl --user set-environment` 只对 user manager 拉起的进程生效，GUI 进程读不到（实测 `environment.d` 有、`show-environment` 有、**`/proc/<pid>/environ` 无**），可行解只有注销重登
  - **修复顺序**：先 **A 组诚实化**（A1 正则纳入 `:`／A2 出站闸门与菜单判定对齐／A3 三态可逆，需动 ACP schema 故要重跑 `generate-acp-schema` ＋ `ui/acp-client`／A4 补集成测试），再 **B 组接线**（B1 `ModelInfo.reasoning` 进 `ModelConfig`，⚠️ 影响所有 `engine: openai` 自定义供应商需先设计降级路径／B2 消费 `/v1/models` 元数据，**正解**且同时覆盖 C1C2C3／B3 档位词表映射）。**C 组（C5）独立并行，不要和 A/B 混在一个改动里**——A/B 改的是出站请求行为，出问题很难二分定位
  - ⚠️ **勘误**：vision 那份的方案 B（`custom_` 前缀剥除）**已于 2026-10-15 落地**（`name_builder.rs:95-104`，见 §0.3 ③①），故 C1 **不是它的复现**——真正原因是目录里没有该网关的 provider 键，属覆盖缺口而非逻辑缺陷
- **OpenAI 兼容端点 developer 角色 400（2026-10-16）**：已按 `BUG-REPORT-developer-role-rejected.md` 方案 A 修复，Chat 系统角色恒为 `system`，推理判定与 `reasoning_effort` 映射保持不变；新增 canonical 推理模型保留 effort、显式非推理模型省略 effort 两条回归测试（均覆盖流式/非流式）。provider shim 保留、前端零改动。**自动验收与本地严格假端点端到端 A/B 验收全绿，deb 已打好**（细节见 §4.11）；真实端点仍待用户安装后验收。
- **本轮 7 项优化已实现并验证**（2026-10-15，见 §0.3）；**会话真删除亦已通过窗口实测**——用户手工操作开发态窗口（隔离目录 `~/goose-dev-runs/20261011-223747-composer`，日志 `/tmp/opencode/gui-test.log`）：删除按钮→确认弹窗→确认后会话从侧边栏（最近＋工作目录分组）消失，刷新后不回来，wire 与后端硬删均正常。原「图形化配置」需求已取消；`~/.config/cortex/config.yaml` 的 `active_provider=custom_lite-gpt` 是用户主动添加，非残留，勿追查。
- **侧边栏会话真删除已完成（2026-10-15）**：原方案假设要新加 `_goose/unstable/session/delete`，**实际后端早已具备**——标准 ACP `session/delete` 在 `dispatch.rs:407` 注册，`manage_sessions.rs:88` 的 `on_delete_session` 先 `cancel_agent_run`＋停 live voice，再 `SessionManager::delete_session`（单事务硬删 messages/usage_ledger/sessions），最后清内存 `sessions` 与 agent_manager；全页会话页 `SessionListView.tsx:549` 也早有删除。故**本轮零 Rust、零 schema、零新 i18n 键**（复用 `sessions.delete.title/message`、`sessions.action.delete`、`sessions.toast.deleted/deleteFailed`，16 语言早已齐全，messages 仍 1676），原以为省掉重编，实际仍跑了一次 17m52s（见 §4）。只改两处：`useNavigationSessions.ts` 加 `handleDeleteSession`（乐观移除最近＋归档两表 → 成功后派发 `SESSION_DELETED`、取消权限/elicitation 请求、删快照、正在查看该会话则回首页、`finally` 必重取以纠正乐观值），并给 `SESSION_DELETED` 监听器补上归档列表过滤（原先只清最近列表）；`NavigationPanel.tsx` 把单 `rowAction` 扩成按钮组（最近＝归档＋删除，归档＝恢复＋删除，删除为红色 `Trash2`）＋`ConfirmationModal`（destructive，成功/失败各一条 toast）。**已归档会话可直接物理清除**。验证见 §4。
- **Token 消耗优化第一批（2026-10-15）**：范围＝纯减实际输入/输出 token；缓存参数/命中、DeepSeek 原生 hit/miss 统计、GPT-6 断点、工具对摘要等**明确不在本轮**。①模型可见工具输出普查（证据与排除项见 audit §4.6）：shell/analyze/summarize/tom/chatrecall 均已有上限，**唯一无上限的 `tree` 加 50KB 行边界截断＋独立提示块**；两条排除项已核实——shell 的 `structured_content` 不进模型上下文、桌面端无 ACP fs 能力故无 `read` 工具（读文件走 shell）。②`compaction.md` 由「花光长度预算、尽量多引用」改为「最短可续接摘要、详细度随复杂度」，保留「错误逐字引用」「不遗漏续接所需信息」。定点测试见 §4；真实节省与压缩质量需后续真实会话观察。**重编＋打包＋安装已全闭环（2026-10-16）**：release 重编 12m34s → deb 打包成功 → 已 `apt install` 覆盖安装，本批随之内嵌进 `/usr/lib/cortex/resources/bin/cortex`（sha256 `b0e98302…` 与构建产物逐字节一致），**正式安装版即含本批优化**。
- **联网工具链已就位（2026-10-15）**：用户已开 **TUN 透明代理**（`env -i curl` 仍 200，故 agent 侧同样生效；注意终端 `export` 的代理变量 Cortex 读不到，见 audit §4.4）。已装四样：`uv 0.13.1`（`~/.local/bin`，内置 web-search 技能的前提）、`~/.agents/skills/web-search/`（探测+30 分钟缓存，proxy 走 DuckDuckGo／direct 走 cn.bing.com，GitHub 一律走 `api.github.com`；**同名顶掉内置那个半死版本**）、`github-mcp-server` 官方 v2.0.2（SHA256 已校验，`~/.local/bin`，配 `--read-only --toolsets=repos,issues,pull_requests,code_quality` 共 23 工具）、`context7`（实测 `resolve-library-id` 调通）。均在 `~/.config/cortex/config.yaml`，备份 `config.yaml.bak-20261015`。**GitHub token 仍待用户自行存入钥匙串**（GUI 扩展页 env key，我不碰凭据）；**npm 上同名 `github-mcp-server` 是冒牌货，勿用**。
- **技能与扩展现状（2026-10-15）**：Cortex 现共 **3 个技能**。项目级 `.agents/skills/` 下有本轮定制的 `session-task-scheduling`（**子会话拆分决策**）与 `context-compression-fast-workflow`（**工作流纪律**）；`web-search` 在全局 `~/.agents/skills/`（顶掉内置半死版本）。**定制只落项目级副本，全局目录一字未动**（`cmp` 与 `~/下载/` 原件逐字节一致），故 OpenCode 不受影响。扩展启用 **11/18**（本轮开 `summarize`；新装 `context7`+`github`）。详见 audit §4.5。
- **技能页描述本地化＋组头 `+`（2026-10-16，纯 UI）**：技能**名称保持原样**（`name` 是 agent 匹配标识与安装依据），描述改走 i18n——新增 `components/skills/skillDescriptions.ts`，照 `extensionDescriptions.ts` 的既有范式，匹配键「去非字母数字＋小写」，**只登记这 3 个技能**，其余回落 SKILL.md 原文；搜索框仍按原文匹配，故英文原文搜得到、只有显示本地化。侧边栏「新建会话」整行按钮删除，改为**工作目录组头右侧的 `+` 图标**（`aria-label` 复用既有键，i18n 零新增），组头改为 `div` 包折叠＋`+` 两个**兄弟** button（嵌套 button 非法且会冒泡误折叠）。i18n **1679 messages**（3 键×16 语言，人工翻译）。验证见 §4。
- **启动加载页（2026-10-16，纯 UI）**：`suspense-loader.tsx` 与 `components/startup/StartupSplash.tsx` 改为 CortexMark 大图标（`h-48 w-48`，上移 `-translate-y-16`）＋底部**唯一一套**三阶段真实进度；删除 wordmark、tagline、spinner 和重复状态条。`hooks/useStartupProgress.ts` 并行等待真实 ACP 配置、最近会话、默认 provider 模型目录请求，完成状态驱动节点；i18n 最终 **1683 messages**（新增 6 键×16 语言，删除不再使用的 tagline/status 键）。主题随现有 token，typecheck 与 `i18n:check` 通过；窗口 HMR/截图确认布局。
- 源码已迁至 **`/home/rarestcsc/Cortex`**；分支 `composer-ui-refactor`，HEAD `3bd8520`，**至今无重构提交、不提交/上传**。保留全部改动；不 reset/覆盖/不建副本-worktree。
- 旧目录 `/home/rarestcsc/Goose_test/goose` **只删构建产物**（2026-10-15：`target` 11G＋`ui/node_modules` 1.9G＋`desktop/out` 768M＋`desktop/.vite`＋`src/bin/cortex` 二进制，实测回收 **11.9G**），源码与 `.git` 保留（651M）作回退；171 项改动逐项按重命名映射在新仓库均有对应文件，`git fsck` 干净。**无需整体删除**。
- 后端 `crates/**`、构建、打包、安装均已授权；但 **sudo 动作交用户执行**，我只提供脚本与命令。不读取/打印凭据内容，不发送任务。
- 真实 `~/.config/goose/` mtime/ctime 必须保持 **`2026-10-09 17:56:19.234001826 +0800`**；变化立即停止报告，不得改回。

- **✅ OpenCode 免费模型的思考强度与视觉（2026-10-17 第四轮收尾，用户要求）**
  - **思考强度已修**：`~/.config/cortex/custom_providers/custom_cortex-free-opencode.json` 三个模型由
    `"reasoning": false` 改为 **`"reasoning": true`**（**只动这 3 行**，`supports_vision` 与其它 22 个键一律未碰）。
    原来的 `false` 因 `ModelInfo.reasoning` 是**非 Option bool** 而等于「什么都没说」，
    模型名又不含任何启发式 ⇒ 菜单只有 `[Off]`、出站无字段
  - **配套的前置修复**：丙留下的兜底三元组会让选 **Off** 发 `"low"`、选 **Max** 发 `"high"`，
    所以**必须先删三元组再写声明**。已删（`formats/openai.rs` 的 `accepts()` 第三分支改为「只认本档自己的词」）
  - **端到端验证**（隔离配置根 + 严格假端点 `127.0.0.1:7911`，**未碰 7863/8787、未发真实模型请求**）：
    假端点做成 free-lane 形状（`/v1/models` 零能力元数据）并对词表外取值 / 任何 `image_url` 回 400。
    真实二进制实测：选 `medium` 发 `"medium"`、选 **`max` 发 `"max"`**（不是 `high`）、选 **`off` 完全不发该字段**（不是 `low`）
  - **路线 ①（`catalog_provider_id` 参与 canonical 查找）本轮走不通**：模型名 `oc-space-bunny-free` 与目录的
    `space-bunny-free` 对不上，而 `name_builder.rs:285` 的 `strip_common_prefixes` 里没有 `oc-`
    ⇒ 改代码也接不通这个案例，且那是设计改动（乙的文件、本轮未授权）。要根治需另立项
  - **视觉不需要代码改动**：`providers/openai.rs:594` `vision_support()` 结尾 `.known.or(Some(true))` 已开乐观发送，
    `:936` `build_chat_payload` 显式把它传进格式化选项（不会退化成 `unwrap_or_default()`），前端也不按视觉能力禁用附件。
    **刻意不写 `supports_vision`** —— 那会把未经真机确认的声明变成权威值并**关掉 G1 自愈**
  - **回滚**：单文件改动前快照在
    `/tmp/opencode/cortex-config-backup-20261017-145438/pre-reasoning-20261017-152620/custom_cortex-free-opencode.json`；
    整目录回滚用同目录 `restore.sh --apply`
- **⏸ 待办：死 Tailwind 类全仓库普查（2026-10-17 第四轮审计发现，用户报障触发）**
  - **报告：`docs/BUG-REPORT-dead-tailwind-classes.md`；清单快照：`docs/dead-classes-snapshot-2026-10-17.txt`；可复跑脚本：`ui/desktop/scripts/scan-dead-classes.py`**
  - **根因**：`main.css` 的 `@theme inline` 只注册 `background-*` / `text-*` / `border-*` / `ring-*` 四族，
    而多处代码用的是**另一套 camelCase 命名**（`surfaceHover` / `textStandard` / `textSubtle` / `iconSubtle` /
    `borderSubtle` / `borderStandard` / `muted` / `default`）。**Tailwind v4 不为未注册 token 生成任何 CSS**
    ⇒ 类名写在 DOM 上、没有任何规则命中 ⇒ **默默用浏览器默认样式渲染**。**构建、typecheck、单测全都通过，没有任何报错**
  - **规模**：`ui/desktop/src` 520 个源文件里 **511 处 / 119 种 / 71 个文件**确认是死类。
    最大几项：`text-text-muted`(66/20 文件)、`border-border-subtle`(38/12)、`text-text-default`(31/10)、`text-textSubtle`(26/9)
  - **已修 1 个**：`CustomProviderForm.tsx`（用户报障的视觉三态开关，15 处），该文件现在零死类
  - **两条修法待选**：**A** 在 `main.css` 里把缺失 token 注册为四族别名（一次修好 511 处，不碰 71 个业务文件；
    阻力是 `theme-tokens.ts` 的 `Record<McpUiStyleVariableKey, string>` 类型不接受非 SDK 的 key）；
    **B** 把死类机械替换成已注册 token（不碰主题，顺手收敛命名；71 文件需分批 + 截图对比）。**建议先 A 后 B，或只做 A**
  - **验收**：脚本报 0 处 + 人工过一遍 onboarding 与设置页截图（这类问题单测发现不了）+ **建议把脚本接进 CI 当守卫**，
    否则必然复发——本 bug 的成因就是「写错了不报错」

## 0.2 重构后运行验证与两处修复（2026-10-15）

重构后的 Cortex **已实测可跑通**，并修好两个此前遗留的问题。证据见 audit.md §4.2。

- **code_execution 修复**：根因**不是** v145.0.0 不存在，而是 gh-proxy 对大型静态库 `.a.gz` 返回 **HTTP 403**；GitHub 直连实测 **200 / 2.5MB/s**。改 `RUSTY_V8_MIRROR` 直连即可，**不需要降级版本**。启用后实测走通 `List Functions` → `executing code` → 返回结果。
- **图标修复**：两个叠加问题——`main.ts:1248` 无条件用 macOS 的 `.icns`（Linux 不认，且开发态 `__dirname` 指向 `.vite/build` 该路径不存在）；且 `main.ts:74` 的 `app.setDesktopName('cortex-dev.desktop')` 指向**从未创建**的文件，GNOME 找不到 → 回退默认占位图。已改按平台选图标＋多路径回退，并新建 `~/.local/share/applications/cortex-dev.desktop`（`StartupWMClass=CortexDev` 与窗口 `WM_CLASS` 第二段对齐、`Icon=` 绝对路径）。dock 实测显示正确图标。
- **feature 裁剪陷阱**：`serve` 子命令被 `#[cfg(feature="acp-http")]` 门控，裁 feature 时漏掉它会让 GUI **静默失败**（`unrecognized subcommand 'serve'`）。`--no-default-features` 下必须完整列出全部 feature。
- **实测耗时**：UI 逻辑改动热更新即时；i18n JSON 改动 `i18n:compile` **6.8 秒**；typecheck 37 秒；**改 Rust 一个词也要 12m39s**（级联 `cortex`→`cortex-mcp`→`cortex-cli`＋链接 290MB 二进制）。故 Rust 改动要批量做。
- **顺带修正**：`platform_extensions/mod.rs:56,159` 两处用户可见 goose 文案已改 Cortex（已重编译生效）。
- **仍未做**：重构版已于 **2026-10-16 01:40 安装**（apt history 记为 `Upgrade: cortex:amd64 (1.54.0, 1.54.0)` 同版本重装），`/usr/lib/cortex` 已是本轮重构后构建，**且已实机启动跑过真实会话**（§4 ⑧）；**§0.2 遗留的打包、安装、实机验证缺口全部清零**；旧目录 `/home/rarestcsc/Goose_test/goose` 的构建产物已清、源码留作回退（见 §0），如需彻底清理可再删那 651M。`BUG-REPORT-custom-provider-vision.md`（12K）**已搬入本仓库 `docs/`**，勿重复搬。

## 0.3 本轮优化（2026-10-15 已完成）

七项用户需求全部落地。证据见 audit.md §4.3。

1. **关于页**：设置新增第 9 个标签「关于」。版本号＋作者 rarestcsc，另有运行环境（Electron/Chromium/Node/平台）、数据与配置目录（可复制）、独立构建/兼容性/许可证三段说明。数据来源为新增 IPC `get-app-info`（`main.ts`，preload `getAppInfo()`）。组件 `settings/about/AboutSection.tsx`。
2. **添加自定义供应商显示不全**：根因是 `ComposerProviderManager` 传 `isEditable={custom.isEditable}`，新建时为 `undefined`，而表单所有字段都挂在 `isEditable` 上 → 只剩「认证＋按钮」，正是截图现象。改为 `custom.isEditable ?? true`。附带修 `ComposerModelPopover.tsx:435`：切到管理供应商时把弹层高度**冻结成模型列表当前高度**，改为取 `placement.maxHeight`，否则表单挤在 320px 里。
3. **视觉识别**：三处。①`name_builder.rs` 直查失败后剥 `custom_` 前缀重查（并再过一遍 `map_provider_name`），`custom_siliconflow`＋`zai-org/GLM-5.3-Flash` 命中目录 → vision/context/reasoning/cost 一并回填；②剥图占位文案改为如实的「image input is turned off for this model」（openai/openai_responses/databricks 三处格式同步改文案＋断言）；③表单新增**逐模型「图片输入 自动/开启/关闭」**三态开关，走新 DTO `modelCapabilities`（`CustomModelCapabilityDto.supportsVision`），落到 `ModelInfo.supports_vision`，用户优先级高于目录判定。
4. **托盘**：改用彩色 `icon-tray(@2x).png`（原 `iconTemplate.png` 是 macOS 模板图，面板按前景色重绘，深/浅主题都可能不可见），加 tooltip、Linux 下点击唤出窗口。**但本机 GNOME 46 仍不显示**——见 audit.md §4.3 的 DBus 证据，属 Electron↔libayatana 属性读取失败，非 Cortex 逻辑问题。
5. **侧边栏按工作目录分组**：取消「>1 组才分组」的门槛，永远分组（无 cwd 归「无工作目录」）；顶部「添加工作目录」；每组末尾「+ 新建会话」（带 `?workingDir=` 跳转，Hub 消费后即删参数，不预建空会话）；底部「已归档」折叠区；组内子项（会话行＋「+ 新建会话」）整体 16px 缩进（`pl-4`）对齐组头文字，呈工作目录→子文件层级（2026-10-15 补）。
6. **真归档**：会话行悬停出归档按钮，走已存在但从未接线的 `_goose/unstable/session/archive|unarchive`；已归档会话从最近列表剔除并在底部列出，可恢复。归档列表无专用接口，靠分页扫 `session/list` 取 `archivedAt`（上限 200 条扫描 / 20 条展示）。
7. **会话命名提炼**：`session_name.md` 改为「一到三个词」的标签式命名（砍掉长例句、禁止 workflow 词与标点），代码侧截断 100→40 字符（`session_naming.rs` `MAX_SESSION_NAME_CHARS`）。
8. **扩展描述本地化**：名称保持英文（用户要粘进 config.yaml 的标识符），描述走 i18n。新增 `extensionDescriptions.ts` 覆盖 17 个扩展，键按「去分隔符小写」匹配（`code_execution`→`codeexecution`、`Extension Manager`→`extensionmanager`）；`Built-in extension`/`HTTP extension` 等兜底文案一并 i18n。i18n **1676 messages**（+50），16 语言全量补齐。

**副作用/代价**：i18n 键 +50（15 个语言 × 50 条人工翻译）；新增 Rust DTO 字段 → 须重跑 `generate-acp-schema` 与 `ui/acp-client` 生成（已做）。

## 0.1 命名重构（2026-10-15 已完成）

项目目录、crate 名、UI 包名已从 goose 彻底改为 cortex。源码证据见 audit.md §4.1。

- **路径**：源码 `/home/rarestcsc/Cortex`（14G→2.2G，删 `target`/`node_modules`/文档站）。搬迁用 `rsync -a` 排除 `target/ node_modules/ .vite/ out/`；HEAD、分支、171 项既有改动逐项一致。依赖已重装（`ui` 下 `pnpm install`）。
- **crates**：15 个 `goose*`→`cortex*`（`goose`→`cortex`、`goose-cli`→`cortex-cli`…）。`goose::`→`cortex::` 593 处、`goose_xxx::`→`cortex_xxx::` 776 处，共 276 文件。只匹配路径形态（带 `::`），wire 字段 `goose_extensions` 等未误伤。
- **协议 DTO 保留 `Goose*`**：`GooseExtension` 等由 ACP schema 生成、改名即改 wire 契约；`goose_mode`/`goose_model` 等配置键同理保留。**`GOOSE_*` 环境变量全部不改**（对外 API，约 900 处）。
- **UI**：`@aaif/goose-acp-client`→`@cortex/acp-client`（`ui/acp-client`）。删 `ui/goose-acp`、`ui/goose-binary/*`、`ui/scripts`。本地符号改名：`GooseLogo`→`CortexIcon`、`LoadingGoose`→`LoadingIndicator`、`GooseMessage`→`CortexMessage`、`GooseSidebar`→`CortexSidebar`、`gooseServe`→`cortexServe`、`gooseAcpClient`→`acpClient` 等。i18n 432 键改名，**1626 messages 不变**。
- **删除上游资产**：`documentation/`(312M)、`.github/`、`oidc-proxy/`、`services/`、`evals/`、`buzz/`、`examples/`、`workflow_recipes/`、`bin/`(hermit)、Docker/flake/devcontainer、RELEASE/CONTRIBUTING/GOVERNANCE 等、`ui/text/`、release-plz。保留 `LICENSE`、`vendor/v8`、`.goosehints`(重写为 Cortex 版)。
- **新建/重写**：`Justfile`（精简 20 目标，删跨平台/发布/benchmark）、`README.md`、`AGENTS.md`、`BUILDING_LINUX.md`。
- **新增修正**：`memory` MCP 的 `.goose/memory`→`.cortex/memory`（**运行时行为变更**）；6 处外发 User-Agent 改 `cortex/<version>`。`.goose/agents` 保留（跨工具发现路径）。
- **易漏点**：`pub use`/`pub use {裸模块名}` 里的 crate 名不带 `::`，`include_str!` 路径里的目录名也不会被标识符规则捕获——编译器才会暴露（本次 4 处）。

## 1. 已实现功能（勿重做）

**会话与强度**：会话级 full-set config store（区分字段缺失与 `[]`，保留 mode/未知项）；confirmed/pending/error 按 sessionId 隔离，操作 ID 防重复写、期间缓冲推送、失败用服务端快照；独立强度只写 `thinking_effort`，映射后端实际档位（含分组/custom），不固定四档、不加重置；档位点刻意弱化（4px、未填充 `text-secondary` 0.28、已填充白 0.4）；拖动仅预览、松手提交，Esc/外部点击/配置变化丢弃预览，回填只认服务端。首页默认 provider/model 到达即建真实空会话，共享 Promise 防重复。

**模型/供应商面板**：模型按钮直开单层面板（搜索置顶、按供应商分组、自定义模型 ID、同层管理）；只列 `is_configured` 且（Custom／当前 provider／显式 enabled+configured）。管理列表 Custom 全在前，随后仅 `openai/anthropic/google/openrouter/ollama/deepseek`；Settings 完整列表不删。框宽统一 320 CSS px（视口夹取）、内部滚动。中文返回已修（避让 titlebar bottom+8px）。

**首页/底栏/侧栏**：品牌 SVG＋分时问候（每分钟更新）；Composer 已删诊断/Live voice/dictation/扩展按钮；次要控件按 **`<480px`** 收起（勿提到 640px）；侧栏隐藏「配方」「调度」，路由保留。**不做最近模型 UI**，Composer 禁用 `recentModels`/`acpReadThinkingEffort`/`fetchModelReasoning`/`addToRecentModels`。i18n 为 16 JSON、1626 messages。

**品牌组件**：`components/CortexLogo.tsx`（字标，字色随主题）、`components/CortexIcon.tsx`（图标框，原 `GooseLogo`）、`components/icons/CortexMark.tsx`（纯字形，`useId` 隔离渐变 id）；`LoadingIndicator`（原 `LoadingGoose`）、`CortexMessage`、`CortexSidebar` 已替换 `BaseChat` 水印/`OnboardingGuard`；原生菜单、通知、错误框已改 Cortex；页面标题 Cortex。

**独立身份与断联（已完成）**
- 身份：主/子代理、小模型、语音、回合上下文与 fallback 自称 Cortex；ACP `agent_info.name=cortex`、默认标签 `Cortex (Default)`；package `cortex-app`、Forge 可执行文件与权限提示 Cortex。哨兵 provider ID 与 meta key `goose` 属兼容标识，保留。
- 数据隔离：后端 `Paths` 用 `cortex`（`~/.config/cortex`、`~/.local/share/cortex`）、钥匙串服务名 `cortex`、系统配置 `/etc/cortex`；拒绝导入上游 Goose 配置（保留 Claude Desktop 导入）。Electron 层为 `~/.config/Cortex`（首字母大写，勿混）。
- 密钥：走系统钥匙串 `Entry::new("cortex","secrets")`（`config/base.rs:32,34,1218`），落盘 `~/.local/share/keyrings/login.keyring`；`secrets.yaml` 不存在（仅 `.lock`）＝未降级。钥匙串不可用时按 `base.rs:1207-1214` 的错误特征降级为明文 `secrets.yaml`。
- 上游连接清除：PostHog 端点/密钥删除、遥测判定恒 false、consent 弹窗与设置项下线；`UPDATES_ENABLED`/`TELEMETRY_UI_ENABLED` 为 false，更新 owner/repo 为空且 `checkForUpdates` 早退、Forge publishers 清空、`app-update.yml` 不打包、CLI 自更新恒拒绝；OAuth CIMD 与 Hugging Face client id 改 `CORTEX_*`（未配置时要求用 API token）；`goose_doc_guide` 技能过滤；帮助/文档/扩展库/配方/诊断上游链接移除或改本地导出；字体改系统栈。深链改 `cortex://`。新增 `utils/upstreamIsolation.ts` 在 `webRequest` 与 `openExternalUrl` 双层拦截上游端点，CSP 移除 GitHub 源。**用户选择的模型供应商与 MCP 服务仍可正常联网。** 保留 `../../LICENSE` 与 Apache/MIT 归属。

**图标（最终修法，已装版验证）**：直接采用用户原始素材 `~/下载/Cortex-main/icon/Cortex-icon-macOS.png`（内缩 100px、rx=186、投影、顶部高光边），`cmp` 与原文件逐字节一致；`icon.svg` 直接复制原文件；512/2048/ico/icns 由原 SVG 经 Chrome 渲染＋Lanczos 缩放，icns 含 ic07–ic14 PNG **与 ic04/ic05 legacy ARGB**；iconTemplate* 取原 `Cortex-glyph.svg` 生成 22/44。**教训**：electron-installer 只装 `/usr/share/pixmaps`、不注册 hicolor，desktop entry 写 `Icon=cortex` 会被 GNOME 解析为 `ThemedIcon` 并回退成默认占位图；必须用绝对路径。备份 `/tmp/opencode/cortex-icon-backup-round2/`，脚本 `/tmp/opencode/cortex-icon-from-original/build.sh`。

## 2. 代码定位与不能承诺的事

路径相对 `ui/desktop/src/`；先读目标源码/测试，引用后端事实再读 audit。

| 责任 | 主要文件 |
|---|---|
| 配置数据流 | `acp/{configOptions,configOptionsStore,providers,sessions,chatNotifications,chatSessionController,chatSessionStore}.ts`；`hooks/useConfigOptions.ts` |
| 模型/强度 UI | `components/settings/models/bottom_bar/{ModelsBottomBar,ComposerModelPopover,ThinkingEffortControl}.tsx`；`hooks/useComposerModelCatalog.ts` |
| 管理与 Settings 兼容 | `components/settings/providers/{ComposerProviderManager,modal/ProviderConfigurationModal,modal/subcomponents/forms/CustomProviderForm}.tsx`；`components/settings/models/subcomponents/SwitchModelModal.tsx` |
| 首页/底栏/导航 | `components/{Hub,WelcomeGreeting,ChatInput,BaseChat,ModelAndProviderContext}.tsx`；`components/Layout/NavigationPanel.tsx`；`main.ts` |
| 品牌与图标 | `components/{CortexLogo,CortexIcon}.tsx`、`components/icons/CortexMark.tsx`、`assets/cortex-brand.svg`；`images/` 下 icon 与 iconTemplate 系列 |

**不能承诺**：真实 HTTP reasoning/wire、真实凭据 provider/任务、macOS Dock 与跨平台原生窗口、频繁新对话累积空会话及目录/扩展初始化的副作用。完整断线/超时 uncertain 恢复、连接 generation、默认哨兵实际 provider 回读、跨窗口一致性、未保存管理表单放弃确认等，**不能因类型检查或 happy-path 测试宣称闭合**；需此类任务时定点审源码与用例，不自动扩张。

## 3. 环境、运行与打包

- Node v24.21.0、pnpm 12.11.2、UI 依赖已装；Rust 1.99.0 在 `~/.cargo`。不要重装、不要 apt cargo 1.75、不要 source hermit。
- **验证工具直接用 `ui/node_modules` 下的 Node 可执行入口**（如 `node ui/node_modules/typescript/bin/tsc --noEmit`）。`pnpm run typecheck` 曾触发自动依赖同步/postinstall 并清理 `.vite`，避开它。
- **已安装的 Cortex（正式入口，2026-10-16 01:40 重装为重构版）**：程序 `/usr/lib/cortex`，入口 `/usr/bin/cortex`→`../lib/cortex/Cortex`，后端 `/usr/lib/cortex/resources/bin/cortex`，桌面项 `/usr/share/applications/cortex.desktop`，图标 `/usr/share/pixmaps/cortex.png`，深链 `cortex://`；Electron 43.4.0。**实测**（gjs/Gio）：`cortex.desktop` 图标解析为绝对路径即 `FileIcon`、`startup_wm_class` 为 `None`（与 audit §4.1 记录的安装版行为一致）；hicolor 未注册，符合 electron-installer 只装 pixmaps 的已知行为。重装＝
  `sudo apt install /home/rarestcsc/Cortex/ui/desktop/out/make/deb/x64/cortex_1.54.0_amd64.deb`（**sudo 由用户执行**）。同名同版本 1.54.0 直接覆盖、**不必先卸载**：实测两侧文件清单规范化后旧包独有的只有目录项（不产生孤儿文件），新包只多 `icon-tray.png`／`icon-tray@2x.png`，且新 deb **无 maintainer 脚本**（control 仅 `control`）。**必须用绝对路径或先 `cd` 到仓库根**——在 `~` 下用相对路径会报 `E: 命令行中有不支持的文件`，那是路径不存在、不是包有问题。旧的 `/tmp/opencode/cortex-install.sh` 已不存在，勿再引用。上游 Goose 1.54.0 仍在 `/usr/bin/goose`，两者并存、数据与深链互不干扰。
- **GUI 全部关闭**，无残留进程，9333/9444/9445 空闲。
- **打包（已授权）**：后端须先**原子替换** `ui/desktop/src/bin/cortex`（`cp -p` 到 `.staging` 再 `mv`；**勿用 `just copy-binary`**，它硬编码相对路径 `target/release/`，而仓库无 `target/`），再在 `ui/desktop` 下跑
  `ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/ node ../node_modules/@electron-forge/cli/dist/electron-forge.js make --platform=linux --arch=x64 [--targets=@electron-forge/maker-deb]`。`ELECTRON_MIRROR` **必设**，否则卡死在 `SHASUMS256.txt`（根因见 audit §4.4）；`--targets` 只出 deb、跳过缺 `rpmbuild`／`flatpak-builder` 的 rpm 与 flatpak。`build-acp-client` 在 `crates/cortex/acp-schema.json` 比 `ui/acp-client/dist` 旧时可跳过；i18n 用 `node scripts/i18n-compile.js` 直调以避开 pnpm 依赖同步。**不要加 `packagerConfig.ignore`**（会覆盖 Vite 插件默认忽略导致依赖解析失败）；`extraResource` 须用相对路径。产物在 `out/make/deb/x64/`。
- Rust 构建用独立 target，不覆盖仓库原二进制。**两条 GitHub 路径要分清**：v8 静态库下载走 `RUSTY_V8_MIRROR`（默认直连）；cargo 拉 git 依赖走下面的 `insteadOf` 转发 gh-proxy，**不直连重试**。

```bash
export PATH="$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR=/tmp/opencode/cortex-rust-target
export CARGO_NET_GIT_FETCH_WITH_CLI=true
export RUSTY_V8_MIRROR="https://github.com/denoland/rusty_v8/releases/download"  # 默认直连；直连不通时**先问用户**是否开了代理，见上
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0='url.https://gh-proxy.com/https://github.com/.insteadOf'
export GIT_CONFIG_VALUE_0='https://github.com/'
cargo build --release -p cortex-cli --bin cortex   # 或 just release-binary（顺带 stage）
# 产物固定为 /tmp/opencode/cortex-rust-target/release/cortex；仓库内**没有** target/，勿把它当后端路径。实测 2026-10-15 重编 **17m52s**（指纹不符，连带重编 v8/deno/core/cortex/cortex-cli）
# 测试另设：GOOSE_PATH_ROOT=/tmp/opencode/cortex-rust-test-config GOOSE_DISABLE_KEYRING=1
```

- **code-mode 可构建**：须把 `RUSTY_V8_MIRROR` 指向能用的源。**默认用 GitHub 直连**；2026-10-15 一次直连 `Failed to connect to github.com port 443`，**原因是用户当时开了代理**（不是网络结论），当次改用 gh-proxy 也能跑（`.rs`/`.a.gz` 均 200）。**规则：直连失败时先问用户代理开关，不要自行判定镜像可用性。**
- `-p cortex` 的测试/clippy 必须显式用 `--features acp-http,scheduler,rustls-tls,system-keyring`；scheduler 相关测试必须开该 feature，否则 `crate::scheduler::Scheduler` 未导出会连带 20+ 编译错。格式层现位于 `cortex-provider-types`，定点单测用 `cargo test -p cortex-provider-types --lib formats::openai::`。
- 开发态 GUI 只用原 lite-gpt 隔离目录，不换目录/重配；**必须先 export 再启动**（避免展开为空污染真实目录）：

```bash
cd /home/rarestcsc/Cortex/ui/desktop
export GOOSE_PATH_ROOT="/home/rarestcsc/goose-dev-runs/20261011-223747-composer"
export GOOSE_DISABLE_KEYRING=1
export GOOSE_BINARY="/tmp/opencode/cortex-rust-target/release/cortex"
export ENABLE_PLAYWRIGHT=1
export PLAYWRIGHT_DEBUG_PORT=9333
pnpm run start-gui -- --user-data-dir="$GOOSE_PATH_ROOT/electron-userdata"
```

目标窗口点击可用 `chromium.connectOverCDP('http://127.0.0.1:9333')`（已有 `@playwright/test`），不是全量 E2E。收工检查与停止（精确匹配本克隆，不影响安装版）：

```bash
pkill -f '^/home/rarestcsc/Cortex/ui/node_modules/electron/dist/electron( |$)'
pkill -f '^/tmp/opencode/cortex-rust-target/release/cortex serve( |$)'
pgrep -af '^/home/rarestcsc/Cortex/ui/node_modules/electron/dist/electron( |$)|^/tmp/opencode/cortex-rust-target/release/cortex serve( |$)'
stat -c 'mtime=%y ctime=%z' /home/rarestcsc/.config/goose
```

启动脚本被杀可能留孤儿 backend，必须单独核对。

## 4. 验证与当前结果

改前按影响选定点基线，改后最小充分验证；**不全量跑 E2E/打包**。在 `ui/desktop`：

```bash
node ../node_modules/typescript/bin/tsc --noEmit   # typecheck（勿用 pnpm run typecheck）
# 按改动面选：WelcomeGreeting / Hub / ThinkingEffortControl / ModelsBottomBar
#           ComposerModelPopover / ComposerProviderManager
#           acp/__tests__/{configOptions,configOptionsStore,providers,sessions,chatNotifications}
#           ProviderConfigurationModal / CustomProviderForm（后者加 --testTimeout=15000）
TMPDIR=/tmp/opencode pnpm run i18n:check
```

共享生命周期改动再选 `chatSessionController.test.ts` / `chatSessionStore.test.ts`。过滤至少命中一个用例；失败先重跑失败项。改文案必须 extract 生成 en（不手插键顺序）、同步其余 15 语言、compile、`i18n:check`。`git diff --check` 在仓库根。**测试失败必须回旧仓库跑同一用例确认是否既有**，不能默认归因本次改动。

**当前结果（2026-10-15 重构后）**：`cargo check --workspace --all-targets` **0 错误**（6m21s）；UI typecheck 退出码 0；`i18n:check` 通过、**1626 messages**；`cargo fmt --all` 无差异。Rust 库 **2211 passed / 11 failed**（`--features scheduler,rustls-tls,system-keyring`），11 个失败**已在旧仓库复现同样失败**（toolshim×4、gcpauth 联网、prompt_manager 快照、extension_manager、config::extensions、state_machine×3），属预先存在。`schedule_recipe_parity` 通过（fixture 已迁到 `crates/cortex/tests/fixtures/recipes`）。

**实机验证（开发态，Playwright CDP 9333）**：应用启动＋`cortex serve` 后端拉起、首页/扩展页/会话历史/设置三页/模型面板全部 PASS、真实对话往返、**Code Mode 实跑（`List Functions`→`executing code`→结果）**、dock 图标正确、界面 goose 命中 0、隔离目录仅生成 cortex 命名空间。15 个扩展全部加载（7 默认＋8 可选）。

**不能宣称全功能正常**（未实测）：外部 MCP 服务器实际拉起、developer 文件/Shell 的真实效果、图像/语音/dictation、长时间稳定性与断线恢复、打包安装版。

**重构前基线（仍有效）**：打包应用实机启动验证：自带 `cortex serve`、UA `Cortex/1.54.0`、界面无 goose 字样、只创建 cortex 命名空间目录。deb 元数据 Package/Maint=Cortex，`Icon=/usr/share/pixmaps/cortex.png` 解析为 `FileIcon`。

**未跑**：macOS/Windows 产物、rpm/flatpak（缺 `rpmbuild`／`flatpak-builder`）、`cortex-cli` 与集成测试、wire 抓包。真实配置时间戳全程为基线；未提交/上传。

**本轮验证结果**：①§0.3 七项优化——Rust 定点 `canonical` 37 / `session_naming` 4 / `declarative` 23 / `formats` 373 全绿；UI typecheck 退出码 0；`i18n:check` 通过、**1676 messages**；定点 vitest **302 passed / 41 files**（`settings/providers`、`settings/extensions`、`Layout`、`hooks`、`acp/__tests__`、`sessions`，须带 `--testTimeout=15000`，否则 5 个慢用例按默认 5s 超时假失败——非断言失败）；`cargo fmt` 无差异、`git diff --check` 干净；开发态窗口实测关于页、添加自定义供应商（字段齐全＋图片输入三态）、侧边栏分组/添加工作目录/新建会话、归档与恢复往返、扩展页 15 个描述全中文且名称仍英文。②会话真删除——**改动本身无 Rust**（后端早已具备），但**为消除二进制过期疑虑仍跑了一次 release 重编：17m52s**，cargo 判定旧二进制与源码指纹不符并重编了 v8/deno/core/cortex/cortex-cli，产物 `/tmp/opencode/cortex-rust-target/release/cortex`（2026-10-15 19:55:37）当时无任何 `.rs` 比它新（已被 ⑥ 的 2026-10-16 重编取代）；typecheck 退出码 0；`i18n:check` 通过、**1676 messages**（复用既有键，未新增）；定点 vitest **228 passed / 33 files**（`components/Layout`、`hooks`、`acp/__tests__`、`App.test.tsx`、`__tests__/sessions`），新增 5 例（按钮组、确认前不删、取消不删、归档会话删除、hook 清理与失败上报）；`git diff --check` 干净；**窗口实测已由用户完成并通过**（删除后会话从侧边栏消失、刷新不回来，wire 与后端硬删均正常，见 §0）；③token 消耗优化第一批——`cortex-context-management` **13/13**；`cortex` 库 tree 定点 **5/5**（3 既有＋新增 2 例：大树截断提示、多字节边界）；clippy：`cortex-context-management --all-targets` 通过、`cortex --lib`（acp-http,scheduler,rustls-tls,system-keyring）通过，全量 `--all-targets` 仅败于**既有** `onboarding.rs:3` 未用导入（**2026-10-15 已删除**，见 ④）。④侧边栏子项缩进＋导入清理——UI：`NavigationPanel.tsx:533` 组内子项包 `pl-4`，typecheck 退出码 0、Layout 定点 vitest **5/5**、窗口 HMR 实测层级正确；Rust：删 `onboarding.rs:2-3` 既有 `#[cfg(test)]` 未用导入（非测试代码未用，内层 `mod tests:503` 自带），`cargo fmt` 无差异、`git diff --check` 干净；**clippy 验收 `-p cortex --all-targets`（acp-http,scheduler,rustls-tls,system-keyring）通过**（`CLIPPY_EXIT=0`，6m58s，日志 `/tmp/opencode/clippy-cortex-all-targets.log`）——全量 `-D warnings` 阻塞点已清除。⑤组头 `+` ＋技能描述本地化（2026-10-16）——typecheck 退出码 0；`i18n:extract` 重生成 en 后 `i18n:check` 通过、**1679 messages**（3 新键×16 语言，格式与 formatjs 输出逐字节一致）；定点 vitest **8 passed / 2 files**（`skillDescriptions.test.ts` 新增 3 例：已登记本地化／未登记回落原文／大小写与分隔符无关；`NavigationPanel.test.tsx` 5 例回归）；`git diff --check` 干净；**未开窗口实测**（这轮窗口已关，改动靠 typecheck＋单测＋i18n 三项静态证据）。⑥**release 重编＋deb 打包（2026-10-16）**——重编 `CARGO_EXIT=0`／12m34s，`find crates -name '*.rs' -newer <bin>` 为空，`serve` 在（acp-http 未裁）；打包 `FORGE_EXIT=0`，`cortex_1.54.0_amd64.deb` 163,651,096 B。核验：Maintainer=Cortex、`/usr/bin/cortex`→`../lib/cortex/Cortex`、desktop 图标绝对路径、`resources/bin/cortex` sha256 与构建产物一致且 `--version`=1.54.0、Electron 43.4.0 与 package.json 一致、16 个 locale chunk 各 1683 条；界面 goose 仅 `aboutSection.compatBody`（故意解释 `GOOSE_*` 保留原因）＋`/home/goose/workspace` 占位符＋`.goosehints` 文件名。`out/` 已 ignore，工作区未跟踪清单打包前后逐项一致；`~/.config/goose` 时间戳未动、无残留进程。**教训**：Vite 生产构建 mangle 标识符，grep 压缩后 asar 找组件名不可靠（`StartupSplash` 0 命中），与 audit §4.3 同源。⑦**deb 安装（2026-10-16 01:40，sudo 由用户执行）**——apt history 记为 `Upgrade: cortex:amd64 (1.54.0, 1.54.0)`，即同名同版本重装，**无需卸载**。安装后核验：`dpkg-query` Status=`install ok installed`；`/usr/lib/cortex/resources/bin/cortex` sha256 `b0e98302…` **与构建产物逐字节一致**、`--version`=1.54.0、`serve` 子命令在；托盘图标 `icon-tray.png`／`icon-tray@2x.png` 已就位（重构前那版没有，反向印证装的是新版）；`app.asar` 7,486,154 B；`/usr/bin/cortex`→`../lib/cortex/Cortex`；`cortex.desktop` `Icon=/usr/share/pixmaps/cortex.png`；gjs/Gio 实测图标解析为 `FileIcon`、`startup_wm_class`=`None`；Electron 43.4.0。**实机启动见 ⑧**。**教训**：在 `~` 下用相对路径 `apt install ./ui/...deb` 报 `E: 命令行中有不支持的文件`——那是路径不存在，非包问题，须用绝对路径或先 `cd` 仓库根。⑧**实机启动已由用户完成（2026-10-16）**——文件系统证据链：apt 01:40:25 完成 → `~/.local/share/cortex/model_catalog` 01:40:35（后端启动）→ `sessions.db`/`-shm`/`-wal` 01:40～01:48 持续活动（真实会话在跑）→ `~/.config/cortex/custom_providers` 01:44:22、`config.yaml` 01:45:24。**关键判据**：dev 态走 `GOOSE_PATH_ROOT` 隔离根、**不写真实 `~/.config/cortex`**，故那两笔只能来自正式版。另开发窗口昨晚也跑过（隔离目录 `electron-userdata/DevToolsActivePort` 00:32、`window-state.json` 00:48）。**dock 固定项无需重钉**：旧版被钉住的图标在重装后直接打开新版——dock 项解析的是 desktop id／`/usr/bin/cortex`，重装是同路径原地覆盖，故指向自动跟随。⑨**会话命名修复＋模型折叠（2026-10-16，用户开发窗口实测通过）**——修掉「会话标题永远New Chat」：根因是 `MessageContentBlock::Thinking` 为独立变体而 `as_text()` 只对 `Text` 返回 `Some`，推理模型把答案放进 thinking 块时取名为空串，`system_generated_name` 的 `if !name.is_empty()` 直接跳过写入，**无报错、无通知、UI 停在默认名**。实证链：DB 28 会话 26 个 name="New Chat"、隔离开发态 79 个全部如此、`llm_request` 日志证明命名请求**确实发出**、开发态 WARN 里**没有** `Failed to generate session description`（请求成功＋无报错＋没写入＝空串）。修法＝取名**永不为空**的级联：`text 块 → thinking 块 → 首条用户消息 → warn`，新增 `collect_title_candidates`/`normalize_whitespace` 与 3 例回归。**附带修可诊断性缺陷**：`cortexServe.ts` 原只把匹配 `isFatalError`（`panicked at`/`RUST_BACKTRACE`/`fatal error`）的 stderr 落盘，**所有 `warn!` 全被丢弃**，这正是查不到根因的原因；现按 tracing 级别识别，`Logger` 加**可选** `warn?` 不破坏既有实现。**模型折叠**（`ComposerModelPopover.tsx` 5 处）：组头 `<h3>`→`<button aria-expanded>`＋`ChevronDown` 旋转，状态存 `localStorage`，**搜索时强制全部展开**，默认全展开，**零新增 i18n 键**。另修一个**过期测试**：`ComposerModelPopover.test.tsx` 断言面板高`210px`（旧冻结高度行为），现行设计是 `placement.maxHeight`＝520px —— §0.3 item 2 改了代码没同步断言，而 §4 验证清单恰好**没有 `settings/models`**，故一直没跑到。**调度决策 S0**（不拆子会话：两个单元各 1–3 文件、调查已完成、共享同一次构建验收，拆分成本高于收益）。验证：tsc 0；vitest **21 passed / 2 files**（含新增 3 例折叠测试）；i18n:check 通过 **1683**（零新增键）；prettier/cargo fmt 干净；release 构建 `CARGO_EXIT=0`／36m04s；deb `FORGE_EXIT=0`、`cortex_1.54.0_amd64.deb` 163,570,632 B，内嵌后端 `58a96940…` 与构建产物逐字节一致。**用户已在开发窗口实测两项均通过**。**未执行：Rust 单测**（见 ⑩）。⑪**该 deb 已安装（2026-10-16 14:20）**——`apt history` 记 `Upgrade: cortex:amd64 (1.54.0, 1.54.0)`（同名同版本重装，免卸载）。安装后核验：`dpkg-query` Status=`install ok installed`；`/usr/lib/cortex/resources/bin/cortex` sha256 `58a96940…`（**已由 `b0e98302…` 换成本轮构建**）、`--version`=1.54.0、`serve` 在；`app.asar` @14:10 内含 `composerModel.collapsedProviders` 键（折叠功能确已进包）；`/usr/bin/cortex`→`../lib/cortex/Cortex`、`cortex.desktop` `Exec=/usr/bin/cortex`、`Icon=/usr/share/pixmaps/cortex.png`；gjs/Gio 实测 `exec=/usr/bin/cortex`、`icon=/usr/share/pixmaps/cortex.png`（即 `FileIcon`）、`startup_wm_class=None`；Electron 43.4.0；真实 `~/.config/goose` 时间戳未动。**功能层验收（新建会话标题不再是 New Chat）仍需用户在正式版实测** —— 文件层只能证明二进制换对了。

`ChatInput.layout.test.ts` 仅 AST 结构契约，`NavigationPanel.test.tsx` 为 mock 渲染；测试或标签变化不证明真实 wire。
**历史未执行项：`session_naming` 单测**。其 3 例新回归测试**未编译未运行** —— 当时 `debug/` 目录整个消失（仅删过 `debug/incremental`，**无法完全解释为何整个 debug 消失**，不编原因），冷编译代价大；而在 release profile 跑测试有**再次触发 v8 build script 破坏性清理**的风险（正是 ⑩ 事故的成因）。本次 §4.11 只补跑 OpenAI 格式层定点测试，不能据此声称 session_naming 测试已通过。补跑需单独授权。

## 4.10 v8 静态库事故（2026-10-16，操作规则）

事故经过与恢复细节见 audit §4.10（此处不重复）。**唯一需要记住的规则：Rust 构建一旦启动绝不可中断** —— v8 的 build script 会**先删除 `release/gn_out/` 再重新下载**，中断等于永久丢失 169MB 的 `librusty_v8.a`（`~/.cache/rusty_v8` 本就为空，无副本可恢复），且 cargo 会连带删掉旧的 `release/cortex`。失败特征是 `URLError: [Errno 111] Connection refused` ＋ `v8-goose-*/build.rs:669` 的 `assertion failed`，**与代码无关**。恢复办法：用户开 TUN 代理后用直连 `RUSTY_V8_MIRROR` 重下（36m04s 重建完成）。

另如实记录一项**原因不明的异常**：`debug/` 目录在本轮期间整个消失（仅执行过 `rm -rf debug/incremental`），后果是 `session_naming` 的 3 例新单测**未编译未运行**（见 §4 ⑨）。

## 4.11 OpenAI Chat developer 角色 400 修复验收（2026-10-16）

- **实现**：只改 `crates/cortex-provider-types/src/formats/openai.rs` 的系统角色与测试；原有 o1/o3 断言改为 `system`，新增 canonical `custom_siliconflow` + `zai-org/GLM-5.3-Flash` 的 `reasoning=true` 回填与低/中/高 effort 保留断言，及显式 `reasoning=false` 省略 effort 的回归。两条新增测试均覆盖非流式与流式请求；不发送真实请求。源码证据见 audit §4.11。
- **本次命令范围**：release 使用 §3 的 `cargo build --offline --release -p cortex-cli --bin cortex`；clippy 使用 `cargo clippy --offline -p cortex -p cortex-provider-types --all-targets --features acp-http,scheduler,rustls-tls,system-keyring -- -D warnings`。只运行 OpenAI 格式层单测，不运行全量 Cortex 单测或真实模型调用。
- **运行续接**：release 与 clippy 为同一后台命令顺序执行，日志分别在 `/tmp/opencode/cortex-developer-role-{release,clippy}.log`；另一个后台命令用进程退出事件等待该命令结束，再执行 `/tmp/opencode/cortex-developer-role-package.sh`（先检查测试/release/clippy 成功标记与产物新鲜度）。打包日志 `/tmp/opencode/cortex-developer-role-package.log`。未收到完成结果前不要重复启动构建或打包，更不可终止现有 Rust 进程。
- **自动验收（全绿）**：`cargo fmt --all` / `--check` 与 `git diff --check` 通过；UI typecheck `TYPECHECK_EXIT=0`；`cargo test --offline -p cortex-provider-types --lib formats::openai::` **134 passed / 0 failed**（含两条新增回归）；clippy `CLIPPY_EXIT=0`；release **11m44s，`CARGO_EXIT=0`**，全程未中断、v8 静态库无重下。首轮 clippy 曾因既有 `session_naming.rs:214` 新测试把 `ContentBlock` 未转换就 push 进 `Vec<MessageContentBlock>` 而失败（`CLIPPY_EXIT=101`），仅补 `.into()`、不改命名运行逻辑，重跑即绿；该 `#[cfg(test)]` 修正不影响 release 内容，旧仓库无此新用例故不能声称复现。
- **端到端验收（本地严格假端点，未发真实模型请求）**：`/tmp/opencode/cortex-developer-role-e2e/` 自建假 OpenAI 端点（收到 `developer` 角色一律 400，镜像真实端点）＋隔离配置根，跑刚构建的 release 二进制 `cortex run -t "say hi"`（provider `custom_siliconflow` ＋ 模型 `zai-org/GLM-5.3-Flash`，canonical `reasoning=true`，`GOOSE_THINKING_EFFORT=high`）。修复后：请求体 `roles=['system','user']`、`reasoning_effort="high"`、无 `temperature`、HTTP 200、正常收到回复。A/B 对照用**修复前的已安装二进制** `58a96940…` 打同一端点：`roles=['developer','user']` → **400**，并重复重试 8 次，与 bug 现象逐字一致。假端点与进程已清理。
- **打包**：`out/make/deb/x64/cortex_1.54.0_amd64.deb` 163,571,898 B；构建产物／stage 后端／deb 内嵌后端三者 SHA-256 一致（`d842032a…`）。打包前 i18n 编译 `I18N_COMPILE_EXIT=0`（无前端源码改动）。**未执行 sudo 安装**，已安装的仍是旧版 `58a96940…`，待用户安装后验收。
- **`~/.config/goose` 时间戳异动的真实原因（更正此前误判）**：本次观测到目录 mtime/ctime 变为 `2026-10-16 14:58:11`，一度按硬约束判为构建所致。事后只读排查证明是**用户本人**在改配置：`config.yaml.bak-before-wb2api` 于 14:58:11 新建、`config.yaml` 于 14:59:02 修改、`custom_providers/` 于 14:58:59 变更。构建与测试全程 `GOOSE_PATH_ROOT` 隔离，端到端两次运行后该目录时间戳未再变化。**不要把此事件记成构建回归**；时间戳变化仍应先排查是否用户侧操作。
- **仍待用户验收**：装上新版后用真实 `custom_siliconflow`／workbuddy 系模型发消息不再 400、底栏思考档位仍可调——单测与本地假端点**不能替代**真实端点结论。

## 5. 文档维护规则与新会话 Prompt

- 本文与 audit 以「合并取代、替换过期结论」为主，不堆执行日志、不嵌长 prompt 或截图堆，不建第三份文档。行数上限（plan ≤180、audit ≤100）自 2026-10-16 起改为**参考值而非硬约束**——信息完整性优先，但每次追加仍须先尝试合并进既有条目。
- 进度/决策更新本文对应节，源码事实（日期、file:line、静态/实测）更新 audit 对应条目。
- 本仓已有两份 BUG 报告，不要新建第三种文档：`BUG-REPORT-custom-provider-vision.md`（自定义供应商视觉判定，已修）、`BUG-REPORT-developer-role-rejected.md`（方案 A 已实施，验收状态见 §4.11）。

```text
继续优化 Cortex（Rust 后端＋Electron 桌面，源自 goose，已独立改名）；先读 docs/refactor-plan.md＋AGENTS.md（状态源），audit.md 按需查证。已完成勿重做：§0.3 七项优化、会话删除、侧边栏分组＋组内子项缩进、技能定制、token 第一批（tree 50KB 上限＋compaction.md 收紧）；托盘 GNOME 不显示＝平台问题勿改；全量 clippy 已绿（§4）。

安装基线：2026-10-16 14:20 已安装的后端为 `58a96940…`，含会话命名修复＋模型折叠，用户已在开发窗口实测两项均通过（§4 ⑪）。**本次 developer 角色修复的构建/包状态见 §4.11，勿把旧安装基线当成本次产物**。格式层 Rust 定点单测已通过；旧 session_naming 三条新测试未运行的历史限制仍保留（§4 ⑨与 §4.10）。重装由用户执行：`sudo apt install /home/rarestcsc/Cortex/ui/desktop/out/make/deb/x64/cortex_1.54.0_amd64.deb`（同名同版本免卸载）。打包必设 `ELECTRON_MIRROR`；**Rust 构建绝不可中断**（§4.10）。

本轮 developer 角色修复的最新状态以 §4.11 为准（本轮已获准定点 Rust 单测、clippy、release 与 deb）。未获批准勿做：下一批 token 候选（chatrecall 逐条上限、image 缩放、缓存感知压缩）、rpm/flatpak 打包、删旧仓库 Goose_test/goose 源码、自行开窗口（除非用户发令）、超出本次定点范围的全量 Rust 测试。真实端点验收交用户，不自行发送模型请求。
