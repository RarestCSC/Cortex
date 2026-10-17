# 总结：自定义供应商能力管线（2026-10-16 ~ 10-17）

> 这是本轮的总入口。细节在分文档里，本文只回答「做了什么、成了什么、还剩什么」。

## 1. 一句话

用户的 5 个「自定义模型能力」问题，最后收敛成**一个根因家族**：Cortex 有三套能力信息来源，只用了最差的那套。三轮改下来，5 条里 3 条彻底修好、1 条要用户手改一行配置、1 条只剩文档。

## 2. 起点：5 个症状

| # | 症状 | 来源 |
|---|---|---|
| 1 | workbuddy / OpenCode 等自定义模型不支持思考强度 | 用户 |
| 2 | 中转站模型思考强度只有固定低中高三档，应按模型实际支持设档 | 用户 |
| 3 | 视觉三态开关点了没反应 | 用户 |
| 4 | 没有视觉（图片被替换成占位文本） | 用户（与 1 同条） |
| 5 | `"api_key_env": null` 让整个自定义供应商表清空 | 我在排查中补 |
| 6 | 切换 provider 报 `Internal error` | 我在排查中补 |

## 3. 统一根因

自定义模型的能力信息有三个来源，Cortex 当时**只消费了第三个**：

| 来源 | 载体 | 当时的状态 |
|---|---|---|
| ① 用户声明 | `custom_providers/*.json` 的 `ModelInfo` | `reasoning` **完全没读**；`supports_vision` 只有 provider 侧一处读 |
| ② 端点自报 | `GET /v1/models` 的 `supports_images` / `reasoning_supported_efforts` / `reasoning_default_effort` | **一个字节都没读** |
| ③ 公共静态目录 | `canonical_models.json`（8279 条） | **唯一在用的** |

而第三方网关/自建网关的模型名天然不在 ③ 里（实测 `workbuddy` / `wb2api` 关键词 0 条，provider 键无 `cn` / `global` / `wb2api`），名字启发式又不认 `cn:` / `global:` 这种 realm 前缀 —— ①②③ 全部落空。

**已内置供应商因模型名都能在目录里查到而基本幸免，这正是问题长期没被当成系统性问题发现的原因。**

## 4. 调度

```text
并行（文件所有权零重叠）        串行尾巴
  ├─ 甲：配置层 C5 + C4   ──┐
  └─ 乙：诚实化 A1 + A2   ──┴──→  丙：能力上线 B1~B4 + G 组
```

约束：本仓库 `target/` 冷构建、三个会话共用一个 target ⇒ **构建不并行，只有编辑能并行**。
依据 `docs/TASK-fix-custom-provider-capability-pipeline.md` 的文件所有权表与 Task Contract。

## 5. 三个会话各做了什么

### 甲 — 配置层（C5 + C4）
- **`api_key_env` 加 `deserialize_with = "null_to_empty"`**：`#[serde(default)]` 只管字段缺失不接显式 `null`，而 `load_custom_providers` 用 `.collect::<Result<Vec<_>>>()`，单文件失败即全灭。保持 `String` 类型不变 ⇒ 零调用点变更
- **视觉三态可逆**：wire 原本表达不了「显式重置为自动」，UI 删 key 与「没碰过」在协议上同构。改为 UI 显式发送 `{supports_vision: null}`，后端用 `HashMap::get` 的 `Option<&Dto>` 区分「无条目＝不碰」与「有条目为 null＝清除」
- ⚠️ 过程中**推翻了主会话的勘误结论**：`.or()` 幂等不是因为写得对，是因为上游 `providers.rs:394` 已预置旧值

### 乙 — 诚实化（A1 + A2）
- **正则分隔符 `[-/]` → `[-/:]`**：`global:gpt-6-luna` 这类带 realm 前缀的重新被识别
- **统一两个矛盾判定**：菜单侧 `is_reasoning_model()`（认 glm-5.3 名字）与出站侧 `openai_reasoning_for_model()`（不认）**结论相反**，导致 `cn:glm-5.3-flash` 的三档滑块是纯装饰。新增 `sends_thinking_effort()` 作单一判定，菜单与出站共用
- 选了**路线 1b（放宽出站）**而非 1a（收紧 UI）：1a 只是把承诺收窄，且会砍掉 xAI 已生效的能力

