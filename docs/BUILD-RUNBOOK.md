# Cortex 构建 / 运行 / 打包 Runbook

> 补齐 `refactor-plan.md` §3 在文档重组中的丢失。**本文件是唯一记录打包/安装流程的文档。**
> 最后更新：**2026-10-17（据 `docs/archive/refactor-plan.md` §3/§4 重建）**
> ⚠️ 内容未经本轮重新验证，**执行前先核对现状**；数字为 2026-10-15/16 实测值。

---

## 1. 环境基线（不要重装、不要改动）

| 工具 | 版本 | 禁令 |
|------|------|------|
| Node | **v24.21.0** | 不要重装 |
| pnpm | **12.11.2** | 不要重装。⚠️ `pnpm run typecheck` / `pnpm run test` 会触发自动依赖同步与 postinstall 并清理 `.vite` ⇒ **改用 `node ui/node_modules/typescript/bin/tsc --noEmit`** |
| Rust | **1.99.0**（`~/.cargo`，由 `rust-toolchain.toml` 固定） | ⚠️ **不要 apt cargo 1.75、不要 source hermit** |
| Electron | **43.4.0**（与 `package.json` 一致） | — |

工作区依赖已安装（`ui/node_modules` 存在）。**验证工具直接用 `ui/node_modules` 下的可执行入口。**

---

## 2. Rust 构建

### 2.1 🔴 绝不可中断
v8 的 build script 会**先删 `release/gn_out/` 再重新下载** 169MB 的 `librusty_v8.a`。中断 = **永久丢失且无副本**（`~/.cache/rusty_v8` 本就为空），且 cargo 会连带删掉旧的 `release/cortex`。

- 失败特征（判断「这是我踩的还是别人的」）：`URLError: [Errno 111] Connection refused` + `v8-goose-*/build.rs:669` 的 `assertion failed`，**与代码无关**
- 恢复：用户开代理后用直连 `RUSTY_V8_MIRROR` 重下，实测 **36m04s** 重建完成

### 2.2 耗时基线（Rust 改动要批量）
| 操作 | 实测耗时 |
|------|---------|
| UI 逻辑改动热更新 | 即时 |
| `i18n:compile` | **6.8s** |
| UI typecheck | **37s** |
| `cargo check --workspace --all-targets` | **6m21s** |
| `cargo clippy -p cortex --all-targets` | **6m58s** |
| **改一个 Rust 词 → release 增量** | **12m39s**（级联 cortex→cortex-mcp→cortex-cli＋链接 290MB） |
| release 全量重编 | 11m44s / 12m34s / 17m52s / 36m04s（视改动面） |

⚠️ **未收到完成结果前不要重复启动构建或打包，更不可终止现有 Rust 进程。**

### 2.3 独立 target
```
CARGO_TARGET_DIR=/tmp/opencode/cortex-rust-target
```
产物固定在 `/tmp/opencode/cortex-rust-target/release/cortex`，不覆盖仓库原二进制。

⚠️ **两条 GitHub 路径要分清**：
- **v8 静态库** → `RUSTY_V8_MIRROR`（默认 GitHub 直连）
- **cargo 拉 git 依赖** → gh-proxy `insteadOf` 转发

⚠️ **直连失败时先问用户代理开关**，不要自行判定镜像可用性（2026-10-15 曾因用户开着代理导致 `Failed to connect to github.com port 443`，被误判为网络不通）。

### 2.4 🔴 feature 裁剪会让 GUI 静默失败
`cortex serve` 子命令被 `#[cfg(feature = "acp-http")]` 门控（`crates/cortex-cli/src/cli.rs:47,50`）。裁掉该 feature 后 `cortex serve` 报 `unrecognized subcommand`，**桌面端静默失败、无任何提示**。
`--no-default-features` 下必须完整列出全部 feature。

### 2.5 `-p cortex` 的测试 / clippy feature 集
```
--features scheduler,acp-http,tree-sitter,code-mode,platform-apps,chat-recall,rustls-tls
```
> `platform-apps`/`chat-recall` 用于 prompt 快照与 `config::extensions`；`rustls-tls` 提供 `jsonwebtoken` 的 CryptoProvider（缺它 `chatgpt_codex`/`gcpauth` 会 panic）。等价写法：`portable-default,code-mode`。
⚠️ 不加 `scheduler` 会连带 **24 个编译错误**（`agents/state_machine/tests/`）。
⚠️ `--all-targets` + 加了 `scheduler` 会撞 `E0432: unresolved import cortex::acp::transport`（`acp/mod.rs:12` 带 `#[cfg(feature = "acp-http")]`）。
格式层现位于 `cortex-provider-types`，定点跑：`cargo test -p cortex-provider-types --lib formats::openai::`。

