---
title: Development Setup
description: Clone the GJSify monorepo and build it locally
---

This page is for **contributors** working on the GJSify monorepo itself. If you just want to use GJSify in your own project, head to [Getting Started](/gjsify/getting-started/) instead.

## Prerequisites

- **GJS** 1.86+ (GNOME 49+)
- **Node.js** 24+ (only for `node:` runtime parity testing; not required for install/build/publish)
- GNOME development libraries: `glib2-devel`, `gobject-introspection-devel`, `gtk4-devel`, `libsoup3-devel`, `vala`, `blueprint-compiler`

> `blueprint-compiler` is here and NOT in [Getting Started](/gjsify/getting-started/) on purpose. Building a `.blp` needs nothing on the machine — the transform is in `@gjsify/blueprint` (ADR 0053 clause 5). Contributors need the binary because it is the **oracle** the corpus is measured against: `node scripts/check-blueprint-corpus.mjs --require-oracle` recompiles every golden with it and refuses to pass without it, and `scripts/check-doc-fences.mjs`'s ORACLE stage uses it for the ParamSpec validation the parser does not do. Without it those runs skip or fail, which is the only thing you lose.

On Fedora:

```bash
sudo dnf install gjs gtk4-devel glib2-devel gobject-introspection-devel libsoup3-devel vala blueprint-compiler
```

> The monorepo bootstraps from the **published** `gjsify` (ADR 0002). No yarn, no Corepack, no Node-only npm CLI, and no committed bundle in the checkout. `install.mjs` downloads the release asset, verifies its SHA-256 and caches it by digest.
>
> Use the FULL `install.mjs`, not `--fetch-only`: only the full mode runs `gjsify install -g @gjsify/cli`, which puts `@gjsify/tsc` beside the CLI. On a host with no Node that global copy is the only thing `gjsify tsc` can resolve, and `build:infra` starts with a `gjsify tsc`.

## Clone and build

```bash
git clone https://github.com/gjsify/gjsify.git
cd gjsify

# Fetch + install the published gjsify (no yarn / Node required)
gjs -m install.mjs

# Install this checkout's dependencies with it
gjsify install --immutable

# Build the toolchain the rest of the repo is built with
gjsify run build:infra

# From here on, `gjsify` is on $PATH via node_modules/.bin
PATH="$PWD/node_modules/.bin:$PATH"

# Build all packages
gjsify run build

# Run the full test suite on Node.js and GJS
gjsify run test
```

## Common commands

```bash
gjsify run build      # Build every workspace package
gjsify run build:infra # Only the CLI and build tooling
gjsify run check      # Type-check all packages
gjsify run test       # Run tests on Node.js and GJS
gjsify run clear      # Remove all build outputs
```

Per-package workflows follow the same pattern:

```bash
cd packages/node/fs
gjsify run build:gjsify     # Build the package
gjsify run build:test:gjs   # Build the GJS test bundle
gjsify run test:gjs         # Run tests under GJS
gjsify run test:node        # Run the same tests under Node.js
```

## Next steps

- [Architecture](/gjsify/contributing/architecture/): monorepo structure, build system and GNOME library mappings
- [TDD Workflow](/gjsify/contributing/tdd-workflow/): how to port a new Node.js or Web API to GJS test-first