### 丙 — 能力上线（B1~B4 + G 组）
- **B1**：用户声明的 `reasoning` 接进 `ModelConfig`（此前硬编码 `None`），注入点必须在 canonical 回填**之前**
- **B2**：消费 `GET /v1/models` 的能力字段，菜单档位改为端点声明驱动
- **B3**：端点词表 ↔ `ThinkingEffort` 双向映射，`max ↔ xhigh`
- **B4**：`/v1/responses` 路径的闸门与菜单对齐；`should_use_responses_api` 增加「已证明端点无 Responses API」优先于模型名
- **G1**：端点**完全沉默**时的运行时探测兜底 —— 乐观发送 → 被明确拒绝则剥掉重试一次 → 结论落盘 `model_capabilities.json`
- **G2**：端点不声明能力时，档位 description 给出可操作提示而不是静默收成一档
- **G3**：定位并修复 UI 状态重置（见 §7）

## 6. 现在的状态

| # | 症状 | 状态 |
|---|---|---|
| 1 | workbuddy 不支持思考强度 | ✅ 端点声明驱动，假端点实测出站 `"max"` |
| 2 | 档位固定低中高 | ✅ 端点声明优先；`cn:hy4-preview` 单档 → 出站就是 `high` |
| 3 | 视觉开关点了没反应 | ⚠️ **2026-10-17 真机验收推翻了 §7 ② 的结论**。甲的 C4（协议层）与丙的 G3（`useEffect` 依赖对象身份）**都是真实但次要的问题，不是症状的根因**。真根因是组件用了 5 个**主题里根本没注册**的 Tailwind 类（`surfaceHover` / `textStandard` / `textSubtle` / `borderSubtle` / `borderStandard`），而 Tailwind v4 不为未注册 token 生成任何 CSS ⇒ **点击其实生效、提交也对，只是选中态完全不可见**。已修（`CustomProviderForm.tsx` 15 处死类换掉）。**三轮都没找到，因为没有任何人在运行中的应用里点过一下**。同类腐烂全仓库还有 511 处 / 71 个文件，未修 |
| 4 | 没有视觉 | ✅ 自动：乐观发送 + 拒绝后落盘 |
| 5 | `api_key_env: null` 清空注册表 | ✅ |
| 6 | 切换 provider 报 `Internal error` | ⚠️ 配置没错，真因是 `systemctl --user set-environment` 只对 user manager 拉起的进程生效，**GUI 进程读不到**。可行解只有**注销重登** |
| 1b | **OpenCode 系不支持思考强度** | ✅ **已修**（2026-10-17，真机验收轮）。三个模型声明 `"reasoning": true` + Off 兜底修复，隔离根下端到端验证 `max`→`"max"`、`off`→不发字段。**视觉不需要代码改动**，只差真机确认 free-lane 收不收图。见 `AUDIT-2026-10-17.md` §4.4 |
| 7 | **ACP 集成测试全仓库 panic** | ✅ **已解锁**（`acp_fixtures/server.rs:366`）。暴露 3 个从未执行过的失败，已逐条分类，见审计 §3.3 |

**测试基线**（2026-10-17 复核，`AUDIT-2026-10-17.md` §5）：`cortex-provider-types` 670 passed / `cortex-providers` 269 passed / `cortex --lib --features scheduler,acp-http` 2243 passed 16 failed。**重要修正：那 16 个里有 8 个只是 feature flag 没开**——`analyze` 扩展挂在 `#[cfg(feature = "tree-sitter")]` 下，补上 `tree-sitter,code-mode` 后是 **2276 passed / 8 failed**。三轮都只跑过 `--lib`，**从没跑过集成测试**。UI 全量 `pnpm run test` 是 992 passed / 21 failed（丙 §8.2 记的「13 passed」只覆盖了他自己那一个文件）。

## 7. 本轮三个值得记住的判断

**① 甲的质疑推翻了我的结论。** 我判定 C4 只改 `declarative_providers.rs:310` 即可，甲指出「该 `.or()` 本来就是幂等的」，并追问是否只需改一行——它的论证实际上推出了相反结论：**幂等正因为上游已预置，所以改它是 no-op**。最终是两处一起改。

