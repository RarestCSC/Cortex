# 新核心上下文文档交叉审计报告

> **审计对象**：`docs/ARCHITECTURE.md`、`docs/PROGRESS.md`、`docs/LESSONS.md`、`docs/TECH-DEBT.md`、`docs/AGENTS.md`（含 `docs/README.md`、`docs/archive/README.md`）
> **对账基线**：`docs/archive/` 全部 15 份历史文档 + 项目代码库实测（分支 `composer-ui-refactor` / HEAD `3bd8520`）
> **审计日期**：2026-10-17　**审计方式**：只读。未修改任何文件（除本报告）。
> **覆盖维度**：① 新旧文档对账 ② 文档与代码对账 ③ 新文档内部一致性

---

## 0. 总体结论

| 维度 | 结论 |
|------|------|
| 能力管线主线（C1–C5 / A·B·G 组 / Off 兜底 / ACP 解锁） | **覆盖良好**，编号体系、验收口径、文件归属大体准确 |
| 死 Tailwind 类 | **存在事实性错误**（见 S4），数字被跨文档复用且自相矛盾 |
| 代码路径映射表 | **3 处符号归属错误 + 1 处非函数**（见 S3） |
| `AGENTS.md` 规则集 | **2 条规则指向不存在的路径/依赖**（见 S1、S2） |
| 章节交叉引用 | **4 类引用失效**（§9.1/§9.2/§7.8/§4-C 在 `AUDIT-2026-10-17.md` 中不存在） |
| 编号体系 | **2 处命名空间冲突**（PROGRESS D1–D19 vs TASK D1–D10；「冷启动 B2 失效」标签碰撞） |
| `refactor-plan.md` 承接 | **§2「不能承诺的事」覆盖率 0%**，打包/环境 runbook ≈15%，§1「已实现勿重做」≈10% |

**严重错误 13 项，遗漏补充 20 项，格式与逻辑建议 12 项。**

---

# 1. 严重错误（必须修正）

## S1 🔴 `AGENTS.md` §3.2 的 `ui/desktop/src/api` 规则指向不存在的路径（幻觉）

**证据**
```
$ ls ui/desktop/src/api                     → 不存在
$ git ls-tree -r HEAD | grep '^ui/desktop/src/api/'  → 0 命中
$ grep -rn "src/api\|openapi-ts\|hey-api" docs/archive/*.md  → 0 命中
```

**问题**：`AGENTS.md` §3.2 写「**禁止** import `ui/desktop/src/api` 下的生成 OpenAPI 类型」与「**禁止**重建 `ui/desktop/src/api` 或加 `@hey-api/openapi-ts`」。该路径在工作区、git HEAD、**以及全部 15 份归档文档中均无任何出处**——是一条凭空产生的规则。

**附带事实冲突**：`@hey-api/openapi-ts` 早已存在，且是既有依赖：
```
ui/acp-client/package.json:47   "@hey-api/openapi-ts": "^0.99.0",   ← devDependencies
```

**修正建议**
- 删除 `ui/desktop/src/api` 两条，改为真实路径 `ui/acp-client/src/generated/`（该目录已核实存在，且 `FIX-jia` §3.2 核对过与 `crates/cortex/acp-schema.json` 逐字节一致）。
- openapi-ts 那条限定范围：「**不得在 `ui/desktop` 引入** `@hey-api/openapi-ts`」（`ui/acp-client` 作为 schema→TS 生成器保留它）。

---

## S2 🔴 `AGENTS.md` §5 文件所有权表列出不存在的文件 `cortex-provider-types/src/declarative.rs`

**证据**
```
$ find crates -name declarative.rs
crates/cortex-providers/src/declarative.rs
crates/cortex-providers/examples/declarative.rs
```

**问题**：`AGENTS.md` §5 连续两行列出
```
| cortex-provider-types/src/declarative.rs | 甲 | C5 已修 |   ← 该文件不存在
| cortex-providers/src/declarative.rs      | 甲 | C5 已修 |   ← 真实文件
```

**这条错误是"已知错误被重新引入"**：`BUG-REPORT-custom-provider-null-api-key-env.md` §3/§7 与 `TASK` 甲的 Write Scope 都写了 `crates/cortex-provider-types/src/declarative.rs:155-156`，`FIX-jia` §9 已明确勘误（「该文件不存在；结构体在 `crates/cortex-providers/src/declarative.rs`」）。新文档把已被勘误的错误路径抄了回来。

**修正建议**：删除该行。风险是后续会话按所有权表去改一个不存在的文件。

---

## S3 🔴 `ARCHITECTURE.md` §2.1「功能-代码路径映射表」4 处符号归属错误

逐条实测结果（grep 全 `crates/`）：

| 表中写法 | 实测结果 | 实际位置 |
|----------|----------|----------|
| `crates/cortex-provider-types/src/formats/openai_responses.rs` → `should_use_responses_api_for_provider` | ❌ **该文件里没有** | `crates/cortex-providers/src/openai.rs:708`（同文件 `:491` 是 `should_use_responses_api`）；全仓仅此两处定义 |
| `crates/cortex-providers/src/openai.rs` → `OpenAiProvider::{with_endpoint_capabilities, declared_capabilities}` | `with_endpoint_capabilities` ✅ / `declared_capabilities` ❌ | `declared_capabilities` 在 `crates/cortex/src/config/declarative_providers.rs:439` |
| `crates/cortex/src/config/declarative_providers.rs` → `apply_declared_capabilities` | ❌ 该文件无此函数 | `crates/cortex/src/model_config.rs:169`（**已在同表第 1 行正确列出**，此处重复且归属错） |
| `crates/cortex-provider-types/src/formats/openai.rs` → `accepts()` | ⚠️ **不是函数** | 是 `openai_reasoning_effort_for_endpoint` 内的局部闭包，`openai.rs:2033-2040`，未导出、不可从外部引用 |

**已核实正确的部分**（无需改动）：`base_model_config_from_user_config`、`sends_thinking_effort`、`endpoint_capabilities`、`reasoning_effort_is_fixed`、`create_request_for_model_with_options`、`openai_reasoning_effort_for_endpoint`、`EndpointModelCapabilities`/`ProbeCache`/`word_for`、`map_to_canonical_model`/`strip_realm_prefix`/`infer_provider_stripping_realm`、`vision_support`/`should_use_responses_api`、`publish_declared_capabilities`、`thinking_effort_values`/`current_thinking_effort_value`/`assert_menu_and_payload_agree`、`custom_provider_models`/`update_custom_provider`、`load_custom_providers`/`null_to_empty`、`should_retry`、`ThinkingEffortSupport`；以及全部 16 个 Rust 路径 + 5 个 UI 路径 + `canonical_models.json`（**8279 条**已实测确认）。

