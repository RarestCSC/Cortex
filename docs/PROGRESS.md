# Cortex 项目当前进度与看板

> 基于 `docs/archive/` 全部历史文档汇总。最后更新：**2026-10-17（第五轮：仓库迁移 + CI 守卫 + P0 关闭）**

> ⚠️ **编号体系声明（避免误引）**
> 本文件的 `D#`（已完成）、`P0/P1/P2-#`（待办）、`BUG-#`（遗留 bug）是**本项目自定编号**，
> 与归档文档的编号**互不对应**：
> - `TASK-fix-…md` 的 `D1–D10` 是**调度决定/文件移交**（例：`TASK` D6 = ACP 集成测试阻断 = 本文件 **D13**；`TASK` D8 = lint 命令跑不通 = 本文件 **P2-3**）
> - `BUG-REPORT-custom-provider-capability-pipeline.md` 的四个覆盖缺口是 **Gap A/B/C/D**（等价 `TASK` D9-A~D），**不是** D1–D4
> - `SUMMARY` §7.5 的 **D10-a**（真机探测 free-lane）对应本文件 **D14** 的前提条件
>
> ⚠️ **引用归档文档时的两个坑**：`AUDIT-2026-10-17.md` **没有 §9、也没有 §7.8**（该文止于 §8，§7 无子节）；其冷启动发现一节是 **`### C.`（隶属 §5）**，不是「§4-C」。

---

## ✅ 已完成

| 编号 | 事项 | 对应交付/文档 | 验收状态 |
|------|------|--------------|----------|
| D1 | `api_key_env: null` 不再炸掉整个 custom provider 注册表 | `FIX-jia` C5 | 单测绿、集成测试绿、假端点验证通过。⚠️ **`cortex doctor` 端到端未跑**（需 cortex-cli 290MB 链接）、**真机验收未做**（`FIX-jia` §7.4） |
| D2 | 视觉三态开关真正可逆（自动能清掉已设值） | `FIX-jia` C4 | 协议层+持久化层+UI层三层全绿。⚠️ 实现走的是 `HashMap::get` 三态区分，**未按原 A3 方案改 ACP schema** |
| D3 | `is_openai_responses_model` 正则纳入 `:` 分隔符 | `FIX-yi` A1 | 单测绿、`global:gpt-6-luna` 等 realm 前缀模型识别通过 |
| D4 | 消灭「UI 能调但出站不发 reasoning_effort」静默失效 | `FIX-yi` A2 | 统一 `sends_thinking_effort()` 判定，菜单⇄出站一致性回归绿。⚠️ `TASK` 中「`cn:space-bunny` 类模型出站含 effort」这条 AC **依赖 B1，乙无法达成**，替代证据是 `cn:glm-5.3-flash` |
| D5 | 用户声明 `reasoning: true` 接进 ModelConfig | `FIX-bing` B1 | 注入点在 canonical 之前，权威值契约，单测绿 |
| D6 | 消费 `GET /v1/models` 能力字段（动态档位、视觉、缺省值） | `FIX-bing` B2 | 声明型网关端到端绿、`cn:hy4-preview` 单档菜单绿。⚠️ **带未修缺口**：冷启动不回填 `reasoning`，见 **P0-5** |
| D7 | `ThinkingEffort` ↔ 网关词表双向映射（`max ↔ xhigh`） | `FIX-bing` B3 | 端到端验证：`max` 发 `max`、非 `high` 降级。⚠️ 该验证的**前提是 provider JSON 里已写 `"reasoning": true`** |
| D8 | `/v1/responses` 路由闸门与菜单对齐、回落机制 | `FIX-bing` B4 | `should_use_responses_api` 压过模型名、首次 404 回落 chat |
| D9 | 运行时探测兜底（G1：乐观发送→拒绝剥离→落盘） | `FIX-bing` G1 | 沉默型网关端到端绿、缓存跨进程存活、TTL 30 天。⚠️ 同 D7，**「端点是唯一推理证据」这一类模型从未被测过**（见 P0-5） |
| D10 | 端点沉默时菜单给可操作提示而非静默一档 | `FIX-bing` G2 | ACP option description 注入、三条单测绿。⚠️ **提示位置是否够 = 未决**，见 **P1-9** |
| D11 | UI 状态重置修复（useEffect 依赖对象身份→供应商身份） | `FIX-bing` G3 | 4 条真实点击用例绿、去掉修复即红。⚠️ 真根因是 D15 的死类，G3 判定为「真实但次要」 |
| D12 | Off 兜底三元组删除，改为「只认本档自己的词」 | `AUDIT-2026-10-17` §1 | `Off` 不发字段、`Max` 发 `max`、零回归。**4 处新失败**（其中 2 条是乙/丙的核心不变量）；既有 6 条测试中改写 3 + 保留 1（跨路径不变量）+ 新增 2 |
| D13 | ACP 集成测试全仓库解锁（`crates/cortex/tests/acp_fixtures/server.rs:366`） | `AUDIT-2026-10-17` §3 | **11 个测试二进制 8 绿 3 红**，暴露 3 个从未执行的失败已分类。第五轮已修 3 个红（P1-5/6/7） |
| D14 | OpenCode 免费模型思考强度**（workaround，非根治）** | `AUDIT-2026-10-17` §4.4 | 三个模型手写 `"reasoning": true`（**只动 3 行、其余键未碰**），隔离根端到端验证 `max`→`"max"`、`off`→不发字段。⚠️ **根因 `catalog_provider_id` 未修**，见 **P1-1**；且**顺序有依赖：必须先做 D12（删三元组）再写声明** |
| D15 | 死 Tailwind 类：用户报障文件 `CustomProviderForm.tsx` 选中态清理 | `AUDIT-2026-10-17` §4.2 | 15 处选中态死类替换、tsc 绿、视觉单测全过。第五轮全仓库清理后该文件已零死类，见下方说明 |
| D16 | 会话真删除/真归档、工作目录分组、侧边栏改版等 **8 项** UI 优化 | `refactor-plan.md` §0.3 | 已实测可跑通、打包安装闭环。**8 项清单**：①关于页 ②自定义供应商字段显示不全 ③视觉识别三处 ④托盘 ⑤工作目录分组 ⑥真归档 ⑦会话命名提炼 ⑧扩展描述 i18n |
| D17 | 命名重构 goose→cortex（crate、CLI、UI 包、协议键保留） | `refactor-plan.md` §0.1 | 15 个 crate；`goose::`→`cortex::` **593 处**、`goose_xxx::` **776 处**，共 **276 文件**；i18n **432 键**改名、**1626 messages** 不变；**171 项改动**逐项核对、`git fsck` 干净 |
| D18 | developer 角色 400 修复（系统角色恒为 system） | `BUG-REPORT-developer-role-rejected` | 方案 A 已落地、本地假端点 A/B 验收绿（修复前 binary 400 + **重复重试 8 次**，修复后 `roles=['system','user']`、HTTP 200）。⚠️ **真机验收未做**，见 **P1-10** |
| D19 | code_execution v8 下载 403 修复、图标修复 | `refactor-plan.md` §0.2 | 根因是 gh-proxy 对大型静态库 `.a.gz` 返回 403（**不是** v145.0.0 不存在），`RUSTY_V8_MIRROR` 直连即可、无需降级版本；按平台选图标、desktop 项创建 |