---

## 3. 桌面端打包（electron-forge）

### 3.1 🔴 必须先做
| # | 步骤 | 说明 |
|---|------|------|
| 1 | **原子替换后端二进制** | `cp -p` 到 `ui/desktop/src/bin/cortex.staging` 再 `mv`。⚠️ **不要用 `just copy-binary`** —— 它硬编码相对路径 `target/release/`，而本仓库没有 `target/` |
| 2 | **设 `ELECTRON_MIRROR`** | `https://cdn.npmmirror.com/binaries/electron/`。不设会卡死在 `SHASUMS256.txt`（`index.js` 里 `cacheMode: Bypass`，Never use the cache for loading checksums） |
| 3 | **限定目标平台** | `--targets=@electron-forge/maker-deb`。⚠️ rpm/flatpak 会因缺 `rpmbuild` / `flatpak-builder` 失败 |
| 4 | i18n 直调脚本 | `node scripts/i18n-compile.js`，避开 pnpm 依赖同步 |

### 3.2 🔴 不要做的事
- **不要加 `packagerConfig.ignore`** —— 会覆盖 Vite 插件的默认忽略，导致依赖解析失败
- `extraResource` 须用**相对路径**

### 3.3 可跳过 / 可选
- `build-acp-client`：`crates/cortex/acp-schema.json` 比 `ui/acp-client/dist` 旧时可跳过
- 本地生成 `checksums`（`index.js:47-57`）或 `unsafelyDisableChecksums` 也能替代 `ELECTRON_MIRROR`，但**要改受版本控制的 `forge.config.ts`**，未采用

### 3.4 产物
- 位置：`ui/desktop/out/make/deb/x64/`
- 文件名：`cortex_1.54.0_amd64.deb`（实测 163,570,632 ~ 163,671,898 B，视构建轮次）
- `app.asar` ≈ 7.49 MB，内含 **16 个 locale chunk 各 1683 条**
- `out/` 已在 `.gitignore`

### 3.5 图标
- 直接采用原始素材 `icon/Cortex-icon-macOS.png`（内缩 100px、rx=186、投影、顶部高光边）
- 512/2048/ico/icns 由原 SVG 经 Chrome 渲染 + **Lanczos** 缩放生成
- 🔴 **electron-installer 只装 `/usr/share/pixmaps`、不注册 hicolor** ⇒ desktop entry 写 `Icon=cortex` 会被 GNOME 解析成 `ThemedIcon` 并**回退默认占位图**。**必须写绝对路径**
- 开发态图标：`main.ts` 按平台选 icon + 多候选路径回退；`app.setDesktopName('cortex-dev.desktop')` 指向的文件**必须真实存在**，否则同样回退占位图
- 已知：`startup_wm_class = None`（与 §5 一致，未解决）

---

## 4. 安装（sudo 由用户执行）

```bash
cd /home/rarestcsc/Cortex            # 或用绝对路径
sudo apt install ./ui/desktop/out/make/deb/x64/cortex_1.54.0_amd64.deb
```

| 要点 | 说明 |
|------|------|
| ⚠️ **路径** | 在 `~` 下用相对路径会报 `E: 命令行中有不支持的文件` —— **那是路径不存在，不是包有问题** |
| ⚠️ **免卸载** | 同名同版本（1.54.0）直接覆盖即可，旧包独有的只有目录项 |
| 安装后位置 | 程序 `/usr/lib/cortex`；入口 `/usr/bin/cortex` → `../lib/cortex/Cortex`；后端 `/usr/lib/cortex/resources/bin/cortex`；桌面项 `/usr/share/applications/cortex.desktop` |
| 图标 | `/usr/share/pixmaps/cortex.png`（gjs/Gio 实测解析为 `FileIcon`） |
| 深链 | `cortex://` |
| **上游 Goose 并存** | Goose 1.54.0 仍在 `/usr/bin/goose`，两者并存，数据与深链互不干扰 |
| 验收 | `dpkg-query -s cortex` 应为 `install ok installed`；`cortex --version` = 1.54.0；`resources/bin/cortex` 的 sha256 应与构建产物**逐字节一致** |

