---
title: Distribute your GJS app
description: Two ways to put a GJS app on someone else's machine — a one-line Node-free installer, or a .deb/.rpm via gjsify ship.
---

There are two ways to put a GJS app on someone else's machine, and they answer
different questions.

| | `gjsify generate-installer` | `gjsify ship` |
|---|---|---|
| Produces | a one-line `curl … \| gjs` installer | a `.deb` / `.rpm` |
| Installs into | `~/.local/` (per user, no root) | the system, via the distro package manager |
| User needs | `gjs ≥ 1.86` and `curl` | nothing but their package manager |
| Updates | re-run the installer | `apt upgrade` / `dnf upgrade` |
| Best for | early adopters, CLI tools, anything you iterate on quickly | a release you want a distro user to install and forget |

This page is about the first. The second is
[`gjsify ship`](/gjsify/cli-reference/#gjsify-ship) — one staged payload wrapped
per format, with the design recorded in
[ADR 0024](https://github.com/gjsify/gjsify/blob/main/docs/adr/0024-ship-installable-artifacts.md).
They are not exclusive: the same built bundle feeds both.

One thing to know before reaching for a `.deb`: the emitted dependency is
`gjs (>= 1.86)`, and **no released Debian satisfies it** — Debian went 1.82.3
(trixie) straight to 1.88.1 (forky), skipping 1.84 and 1.86. `gjsify ship` says
so at package time rather than lowering the floor quietly, because a package apt
refuses is better than one that installs and then dies on a syntax error.

The same Node-free bootstrap that installs `@gjsify/cli` also installs
**any GJS-runnable package on npm** — including yours.

## Generate an installer for your package

From the root of your GJSify app:

```bash
gjsify generate-installer
```

This writes `install.mjs` to the current directory, with three constants
substituted for your package: the npm name (from `package.json#name`),
the bin name (the first key of `gjsify.bin` or `bin`), and the GJSify
bootstrap URL (defaults to
`https://github.com/gjsify/gjsify/releases/latest/download/cli.gjs.mjs`).

Commit the generated `install.mjs`:

```bash
git add install.mjs && git commit -m "chore: add gjsify-based installer"
git push
```

Your README's install instructions become:

```bash
curl -fsSL https://github.com/<you>/<repo>/raw/main/install.mjs \
  -o /tmp/i.mjs && gjs -m /tmp/i.mjs && rm /tmp/i.mjs
```

## What it does for your users

1. Downloads the pinned `cli.gjs.mjs` bootstrap bundle from the GJSify
   GitHub release, verifies SHA-256.
2. Spawns `gjs -m <bundle> install -g <your-package>` — `@gjsify/cli`'s
   install backend resolves your package's transitive dependencies
   (including any native prebuilds), writes them under
   `~/.local/share/gjsify/global/`, and creates the
   `~/.local/bin/<your-bin>` launcher.

No Node, no npm, no yarn on the user's machine. Just `gjs ≥ 1.86`
(included with Fedora 43+, Arch, and Debian forky/sid — Debian 13 "trixie" ships
1.82.3 and does not qualify) and `curl`.

## Customise

```bash
gjsify generate-installer \
  --target @my-org/my-app \
  --bin-name my-app \
  --bootstrap-url https://example.com/cli.gjs.mjs \
  --output bin/install.mjs
```

| Flag | Default |
|---|---|
| `[target]` (positional) | `package.json#name` |
| `--bin-name <name>` | first key of `gjsify.bin` or `bin` |
| `--bootstrap-url <url>` | GJSify GitHub `releases/latest/download/cli.gjs.mjs` |
| `--output <file>` | `install.mjs` (in cwd) |
| `--force` | overwrite existing |

For airgapped environments or forks, host your own bootstrap bundle and
point `--bootstrap-url` at it. The generated `install.mjs` honors a
`GJSIFY_INSTALL_BOOTSTRAP_URL` env var at runtime so users can override
it without editing the script.

## Requirements for your package

Your published package needs:

- `gjsify.bin` (or `bin`) in `package.json` pointing at the GJS entry
  bundle:

  ```json
  {
    "gjsify": { "bin": { "my-app": "./dist/my-app.gjs.mjs" } }
  }
  ```

- The bundle built with `gjsify build … --app gjs --shebang` so the
  installed launcher works correctly. (The launcher will wrap with
  `exec gjs -m '<bundle>'` for any `.mjs` target, so the shebang is
  optional — but recommended.)

- Any native prebuilds (`.so` / `.dylib` / `.dll` + `.typelib`) declared as
  runtime dependencies of packages that contain a `gjsify.prebuilds` field.
  `@gjsify/cli`'s install backend walks those automatically and bakes the
  directories it finds into the bin launcher's environment.

  The walk resolves `prebuilds/<os>-<arch>/` for the running host. There is one
  spelling — `${process.platform}-${process.arch}` (`linux-x64`, `linux-arm64`,
  `darwin-arm64`, `win32-x64`) — which is exactly what a running process can
  compute about itself, so nothing has to be translated. A package's own
  `gjsify.platforms` entry is still probed first, and the retired uname
  spelling (`linux-x86_64`) is accepted as a fallback so tarballs published
  before the rename keep loading. The launcher exports `GI_TYPELIB_PATH` plus
  the library-search variable the host loader reads: `LD_LIBRARY_PATH` on
  Linux, `DYLD_LIBRARY_PATH` on macOS, `PATH` on Windows.

  So the *resolution* is cross-platform. Whether your app runs off Linux still
  depends on whether its native dependencies actually publish an artifact for
  that host — see [Platform Support](/gjsify/platform-support/) for the
  per-package matrix.

## Reference implementations

- [`@gjsify/cli`](https://github.com/gjsify/gjsify/tree/main/packages/infra/cli)
  itself — the canonical example. Its root `install.mjs` is the
  template `gjsify generate-installer` writes.
- [`@ts-for-gir/cli`](https://github.com/gjsify/ts-for-gir) — multi-bin
  GJS app distributed via the same bootstrap.