### 关于 D15「零死类」的最终口径

第五轮已复跑扫描并完成全仓库清理：修正假阳性（透明度修饰符、`theme-tokens.ts` 对象键、复合 data 变体）后，真实待清数为 **394 处 / 85 种 / 60 文件**，方案 A（`main.css` 别名）+ B（13 个业务文件定点替换）后降至 **0**。

- 旧快照 `511 / 119 / 71` 含三类假阳性，**仅作历史记录**，不再作为当前待清数。
- 本地门禁：`ui/desktop/scripts/check-dead-classes.sh`（0 → exit 0，有死类 → exit 1）。
- GitHub Actions：`.github/workflows/dead-classes.yml`，run `39031487176` success，输出 `SCANNED_FILES=520 TOTAL=0 KINDS=0 FILES_AFFECTED=0`。

---

## 📋 进行中 / 待办

### P0（已全部关闭）

| 编号 | 事项 | 结论 |
|------|------|------|
| ✅ P0-1 | WorkBuddy Responses API 真机验收 | `/v1/responses` → **404**，B4 回落 chat 并缓存 `supports_responses_api:false`；三个 `global:gpt-6-*` 被网关 **503 `personal_free_user`** 拦截。**代码侧已闭合；模型可用性由账号决定，用户决定以后再弄** |
| ✅ P0-2 | 各网关 400 拒图措辞覆盖 | 未捕获真实 400 原文；free-lane 模型接受图片（200）。**用户实测视觉可用，已验收；以后出问题再处理**。`capability_rejection` 保持 fail-loud（未知措辞 → 错误上抛，不静默剥图） |
| ✅ P0-3 | G1 图像乐观发送真机验收 | GUI 经 Cortex 向 free-lane 发图成功（模型回复 "Blank"），`llm_request.0/1.jsonl` 含 `image_url`，网关接受，无需降级 |
| ✅ P0-4 | 死 Tailwind 类清理 + CI 守卫 | 真实 **394/85/60 → 0**；本地门禁 + GitHub Actions 双绿（run `39031487176`） |
| ✅ P0-5 | 冷启动不回填 `reasoning` | 已修（镜像 `model_config.rs:176-193`）；新增回归测试；`cortex-providers --lib` 270/0；dev 二进制 e2e 主请求带 `reasoning_effort:"high"` |

