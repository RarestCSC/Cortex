# goose-sdk

Python bindings for the goose Development Kit (GDK).

This package is generated from the Rust `goose-sdk` crate using UniFFI.

## Build a local wheel

From the repository root:

```bash
just --justfile crates/cortex-sdk/justfile python-wheel
```

The wheel is written to `crates/cortex-sdk/python/dist/`.
