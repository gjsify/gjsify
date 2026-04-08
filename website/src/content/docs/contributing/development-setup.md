---
title: Development Setup
description: Clone the gjsify monorepo and build it locally
---

This page is for **contributors** working on the GJSify monorepo itself. If you just want to use GJSify in your own project, head to [Getting Started](/gjsify/getting-started/) instead.

## Prerequisites

- **GJS** 1.84+ (GNOME 46+)
- **Node.js** 24+
- **Yarn** 4.x (via Corepack)
- GNOME development libraries: `glib2-devel`, `gobject-introspection-devel`, `gtk4-devel`, `libsoup3-devel`, `vala`, `blueprint-compiler`

On Fedora:

```bash
sudo dnf install gjs gtk4-devel glib2-devel gobject-introspection-devel libsoup3-devel vala blueprint-compiler
```

## Clone and build

```bash
git clone https://github.com/gjsify/gjsify.git
cd gjsify

# Install dependencies
corepack enable
yarn install

# Build all packages
yarn build

# Run the full test suite on Node.js and GJS
yarn test
```

## Common commands

```bash
yarn build            # Build every workspace package
yarn build:node       # Only the Node.js targets
yarn build:web        # Only the Web API targets
yarn check            # Type-check all packages
yarn test             # Run tests on Node.js and GJS
yarn clear            # Remove all build outputs
```

Per-package workflows follow the same pattern:

```bash
cd packages/node/fs
yarn build:gjsify         # Build the package
yarn build:test:gjs       # Build the GJS test bundle
yarn test:gjs             # Run tests under GJS
yarn test:node            # Run the same tests under Node.js
```

## Next steps

- [Architecture](/gjsify/contributing/architecture/) — monorepo structure, build system and GNOME library mappings
- [TDD Workflow](/gjsify/contributing/tdd-workflow/) — how to port a new Node.js or Web API to GJS test-first