### P1（重要，不阻塞主流程但影响体验）

| 编号 | 事项 | 来源 | 备注 |
|------|------|------|------|
| ✅ P1-1 | **`catalog_provider_id` 参与 canonical 查找（Phase 1）** | `AUDIT-2026-10-17` §2 ①、`SUMMARY` §7.5 | **已完成并验证**：lite-gpt 配置改为 `catalog_provider_id: "openai"`；代码用别名解析 `openai/gpt-6-luna`（1.05M / 128k）；端点 context 仍优先。OpenCode 的 `oc-` 名字规则仍未做 |
| ✅ P1-2 | **档位语义：默认 Off（支持时）/最低档；菜单只显示实际档位** | `AUDIT-2026-10-17` §1.5 | **已完成并验证**：`can_disable_thinking` / `only_reasoning` / `reasoning_effort` 进入菜单；Off 只在支持时出现；显式 Off 且无 off 词时省略字段；不支持 Off 的模型默认最低档 |
| P1-3 | **`reasoning: false` 无法表达（三态需求）** | `AUDIT-2026-10-17`、`FIX-bing` §9.1 #5 | 给 `ModelInfo` 加三态是产品决策。名字被启发式认成推理模型、用户想显式关掉时无「关」表示 |
| ✅ P1-4 | **`model_capabilities.json` 位置与清除入口** | `AUDIT-2026-10-17` §5-E #7、`FIX-bing` §9.1 #6 | **已完成**：位置不动；新增 `cortex capability-cache [--clear]`（查看/清除）；零 i18n |
| ✅ P1-9 | **G2 提示进桌面底栏弹层** | `FIX-bing` §9.1 #4、`AUDIT-2026-10-17` §5-E #6 | **已完成**：弹层显示 ACP option description，零 schema/i18n 改动 |
| ✅ P1-5 | **腐烂测试修复：`declared_vision_registry` 陈旧断言** | `AUDIT-2026-10-17` §3.3 #1 | **已完成（第五轮）**：只数 POST，1 passed / 0 failed |
| ✅ P1-6 | **腐烂测试修复：`goose-doc-guide` 死断言** | `AUDIT-2026-10-17` §3.3 #2、`SUMMARY` §8 表**第 12 行** | **已完成（第五轮）**：改断言 `web-search` 并隔离 `HOME`，`acp_custom_requests_test` 21/0 |
| ✅ P1-7 | **腐烂测试修复：`code-mode` 导致 fixture 预算超时** | `AUDIT-2026-10-17` §3.3 #3 | **已完成（第五轮）**：fixture 预算 5s → 30s，`acp_server_test` 59/0（79s） |
| ✅ P1-8 | **`cortex-cli/src/logging.rs:55` 改名遗留** | `AUDIT-2026-10-17` §3.3 末尾 | **已完成（第五轮）**：字面量 `"goose"` → `"cortex"`，`cortex-cli --lib` 353/0 |
| **P1-9** | **G2 提示位置：桌面端底栏是否也需要** | `FIX-bing` §9.1 #4、`AUDIT-2026-10-17` §5-E #6 | 当前只在 ACP option description。`ThinkingEffortControl.tsx` 底栏要不要同一句话**取决于真机观感**，尚未决策 |
| **P1-10** | **developer 角色修复的真机验收** | `refactor-plan.md` §4.11 末条 | 装上新版后用真实 `custom_siliconflow`／workbuddy 系模型发消息**不再 400**、底栏思考档位仍可调。⚠️ 单测与本地假端点**不能替代真实端点结论** |
| ✅ P1-11 | **`session_naming` 3 例回归测试** | `refactor-plan.md` §4⑨ + §4 末条 | **已完成**：现有 debug lib 测试二进制定点跑 **3 passed / 0 failed**（`test_collect_title_candidates_*`）；不需要 release profile，原「单独授权」限制解除 |

### P2（技术债、长期维护）