**修正建议**：按上表逐格改正；`accepts()` 一格改写为「`openai_reasoning_effort_for_endpoint` 内的 `accepts` 闭包（`openai.rs:2033-2040`）」。

---

## S4 🔴 「`CustomProviderForm.tsx` 已清零死类」与项目自己的扫描快照矛盾

**证据链**
```
CustomProviderForm.tsx      mtime = 2026-10-17 15:04:45   （死类修复已完成）
dead-classes-snapshot-…txt  mtime = 2026-10-17 15:25:53   （快照晚于修复 21 分钟）
```
快照（扫描头 `SCANNED_FILES=520 TOTAL=511 KINDS=119 FILES_AFFECTED=71`）**仍把该文件列为 3 个死类的命中文件**：

| 死类 | 快照行 | 快照记录 |
|------|--------|----------|
| `border-border` | :12 | `10 处 / 4 文件`，文件列含 `…/forms/CustomProviderForm.tsx` |
| `border-yellow-500` | :21 | `4 处 / 3 文件`，文件列含 `…/forms/CustomProviderForm.tsx` |
| `bg-red-900` | :40 | `2 处 / 2 文件`，文件列含 `…/forms/CustomProviderForm.tsx` |

**当前文件实测仍含**：`border-border` ×3（`CustomProviderForm.tsx:590, 607, 652`）、`border-yellow-500` ×1、`bg-red-900` ×1。

已核实为**真修好**的部分（这 6 个确实归零）：`bg-surfaceHover`、`text-textStandard`、`text-textSubtle`、`border-borderSubtle`、`border-borderStandard`、`text-iconSubtle` → 当前文件全部 0 命中。

**影响三处「已清零」声明**：`PROGRESS.md` D15、`TECH-DEBT.md` §1.3、`ARCHITECTURE.md` §4（"CustomProviderForm.tsx 已清零"）。

**衍生矛盾**：`PROGRESS.md` BUG-4 写「全仓库 511 处死类（**除 CustomProviderForm.tsx 外** 70 文件未动）」——若该文件已清零，则 511 处与 71 文件都是**修复前**的口径，却被当作**当前待办**口径在 `PROGRESS` 仪表盘、`TECH-DEBT` §1.1/§5、`ARCHITECTURE` §2.2/§4 中复用。

**修正建议**：
1. 三处"零死类"改为「**15 处选中态死类已换**；快照仍记录本文件 3 类死类（`border-border`/`border-yellow-500`/`bg-red-900`），需复跑 `scan-dead-classes.py` 确认」。
2. 511/119/71 明确标注为「2026-10-17 15:25 快照口径」，并补上分母 `SCANNED_FILES=520`。
3. 若快照确为修复前生成，重新生成快照并刷新所有引用数字。

---

## S5 🔴 对 `AUDIT-2026-10-17.md` 的章节引用大面积失效

实测该文件章节结构：`§0 / §0.1 / §1(1.1-1.5) / §2(①②③+建议) / §3(3.1-3.4) / §4(4.1-4.4) / §5(A,B,C,D,E) / §6(6.1) / §7 / §8` —— **没有 §9，§7 无子节，§4 无字母子节**。

| 新文档中的引用 | 出现位置 | AUDIT 实际章节 | 真实出处 |
|----------------|----------|-----------------|----------|
| `AUDIT §9.1` | `PROGRESS.md` P0-2、BUG-5；`LESSONS.md` §7 表 | ❌ **不存在** | `FIX-bing-capability-wiring.md` §9.1 |
| `AUDIT §9.2` | `PROGRESS.md` BUG-6 | ❌ **不存在** | `FIX-bing` §9.2 |
| `AUDIT §7.8` | `PROGRESS.md` P2-4；`LESSONS.md` §7 表；`AGENTS.md` §1.1、§7-5 | ❌ **不存在**（§7 只有"配置读写"一个子节） | `FIX-yi-reasoning-effort-honesty.md` §7.8 |
| `AUDIT §4-C` | `PROGRESS.md` P0-5 | ❌ **不存在**（§4 只有 4.1-4.4） | 同文件 `### C.`（第 459 行，隶属 §5） |

**核实有效的引用**（无需改）：`§1`、`§1.5`、`§2`、`§3`、`§3.3`、`§3.4`、`§4.2`、`§4.3`、`§4.4`、`§5-D`、`§5-E`、`§6`。

**旁证**：`AGENTS.md` §1.1 写「审计 §7.8 发现该目录已被用户手工改为 15:33」——实测 `~/.config/goose` mtime = `2026-10-16 15:33:19.319533114 +0800`、`~/.config/cortex` = `2026-10-16 15:41:44.329279483 +0800`，**内容判断正确，只是出处标错**。

**修正建议**：把上表 4 类引用改指真实出处；`PROGRESS.md` P0-5 的 `§4-C` 改为 `§5-C`。

---

## S6 🔴 ACP 集成测试二进制数量：同一批新文档内三处不一致

**实测**：`crates/cortex/tests/` 下 `acp_*_test.rs` 共 **8 个**；`AUDIT` §3.2 实测表另外含 `session_id_propagation_test` / `custom_provider_command_auth_test` / `declared_vision_registry` ⇒ **合计 11 个测试二进制，3 个失败**。

| 位置 | 写法 | 判定 |
|------|------|------|
| `PROGRESS.md` 仪表盘 | 「**8/11** 二进制全绿，3 个有已知失败」 | ✅ 正确 |
| `ARCHITECTURE.md` §4 | 「ACP 集成测试 \| **8 个二进制**，3 个失败已分类」 | ❌ 应为 11 |
| `TECH-DEBT.md` §4 | 「ACP 集成测试 \| **8 个二进制**跑通」 | ❌ 应为 11 |
| `PROGRESS.md` D13 验收 | 「**8 个二进制**跑通、暴露 3 个从未执行的失败已分类」 | ❌ 应为 11（且**与同文件仪表盘自相矛盾**） |

**修正建议**：三处统一为「**11 个测试二进制 / 8 绿 3 红**」。

---

## S7 🔴 「冷启动 B2 失效」标签碰撞：已修的教训 vs 未修的 P0 同名

| 出处 | 描述的问题 | 状态 |
|------|-----------|------|
| `LESSONS.md` §3（以「【最终解决方案】双修法」格式呈现） | `FIX-bing` §7.1 冷启动**时序**缺陷：`ModelConfig` 同步构造 vs `/v1/models` 异步 HTTP | ✅ **已修**（声明侧 `declared_capabilities()` 直读文件+memoize；出站侧 `with_endpoint_capabilities()` 折进早产 config） |
| `PROGRESS.md` **P0-5** / `TECH-DEBT.md` §3.1 | `crates/cortex-providers/src/openai.rs:344` 的 `with_endpoint_capabilities()` **只折进 `endpoint_capabilities` 与默认档位，不回填 `reasoning`**（实测已确认该函数体 344-369 行确无 `reasoning` 回填），而闸门 `sends_thinking_effort()` 只看 `reasoning` | ⏸ **未修，P0** |

