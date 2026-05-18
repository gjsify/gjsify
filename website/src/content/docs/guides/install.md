---
title: Install gjsify
description: Bootstrap @gjsify/cli on any GNOME machine — no Node, no npm.
---

## Recommended: Node-free bootstrap (gjs ≥ 1.86)

```bash
curl -fsSL https://github.com/gjsify/gjsify/releases/latest/download/install.mjs \
  -o /tmp/g.mjs && gjs -m /tmp/g.mjs && rm /tmp/g.mjs
```

The `install.mjs` script is a tiny stock-GJS bootstrap (~250 LoC, only
GLib / Gio / Soup 3) that:

1. Downloads the pinned `cli.gjs.mjs` bundle from the GitHub release.
2. Verifies its SHA-256 against a sidecar `.sha256` asset.
3. Caches it under `$XDG_CACHE_HOME/gjsify/bootstrap/`.
4. Spawns `gjs -m <bundle> install -g @gjsify/cli` — the full CLI then
   handles transitive dependency resolution, native prebuilds, lockfile,
   and the `~/.local/bin/gjsify` launcher.

After install:

- The CLI tree lives under `~/.local/share/gjsify/global/node_modules/`.
- A POSIX `sh` launcher is written to `~/.local/bin/gjsify`. Add that
  directory to your `PATH` if it isn't already:

  ```bash
  export PATH="$HOME/.local/bin:$PATH"
  ```

### Refresh in place

```bash
gjsify self-update         # install the latest release
gjsify self-update --check # check without installing
gjsify self-update --tag next   # opt into a different dist-tag
```

### Pin a specific version

```bash
gjs -m /tmp/g.mjs --tag 0.4.10
```

`--tag` accepts npm dist-tags (`latest`, `next`) or pinned versions (`0.4.10`).

### Custom install location

```bash
GJSIFY_GLOBAL_PREFIX=$HOME/.gjsify GJSIFY_GLOBAL_BIN_DIR=$HOME/.gjsify/bin \
  gjs -m /tmp/g.mjs
```

The install backend honors `GJSIFY_GLOBAL_PREFIX` (default
`~/.local/share/gjsify/global`) and `GJSIFY_GLOBAL_BIN_DIR` (default
`~/.local/bin`).

## Alternative: npm install

```bash
npm install -g @gjsify/cli
```

Still fully supported. Choose this if you already manage developer
tooling via npm and don't mind keeping Node on the path.

## Prerequisites

The bootstrap script requires:

- **gjs ≥ 1.86** — bundled with Fedora 43+, Debian 13+, Arch
- **curl** (or `wget`) — universally available
- An internet connection for the initial bootstrap; subsequent
  installs and updates resolve from cache when possible.

If `gjs` is older than 1.86 the bootstrap aborts with a clear message
pointing at install commands for the major distributions.

## Uninstall

```bash
rm -rf ~/.local/share/gjsify ~/.local/bin/gjsify
```

The bootstrap cache at `~/.cache/gjsify/` is safe to delete at any
time — the next install or update rebuilds it.