| 编号 | 事项 | 来源 | 备注 |
|------|------|------|------|
| P2-1 | **其余中转站 `/v1/models` 核查** | `BUG-REPORT-…pipeline` Gap D、`FIX-bing` §9.2 | **lite-gpt 已探**：只有 `supported_endpoint_types`，无 context/effort；已用 `catalog_provider_id: "openai"` 走 canonical。`custom_chatanywhere` / `custom_siliconflow` 仍需 API key |
| P2-2 | **测试隔离漏洞：`GOOSE_PATH_ROOT` 不隔离 `~/.agents/skills`** | `AUDIT-2026-10-17` §3.4 | `crates/cortex/src/skills/mod.rs:401` 用 `dirs::home_dir()`。技能类测试读开发者真实家目录（`sources::tests::list_sources_lists_builtin_skills_without_upstream_doc_guide` 失败的真因是自装 `~/.agents/skills/web-search` 顶掉内置，`discover_skills` 的 `seen` 去重）。以后写技能测试要么隔离 HOME 要么别依赖 builtin |
| P2-3 | **`cargo clippy --all-targets` 跑不通的分支既有问题** | `AUDIT-2026-10-17` §6 | 不加 feature 编译错误（`agents/state_machine/tests/` 24 个）、加了撞 `E0432: unresolved import cortex::acp::transport`（`acp/mod.rs:12` 带 `#[cfg(feature = "acp-http")]`）。⚠️ 时间线：`refactor-plan` §4④（2026-10-15）曾全绿，2026-10-17 又跑不通，状态反转源自改名引入的 feature 门控 |
| ✅ P2-4 | **真实 `~/.config/goose` 时间戳已变更** | `FIX-yi` §7.8 | **已确认修订基线（2026-10-18）**：硬边界基线改为 `2026-10-16 15:33:19.316532991 +0800`，判定为用户手工改配置、非构建回归；`AGENTS` §1.1 已更新 |
| ✅ P2-5 | **不要用 `git stash` 做局部回退（改名未提交状态）** | `AUDIT-2026-10-17` §7、`refactor-plan` §0 | **已随新仓库失效**：改名已提交，`git stash` 恢复为正常操作；仍优先用 `git diff` / `git restore` 定点回退 |
| ✅ P2-6 | **工作区残留 + 已知 flaky 测试** | `FIX-jia` §7.3、`FIX-bing` §8.1/§8.2 | **全部关闭**：① `.snap.new` 已删（feature 集已对齐）；② `gemini_cli` 已修（读取改 5s 轮询，2026-10-18）；③ `CustomProviderForm` 慢用例已传 `15000` |
| ✅ P2-7 | **token 优化线** | `refactor-plan.md` §0 token 段、§5 | **第一批已上线并进正式安装包**：`tree` 加 `OUTPUT_LIMIT_BYTES=50_000` 行边界截断（+2 例回归）、`compaction.md` 改为「最短可续接摘要」。**第二批已取消**（用户 2026-10-17 决定不做）：chatrecall 逐条上限、image 缩放、缓存感知压缩。明确不在范围：缓存参数/命中、DeepSeek 原生 hit/miss、GPT-6 断点 |

---

## 🐛 已知遗留 Bug（有 BUG-REPORT 但无 FIX 对应解决）

| 编号 | Bug | 状态 | 说明 |
|------|-----|------|------|
| BUG-1 | **`api_key_env: null` 仅解决了这一种坏文件，真正语法错误的 JSON 依然拖垮整张注册表** | 方案 B/C 未做 | `FIX-jia` §2.3 已标注：按边界未做。`load_custom_providers` 用 `.collect::<Result<Vec<_>>>()`，单文件失败即全灭；且错误只在 `tracing::warn!` 里，**GUI 用户看不到**。需坏文件跳过+错误对用户可见 |
| BUG-2 | **GUI 进程读不到 `systemctl --user set-environment` 的变量** | 已定位，环境问题 | `FIX-jia` §4、`SUMMARY` §6 #6、`BUG-REPORT-…null-api-key-env.md` §4。实测：`~/.config/environment.d` 有、`systemctl --user show-environment` 有、**`/proc/<pid>/environ` 无**。✅ **可行解：从带该变量的环境启动 GUI 窗口（`AUDIT` §4.1 实测，不必注销重登）**；注销重登亦可 |
| ✅ BUG-3 | **`goose-doc-guide` 技能被刻意过滤但集成测试断言要求它出现** | 已修（P1-6） | 已改为断言 `web-search`，并隔离 `HOME`，21/0 |
| ✅ BUG-4 | **全仓库死 Tailwind 类（70+ 文件未动）** | 已修（P0-4） | 真实 394/85/60 → **0**；本地门禁 + GitHub Actions 双绿 |
| BUG-5 | **探测缓存 400 措辞覆盖不全** | 仅匹配常见组合 | `FIX-bing` §9.1 #2/3。措辞不在 `REFUSAL_TERMS × 主题词` 的笛卡尔积里会退化成错误上抛。**P0-2 用户已验收视觉可用；保持 fail-loud，后续有真实 400 样本再扩词表** |
| ✅ BUG-6 | **图像降级分支未过真实二进制** | 已验（P0-3） | GUI 经 Cortex 向 free-lane 发图成功，`image_url` 落日志，网关 200，无需降级 |