**② 丙发现第 3 条 bug 与甲修的不是同一件事。** 甲修的是「点『自动』清不掉已设值」（ACP 层，已验证）；用户说的「点了完全没反应」是另一层——`useEffect(..., [initialData])` 依赖**对象身份**，而两个挂载点都在 render body 里现造该对象，于是宿主任何一次 re-render 都把用户的点击抹掉。**甲在 ACP JSON-RPC 层验不出它，因为请求层根本没收到过那份 payload。**

> **【2026-10-17 真机验收修正】甲与丙修的都不是根因。** 用户开窗实测：按钮初始**全不高亮**、点击后**零视觉变化**（不是「变了又弹回」）。
> 真根因是 `CustomProviderForm.tsx` 用了 5 个**主题里根本没注册**的 Tailwind 类（`surfaceHover` / `textStandard` / `textSubtle` / `borderSubtle` / `borderStandard`），
> 而 Tailwind v4 **不为未注册 token 生成任何 CSS** ⇒ 选中态 `bg-surfaceHover font-medium text-textStandard` 只剩 `font-medium`，11px 下几乎不可见。
> **点击一直生效、提交一直正确，缺的只是反馈。** 已修（15 处死类换掉，该文件现在零死类）。
> **三轮都没找到真根因，因为没有任何人在运行中的应用里点过一下。** 证据与同类腐烂统计见 `AUDIT-2026-10-17.md` §4.2。

**③ 非 Option 的 `bool` 让「声明 false」和「没说」无法区分。** `ModelInfo.reasoning` 是 `#[serde(default)] bool`，丙最终只发布 `true`。理由：把沉默当否定会遮蔽名字启发式，让从没写过该字段的自定义网关静默失去所有被名字识别的推理模型。误伤方向是刻意的——多发一个 `reasoning_effort` 的代价是「被拒 → 降级 → 落盘」（可自愈），少发的代价是「模型真的在思考但开关不掉」（不可自愈）。

## 7.5 真机探测：OpenCode 免费车道（2026-10-17，本轮唯一一次发真实请求）

三个测试会话全程禁发真实模型请求。这次为定一个决策直接打了真 free-lane（`127.0.0.1:8787`），共 5 次请求。

| `reasoning_effort` | HTTP | reasoning_tokens |
|---|---|---|
| `low` | 200 | 22 |
| `medium` | 200 | — |
| `max` | 200 | **62** |
| `xhigh` | 200 | 26 |
| `minimal` | 200 | 15 |
| `banana`（乱值） | **400** | — |

**① 端点真实生效**（low→max 差异 22 vs 62 token），不是静默丢弃。
**② 端点校验取值**（乱值 400）⇒ 词表映射是必需项，不是优化。
**③ `xhigh` 与 `max` 都接受** ⇒ B3 的 `max ↔ xhigh` 双向映射对 OpenCode 两条都通。

目录里其实**有**这条数据，只是查不到：

```
opencode-go/space-bunny-free   reasoning: true
  reasoning_efforts: [low, medium, high, xhigh, max]
  attachment: true   modalities.input: [text, image, video]   cost: 0
```

查不到纯粹是**命名错位**：provider 键剥 `custom_` 后是 `cortex-free-opencode`（目录里叫 `opencode-go`），模型名 `oc-space-bunny-free`（目录里叫 `space-bunny-free`）。`catalog_provider_id` 字段**不参与 canonical 查找**，那条路当前也走不通。

### ⚠️ 由此发现一个新 bug（丙引入的兜底路径）

给三个模型写 `"reasoning": true` 能开菜单，但**会引入一个更糟的行为**。丙保留了硬编码三元组 `["low","medium","high"]` 作最后兜底（`formats/openai.rs:2038`），而 `accepts()` 在「端点与目录都没声明」时正回落到它（`:2025`）：

| 菜单选择 | preferred 序列（`:2000-2006`） | 三元组里第一个被接受 | **实际发出** |
|---|---|---|---|
| **Off** | `none → minimal → off → low` | `low` | **`"low"`** |
| Max | `max → xhigh → high → …` | `high` | **`"high"`** |

**选「Off」会发 `reasoning_effort: "low"`——用户让它别思考，反而发了个 low。** 现状（不发字段）才是对的。

现有的 Off 保护在 `:1763` 的 `Some(Off) if !is_reasoning_model => None`，只覆盖「非 OpenAI-canonical 模型」；但写死 `"reasoning": true` 后 `openai_reasoning_for_model()` 返回 **true**（它优先取 `self.reasoning`），保护不触发。