**危害**：读者按 `LESSONS.md` 会认为 P0-5 已闭环。

**修正建议**：前者改名为「**冷启动时序缺陷（已修）**」，后者改名为「**冷启动不回填 `reasoning`（P0，未修）**」；并在 `PROGRESS.md` P0-5 备注加一句「≠ `LESSONS.md` 同名那条」。

---

## S8 🔴 `PROGRESS.md` D1–D19 与 `TASK` D1–D10 编号空间完全错位

| 号 | `TASK-fix-…md` 里的含义 | `PROGRESS.md` 里的含义 |
|----|------------------------|--------------------------|
| D1 | `formats/openai.rs` 授权给丙 | `api_key_env: null` 修复 |
| D2 | Dependency 要等甲和乙 | 视觉三态可逆 |
| D3 | `reasoning` 不可逆 bug，B1 必撞 | A1 正则纳入 `:` |
| D4 | B1 注入顺序 | A2 判定合一 |
| D5 | D5-a/b/c/d 移交四点 | B1 声明接入 |
| D6 | ACP 集成测试 panic（= `PROGRESS` **D13**） | B2 消费 `/v1/models` |
| D7 | 判据必须改 | B3 词表映射 |
| D8 | lint 命令跑不通（= `PROGRESS` **P2-3**） | B4 路由闸门 |
| D9 | Gap A/B/C/D（= `PROGRESS` **P0-4/D9/P2-1**） | G1 探测兜底 |
| D10 | 真机探测 + 三元组 bug（= `PROGRESS` **D12**） | G2 沉默提示 |

**危害**：任何「D6 已修 / D6 未修」的引用在新语境下都有歧义。`docs/archive/` 原始材料中的 `D 组四个覆盖缺口` 实际编号是 **Gap A/B/C/D**（等价 `TASK D9-A~D`），也**不是** D1–D4。

**修正建议**：`PROGRESS.md`「已完成」表头加注「本表 `D#` 为本项目自定交付序号，**与 `TASK-fix-…md` 的 `D#`、与 `BUG-REPORT-…pipeline.md` 的 `Gap A–D` 无关**」。

---

## S9 🔴 `PROGRESS.md` 仪表盘「真机验收完成度 4/9 项已测」数字无依据

实测 `AUDIT` §5-E 结构：

| 分档 | 条目 | 已测数 |
|------|------|--------|
| 「用户一定要测」 | **#1, #2, #3, #4** | 0 |
| 「已测（留结论，别重测）」 | **原#3, 原#4, 原#9** | **3** |
| 「测了更好」 | **#5, #6, #7, #8** | 0 |
| 合计 | **11 行**（编号 #1–#9 混用） | **3** |

**问题**：分子写 **4**（实际 3），分母写 **9**（编号去重勉强可辩，但行数是 11）。该指标作为"下一步行动建议"的依据，口径不准。

**修正建议**：改为「**3/11 已测（§5-E）**」或给出编号去重口径「**3/9**」并注明分母定义。

---

## S10 🔴 `PROGRESS.md` D14 把 workaround 记为「已完成」，未标注「根治未做」

**文档写法**：`D14 | OpenCode 免费模型思考强度修复（配置改 + 代码改） | 验收：隔离根端到端验证：max→"max"、off→不发字段`

**实际口径**（`AUDIT` §4.4、`SUMMARY` §8 行 1、`refactor-plan` L79-81）：
- 采用手段是**手写 `"reasoning": true`** 到 `custom_cortex-free-opencode.json` 的 3 个模型 ⇒ 原文明确称其为「**workaround，不是修复**」
- 根因（`catalog_provider_id` 不参与 canonical 查找；`name_builder.rs` 的 `strip_common_prefixes` 24 个前缀里**没有 `oc-`**）**未修**
- 「视觉不需要代码改动」是**另一个结论**，不是 D14 的验收项

**矛盾面**：同文件 `P1-1` 与 `TECH-DEBT.md` §3.5 都明确说根治未做，D14 行本身却无「workaround」字样。

**修正建议**：D14 事项名加「**（workaround）**」，验收列补「根因 `catalog_provider_id` 未修，见 P1-1」。

---

## S11 🔴 `PROGRESS.md` D18 的真机验收缺口未进任何待办清单

**`refactor-plan.md` §4.11 末条原文**：
> ⚠️ **仍待用户验收**：装上新版后用真实 `custom_siliconflow`／workbuddy 系模型发消息不再 400、底栏思考档位仍可调 —— **单测与本地假端点不能替代真实端点结论**
> ⚠️ **未执行 sudo 安装**，已安装的仍是旧版 `58a96940…`

**`BUG-REPORT-developer-role-rejected.md` §6 第 5 项**：端到端（需用户配合）**未执行**。

**现状**：`PROGRESS.md` D18 验收只写「本地假端点 A/B 验收绿」；`P0-1~P0-5`、`P1-1~P1-8`、`P2-1~P2-5`、`BUG-1~BUG-6`、仪表盘真机清单 —— **全部没有这一条**。

**修正建议**：新增 `P1-9` 或把 D18 验收改为「代码已落地 + 假端点 A/B 绿；**真机（装新版后不再 400、档位可调）待用户验收**」。

---

## S12 🟠 `PROGRESS.md` D1 验收口径漏掉两条未做的验证

**`FIX-jia` §7.4「未做的验证」原文**：
> - **C5 报告测试计划第 5 条的 `cortex doctor` 端到端未跑** —— 需要 `cortex-cli` 的 290MB 链接
> - **未做真机验收**：单元测试与假数据对真实端点的结论没有任何证明力

**现状**：D1 验收列写「单测绿、集成测试绿、假端点验证通过」，未标注 `cortex doctor` E2E 与真机验收未做。

**修正建议**：D1 验收补「`cortex doctor` 端到端未跑（需 cortex-cli 290MB 链接）；真机验收未做」。

---

## S13 🔴 `PROGRESS.md` 仪表盘「配置隔离合规性 ✅」遗漏 D10-a 这个唯一例外

