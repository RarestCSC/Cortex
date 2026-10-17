# Cortex 项目当前进度与看板

> 基于 `docs/archive/` 全部历史文档汇总。最后更新：**2026-10-17（经 `AUDIT-REPORT.md` 交叉审计修订）**

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
| D13 | ACP 集成测试全仓库解锁（`crates/cortex/tests/acp_fixtures/server.rs:366`） | `AUDIT-2026-10-17` §3 | **11 个测试二进制 8 绿 3 红**，暴露 3 个从未执行的失败已分类 |
| D14 | OpenCode 免费模型思考强度**（workaround，非根治）** | `AUDIT-2026-10-17` §4.4 | 三个模型手写 `"reasoning": true`（**只动 3 行、其余键未碰**），隔离根端到端验证 `max`→`"max"`、`off`→不发字段。⚠️ **根因 `catalog_provider_id` 未修**，见 **P1-1**；且**顺序有依赖：必须先做 D12（删三元组）再写声明** |
| D15 | 死 Tailwind 类：用户报障文件 `CustomProviderForm.tsx` 选中态清理 | `AUDIT-2026-10-17` §4.2 | 15 处选中态死类替换、tsc 绿、视觉单测全过。⚠️ **「该文件零死类」待复跑确认** —— 见下方说明 |
| D16 | 会话真删除/真归档、工作目录分组、侧边栏改版等 **8 项** UI 优化 | `refactor-plan.md` §0.3 | 已实测可跑通、打包安装闭环。**8 项清单**：①关于页 ②自定义供应商字段显示不全 ③视觉识别三处 ④托盘 ⑤工作目录分组 ⑥真归档 ⑦会话命名提炼 ⑧扩展描述 i18n |
| D17 | 命名重构 goose→cortex（crate、CLI、UI 包、协议键保留） | `refactor-plan.md` §0.1 | 15 个 crate；`goose::`→`cortex::` **593 处**、`goose_xxx::` **776 处**，共 **276 文件**；i18n **432 键**改名、**1626 messages** 不变；**171 项改动**逐项核对、`git fsck` 干净 |
| D18 | developer 角色 400 修复（系统角色恒为 system） | `BUG-REPORT-developer-role-rejected` | 方案 A 已落地、本地假端点 A/B 验收绿（修复前 binary 400 + **重复重试 8 次**，修复后 `roles=['system','user']`、HTTP 200）。⚠️ **真机验收未做**，见 **P1-10** |
| D19 | code_execution v8 下载 403 修复、图标修复 | `refactor-plan.md` §0.2 | 根因是 gh-proxy 对大型静态库 `.a.gz` 返回 403（**不是** v145.0.0 不存在），`RUSTY_V8_MIRROR` 直连即可、无需降级版本；按平台选图标、desktop 项创建 |

### 关于 D15「零死类」的准确说法

`CustomProviderForm.tsx` 的 **6 类选中态死类已实测归零**（`bg-surfaceHover`/`text-textStandard`/`text-textSubtle`/`border-borderSubtle`/`border-borderStandard`/`text-iconSubtle` → 0 命中）。

但 `docs/archive/dead-classes-snapshot-2026-10-17.txt`（mtime 15:25，**晚于**该文件修复的 15:04）仍把本文件列为 3 个死类的命中文件，且文件实测仍含：
- `border-border` ×3（`:590`、`:607`、`:652`）
- `border-yellow-500` ×1、`bg-red-900` ×1

⇒ **「该文件现零死类」的说法不成立**，需复跑 `python3 scripts/scan-dead-classes.py` 定死口径后再改写。

---

## 📋 进行中 / 待办

### P0（最高优先级，阻塞真机可用）

