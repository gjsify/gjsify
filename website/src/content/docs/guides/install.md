---
title: Install & Update
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

> **Platform support.** The global install additionally lays down the GJS-native
> engine set — `@gjsify/rolldown-native`, `@gjsify/lightningcss-native`,
> `@gjsify/oxfmt-native`. The CLI locates prebuilds for whatever host it runs on
> (and exports `DYLD_LIBRARY_PATH` on macOS / `PATH` on Windows rather than
> Linux's `LD_LIBRARY_PATH`), but `@gjsify/rolldown-native` — the only bundler
> engine `gjsify build` has under GJS — currently publishes `linux-x64` and
> `linux-arm64` only. A **Node-free** GJSify toolchain is therefore still
> Linux-only. On macOS and Windows GJSify works with Node installed, using the
> npm `rolldown` / `lightningcss` / `oxfmt` packages instead. See
> [Platform Support](/gjsify/platform-support/) for the per-package matrix and
> [How It Works → Native prebuilds](/gjsify/how-it-works/#native-prebuilds-and-gjsify-run)
> for how a prebuild directory is located.

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
gjs -m /tmp/g.mjs --tag 0.18.0
```

`--tag` accepts npm dist-tags (`latest`, `next`) or pinned versions (`0.18.0`).

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

### Which runtime does the installed `gjsify` default to?

`gjsify` follows whichever runtime is running it. The Node-free bootstrap
above installs a GJS bundle, so its `--app` build target and `--runtime`
default to `gjs`; `npm install -g @gjsify/cli` runs on Node, so those default
to `node`; invoking the CLI via `bunx @gjsify/cli` or `deno run
npm:@gjsify/cli` defaults to `bun`/`deno` respectively (all three consume the
same `--app node` bundle). Override explicitly with `--app`/`--runtime` — see
[Runtimes](/gjsify/runtimes/). (`gjsify showcase` is the exception: a showcase's
canonical artifact is its `--app gjs` bundle, so it defaults to `gjs` whenever
`gjs` is installed, whatever the host.)

### Which VERSION does `npx` / `bunx` / `deno run` give you?

Not necessarily the latest one, and the difference is not visible in the output
of the command that fails because of it. All three runners reuse a **cached**
copy of an unpinned bin, so the same `npx @gjsify/cli …` can keep serving a
release from months ago. Pin the tag to force a resolve:

```bash
npx @gjsify/cli@latest showcase excalibur-jelly-jumper
bunx @gjsify/cli@latest showcase excalibur-jelly-jumper
deno run -A --reload npm:@gjsify/cli@latest showcase excalibur-jelly-jumper
```

Deno adds a second rule: `minimumDependencyAge` (24 h by default) refuses a
version published more recently than that — so a same-day release is skipped in
favour of an older one until it ages in. Deno says so explicitly when you pin
the version; when you don't, it quietly resolves to the older one. Pass
`--min-dep-age=0` (or set `"minimumDependencyAge"` in `deno.json`) to opt out.

`gjsify showcase` prints the CLI version it is running as (`[gjsify 0.24.1]`),
so if a showcase misbehaves, check that line first.

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