**`TASK` D10-a / `SUMMARY` §7.5 原文**：
> 2026-10-17，本轮唯一一次发真实请求。**这次为定一个决策直接打了真 free-lane（`127.0.0.1:8787`），共 5 次请求。**
> 实测：`low`→200/22 reasoning_tokens、`max`→200/**62**、`xhigh`→200/26、`minimal`→200/15、乱值 `banana`→**400**

`SUMMARY` §10 同时写「全程未发任何真实模型请求」—— **该文档自相矛盾**（§7.5 推翻了 §10）。

**现状**：`PROGRESS.md` 仪表盘「配置隔离合规性 \| 全程 `GOOSE_PATH_ROOT` 隔离，真实配置未触碰 \| ✅」与 `AGENTS.md` §1.2「**全程不发任何真实模型请求**」均未记录这个例外，读者会以为连真网关探测都没做过。

**注意**：`8787` 端口确在 `AGENTS.md` §1.2「刻意避开」名单里 ✓，但那条约束针对的是**验收会话**，D10-a 是**主会话的决策性探测**，性质不同。

**修正建议**：`AGENTS.md` §1.2 增补例外说明（「唯一已记录的例外：2026-10-17 D10-a 对 8787 的 5 次决策性探测，实测表见 `SUMMARY §7.5`」），`PROGRESS.md` 仪表盘备注同一句。

---

# 2. 遗漏补充（建议添加）

> 以下均为归档文档中有价值、但**未进入新 5 文档**的内容。按危害排序。

## O1 🔴 `session_naming` 3 例回归测试至今未编译未运行（跨 4 轮）

`refactor-plan.md` §4⑨ 末条 + §4 末条：
> ⚠️ **历史未执行项**：其 **3 例新回归测试未编译未运行** —— 当时 `debug/` 目录整个消失（仅删过 `debug/incremental`，**无法完全解释为何整个 debug 消失，不编原因**）
> 在 release profile 跑测试有**再次触发 v8 build script 破坏性清理**的风险；**本次只补跑了 OpenAI 格式层定点测试，不能据此声称 session_naming 测试已通过。补跑需单独授权**

`PROGRESS.md` 的「已完成」表与仪表盘均**未提及这个测试盲区**。

**建议**：新增 `P1-x`「`session_naming` 3 例回归未运行（补跑需单独授权，release profile 有触发 v8 破坏性清理风险）」，并在 `TECH-DEBT.md` §2 记录 `debug/` 目录消失事故。

## O2 🔴 `cortexServe.ts` 丢弃所有后端 `warn!` 的可诊断性架构缺陷

`refactor-plan.md` §4.9：
> 原 `cortexServe.ts` 的 `onStderrData` **只把 `isFatalError`（`panicked at`/`RUST_BACKTRACE`/`fatal error`）落 main.log，所有 `warn!`/`error!` 级后端日志一律丢弃** —— 「这就是本次根因查了两轮的直接原因」。现新增 `isBackendDiagnostic` 落 `logger.warn`，`Logger` 接口加**可选** `warn?`。

这是**会复发的架构级缺陷**（下次同类问题仍查不到根因），已修但作为教训完全丢失。

**建议**：写入 `LESSONS.md` §5，并在 `AGENTS.md` §3.1「日志」条目补一句规则。

## O3 🟠 剥图占位文案诚实性修复无跟踪项

`BUG-REPORT-custom-provider-vision.md` §7 附带项：
> **附带诚实性修复**：无论哪层判定失败，剥图提示应如实报告归属：「已按缓存/配置剥离图片（可在设置中修改该模型能力）」，**而非一律归因于「模型不支持视觉」**

**状态不明**：`FIX-bing` §2.4 称 `refactor-plan` §0.3 ③② 已改为 `image input is turned off for this model`，但该文案在**新 5 文档中 0 命中**；`FIX-bing` 同时强调「**它在三个 format 层各有一份并被测试断言**」——这条防回退约束也丢失了。

**建议**：`TECH-DEBT.md` §2 补一条「剥图占位文案约束：三处 format 层各一份且被测试断言，改文案须同步三处」。

## O4 🟠 `capability_model_name` 双名分叉隐患

`FIX-yi` §7.5：
> ⚠️ `create_request_for_model_with_options` 的 `capability_model_name` **允许与 `model_config.model_name` 不同**（`openai_compatible::stream_for_model`、databricks 路由）。**effort 闸门现在用 `model_config.model_name`**，而 `openai_reasoning_for_model()` 查 catalog 仍用传入名。现有调用方都用同一模型名构造 config，**未观察到差异**；若日后出现真正传不同能力名的 provider，**需重新评估**

实测 `capability_model_name` 确实存在（`formats/openai.rs:1774`、`openai_responses.rs:630`、`providers/bedrock.rs:981`）。

**建议**：写入 `AGENTS.md` §2.1（该节已讲"不要改这两个函数"，但没讲这条分叉）。

## O5 🟠 第二张 provider 白名单未记录

`AGENTS.md` §2.7 只列了 `PROVIDERS_NEEDING_STANDARD_CHAT_PARAMS`（`nearai`/`pleumrouter`，实测 `openai.rs:527` ✓）。另一张仍存在且仍生效：
```
crates/cortex-providers/src/openai.rs:538
const PROVIDERS_NEEDING_REASONING_EFFORT_MAPPING: &[&str] = &["meta"];
```
**建议**：`AGENTS.md` §2.7 补这一张。

## O6 🟠 「部署前要知道的行为变更」5 条整条丢失

`FIX-bing` §9.3 / `refactor-plan` §0-7：
1. `custom_*` 写 `"reasoning": true` 就开始收 `reasoning_effort`
2. `supports_vision == None` 开始**乐观发图**
3. realm 前缀模型**第一次多一次 404**
4. **每个声明式 provider 实例多一次 `GET /v1/models`（5 秒超时，失败静默）** ← 最易被用户察觉的一条
5. 端点级能力 400 **不再重试 3 次**（此前「4 个请求里 3 个是白费的」）

**建议**：`AGENTS.md` §2 新增「部署前行为变更」小节。这是升级到新版时最需要提前告知用户的清单。

## O7 🟠 G1 缓存键的精确算法丢失（后续维护必踩）

`FIX-bing` §4.2/§4.3/§4.4：
- `base_url` 用 **host + 请求路径**（`api_client.host()` 与 `base_path` 拼成 `…/v1/chat/completions`），**不是用户填的 `api_url`** —— 同一家网关两个配置项指向同一端点时**必须共享结论**
- **末尾斜杠归一化**（`http://a/v1` 与 `http://a/v1/` 是同一把键）
- **三级粒度不同**：`supports_responses_api` 按端点存（与模型无关）；`supports_vision` / `supports_thinking_effort` 按 `base_url + 模型` 存
- `version` 字段读到不认识的值就**当空缓存**，不把来历不明的结构解释成结论
- **只在探测得出结论的那一刻写**，整文件读-改-写（进程内 `Mutex` 后面）
- **默认关闭**（`capability_cache: None`），只有生产路径经 `openai_def.rs:223` 注入 —— 已实测确认 `openai.rs:218` 为 `capability_cache: None`、`openai_def.rs:223` 注入
- 过期后重新乐观一次，代价是**每 30 天一次错误请求（不计费）**

新文档只有「键 = `base_url` FNV-1a-64 哈希 + 模型名」（`AGENTS.md` §2.6 / `ARCHITECTURE.md` §2.3），其余全丢。

## O8 🟠 G2 的三态措辞纪律（反撒谎约束）丢失

`FIX-bing` §6：
> 端点**问了并答了**（哪怕答的是空）→ 原文案；端点**被问过、且什么都没声明** → 原文案 + 可操作提示；**从没问过**（内置供应商等）→ 原文案。
> ⚠️ **不能把「没问」说成「它不声明」，那是另一种撒谎**

配套（§7.1）：`endpoint_capabilities: None`（**没人问过**）与「有记录但全 `None`」（**问了，它没说**）在语义上被区分开。

`PROGRESS.md` D10 与 `ARCHITECTURE.md` §2.2 只说「端点沉默时菜单给可操作提示」，**三态区分本身没有记录**。

## O9 🟠 `AUDIT` §5-E #6「G2 提示在桌面端底栏是否也需要」完全丢失

`FIX-bing` §9.1 第 4 条 + `AUDIT` §5-E #6：
> 目前只在 ACP option description。**桌面端底栏（`ThinkingEffortControl.tsx`）是否需要同样一句话，要看真机上的实际观感**

新文档把 G2 一律记作"已完成"（`PROGRESS.md` D10），**未决策的开放项丢失**。

**建议**：`PROGRESS.md` P1 增一条；`ARCHITECTURE.md` §2.2 `ThinkingEffortControl.tsx` 行注明「G2 提示当前只在 ACP option description，底栏是否需要待真机观感」。

## O10 🔴 `refactor-plan.md` §2「不能承诺的事」9 类清单覆盖率 0%

原文（`audit.md` §2 与 `refactor-plan.md` §2 强化版）：
> 不能因类型检查或 happy-path 测试宣称闭合：真实 HTTP reasoning/wire、真实凭据 provider/任务、macOS Dock 与跨平台原生窗口、频繁新对话累积空会话的副作用、**完整断线/超时 uncertain 恢复、连接 generation、默认哨兵实际 provider 回读、跨窗口一致性、未保存管理表单放弃确认**。
> 另：`ChatInput.layout.test.ts` **仅 AST 结构契约**、`NavigationPanel.test.tsx` 为 **mock 渲染** —— **测试或标签变化不证明真实 wire**；`ChatInput` 测试存在不等于功能正常。
> 「mock 通过不证明竞态闭合」；「**尚需授权后专门核查 4 项**」。

**这是整份归档材料里最重要的「不许过度宣称」契约，新 5 文档没有任何对应章节。**

**建议**：`AGENTS.md` 新增一节「不可过度宣称」。

## O11 🔴 环境与打包 runbook 覆盖率 ≈15%（高杀伤力陷阱全丢）

`refactor-plan.md` §3 中从未被新文档接住的关键项：

| 类别 | 丢失内容 |
|------|---------|
| 版本 | Node **v24.21.0** / pnpm **12.11.2** / Rust **1.99.0**（`~/.cargo`）；**不要重装、不要 apt cargo 1.75、不要 source hermit** |
| 🔴 高危 | **`serve` 子命令被 `#[cfg(feature = "acp-http")]` 门控**（`cortex-cli/src/cli.rs:47,50`），裁掉该 feature 会让 GUI **静默失败**（`unrecognized subcommand 'serve'`） |
| 🔴 打包 | **`ELECTRON_MIRROR` 必设**，否则卡死在 `SHASUMS256.txt`；**不要加 `packagerConfig.ignore`**（会覆盖 Vite 默认忽略导致依赖解析失败）；`extraResource` 须用相对路径 |
| 打包 | `--targets=@electron-forge/maker-deb` 只出 deb；rpm/flatpak 缺 `rpmbuild`/`flatpak-builder`；产物 `out/make/deb/x64/` |
| 安装 | `sudo apt install ./相对路径.deb` 在 `~` 下报 `E: 命令行中有不支持的文件` —— **是路径不存在，不是包有问题**；同名同版本 **1.54.0 直接覆盖、不必先卸载**；sudo 由用户执行 |
| Rust 构建 | `CARGO_TARGET_DIR=/tmp/opencode/cortex-rust-target` 独立 target；**v8 走 `RUSTY_V8_MIRROR`（默认直连），cargo 拉 git 依赖走 gh-proxy `insteadOf`，两条路径要分清**；**直连失败时先问用户代理开关，不要自行判定镜像可用性** |
| 已装入口 | `/usr/lib/cortex`、后端 `/usr/lib/cortex/resources/bin/cortex`、**上游 Goose 1.54.0 仍在 `/usr/bin/goose`，两者并存**、Electron 43.4.0 |
| 开发态 GUI | `GOOSE_BINARY` / `ENABLE_PLAYWRIGHT` / `PLAYWRIGHT_DEBUG_PORT=9333` / `pnpm run start-gui -- --user-data-dir=…`；`chromium.connectOverCDP` 定点点击（非全量 E2E）；**启动脚本被杀可能留孤儿 backend**；`pkill` 要精确匹配避免误杀安装版 |

**建议**：新增 `docs/BUILD-RUNBOOK.md`，或并入 `ARCHITECTURE.md` §5。

## O12 🟠 改名重构的量化基线与易漏点全丢

`refactor-plan.md` §0.1 / `audit.md` §4.1 中的数字，**新 5 文档 0 命中**：

| 数字 | 含义 |
|------|------|
| **15 个** | `goose*` → `cortex*` 的 crate 数 |
| **593 处** | `goose::` → `cortex::` |
| **776 处** | `goose_xxx::` → `cortex_xxx::` |
| **276 个文件** | 上述改动的文件数 |
| **432 键 / 1626 messages** | i18n 改名与基线 |
| **4 处** | 编译器暴露的漏改（`pub use goose_download_manager as download_manager`；`cortex-providers/src/lib.rs` 花括号内裸模块名 `goose_mode`；`include_str!("../goose_apps/clock.html")` ×2） |
| 312M / 14G→2.2G / 11.9G | 删除 `documentation/`；仓库瘦身；旧目录回收 |

**最关键的一条教训（0 命中）**：
> **易漏点**：`pub use` / `pub use {裸模块名}` 里的 crate 名**不带 `::`**；`include_str!` 路径里的目录名也不会被标识符规则捕获 —— **编译器才会暴露（本次 4 处）**。

## O13 🟠 已知 flaky / 临界慢测试未记录

| 测试 | 来源 | 说明 |
|------|------|------|
| `providers::gemini_cli::tests::initial_prompt_is_sent_on_stdin` | `FIX-bing` §8.1 | 某一轮全量跑失败过一次，单独跑 4/4 通过，再跑全量又通过；`spawn` 子进程，本机负载下的**既有抖动**，非本次引入 |
| `CustomProviderForm.test.tsx` 的 `does not carry credentials…` 与 `clears secrets…` | `FIX-bing` §8.2 | 各耗时 ~4.4~5.0s，**默认 5s 超时把它们顶掉**；加 `--testTimeout=30000` 后 13/0，不加则 12/2。**是超时不是断言失败** |

`TECH-DEBT.md` §2.2 只提了 `ComposerModelPopover.test.tsx` 的 jsdom 520px 断言，未提这两条。**缺了会被误判为回归。**

## O14 🟡 工作区残留未记录

`FIX-jia` §7.3：
> 工作区遗留 `crates/cortex/src/agents/snapshots/cortex__agents__prompt_manager__tests__all_platform_extensions.snap.new`（已被 gitignore，来自某次 `prompt_manager` 快照测试运行，非本次产生）

**建议**：`TECH-DEBT.md` §2 记一行。

## O15 🟡 归档文档中已知的错误引用（防后人踩空 / 重推导）

| 错误引用 | 实情 |
|----------|------|
| `BUG-REPORT-developer-role-rejected.md` **§82** —— 被 `…pipeline.md:249`、`…thinking-effort.md:310`、`TASK:255`、`FIX-yi:8,185,187` 四处引用 | 该文件只有 **125 行 / 8 节**，无 §82。实指 `test_create_request_non_reasoning_model_omits_reasoning_effort`（`FIX-yi:187` 确认） |
| `/tmp/opencode/wb2api-effort-probe/mock_server.py` | `FIX-yi` §9 已勘误：**该目录已不存在，勿再引用** |
| `FIX-yi` §3.2 曾把「1a 会让 B1 白做」列为理由 | **已被自己推翻**（`model.rs:308` 的 `self.reasoning.or_else(...)` 优先采用显式声明） |
| `vision` 方案 B（`custom_` 前缀剥除）已于 2026-10-15 落地 | 故 **C1 不是它的复现** —— 这条防误判根因的勘误丢失 |
| `crates/cortex-provider-types/src/declarative.rs` | 见 **S2**，同一错误在 `AGENTS.md` §5 被重新引入 |
| `audit.md` 的 Rust 行号 | 文首自述「**2026-10-11/12 核对记录，引用后端行为前必须重读源码**；索引不等于运行证据；无真实 HTTP reasoning 抓包」 |

## O16 🟡 分支 / HEAD / 回退目录状态丢失

`refactor-plan.md` §0：
> 源码已迁至 `/home/rarestcsc/Cortex`；分支 **`composer-ui-refactor`**，HEAD **`3bd8520`**；旧目录 `/home/rarestcsc/Goose_test/goose` 源码保留 **651M** 作回退（「如需彻底清理可再删那 651M」）

**实测确认**：分支 `composer-ui-refactor`、HEAD `3bd8520` ✓。新 5 文档**零命中**分支名、HEAD、旧回退目录。`PROGRESS.md` D17 只留「171 项改动逐项核对、git fsck 干净」。

**建议**：`AGENTS.md` §8 启动检查清单补「当前分支/HEAD」与「旧回退目录位置」。

## O17 🟡 明确的「勿改 / 勿追查」指令丢失

`refactor-plan.md` §5 新会话 Prompt 点名的几条防误改指令，新文档均无：

| 指令 | 出处 |
|------|------|
| 「**托盘 GNOME 不显示＝平台问题勿改**」（`Impossible to get basic properties: GDBus.Error`，Electron↔libayatana 属性读取失败） | §0.3 ④ + §5 |
| 「`active_provider=custom_lite-gpt` 是**用户主动添加，非残留，勿追查**」 | §0 |
| 「**图形化配置需求已取消**」 | §0 |
| 「**session_naming 3 例测试未运行，补跑需单独授权**」 | §4 末条 |
| 「未获批准勿做：下一批 token 候选（chatrecall 逐条上限 / image 缩放 / 缓存感知压缩）、rpm/flatpak 打包、删旧仓库源码、自行开窗口、超出定点范围的全量 Rust 测试」 | §5 |

## O18 🟡 「下一步 token 优化」这条线整支丢失

`refactor-plan.md` §0 token 优化**第一批已上线并已进正式安装包**（内嵌 sha256 `b0e98302…`），但新文档零命中：
- `tree` 工具加 `OUTPUT_LIMIT_BYTES = 50_000` 行边界截断 + 独立提示块（新增 2 例回归：大树截断提示、多字节边界）
- `compaction.md` 从「花光长度预算」改为「最短可续接摘要、详细度随复杂度」
- 明确**不在本轮**的范围：缓存参数/命中、DeepSeek 原生 hit/miss、GPT-6 断点、工具对摘要
- **已排期第二批候选**：chatrecall 逐条上限、image 缩放、缓存感知压缩

`PROGRESS.md` 的 P2 类完全没有 token 优化这一支。

## O19 🟡 `refactor-plan` §0.3 实为 8 项，`PROGRESS.md` D16 写「7 项」且内容清单缺失

**§0.3 实际 8 项**：①关于页 ②自定义供应商字段显示不全 ③视觉识别三处 ④托盘 ⑤工作目录分组 ⑥真归档 ⑦会话命名 ⑧扩展描述 i18n。

`PROGRESS.md` D16 只写「侧边栏会话真删除、真归档、工作目录分组、启动加载页等 **7 项**优化」——其中"启动加载页"根本不在 §0.3 的 8 项里（属 §0 的另一条），而 8 项中的「关于页」「托盘」「会话命名」「扩展描述 i18n」全部缺失。

## O20 🟡 i18n 消息总数无基线 + 验证纪律丢失

**丢失的基线**：1626（改名后）→ 1676 → 1679 → **1683**（当前）。`AGENTS.md` §3.2 只写「16 语言×N 键的人工翻译成本要单独评估」，读者**无参照系**判断当前规模。

**丢失的纪律**（`refactor-plan.md` §4）：
- 改文案必须 **`i18n:extract` 生成 en**（不手插键顺序）→ 同步其余 15 语言 → compile → `i18n:check`
- ⚠️ **测试失败必须回旧仓库跑同一用例确认是否既有，不能默认归因本次改动**
- ⚠️ 定点 vitest 须带 `--testTimeout=15000`，否则 5 个慢用例按默认 5s **假失败——非断言失败**
- ⚠️ **Vite 生产构建 mangle 标识符，grep 压缩后 asar 找组件名不可靠**（`StartupSplash` 0 命中）

---

# 3. 格式与逻辑优化

## F1 🔴 `LESSONS.md` §3「冷启动 B2 失效」条目必须拆成两条

与 **S7** 同源，但属排版问题：`LESSONS.md` §3 把 `FIX-bing` §7.1 的**已修**问题写成一条标准「已解决教训」，与 `PROGRESS.md` P0-5 / `TECH-DEBT.md` §3.1 的**未修 P0** 共用同一标签。建议：

```
### 【冷启动时序缺陷（已修）】-【…】-【…】-【双修法…】
### 【冷启动不回填 reasoning（P0，未修）】-【…】-【openai.rs:344 只折 endpoint_capabilities…】-【一行镜像 model_config.rs:187-193；见 PROGRESS P0-5】
```

## F2 🔴 `ARCHITECTURE.md` §1.2 的「三层合并优先级」图与代码实际不符

**实测**（`crates/cortex-provider-types/src/endpoint_capabilities.rs:271`）：
```rust
pub fn lookup(provider_name: &str, model_name: &str) -> ResolvedCapabilities {
    ResolvedCapabilities {
        declared: declared_registry().read()...get(&key)...,
        endpoint: endpoint_registry().read()...get(&key).cloned(),
    }
}
```
→ **`lookup()` 只有 `declared` 与 `endpoint` 两个来源，没有「探测缓存」这一层。**

实际链路（`crates/cortex/src/model_config.rs:176-194`）：
```
用户声明 → 端点自报(supports_reasoning) → 端点有词表但没声明 supports_reasoning ⇒ true → （随后）canonical 回填
```

G1 的 `ProbeCache` 是**完全独立的机制**（`crates/cortex-providers/src/openai.rs:559 probe_cache()`），只在 `vision_support`（:600）、`should_use_responses_api`（:578）、以及降级重试处（:859/:869）被查询，**不在 `lookup()` 优先级链里**。

而 `ARCHITECTURE.md` §1.2 的图把「探测缓存（G1 观测到的直接拒绝）」排在**端点自报之上** —— 这与 `AGENTS.md` §2.6 自己写的「**声明过的能力根本不会走到探测**」方向相反，会让读者以为 G1 结论会压过端点声明。

**建议**：改为两条独立的链，并注明 G1 与 `lookup()` 的关系。

## F3 🟠 `LESSONS.md` §7 冲突表第 1 行数字冲突（4 vs 6）

| 出处 | 数字 |
|------|------|
| `LESSONS.md` §7 表：「实测空集引入 **4 处**回归」 | 4 |
| `PROGRESS.md` D12：「零回归，**6 条既有测试保护**」 | 6 |
| `refactor-plan.md` L18：「按字面改空集会打破 **6 条既有测试**」 | 6 |

两者可能指不同集合（4 处**新回归** / 6 条**既有测试**），但三处并排出现时读者无法调和。

**建议**：统一为「**4 处新失败（其中 2 条是核心不变量）；既有 6 条测试中改写 3 + 保留 1（跨路径不变量）+ 新增 2**」。

## F4 🟠 `PROGRESS.md` P1-6 的 `SUMMARY §8 #13` 引用不可靠

`SUMMARY-custom-provider-capability-pipeline.md` §8 是**13 行表格**，不是编号列表。逐行数：第 12 行才是 `goose-doc-guide`，第 **13** 行是「测试隔离漏洞」。P1-6 写 `SUMMARY §8 #13` 指向 `goose-doc-guide` 死断言，**按字面数会指错行**。

**建议**：改写为「`SUMMARY §8` 表第 12 行」或直接引 `AUDIT §3.3 #2`。

## F5 🟡 行号漂移（3 处）

| 引用 | 文档位置 | 实测 |
|------|----------|------|
| `model_config.rs:136` 硬编码 `reasoning: None` | `LESSONS.md` §3 | `reasoning: None` 在 **`model_config.rs:147`**（:136 是 `) -> Result<ModelConfig> {`） |
| `CustomProviderForm.tsx:331` `useEffect([initialData])` | `LESSONS.md` §3 | `useEffect` 在 **`:341`**，依赖数组 `[initialDataIdentity]` 在 **`:370`**，`initialDataIdentity` 定义在 **`:337`** |
| `model_config.rs:187-193` | `PROGRESS.md` P0-5、`TECH-DEBT.md` §3.1 | ✅ **准确**（`.or_else` 推断 `reasoning=Some(true)` 的那一块） |

同类**已核实准确**的引用：`skills/mod.rs:401`（`dirs::home_dir()` ✓）、`skills/builtin.rs:9-13`（`goose_doc_guide` 过滤 ✓）、`cortex-cli/src/logging.rs:55`（断言 `"goose"` ✓）、`config/paths.rs:22`（`app_name: "cortex"` ✓）、`acp_fixtures/server.rs:366`（`Some("cortex")` ✓）、`acp/server/providers.rs:394`（`existing.iter().find(...)` 预置点 ✓）、`cortex-providers/src/openai.rs:344`（`with_endpoint_capabilities` ✓）、`platform_extensions/mod.rs:194`（`GOOSE_MOIM_MESSAGE_TEXT/FILE` ✓）、`cortex-mcp/src/lib.rs:14-18`（`app_name: "goose"` ✓）、`cortex-mcp/src/memory/mod.rs:515`（`"goose-memory"` ✓）。

## F6 🟠 `PROGRESS.md` 仪表盘「Rust 测试通过率 2276/2284 = 99.6%」口径不完整

分母 `2284` 只含 `cortex --lib`。**未计入**：`cortex-cli --lib` 352/1、UI vitest 992/21/8、ACP 11 个测试二进制。读者极易读成「全仓库 99.6%」。

**建议**：指标名改为「`cortex --lib` 通过率 2276/2284 = 99.6%」，或补全为加权总口径。

## F7 🟡 `LESSONS.md` §2 与 §3 现象描述重叠

- §2 行 19【菜单与出站判定分叉】现象：「`cn:glm-5.3-flash` 菜单显示 3 档可调，出站零字节」
- §3【词表双向映射】讲的是同一现象的另一半

**建议**：§2 只保留「两个判定结论相反」的根因与路线选择（1a/1b），把具体模型与实测数据集中到 §3，避免同一现象两处维护。

## F8 🟡 `TECH-DEBT.md` §1.2 表格排序键不明

按「涉及文件数」降序：`text-text-muted` 66/20、`border-border-subtle` 38/12、`text-text-default` 31/10、`text-textSubtle` 26/9、`bg-background-default` 12/8、`bg-background-muted` 11/7、`text-iconStandard` 8/6 —— 前 7 行符合。
但第 8 行 `text-text-standard` **27 处 / 5 文件** 排在 8/6 之后，第 9 行 `text-muted-foreground` 15/4、第 10 行 `border-border` 10/4 —— **排序键在第 8 行断裂**。

**建议**：注明排序键，或按处数严格降序重排（否则读者会误以为"处数少的反而更多"）。

## F9 🟡 `AGENTS.md` §8 启动检查清单第 2 步会中断

```bash
ls -la ~/.config/cortex/config.yaml ~/.config/goose/config.yaml
```
任一文件不存在时 `ls` 整体报错退出（退出码 ≠ 0），清单会在第 2 步就中断。

**建议**：改为 `ls -la ~/.config/cortex/config.yaml ~/.config/goose/config.yaml 2>&1 || true`，并补上 §4 表格里「默认 provider 哨兵 ID `"goose"`」的代码位置（`crates/cortex/src/acp/server.rs:217 DEFAULT_PROVIDER_ID = "goose"`，来源 `AUDIT §3.1`）。

## F10 🟡 `ARCHITECTURE.md` §2.2 死类脚本行缺分母

「511 处 / 119 种 / 71 文件」缺 `SCANNED_FILES=520`（扫描了 `ui/desktop/src` 下 520 个源文件）。没有分母，读者无法判断 511/520 的严重性，也无法在修复后对账。

## F11 🟡 `AGENTS.md` §3.2「Tailwind 类必须用已注册 token」的「四族」表述不完整

实测 `ui/desktop/src/styles/main.css` 除四族（`--color-background-*` / `--color-text-*` / `--color-border-*` / `--color-ring-*`，:64-110）外，还注册了：

| 额外 token | 位置 |
|------------|------|
| `--color-ring` | :167 |
| `--color-sidebar-foreground` / `-accent` / `-accent-foreground` / `-border` | :168-171 |
| `--color-neutral-50…950` | :33-43 |
| `--color-red-100/200`、`--color-blue-100/200`、`--color-green-100/200`、`--color-yellow-100/200` | :45-55 |
| `--font-serif`、`--shadow-default`、`--breakpoint-md` | :15, :166, :172 |

写「四族」会让人以为 `--color-ring` 与 `sidebar-*` 不可用。

**建议**：改为「四族语义 token + `ring` / `sidebar-*` 别名 + `neutral/red/blue/green/yellow` 原语」，或直接指向 `main.css:24-173`。

## F12 🟡 `PROGRESS.md` BUG-2 把两个解法并列，丢失了优先级

**`AUDIT` §4.1 结论**：
> ✅ **不是代码 bug**，代码零改动；… **不必注销重登**（这是 `SUMMARY §6` 第 6 条早已记录的已知问题，原记录「可行解只有注销重登」）

**`PROGRESS.md` BUG-2 现写法**：「可行解只有注销重登**或**从带变量环境启动 GUI」—— 把"更省事的解"与"更麻烦的解"并列，未标明哪个已被验证更优。

**建议**：「可行解：**从带变量环境启动 GUI**（已验证，不必注销重登）；注销重登亦可」。

---

# 4. 核实通过项（供快速排除）

以下内容经实测**确认准确**，无需改动：

- **16 个 Rust 路径 + 5 个 UI 路径 + `scripts/scan-dead-classes.py` + `ui/acp-client/src/generated/` 全部存在**
- `canonical_models.json` = **8279 条**（`ARCHITECTURE.md` §1.1 ✓）
- `model_capabilities.json` + **FNV-1a**（`endpoint_capabilities.rs:485` 注释 + 8 处引用 ✓）；TTL 30 天 ✓
- `KEYRING_SERVICE="cortex"` / `KEYRING_USERNAME="secrets"`（`config/base.rs:32,34` ✓）
- `PROVIDERS_NEEDING_STANDARD_CHAT_PARAMS = ["nearai","pleumrouter"]`（`openai.rs:527` ✓）
- `ThinkingEffort::{Off,Low,Medium,High,Max}` 五档 + `max|xhigh` 别名（`thinking.rs:308-336` ✓）
- `catalog_provider_id` 在 `canonical/` 与 `model_config.rs` 中**零命中**（`TECH-DEBT.md` §3.5 ✓）
- `openai_reasoning_efforts_for_model` 与硬编码三元组 `["low","medium","high"]` **已从生产代码删除**（仅存于测试夹具）✓ —— `PROGRESS.md` D12 属实
- `is_none` 守卫 + 注入点在 `apply_canonical_limits` 之前（`model_config.rs:155-194` + 注释）✓
- `capability_cache` 默认 `None`、仅 `openai_def.rs:223` 注入 ✓
- `docs/archive/README.md` 表格**完整覆盖** 15 份归档文件，无失效条目 ✓
- 测试基线修正表（`TECH-DEBT.md` §4）与 `AUDIT` §3.4/§6 口径一致 ✓

---

# 5. 建议的修正顺序

| 序 | 动作 | 涉及文件 |
|----|------|----------|
| 1 | 修 S1 / S2（删除幻觉路径与幻觉文件） | `AGENTS.md` §3.2、§5 |
| 2 | 修 S3（4 格符号归属）+ F5（3 处行号） | `ARCHITECTURE.md` §2.1、`LESSONS.md` §3 |
| 3 | 复跑 `scan-dead-classes.py` 定死 S4 口径，刷新全部引用数字 | `PROGRESS.md` D15/BUG-4/仪表盘、`TECH-DEBT.md` §1.3、`ARCHITECTURE.md` §4 |
| 4 | 修 S5（4 类失效引用）+ F4 | `PROGRESS.md`、`LESSONS.md`、`AGENTS.md` |
| 5 | 统一 S6（11 个二进制）+ S9（3/11）+ F6（通过率口径） | `ARCHITECTURE.md` §4、`TECH-DEBT.md` §4、`PROGRESS.md` |
| 6 | 拆分 S7/F1（冷启动两条） | `LESSONS.md` §3、`PROGRESS.md` P0-5、`TECH-DEBT.md` §3.1 |
| 7 | 加 S8 编号空间声明 | `PROGRESS.md` 表头 |
| 8 | 补 S10 / S11 / S12 的"未做/待验收"标注 | `PROGRESS.md` D14/D18/D1 |
| 9 | 补 S13 例外说明 | `AGENTS.md` §1.2、`PROGRESS.md` 仪表盘 |
| 10 | 按 O1–O20 逐项补录（建议 O1/O2/O10/O11 优先） | 多文件 |

---

*本报告由交叉审计生成，所有代码库结论均基于 2026-10-17 的实测（grep / 读码 / mtime / git ls-tree），未执行任何构建、测试或网络请求。*