| 编号 | 事项 | 来源 | 备注 |
|------|------|------|------|
| **P0-1** | **真机验收：WorkBuddy 是否实现 Responses API** | `AUDIT-2026-10-17` §5-E #1 | `global:gpt-6-luna`（同理 `global:gpt-5.6-terra`、`global:gpt-6-sol`）等首次会打 `/v1/responses`，B4 已降级为「首次 404 回落」但首次仍会打。约束禁止打 7863，需用户配合真机测 |
| **P0-2** | **真机验收：1b 的 400 风险（各网关 400 措辞覆盖）** | `AUDIT-2026-10-17` §5-E #4、`FIX-bing` §9.1 #2 | G1 只匹配一组常见措辞（`REFUSAL_TERMS × 主题词`），文案不同时退化成「错误上抛」。⚠️ **1b 没有运行时降级**，已收窄的两处只覆盖「xAI 固定参数族」与「选 off」两种情形，非通用保护 |
| **P0-3** | **真机验收：G1 图像乐观发送在真网关上够不够安静** | `AUDIT-2026-10-17` §5-E #8、`FIX-bing` §9.1 #2 | `cortex run` 无图片入口，需桌面端真机会话+工具返回图片触发 |
| **P0-4** | **死 Tailwind 类全仓库普查清理 + CI 守卫** | `AUDIT-2026-10-17` §4.3、`BUG-REPORT-dead-tailwind-classes.md` | 520 个源文件 → **511 处 / 119 种 / 71 文件**（2026-10-17 15:25 快照口径）。建议方案 A（`main.css` `@theme inline` 补注册别名）优先，再 B（机械替换）。**CI 守卫必须接入**，否则必然复发 |
| **P0-5** | **冷启动不回填 `reasoning`**：`with_endpoint_capabilities` 不回填 | `AUDIT-2026-10-17` §5-C、§5-D | 端点声明了词表但第一、二轮出站都无 effort；`cn:hy4-preview` 类「端点是唯一推理证据」的模型菜单 `[Off]`、出站无字段。修法一行（镜像 `model_config.rs:187-193`）但按边界未改。⚠️ **与 `LESSONS.md` 的「冷启动时序缺陷（已修）」是两码事**，勿混 |

### P1（重要，不阻塞主流程但影响体验）

| 编号 | 事项 | 来源 | 备注 |
|------|------|------|------|
| P1-1 | **`catalog_provider_id` 参与 canonical 查找（OpenCode 系根治）** | `AUDIT-2026-10-17` §2 ①、`SUMMARY` §7.5 | 需改 `name_builder.rs`（乙/丙文件）、TASK 所有权表未授权本轮。模型名 `oc-*` 与目录 `space-bunny-free` 仍对不上，`strip_common_prefixes` 里**没有 `oc-` 前缀**需补 |
| P1-2 | **目录有词表但无「关」的词时 `Off` 仍发 `low`** | `AUDIT-2026-10-17` §1.5 | `cn:glm-5.3-flash` 实测 `Off → "low"`（在 7865 声明型网关上同样实测复现）。比网关闭默型更常见。属产品决策：发最轻档 vs 不发（端点默认可能更多）。影响家族：GLM / kimi-k3 / gpt-5.6-astra |
| P1-3 | **`reasoning: false` 无法表达（三态需求）** | `AUDIT-2026-10-17`、`FIX-bing` §9.1 #5 | 给 `ModelInfo` 加三态是产品决策。名字被启发式认成推理模型、用户想显式关掉时无「关」表示 |
| P1-4 | **`model_capabilities.json` 位置与 UI 清除入口** | `AUDIT-2026-10-17` §5-E #7、`FIX-bing` §9.1 #6 | 当前在配置目录。用户偏好其他位置或希望 UI 可清除需改动 |
| P1-5 | **腐烂测试修复：`declared_vision_registry` 陈旧断言** | `AUDIT-2026-10-17` §3.3 #1 | 断言 `requests.len()==1` 实得 2（GET + POST），多出的 GET 是 B2 既定行为。只数 POST 或排除 GET |
| P1-6 | **腐烂测试修复：`goose-doc-guide` 死断言** | `AUDIT-2026-10-17` §3.3 #2、`SUMMARY` §8 表**第 12 行** | 该技能被 `crates/cortex/src/skills/builtin.rs:9-13` 刻意过滤（文件 stem 是 `goose_doc_guide`）。改为断言 `web-search` |
| P1-7 | **腐烂测试修复：`code-mode` 导致 fixture 预算超时** | `AUDIT-2026-10-17` §3.3 #3 | `acp_server_test::test_new_session_uses_current_config_mode`，fixture 5 秒预算（`acp_fixtures/server.rs:430`）没算 code-mode 运行时初始化。响应顺序是被测不变量。需放宽预算或拆分 fixture |
| P1-8 | **`cortex-cli/src/logging.rs:55` 改名遗留** | `AUDIT-2026-10-17` §3.3 末尾 | 断言日志路径含 `"goose"`，`crates/cortex/src/config/paths.rs:22` 已是 `"cortex"`。一行字面量 |
| **P1-9** | **G2 提示位置：桌面端底栏是否也需要** | `FIX-bing` §9.1 #4、`AUDIT-2026-10-17` §5-E #6 | 当前只在 ACP option description。`ThinkingEffortControl.tsx` 底栏要不要同一句话**取决于真机观感**，尚未决策 |
| **P1-10** | **developer 角色修复的真机验收** | `refactor-plan.md` §4.11 末条 | 装上新版后用真实 `custom_siliconflow`／workbuddy 系模型发消息**不再 400**、底栏思考档位仍可调。⚠️ 单测与本地假端点**不能替代真实端点结论** |
| **P1-11** | **`session_naming` 3 例回归测试从未运行** | `refactor-plan.md` §4⑨ + §4 末条 | 因 `debug/` 目录整个消失（原因不明）跨 4 轮**未编译未运行**。补跑需单独授权（release profile 有再次触发 v8 build script 破坏性清理的风险）。⚠️ **不得据此声称该测试已通过** |

