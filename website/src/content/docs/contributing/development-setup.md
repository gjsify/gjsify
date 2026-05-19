---
title: Development Setup
description: Clone the gjsify monorepo and build it locally
---

This page is for **contributors** working on the GJSify monorepo itself. If you just want to use GJSify in your own project, head to [Getting Started](/gjsify/getting-started/) instead.

## Prerequisites

- **GJS** 1.86+ (GNOME 49+)
- **Node.js** 24+ (only for `node:` runtime parity testing; not required for install/build/publish)
- GNOME development libraries: `glib2-devel`, `gobject-introspection-devel`, `gtk4-devel`, `libsoup3-devel`, `vala`, `blueprint-compiler`

On Fedora:

```bash
sudo dnf install gjs gtk4-devel glib2-devel gobject-introspection-devel libsoup3-devel vala blueprint-compiler
```

> Phase D.7d retired the yarn dependency. The monorepo bootstraps via the committed `packages/infra/cli/dist/cli.gjs.mjs` GJS bundle — no yarn, no Corepack, no Node-only npm CLI needed on a fresh checkout.

## Clone and build

```bash
git clone https://github.com/gjsify/gjsify.git
cd gjsify

# Install dependencies via the committed GJS bundle (no yarn / Node required)
gjs -m packages/infra/cli/dist/cli.gjs.mjs install --immutable

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
gjsify run build:node # Only the Node.js targets
gjsify run build:web  # Only the Web API targets
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

- [Architecture](/gjsify/contributing/architecture/) — monorepo structure, build system and GNOME library mappings
- [TDD Workflow](/gjsify/contributing/tdd-workflow/) — how to port a new Node.js or Web API to GJS test-first
