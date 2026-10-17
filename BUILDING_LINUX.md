# Building Cortex Desktop on Linux

This guide covers building the Cortex desktop application from source on Linux.

## Prerequisites

### System Dependencies

**Debian/Ubuntu:**
```bash
sudo apt update
sudo apt install -y dpkg fakeroot build-essential clang libxcb1-dev libxcb-util-dev protobuf-compiler libvulkan-dev libvulkan1 glslc
```

**Fedora/RHEL/CentOS:**
```bash
sudo dnf install -y dpkg fakeroot gcc-c++ clang-devel libxcb-devel libxcb-util-devel protobuf-compiler vulkan-devel glslc
```

### Toolchain

- **Rust**: see `rust-toolchain.toml` (`cargo install just` for the task runner)
- **Node.js**: 20 or later
- **pnpm**: 10 or later

## Build Process

### 1. Build the backend

```bash
cargo build --release -p cortex-cli --bin cortex
```

### 2. Stage the backend for the desktop app

The Electron app loads the backend from `ui/desktop/src/bin/cortex`, which is
git-ignored. `just release-binary` does both steps:

```bash
just release-binary
```

Or manually:

```bash
mkdir -p ui/desktop/src/bin
cp target/release/cortex ui/desktop/src/bin/cortex
```

### 3. Install UI dependencies

```bash
cd ui && pnpm install
```

### 4. Build the application

#### ZIP (works on all distributions)
```bash
cd ui/desktop
pnpm run make --targets=@electron-forge/maker-zip
```
Output: `out/make/zip/linux/x64/`

#### DEB (Debian/Ubuntu)
```bash
cd ui/desktop
pnpm run make --targets=@electron-forge/maker-deb
```
Output: `out/make/deb/x64/`

#### All targets
```bash
cd ui/desktop
pnpm run make
```

### 5. Run

```bash
cd ui/desktop
pnpm run start-gui     # development
./out/Cortex-linux-x64/Cortex   # packaged build
```

## Troubleshooting

### Missing system dependencies

Errors about `dpkg`, `fakeroot`, Vulkan headers or `glslc` mean the
distribution packages listed under Prerequisites are missing.

### GLib warnings

```
GLib-GObject: instance has no handler with id
```

Harmless. To suppress, pipe stderr:

```bash
./Cortex 2>&1 | grep -v "GLib-GObject" | grep -v "browser_main_loop"
```

### Backend binary not found

If the app reports the backend is missing, confirm:

1. The binary was built: `cargo build --release -p cortex-cli --bin cortex`
2. It was staged: `just copy-binary` (copies to `ui/desktop/src/bin/cortex`)
3. The app was rebuilt after staging

### Icon not shown in the launcher

Use an absolute path for `Icon=` in the desktop entry. `Icon=cortex` alone
resolves as a `ThemedIcon` and falls back to a generic placeholder.

## Development workflow

1. **Backend changes**: `just release-binary`, then restart the app
2. **Frontend changes**: `pnpm run start-gui` reloads automatically
3. **Type checking**: `just typecheck`
4. **Formatting and lints**: `just fmt`, `just clippy`

## Desktop entry

```ini
[Desktop Entry]
Name=Cortex
Comment=Local AI agent
Exec=/usr/lib/cortex/Cortex %U
Icon=/usr/share/pixmaps/cortex.png
Terminal=false
Type=Application
Categories=Development;Utility;
StartupNotify=true
MimeType=x-scheme-handler/cortex;
```

`MimeType` registers the `cortex://` deep link.