---

## 📊 关键指标仪表盘

| 指标 | 当前值 | 目标 | 趋势 |
|------|--------|------|------|
| 自定义供应商能力管线覆盖率 | ~90%（WorkBuddy 全通、OpenCode 靠 workaround） | 100%（含 OpenCode 系根治） | ↗️ |
| 能力解析（context / 档位） | ✅ Phase 1 + Phase 2 已验证；lite-gpt `catalog_provider_id: "openai"` | 端点优先、可覆盖 | ✅ |
| 死 Tailwind 类数量 | **0**（2026-10-17 第五轮清理；修正口径后真实 394 处 / 85 种 / 60 文件） | 0 | ✅ |
| `cortex --lib` 通过率 | **2295/2295 = 100%**（新 feature 集；旧 8 个失败已修） | 100% | ✅ |
| 其他测试层 | `cortex-cli --lib` 353/0；UI vitest **1013/0/8**；ACP **11/11** 全绿 | 全绿 | ✅ |
| 真机验收完成度 | **P0 真机项已关闭**（P0-1 环境阻断、P0-2 用户验收、P0-3 通过）；P1-10/P1-11 仍待装版/授权 | 全绿 | ↗️ |
| 配置隔离合规性 | ✅ 验收/验证会话全程 `GOOSE_PATH_ROOT` 隔离 | 100% | ✅ |
| ⚠️ 上条的唯一例外 | 2026-10-17 `TASK` D10-a 为定决策**直打真 free-lane（8787）5 次**（`SUMMARY` §7.5）。端口在 `AGENTS.md` §1.2 回避名单内，但该次探测发生在主会话 | — | — |

---

## 🔄 下一步行动建议

1. **B 类测试债（已验证）**：UI 21 个、Rust 8 个全部归零；`cortex --lib` 2295/0、UI 1013/0/8、ACP 11/11。
2. **Phase 1/2（已验证 + 真机验收通过）**：`catalog_provider_id` 别名、context 回填、档位菜单（默认 Off/最低档）全部通过；`cortex-provider-types` 682/0、`cortex-providers` 272/0。
3. **提交/推送**：已完成（`07d51af` + `e6c919c`，CI 守卫 success）。
4. **产品决策**：P1-3 三态（需要具体误判模型）。
5. **真机/装版**：Phase 1+2 真机验收已通过（2026-10-17 晚，dev 二进制 + 隔离根）；P1-10 developer 角色验收暂缓。
6. **P2 技术债**：P2-4 / P2-3 / P2-6 已完成（2026-10-18，见 `TECH-DEBT.md` §5）；剩 P2-2（隔离 helper，缓做）、P2-1（等 key）；Windows 构建暂缓。

---

## 🆕 2026-10-17 第五轮（本会话）交付

> 本节为追加记录，上方历史基线数字保留不改。

### 已完成（代码 + 测试）

| 编号 | 交付 | 证据 |
|------|------|------|
| P0-5 | `with_endpoint_capabilities` 冷启动回填 `reasoning`（镜像 `model_config.rs:176-193`） | 新增 `a_cold_start_model_takes_its_effort_from_the_endpoint`；`cortex-providers --lib` 270/0；临时还原旧行为测试变红；dev 二进制 + 假端点 e2e 主请求带 `reasoning_effort:"high"` |
| P0-4 | 死 Tailwind 类清理（方案 A+B） | 修正扫描口径后真实 **394 处 / 85 种 / 60 文件** → **0**；`main.css` 注册别名；13 个业务文件定点替换；`tsc` 干净；vitest 992/21/8（与基线一致，无新增失败） |
| P0-4 CI 守卫 | `scan-dead-classes.py --fail-on-dead` + `scripts/check-dead-classes.sh` + npm 目标 `check:dead-classes` | 0 死类 exit 0；注入 1 个假死类 exit 1 |
| P1-5 | `declared_vision_registry` 只数 POST | 1 passed / 0 failed |
| P1-6 | `goose-doc-guide` → `web-search`，并隔离 HOME（P2-2 同源问题） | `acp_custom_requests_test` 21/0 |
| P1-7 | ACP fixture 预算 5s → 30s（code-mode 初始化慢） | `acp_server_test` 59/0（79s） |
| P1-8 | `logging.rs:55` 字面量 `goose` → `cortex` | `cortex-cli --lib` 353/0 |