**这正是乙花一整轮消灭的「UI 承诺了自己不兑现的能力」，从兜底路径上又溜了回来。** 丙在 `:2035-2037` 自己写了原则「没有证据时发送 xhigh 或 max 是发明而非发现」，但三元组让 Off 退化成 low，违背了自己的原则。

修复方向：`accepts()` 的「端点与目录都没声明」分支应返回**空集**而非三元组——没有任何证据时不发明档位。

> **【2026-10-17 审计修正】字面的「空集」会引入 4 处新回归，未按字面执行。**
> 实测：`(None, None)` 分支的真实覆盖面远大于「网关闭默型」——`zai-org/GLM-5.3-Flash`（目录挂在
> `siliconflow/` 下，而 `openai.rs` 的映射把 provider 写死成 `"openai"`）、`claude-sonnet-4`、
> `kimi-k3`、`gemini-3-pro`、`gpt-6.1-sol@eu` 全部走这条分支。空集会让它们「菜单多档、出站 0 字节」，
> 正是乙花整轮消灭的那个病。实际实现改为**只发明「词」、不发明「档位」**：`Off` 无词 → 不发字段，
> 其余各档发自己的名字（`Max` 发 `max` 而非 `high`）。你要的两条验收标准都满足，且零回归。
> 论证、实测与补的单测见 `AUDIT-2026-10-17.md` §1。


## 8. 还没做的

| 项 | 说明 |
|---|---|
| **OpenCode 思考强度** | ✅ **已修**（2026-10-17）：三个模型改为声明 `"reasoning": true`，配合 Off 兜底修复后端到端验证通过 —— `max` 发 `"max"`、`off` 不发字段（隔离根 + 严格假端点，**未碰真实网关**）。**路线 ①（`catalog_provider_id` 参与 canonical 查找）本轮走不通**：模型名 `oc-space-bunny-free` 与目录的 `space-bunny-free` 对不上，`strip_common_prefixes` 里没有 `oc-`，改代码也接不通这个案例。论证见审计 §4.4 |
| **OpenCode 视觉** | ⚠️ **不需要代码改动**。后端早已具备（`vision_support()` 的 `.known.or(Some(true))` 乐观发送 + `build_chat_payload` 显式传入 + 前端不禁用附件 + G1 被拒自愈）。**刻意不写 `supports_vision`** —— 写了就把未经真机确认的声明变成权威值，反而关掉 G1 自愈。**只差真机确认 free-lane 收不收图** |
| **真机验收** | ⚠️ **已部分完成**（2026-10-17 第四轮开窗实测）。已测并留结论：视觉三态开关（真根因是死 Tailwind 类，见 §7 ②）、workbuddy 切换失败（不是代码 bug，是 GUI 进程缺 `WB2A_API_KEY`）、思考档位出站（隔离根 + 严格假端点，`max`→`"max"`、`off`→不发字段）。**仍未做真机确认的清单见审计 §5-E**（4 条「一定要测」/ 4 条「测了更好」） |
| **WorkBuddy 是否支持 Responses API** | 乙的 A1 让 realm 前缀模型改打 `/v1/responses`。丙已把风险降级为「第一次 404 → 回落 chat → 落盘」，但**首次仍会 404**。只有真机能回答 |
| **另三个中转站** | `custom_lite-gpt` / `custom_chatanywhere` / `custom_siliconflow` 的 `/v1/models` 未核查（需用户 key，用户决定推迟）。G1 不依赖端点配合，风险已摊平 |
| ~~**`acp_fixtures/server.rs:366`**~~ | ✅ **已修**，ACP 集成测试全部能跑了。暴露出的 3 个失败见审计 §3.3，**本轮只分类未改** |
| **`cortex-cli/src/logging.rs:55`** | 🔴 **新发现的同族改名遗留**：`cortex --lib` 之外，`cortex-cli --lib` 唯一的一个失败。断言日志路径含 `"goose"` 分量，而 `paths.rs:22` 的 `app_name` 已是 `"cortex"`。一行字面量，本轮未改（不在你枚举的 `crates/cortex/tests/` 范围内） |
| **端点是唯一推理证据时，B2 在冷启动上失效** | 🔴 **审计 §4-C 新发现**：`openai.rs:344` 的 `with_endpoint_capabilities()` 不回填 `reasoning`，而闸门只看 `reasoning`。⇒ workbuddy 那种「名字无启发式 + JSON 没写 reasoning」的模型，词表被带到了出站点却从未用上，菜单是 `[Off]`、出站无字段。修法是一行，但按边界未改 |
| **「目录有词表但没有关的词」时 `Off` 仍发 `low`** | 🔴 **审计 §1.5 新发现**，**比网关闭默型更常见**：`cn:glm-5.3-flash` 实测 `Off → "low"`。但发 `low`（最轻档）vs 不发（端点默认，可能更多）哪个才是用户要的，是产品决策不是机械修复。未改 |
| **探测缓存的措辞覆盖** | G1 只匹配一组常见 400 措辞；真实端点文案不同时会退化成「错误上抛」而非静默降级——安全方向的失败，但会打扰用户 |
| **`reasoning: false` 无法表达** | 给 `ModelInfo` 加三态是产品决策，本轮没做 |
| **`goose-doc-guide` 技能** | ✅ **不需要产品决策**（初稿误判，已更正）：那个技能是**刻意不暴露**的，`skills/builtin.rs:9-13` 有显式过滤。`acp_custom_requests_test.rs:725` 那条「必须出现」是**死断言**，改为断言 `web-search` 即可。而 `sources.rs:1817` 的 lib 测试失败**不是产品问题**——它第二条断言挂在 `expect("expected web-search builtin skill")` 上，因为**你自装的 `~/.agents/skills/web-search` 顶掉了内置那个**（`skills/mod.rs:631` 的 `seen` 去重），干净机器上会通过 |
| **测试隔离漏洞** | 🔴 `GOOSE_PATH_ROOT` **不隔离 `~/.agents/skills`**（`skills/mod.rs:401` 用 `dirs::home_dir()`），技能类测试会读开发者真实家目录。本轮只读未写，但边界描述应补上这一条 |