### P2（技术债、长期维护）

| 编号 | 事项 | 来源 | 备注 |
|------|------|------|------|
| P2-1 | **其余中转站 `/v1/models` 核查** | `BUG-REPORT-…pipeline` Gap D、`FIX-bing` §9.2 | `custom_lite-gpt`(vortexapi.xyz)/`custom_chatanywhere`/`custom_siliconflow` 需用户 API key，用户决定推迟。G1 已摊平风险（核查结果只影响「第一次是否浪费一次请求」，不影响功能） |
| P2-2 | **测试隔离漏洞：`GOOSE_PATH_ROOT` 不隔离 `~/.agents/skills`** | `AUDIT-2026-10-17` §3.4 | `crates/cortex/src/skills/mod.rs:401` 用 `dirs::home_dir()`。技能类测试读开发者真实家目录（`sources::tests::list_sources_lists_builtin_skills_without_upstream_doc_guide` 失败的真因是自装 `~/.agents/skills/web-search` 顶掉内置，`discover_skills` 的 `seen` 去重）。以后写技能测试要么隔离 HOME 要么别依赖 builtin |
| P2-3 | **`cargo clippy --all-targets` 跑不通的分支既有问题** | `AUDIT-2026-10-17` §6 | 不加 feature 编译错误（`agents/state_machine/tests/` 24 个）、加了撞 `E0432: unresolved import cortex::acp::transport`（`acp/mod.rs:12` 带 `#[cfg(feature = "acp-http")]`）。⚠️ 时间线：`refactor-plan` §4④（2026-10-15）曾全绿，2026-10-17 又跑不通，状态反转源自改名引入的 feature 门控 |
| P2-4 | **真实 `~/.config/goose` 时间戳已变更** | `FIX-yi` §7.8 | 实测 `2026-10-16 15:33:19.319533114 +0800`（`~/.config/cortex` 为 `15:41:44.329279483`），判定为**用户手工改配置**、非构建回归。需确认是否修订硬边界记录（基线仍写 `2026-10-09 17:56:19`）或清理现场 |
| P2-5 | **不要用 `git stash` 做局部回退（改名未提交状态）** | `AUDIT-2026-10-17` §7、`refactor-plan` §0 | 会把文件整个撤走留 unmerged 索引。已记一次事故并复原 |
| P2-6 | **工作区残留 + 已知 flaky 测试** | `FIX-jia` §7.3、`FIX-bing` §8.1/§8.2 | ① 残留 `crates/cortex/src/agents/snapshots/cortex__agents__prompt_manager__tests__all_platform_extensions.snap.new`（gitignore，来自 `prompt_manager` 快照测试）；② `providers::gemini_cli::tests::initial_prompt_is_sent_on_stdin` 本机负载下偶发抖动；③ `CustomProviderForm.test.tsx` 两个 ~4.4~5.0s 临界用例在默认 5s 下**假失败（超时非断言）**，需 `--testTimeout` |
| P2-7 | **token 优化线** | `refactor-plan.md` §0 token 段、§5 | **第一批已上线并进正式安装包**：`tree` 加 `OUTPUT_LIMIT_BYTES=50_000` 行边界截断（+2 例回归）、`compaction.md` 改为「最短可续接摘要」。**第二批已排期、未获批准**：chatrecall 逐条上限、image 缩放、缓存感知压缩。明确不在范围：缓存参数/命中、DeepSeek 原生 hit/miss、GPT-6 断点 |