### 真机验收（dev 二进制，未打包）

| 项 | 结论 |
|----|------|
| P0-1 | `POST /v1/responses` → **404**（`llm_request.6.jsonl`），B4 回落 chat 并缓存 `supports_responses_api:false`。三个 `global:gpt-6-*` 模型被网关以 **503 `personal_free_user` 不支持** 拒绝，无法进一步验证 chat 行为。 |
| P0-2 | **未捕获到 400 拒图**：free-lane `oc-space-bunny-free` / `oc-big-pickle` 均接受图片（200）；wb2api `global:enhance-1.0` 返回 503 provider 不可用。`capability_rejection` 的真实 400 覆盖仍未验。 |
| P0-3 | GUI 通过 Cortex 向 free-lane 发图成功（模型回复 "Blank"），`llm_request.0/1.jsonl` 含 `image_url`；网关接受，无需降级。 |
| P0-4 | onboarding / 设置页截图见 `/home/rarestcsc/图片/ Cortex_test/20261017-P0-4-*.png`（10 张）。 |
| P0-5 | 假端点（声明词表、无 `supports_reasoning`）+ dev 二进制：主请求首轮带 `reasoning_effort:"high"`。 |

### 基线复核

- `cortex-providers --lib`：270 passed / 0 failed
- `cortex-cli --lib`：353 passed / 0 failed
- `cortex --lib`（全 feature）：2276 passed / 8 failed（与基线一致）
- `declared_vision_registry` 1/0；`acp_custom_requests_test` 21/0；`acp_server_test` 59/0
- UI `tsc --noEmit` 干净；vitest 992/21/8（与基线一致）
- 真实 `~/.config/cortex/config.yaml` mtime 全程未变（隔离根验收）

### 本轮新增的扫描口径修正

旧快照的 511/119/71 含三类假阳性，已修正：

1. 透明度修饰符（`bg-red-900/20` 被截成 `bg-red-900`）
2. `theme-tokens.ts` 的对象键（`'--color-text-tertiary'` 被当成类名）
3. 复合变体（`data-[variant=destructive]:focus:bg-x/10` 解析不到）

修正后真实待清数为 **394/85/60**。

---

## 🆕 2026-10-17 仓库迁移与 CI 守卫（第五轮补充）

### 仓库

| 项 | 值 |
|----|-----|
| 远端 | `https://github.com/RarestCSC/Cortex.git`（private） |
| 分支/HEAD | `main` / `c07283a`（后续以 `git log -1` 为准） |
| 历史 | fresh history：`8ff6f73` 初始快照 → `c07283a` CI 守卫 |
| 旧目录 | `/home/rarestcsc/Goose_test`（含旧 Goose 源码 + `.git` 651M）、`Cortex-goose-backup` 均已删除 |
| 构建缓存 | `target/debug` 77G（`deps` 38G + `incremental` 36G），按用户要求未清理 |

### CI 守卫