---

## 5. 开发态 GUI 启动（隔离根）

```bash
export GOOSE_DISABLE_KEYRING=1
# ⚠️ 必须先 export 再启动，避免 $GOOSE_PATH_ROOT 展开为空污染真实目录
export GOOSE_PATH_ROOT="/tmp/opencode/<your-dir>"
export GOOSE_BINARY="/tmp/opencode/cortex-rust-target/release/cortex"
export ENABLE_PLAYWRIGHT=1
export PLAYWRIGHT_DEBUG_PORT=9333

cd ui/desktop
pnpm run start-gui -- --user-data-dir="$GOOSE_PATH_ROOT/electron-userdata"
```

### 5.1 定点点击（非全量 E2E）
仓库已有 `@playwright/test`，可直接连 CDP 驱动目标窗口：
```js
chromium.connectOverCDP('http://127.0.0.1:9333')
```

⚠️ **孤儿 backend**：启动脚本被杀时可能留下孤儿后端进程，**必须单独核对**。
⚠️ `pkill` 要用**精确匹配**避免误杀安装版，例如：
```
pkill -f '^/home/rarestcsc/Cortex/ui/node_modules/electron/dist/electron( |$)'
```

### 5.2 隔离合规性取证
dev 态经 `GOOSE_PATH_ROOT` 运行、**不写真实 `~/.config/cortex`** ⇒ 真实配置目录的时间戳变化只可能来自正式版。可用文件时间戳证明（`sessions.db` 持续活动、`custom_providers/` 变更 ⇒ 正式版在跑）。

### 5.3 已装 GUI 端口
9333 / 9444 / 9445 应空闲。

---

## 6. 验证命令清单

```bash
# 类型检查（勿用 pnpm run typecheck）
node ui/node_modules/typescript/bin/tsc --noEmit

# i18n
TMPDIR=/tmp/opencode pnpm run i18n:check

# Rust
cargo fmt --all && cargo fmt --all --check
git diff --check          # 在仓库根
cargo test -p cortex-provider-types --lib
cargo test -p cortex-providers --lib
cargo test -p cortex --lib --features scheduler,acp-http,tree-sitter,code-mode,platform-apps,chat-recall,rustls-tls
cargo test -p cortex-cli --lib
# 集成测试（务必跑）
cargo test -p cortex --features scheduler,acp-http,tree-sitter,code-mode,platform-apps,chat-recall,rustls-tls --test <name>

# 死类扫描（需 vite dev server 或 --css /tmp/gen.css）
cd ui/desktop && python3 scripts/scan-dead-classes.py
```

⚠️ **测试失败必须回旧仓库跑同一用例确认是否既有，不能默认归因本次改动。**

---

## 7. 打包/安装侧的已知行为

| 项 | 说明 |
|----|------|
| deb **无 maintainer 脚本** | 升级不会跑自定义钩子 |
| 界面残留 goose 字样 | 仅 3 处，均为**故意保留**：`aboutSection.compatBody`（解释 `GOOSE_*` 保留原因）、`/home/goose/workspace` 占位符、`.goosehints` 文件名 |
| 托盘图标 | `icon-tray.png` / `icon-tray@2x.png`。⚠️ **不能用 `iconTemplate.png`**（macOS 模板图，面板按前景色重绘 ⇒ 深/浅主题都可能不可见） |
| 托盘 GNOME 不显示 | `Impossible to get basic properties: GDBus.Error`（`appIndicator.js`），Electron↔libayatana 属性读取失败 ⇒ **平台问题，Cortex 侧无可改之处，勿改** |
| ⚠️ Vite 生产构建 mangle 标识符 | **grep 压缩后的 asar 找组件名不可靠**（`StartupSplash` 0 命中）。判二进制是否过期用 `find crates -name '*.rs' -newer <bin>` |

---

## 8. 未做 / 未验证

- macOS / Windows 产物未跑
- **rpm / flatpak 未打包**（缺 `rpmbuild` / `flatpak-builder`）
- **从未做过 wire 抓包**（真实 HTTP reasoning 层级从未验证）
- 打包安装版的功能层验收需用户在正式版实测（文件层只能证明二进制换对了）