---

## 🐛 已知遗留 Bug（有 BUG-REPORT 但无 FIX 对应解决）

| 编号 | Bug | 状态 | 说明 |
|------|-----|------|------|
| BUG-1 | **`api_key_env: null` 仅解决了这一种坏文件，真正语法错误的 JSON 依然拖垮整张注册表** | 方案 B/C 未做 | `FIX-jia` §2.3 已标注：按边界未做。`load_custom_providers` 用 `.collect::<Result<Vec<_>>>()`，单文件失败即全灭；且错误只在 `tracing::warn!` 里，**GUI 用户看不到**。需坏文件跳过+错误对用户可见 |
| BUG-2 | **GUI 进程读不到 `systemctl --user set-environment` 的变量** | 已定位，环境问题 | `FIX-jia` §4、`SUMMARY` §6 #6、`BUG-REPORT-…null-api-key-env.md` §4。实测：`~/.config/environment.d` 有、`systemctl --user show-environment` 有、**`/proc/<pid>/environ` 无**。✅ **可行解：从带该变量的环境启动 GUI 窗口（`AUDIT` §4.1 实测，不必注销重登）**；注销重登亦可 |
| BUG-3 | **`goose-doc-guide` 技能被刻意过滤但集成测试断言要求它出现** | 死断言待改 | `AUDIT-2026-10-17` §3.3 #2。不需要产品决策，改断言即可 |
| BUG-4 | **全仓库死 Tailwind 类（70+ 文件未动）** | 待办已立项 | `BUG-REPORT-dead-tailwind-classes.md`、脚本 `ui/desktop/scripts/scan-dead-classes.py`。单测发现不了，需人工过 onboarding/设置页截图。⚠️ **511 处/119 种/71 文件是快照口径，含已修的 `CustomProviderForm.tsx`**；精确剩余数待复跑 |
| BUG-5 | **探测缓存 400 措辞覆盖不全** | 仅匹配常见组合 | `FIX-bing` §9.1 #2/3。措辞不在 `REFUSAL_TERMS × 主题词` 的笛卡尔积里会退化成错误上抛 |
| BUG-6 | **图像降级分支未过真实二进制** | 仅 wiremock 覆盖 | `FIX-bing` §9.2。`cortex run` 无图片附件入口 |

---

## 📊 关键指标仪表盘

| 指标 | 当前值 | 目标 | 趋势 |
|------|--------|------|------|
| 自定义供应商能力管线覆盖率 | ~90%（WorkBuddy 全通、OpenCode 靠 workaround） | 100%（含 OpenCode 系根治） | ↗️ |
| 死 Tailwind 类数量 | **0**（2026-10-17 第五轮清理；修正口径后真实 394 处 / 85 种 / 60 文件） | 0 | ✅ |
| `cortex --lib` 通过率 | 2276/2284 = 99.6% | 100% | ↗️ |
| 其他测试层 | `cortex-cli --lib` 352/1；UI vitest 992/21/8；ACP 11 个二进制 8 绿 3 红 | 全绿 | ↗️ |
| 真机验收完成度 | **3/11 已测**（`AUDIT` §5-E 的「已测」档：视觉三态、思考档位出站、workbuddy 切换） | 11/11 | ↗️ |
| 配置隔离合规性 | ✅ 验收/验证会话全程 `GOOSE_PATH_ROOT` 隔离 | 100% | ✅ |
| ⚠️ 上条的唯一例外 | 2026-10-17 `TASK` D10-a 为定决策**直打真 free-lane（8787）5 次**（`SUMMARY` §7.5）。端口在 `AGENTS.md` §1.2 回避名单内，但该次探测发生在主会话 | — | — |

---

## 🔄 下一步行动建议

1. **立即**：用户配合完成 P0-1~P0-3 真机验收（需真机访问 7863/8787）
2. **本周**：启动 P0-4 死类清理（方案 A 优先，接入 CI）、修 P0-5 冷启动 `reasoning` 回填（一行镜像）
3. **下周**：P1-1 `catalog_provider_id` 接入 canonical（需 TASK 授权）、P1-2 产品决策 Off 语义
4. **补漏**：P1-9 / P1-10 两条真机观感与验收项；P1-11 的 3 例测试需授权补跑
5. **持续**：P2 类技术债在重构窗口期逐步清理

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
