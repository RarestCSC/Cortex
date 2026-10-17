<div align="center">

# Cortex

_A native AI agent desktop app — built on Rust and Electron_

<p align="center">
  <a href="https://opensource.org/licenses/Apache-2.0"
    ><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
</p>

</div>

Cortex is a self-contained AI agent that runs on your machine: an Electron desktop
app backed by a Rust core, with a CLI for terminal workflows.

## What it is

- **Desktop app** — Electron + React UI (`ui/desktop`), talking to the Rust backend
  over the Agent Client Protocol.
- **Rust core** — providers, sessions, extensions, recipes, schedules
  (`crates/cortex`, `crates/cortex-providers`, …).
- **CLI** — the `cortex` binary (`crates/cortex-cli`).
- **Independent** — no telemetry, no update checks, no upstream network calls.
  Your model providers and MCP servers still work normally.

## Layout

```
crates/           Rust workspace (cortex, cortex-cli, cortex-providers, ...)
ui/desktop/       Electron app
ui/acp-client/    TypeScript ACP client (@cortex/acp-client)
scripts/          Development and diagnostics helpers
docs/             Project notes
```

## Building

The desktop app needs the backend binary staged at `ui/desktop/src/bin/cortex`.

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo build --release -p cortex-cli --bin cortex
just copy-binary
```

Then install UI dependencies and start the app:

```bash
cd ui && pnpm install
cd desktop && pnpm run start-gui
```

Package a Linux x64 build with:

```bash
cd ui/desktop && pnpm run make
```

Artifacts land in `ui/desktop/out/make/`.

## Development

```bash
just build          # debug backend
just release-binary # release backend + stage it for the desktop app
just typecheck      # UI type check
just fmt            # cargo fmt
just clippy         # clippy with -D warnings
just i18n-extract   # regenerate i18n messages
```

## Configuration

Runtime data lives under `~/.config/cortex` and `~/.local/share/cortex`.
Secrets are stored in the system keyring under the `cortex` service.

## Attribution

Cortex is derived from [goose](https://github.com/aaif-goose/goose), which is
part of the Agentic AI Foundation at the Linux Foundation. Licensed under the
Apache License 2.0 — see [LICENSE](LICENSE). Portions carry MIT attribution;
see the license files in third-party sources.