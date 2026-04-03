---
title: Getting Started
description: Prerequisites and quick start for GJSify development
---

GJSify brings the Node.js and Web API ecosystem to [GJS](https://gjs.guide/) — the GNOME JavaScript runtime. Write familiar JavaScript, run it natively on GNOME — backed by GLib, Gio, Soup, Cairo, and GTK.

## Prerequisites

- **GJS** 1.84+ (GNOME 46+)
- **Node.js** 24+
- **Yarn** 4.x (via Corepack)
- GNOME development libraries: `glib2-devel`, `gobject-introspection-devel`, `gtk4-devel`, `libsoup3-devel`

## Quick Start

```bash
# Clone the repository
git clone https://github.com/gjsify/gjsify.git
cd gjsify

# Install dependencies
corepack enable
yarn install

# Build all packages
yarn build

# Run tests
yarn test
```

## Create a New App

```bash
npx create-gjsify my-app
cd my-app
yarn install
yarn build
yarn start
```

## Next Steps

- [Architecture](/gjsify/architecture/) — Understand the monorepo structure
- [Packages](/gjsify/packages/overview/) — Browse available modules
- [Contributing](/gjsify/contributing/) — Help improve GJSify
