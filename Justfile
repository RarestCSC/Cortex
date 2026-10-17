# Cortex — development tasks
#
# Scope: Linux x64 desktop app. Cross-platform release, container and npm
# publishing automation from upstream is intentionally not carried over.

set shell := ["bash", "-uc"]

version := "1.54.0"
cli_bin := "cortex"

# --- Build -------------------------------------------------------------------

# Debug build of the backend CLI.
build:
    cargo build -p cortex-cli --bin {{cli_bin}}

# Release build, then stage the binary where the desktop app expects it.
release-binary:
    cargo build --release -p cortex-cli --bin {{cli_bin}}
    just copy-binary

# Copy the freshly built binary into the desktop app's resource directory.
copy-binary:
    mkdir -p ui/desktop/src/bin
    cp -p target/release/{{cli_bin}} ui/desktop/src/bin/{{cli_bin}}
    @echo "Staged ui/desktop/src/bin/{{cli_bin}}"

# --- Test --------------------------------------------------------------------

test-rust:
    cargo test -p cortex

test-ui:
    cd ui/desktop && pnpm run test

typecheck:
    cd ui/desktop && pnpm run typecheck

# --- Lint --------------------------------------------------------------------

fmt:
    cargo fmt --all

fmt-check:
    cargo fmt --all -- --check

clippy:
    cargo clippy --all-targets -- -D warnings

# --- ACP schema / generated client -------------------------------------------

# Regenerate the ACP JSON schema from the Rust types.
generate-acp-schema:
    cd crates/cortex && cargo run --features code-mode,local-inference,aws-providers,otel,rustls-tls,system-keyring --bin generate-acp-schema

# Regenerate the TypeScript client from the schema (requires the schema first).
generate-acp-types: generate-acp-schema
    cd ui/acp-client && npx tsx generate-schema.ts

# --- i18n --------------------------------------------------------------------

i18n-extract:
    cd ui/desktop && pnpm run i18n:extract

i18n-check:
    cd ui/desktop && pnpm run i18n:check

# --- Desktop -----------------------------------------------------------------

# Start the desktop app in dev mode (Playwright/debug port enabled).
run-ui:
    cd ui/desktop && pnpm run start-gui

package-ui:
    cd ui/desktop && pnpm run package

make-ui:
    cd ui/desktop && pnpm run make

# --- Housekeeping ------------------------------------------------------------

# Remove build artifacts.
clean:
    cargo clean
    rm -rf ui/desktop/out ui/desktop/.vite