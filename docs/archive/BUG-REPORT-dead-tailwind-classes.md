# BUG-REPORT：死 Tailwind 类（未注册的 token 名不产出任何 CSS）

- **日期**：2026-10-17（第四轮审计期间由真机验收暴露）
- **状态**：⏸ **待办**。已修 1 个文件（用户报障的那个），其余 70 个文件未动
- **严重度**：中。功能不受影响，**但凡只用这些类做样式的元素都在默默用浏览器默认样式渲染**
- **发现路径**：用户报「视觉开关点了完全没反应」→ 真机验收 → 排除「状态被抹掉」→ 定位到选中态样式
- **相关**：`AUDIT-2026-10-17.md` §4.2、§4.3

---

## 1. 症状

自定义供应商表单里，每个模型下面的三态视觉开关（自动 / 开启 / 关闭）：

- **初始三个都不高亮**，哪怕 provider JSON 里明确写了 `"supports_vision": true`
- **点击后没有任何视觉变化**

用户侧的观感就是「这个开关点了完全没反应」。

## 2. 根因

组件写的 class 名属于**另一套 camelCase 命名**，而主题里根本没注册它们。

`src/styles/main.css` 的 `@theme inline` 只注册了四族 token：

```
--color-background-{primary,secondary,tertiary,inverse,ghost,info,danger,success,warning,disabled}
--color-text-{primary,secondary,tertiary,inverse,ghost,info,danger,success,warning,disabled}
--color-border-{…同构…}
--color-ring-{…同构…}
```

（值由 `src/theme/theme-tokens.ts` 在运行时 `style.setProperty()` 注入 `:root`；
`main.css` 只负责**注册名字**让 Tailwind 生成工具类。）

而组件用的是：**`surfaceHover` / `textStandard` / `textSubtle` / `iconSubtle` / `borderSubtle` / `borderStandard`**

**Tailwind v4 不会为未注册的 token 生成任何工具类**——类名照写在 DOM 上，但没有对应 CSS 规则。
于是选中态：

```jsx
(modelVision[name] === value) && 'bg-surfaceHover font-medium text-textStandard'
```

实际只剩 `font-medium`（11px 字号下几乎不可见），`bg-surfaceHover` 和 `text-textStandard` 全部失效。
**点击其实生效、提交其实正确，缺的只是反馈。**

## 3. 证据（可复现）

从 live dev server 取**真正生成的 CSS**（不是源文件），对照检查：

```bash
cd ui/desktop
pnpm run start-gui &            # 或任意方式起 vite
curl -s "http://localhost:5173/src/styles/main.css?direct" -o /tmp/gen.css
for c in bg-surfaceHover text-textStandard text-textSubtle border-borderSubtle \
         bg-background-secondary text-text-primary bg-background-tertiary; do
  printf "%-26s %s\n" ".$c" "$(grep -c -- "\.$c" /tmp/gen.css)"
done
```

实测结果：

| 类 | 产物中出现次数 | 判定 |
|---|---|---|
| `.bg-surfaceHover` | 0 | 🔴 未生成 |
| `.text-textStandard` | 0 | 🔴 未生成 |
| `.text-textSubtle` | 0 | 🔴 未生成 |
| `.border-borderSubtle` | 0 | 🔴 未生成 |
| `.bg-background-secondary` | 1 | ✅ 已生成 |
| `.text-text-primary` | 4 | ✅ 已生成 |
| `.bg-background-tertiary` | 1 | ✅ 已生成 |

**脚本化普查**（520 个源文件对照生成产物）：见 `scripts/` 一节，可直接复跑。

## 4. 影响面普查

**511 处 / 119 种 / 涉及 71 个文件**（`src/**/*.tsx` + `src/**/*.ts`，2026-10-17 快照）。

按涉及文件数排序的前 20：

| 死类 | 处数 | 涉及文件数 | 主要出现位置 |
|---|---|---|---|
| `text-text-muted` | 66 | 20 | `GitBranchIndicator` / `TelemetryConsentPrompt` / onboarding 一片 |
| `border-border-subtle` | 38 | 12 | 全局卡片、输入框 |
| `text-text-default` | 31 | 10 | onboarding 一片 |
| `text-textSubtle` | 26 | 9 | `ToolCallWithResponse` / recipes 一片 |
| `bg-background-default` | 12 | 8 | onboarding 一片 |
| `bg-background-muted` | 11 | 7 | onboarding / recipes 一片 |
| `text-iconStandard` | 8 | 6 | 设置各弹窗 |
| `text-text-standard` | 27 | 5 | — |
| `text-muted-foreground` | 15 | 4 | — |
| `border-border` | 10 | 4 | — |