- 文件：`.github/workflows/dead-classes.yml`
- 触发：push / PR 到 `main`，或手动
- 运行：[39031487176](https://github.com/RarestCSC/Cortex/actions/runs/39031487176) → **success**
- 第六轮提交 `07d51af` 的守卫运行 [39042811474](https://github.com/RarestCSC/Cortex/actions/runs/39042811474) 亦 **success**
- 第八轮提交 `b30b644` 的守卫运行 [39058486002](https://github.com/RarestCSC/Cortex/actions/runs/39058486002) 亦 **success**
- 输出：`SCANNED_FILES=520 TOTAL=0 KINDS=0 FILES_AFFECTED=0`

### A 类验收的最终决定（用户 2026-10-17）

| 项 | 决定 |
|----|------|
| P0-1 | 三个 `global:gpt-6-*` 的 503 是账号问题，用户以后再弄；代码侧 404 回落已闭合 |
| P0-2 | 用户实测视觉可用，**已验收**；以后出问题再处理 |
| P0-3 | 已通过（free-lane 接受图片 200） |
| Windows 构建 | 暂缓，等没大 bug 后再做 |

### 基线（第五轮结束时）

- `cortex-providers --lib` 270/0；`cortex-cli --lib` 353/0
- `session_naming` 3 例定点 **3/0**（P1-11 关闭，无需 release profile）
- `cortex --lib` 旧基线 2276/8（8 个均为测试环境问题）；第六轮已验证 **2295/0**
- ACP：**11 个二进制 11/11 全绿**（第六轮全量重跑；3 个红已于第五轮修复）
- UI vitest 992/21/8（21 个均为测试侧：App mock 缺导出、Hub 缺 Router、CustomProviderForm 5s 超时）
- 真实 `~/.config/cortex/config.yaml` mtime 全程未变（`2026-10-16 15:53:59.629486445`）

### B 轮测试债修复（已验证）

- UI：`App.test.tsx` 补 `acpListRecentSessions` mock；`Hub.test.tsx` 包 `MemoryRouter`；`CustomProviderForm.test.tsx` 两个慢用例超时 `15000`。
- Rust：测试 feature 集补 `platform-apps,chat-recall,rustls-tls`；`sources` 两个用例加 `HOME` 隔离；`.snap.new` 已删除。
- 预期：`cortex --lib` 8 个失败归零；UI vitest 21 个失败归零；ACP 11 个全量重跑确认无回归。

---

## 🆕 2026-10-17 能力解析 Phase 0/1（relay-aware capability resolution）

### Phase 0 探测结果（只读 `GET /v1/models`）

| 站点 | 模型数 | 可用字段 | 结论 |
|------|--------|----------|------|
| 7863 WorkBuddy | 53 | `context_length` 53/53、`max_output_tokens` 53/53、`supports_images` 51/53、`supports_reasoning` 48/53、`reasoning_supported_efforts` 46/53、`reasoning_default_effort` 32/53、`reasoning_effort` 16/53、`can_disable_thinking` 15/53、`only_reasoning` 41/53 | 声明型，信息最全 |
| 8787 free-lane | 7 | `context_window` 7/7，其余无 | 只有上下文 |
| lite-gpt (vortexapi.xyz) | 9 | `supported_endpoint_types` 9/9，其余无 | 沉默型；`gpt-6-luna` / `gpt-6.1-sol` 在列 |

同名模型实测：`global:deepseek-v4.1-flash`（7863）**1,000,000** vs `oc-deepseek-v4.1-flash-free`（8787）**262,144**。

### Phase 1 代码改动（未编译验证）

- `EndpointModelCapabilities` 新增 `context_window` / `max_output_tokens` / `supports_responses_api`；解析 `context_length` / `context_window` / `max_context_length` / `max_output_tokens` / `supported_endpoint_types`。
- `parse_n_ctx_from_models` 读取 relay 的 context 字段（llama.cpp `meta.n_ctx` 仍优先）。
- `with_endpoint_capabilities` 在空值时回填 `context_limit` / `max_tokens`。
- `OpenAiProvider` 新增 `canonical_provider`，从 `catalog_provider_id` 注入；`ContextLimitResolver` 用它做 canonical fallback。
- `apply_canonical_limits` 用 `catalog_provider_id` 别名解析 canonical，并新增 `with_canonical_context_limit`。
- `should_use_responses_api_for_provider` 消费 `supported_endpoint_types`。
- 真实配置：`custom_lite-gpt.json` 的 `catalog_provider_id` 从 `null` 改为 `"openai"`（备份 `/tmp/opencode/cortex-config-backup-20261017-212604/`，其余字段未变）。

### 预期结果（已验证）

| 模型 | 站点 | 预期 context | 来源 |
|------|------|--------------|------|
| `global:gpt-6-luna` | 7863 | 1,000,000 | Endpoint |
| `gpt-6-luna` | lite-gpt | 1,050,000 | Canonical (openai alias) |
| `oc-deepseek-v4.1-flash-free` | 8787 | 262,144 | Endpoint |
| `global:deepseek-v4.1-flash` | 7863 | 1,000,000 | Endpoint |

### Phase 2（已验证）

- **决策**：不加 `default` 档；默认选 **Off（支持关闭时）**，否则选**最低档**。
- 菜单只显示端点/canonical 实际声明的档位；`Off` 只在 `can_disable_thinking: true`、词表含 `none`/`off`，或端点完全沉默时出现。
- GLM/Kimi 沉默时保持 always-on 三档（low/high/max），不出现 Off。
- `reasoning_effort`（单档固定）合成单档菜单；`only_reasoning: true` 且无 `can_disable_thinking` 时隐藏 Off。
- 档位标签用端点实际词（如 `xhigh`），不再把 `xhigh` 显示成 `max`。
- canonical `reasoning_efforts` 作为沉默型 relay 的 fallback。
- 显式 Off 且词表无 off 词时**省略 `reasoning_effort`**，不再降级成 `low`。
- 代码已验证：`cortex-provider-types` 682/0、`cortex --lib` 2295/0、UI 1013/0/8、ACP 11/11。

**预期菜单：**

| 模型 | 菜单 | 默认 |
|------|------|------|
| `global:gpt-6-luna` | low / medium / high / xhigh | low |
| `global:gpt-6-astra` | off / low / medium / high / max | off |
| `global:deepseek-v4.1-flash` | high（固定） | high |
| `cn:auto` | high（固定） | high |
| lite-gpt `gpt-6-luna` | none / low / medium / high / max | none |
| lite-gpt `gpt-6.1-sol` | low / medium / high / max | low |
| 8787 free-lane | 固定五档 | off |
| 非推理模型 | off | off |

**代码改动：**

- `endpoint_capabilities.rs`：新增 `reasoning_effort` / `only_reasoning` / `canonical_efforts`；`off_allowed` / `lowest_effort` / `effort_label`。
- `model.rs`：新增 `declared_effort_levels` / `off_allowed` / `lowest_effort` / `effort_label`；canonical 词表 fallback。
- `formats/openai.rs`：Off 只接受 `none/off/minimal`；默认映射 Off/最低档；菜单值过滤。
- `response_builder.rs`：菜单按实际档位渲染；去掉 `default`；标签用实际词。
- `model_config.rs`：不再用 `endpoint_default_effort` 作为初始档。

### 真机验收（dev 二进制 + 隔离根，2026-10-17 晚）

| 项 | 结论 |
|----|------|
| Phase 1+2 | ✅ **用户确认「通过」**：档位菜单按实际词表渲染（`gpt-6-luna` 四档含 `xhigh`、`gpt-6-astra` 含 Off、`deepseek-v4.1-flash` 单档固定、lite-gpt 走 canonical 词表）、context 按端点/别名解析。全部模型可正常切换 |

### 未做

- 用户覆盖 UI、缓存 provenance UI、`credits` / `supports_tool_call`。
- 统一编译与全量测试。

---

## 🆕 2026-10-18 第七轮：P2 收尾

| 项 | 交付 |
|----|------|
| P1-4 | `cortex capability-cache [--clear]`（查看/清除 G1 探测缓存；位置不动） |
| P1-9 | 底栏弹层显示 ACP option description（沉默型网关提示；零 schema/i18n） |
| P2-4 | `~/.config/goose` 时间戳基线修订为 `2026-10-16 15:33:19.316532991`（用户手工改配置；已确认） |
| P2-3 | `clippy --all-targets -D warnings` **exit 0**（新 feature 集下；修 bedrock 测试构造器缺 `endpoint_capabilities`）。网络无关，纯 feature 集 + 遗留构造器问题 |
| P2-6 | `.snap.new` 已删、`CustomProviderForm` 超时已修、`gemini_cli` shim 读取改 5s 轮询（8 连跑通过） |

验证：`cortex-cli --lib` 353/0；`tsc` 干净；bottom_bar vitest 36/36；clippy `-p cortex --features scheduler -D warnings` 干净。

剩：P2-2（隔离 helper，缓做）、P2-1（等 key）、P1-3（等案例）、P1-10 与 Windows（暂缓）。

---

## 🆕 2026-10-18 第八轮：真机 bug 修复

| Bug | 根因 | 修复 | 验证 |
|-----|------|------|------|
| 欢迎页常驻「正在加载对话」 | Hub 自动 prepare 时固定显示底部 `LoadingIndicator` | 移除欢迎页底部指示器 | `tsc` 干净；Hub 15/15 |
| 切换工作目录后实际 cwd 不变 | prepared session 仍绑定旧目录，只改了 UI label | 切换目录时失效 prepared session；`createHubSessionForCurrentDir` 校验 `working_dir`；`workingDirRef` 防竞态 | 新增回归测试；Hub 15/15 |
| 历史会话加载慢（一条消息也慢） | `session/load` 同步启动所有扩展，`context7` stdio MCP 拉进程耗时 | 扩展改为后台预热，`session/load` 立即返回 | `acp_server_test` 59/0 |
| tree 看不到 `.agents`/`.config` | `ignore::WalkBuilder.hidden(true)` 忽略 dotfile，模型误判空目录 | 新增 `show_hidden` 参数；默认隐藏时输出「hidden entries omitted: ...」 | tree 6/6 |

> 供应商更新失败是 dev 环境 `GOOSE_DISABLE_KEYRING=1` + 隔离根无 secret 所致，不是代码 bug；隔离根填一次 key 即恢复。