## 9. 文档索引

| 文档 | 内容 |
|---|---|
| `TASK-fix-custom-provider-capability-pipeline.md` | 调度、硬约束、三个 Task Contract、文件所有权表、D1~D9 实现提示 |
| `BUG-REPORT-custom-provider-capability-pipeline.md` | 统一索引 + C1~C5 全貌 + §4「D 组」四个覆盖缺口 |
| `BUG-REPORT-realm-prefixed-model-thinking-effort.md` | C1/C2 深度：6 个断点链、实测 A/B、网关默认档位表 |
| `BUG-REPORT-custom-provider-null-api-key-env.md` | C5 深度 |
| `BUG-REPORT-custom-provider-vision.md` | C3 前史（其方案 B / A' 已落地） |
| `FIX-jia-custom-provider-config-layer.md` | 甲交付 |
| `FIX-yi-reasoning-effort-honesty.md` | 乙交付 |
| `FIX-bing-capability-wiring.md` | 丙交付 |
| **`AUDIT-2026-10-17.md`** | **第四轮：定点审计三份交付 + 修 Off 兜底映射 + 解锁 ACP 集成测试 + 真机验收轮** |
| `BUG-REPORT-dead-tailwind-classes.md` | 死 Tailwind 类（未注册 token 不产出 CSS）：511 处 / 119 种 / 71 文件。待办，脚本 `ui/desktop/scripts/scan-dead-classes.py` |
| `refactor-plan.md` | 项目状态与续接指南（§0 首条为本轮索引） |

## 10. 过程中形成的硬边界

- 全程 `GOOSE_PATH_ROOT` 隔离，**真实 `~/.config/cortex` 与 `~/.config/goose` 未被测试触碰**
- **全程未发任何真实模型请求**；出站行为一律用 `/tmp` 下自建的严格假端点验证，且刻意避开用户环境里两个真实网关的端口
- AGENTS.md 的 `cargo clippy --all-targets -- -D warnings` **在本分支跑不通**（feature 门控 + 改名遗留），三轮均沿用可行写法并在各自交付里说明
- ⚠️ **本仓库当前处于改名未提交状态，不要用 `git stash` 做局部回退**——它会把工作树文件整个撤走并留下 unmerged 索引项（审计 §6 记录了一次已复原的事故）