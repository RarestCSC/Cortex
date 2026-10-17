# 历史归档文档

此目录为历史归档文档，仅供追溯。opencode 默认无需读取此目录，请优先读取 `docs/` 目录下的最新架构和进度文档：

- `docs/AGENTS.md` — AI 开发规则（每次会话必读）
- `docs/PROGRESS.md` — 项目当前进度与看板
- `docs/ARCHITECTURE.md` — 项目架构与代码地图
- `docs/LESSONS.md` — 避坑指南与最佳实践
- `docs/TECH-DEBT.md` — 技术债清理清单
- `docs/BUILD-RUNBOOK.md` — 构建 / 运行 / 打包 runbook

归档内容（2026-10-17 之前）：

| 文件 | 内容 |
|------|------|
| `audit.md` | 源码证据索引（静态/实测）。⚠️ 其 Rust 行号是 2026-10-11/12 的核对记录，引用后端行为前必须重读源码 |
| `AUDIT-2026-10-17.md` | 第四轮审计：三份交付复核 + Off 兜底修复 + ACP 集成测试解锁 + 真机验收 |
| `BUG-REPORT-custom-provider-capability-pipeline.md` | 统一索引 + C1~C5 全貌 + **D 组四个覆盖缺口（Gap A/B/C/D，不是 D1–D4）** |
| `BUG-REPORT-realm-prefixed-model-thinking-effort.md` | C1/C2 深度：6 个断点链、实测 A/B |
| `BUG-REPORT-developer-role-rejected.md` | developer 角色 400 修复。⚠️ 该文**只有 8 节**，其他文档引用的「§82」是失效引用 |
| `BUG-REPORT-custom-provider-null-api-key-env.md` | C5 深度 |
| `BUG-REPORT-custom-provider-vision.md` | C3 前史 |
| `BUG-REPORT-dead-tailwind-classes.md` | 死 Tailwind 类报告 |
| `dead-classes-snapshot-2026-10-17.txt` | 死类普查快照（`SCANNED_FILES=520 TOTAL=511 KINDS=119 FILES_AFFECTED=71`） |
| `FIX-jia-custom-provider-config-layer.md` | 甲交付：C5 + C4 |
| `FIX-yi-reasoning-effort-honesty.md` | 乙交付：A1 + A2 |
| `FIX-bing-capability-wiring.md` | 丙交付：B1 + B2 + B3 + B4 + G 组 |
| `refactor-plan.md` | 项目状态与续接指南。⚠️ 其 §4.1–§4.9 已被删除，仅存 §4.10/§4.11 与 §4 的 ①–⑪ 验证日志 |
| `SUMMARY-custom-provider-capability-pipeline.md` | 能力管线总结。⚠️ 其 §10「全程未发真实请求」被自己的 §7.5（D10-a 真机探测）推翻 |
| `TASK-fix-custom-provider-capability-pipeline.md` | 调度与 Task Contract。⚠️ 其 `D1–D10` 是调度决定，与 `PROGRESS.md` 的 `D#` 无关 |

---

## ⚠️ 引用本目录时的已知陷阱

1. **编号空间冲突**：`TASK` 的 `D#`（调度决定）、`BUG-REPORT-…pipeline` 的 `Gap A–D`、`PROGRESS.md` 的 `D#`（交付项）三套编号**互不对应**
2. **`AUDIT-2026-10-17.md` 无 §9 / 无 §7.8 / 无「§4-C」**（见 `docs/README.md` 的陷阱清单）
3. **`SUMMARY §8` 是 13 行表格**，不是编号列表；「goose-doc-guide」在**第 12 行**不是第 13 行
4. **多处路径错误已被勘误**，勿沿用旧版：
   - `crates/cortex-provider-types/src/declarative.rs` **不存在**（`FIX-jia` §9）
   - `/tmp/opencode/wb2api-effort-probe/` 目录**已不存在**（`FIX-yi` §9）
5. **`SUMMARY §7.5` 是唯一一次真机探测记录**（2026-10-17 直打 8787 五次），与「全程不发真实请求」的表述冲突