完整清单见 `scripts/dead-classes.txt`（本报告同时在 `scripts/` 下留了一份可复跑的快照）。

**这些元素不是「样式丑一点」，是**根本没有样式**：浏览器默认字体大小、行高、颜色、边框。

这大概率就是「界面看起来有点朴素但说不清哪里怪」的来源——尤其是 onboarding 那一整片。

## 5. 两条修法（择一）

### 方案 A：在 `main.css` 的 `@theme inline` 里补注册缺失的 token

把 `surfaceHover` / `textStandard` / `textSubtle` / `iconSubtle` / `borderSubtle` / `borderStandard` /
`muted` / `default` 等作为 `--color-*` 注册，并在 `theme-tokens.ts` 的 `lightTokens` / `darkTokens` 里给出值。

- ✅ 一次改动让 511 处全部生效，改动面最小
- ✅ 不用碰 71 个业务文件
- ⚠️ 要为 119 种死类逐一决定「它该长什么样」——有些语义清楚（`textSubtle` = 次要文字色），有些是猜（`border-border`？`ring-ring`？）
- ⚠️ `theme-tokens.ts` 的类型是 `Record<McpUiStyleVariableKey, string>`，**新增不在 MCP SDK 里的 key 会过不了类型检查**——这是本方案最大的阻力，可能需要扩类型或走 `as` 绕过

### 方案 B：把死类机械替换成已注册的 token

`text-text-*` → `text-text-{primary,secondary,tertiary}`，
`border-border-*` → `border-border-{primary,secondary}`，
`bg-background-*` → `bg-background-{primary,secondary,tertiary}`。

- ✅ 不碰主题，只改类名；typecheck 与 vitest 能兜住大部分风险
- ✅ 顺带把命名统一到唯一一套 scheme，将来不会再漂
- ⚠️ 71 个文件、511 处，需要逐类人工确认映射（同一个死类在不同语境下可能该对应不同 token）
- ⚠️ 改动面大，建议按目录分批，每批跑一次截图对比

### 建议

**先 A 后 B，或只做 A。** A 是「一次修好」，B 是「顺手把命名收敛」。
119 种死类逐一在 A 里定值时，凡是能直接映射到现有四族的（如 `text-textSubtle` → `text-text-secondary`），
**在 `main.css` 里注册成对应四族的别名**即可，不必新造语义值。

## 6. 验收标准

1. `scripts/scan-dead-classes` 脚本报 0 处
2. 视觉三态开关：初始态正确高亮、点击有可见变化、保存后重载仍正确
3. `tsc --noEmit` 干净、`pnpm run test` 不新增失败
4. **人工过一遍 onboarding 与设置页截图**——这类问题单测发现不了，只能看

## 7. 脚本

`scripts/scan-dead-classes.py`（本轮新增）：

- 从 dev server 取生成产物（`http://localhost:5173/src/styles/main.css?direct`）
- 解析出所有真实生成的选择器（含 `dark\:` 等转义变体）
- 扫 `src/**/*.tsx|ts` 里用到的 `bg-/text-/border-/ring-/fill-/stroke-` token 类
- 变体前缀（`hover:` `dark:` `focus:` …）按全名判定，未注册的按原样判定
- 输出 `SCANNED_FILES / TOTAL / KINDS / FILES_AFFECTED` 汇总 + 每个死类的处数、涉及文件数、样例文件

复跑：

```bash
cd ui/desktop && python3 scripts/scan-dead-classes.py
```

**建议把它接进 CI**（或至少接进 `pnpm run lint`），否则这类腐烂会重新长回来——
本 bug 的成因就是「写错了不报错」，没有守卫就必然复发。

## 8. 已修部分

`ui/desktop/src/components/settings/providers/modal/subcomponents/forms/CustomProviderForm.tsx`
—— 用户实际报障的那个文件，15 处死类全部换成已注册 token，选中态改为
`bg-background-tertiary font-medium text-text-primary`（与 hover 的 `bg-background-secondary`
**明确区分**，否则又变成「看不出变化」）。该文件现在**零死类**，
`tsc --noEmit` 干净，4 条视觉单测仍全过。