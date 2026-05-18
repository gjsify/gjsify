---
title: Distribute your GJS app
description: Ship a one-line installer for your gjsify-based npm package.
---

The same Node-free bootstrap that installs `@gjsify/cli` also installs
**any GJS-runnable package on npm** — including yours.

## Generate an installer for your package

From the root of your gjsify app:

```bash
gjsify generate-installer
```

This writes `install.mjs` to the current directory, with three constants
substituted for your package: the npm name (from `package.json#name`),
the bin name (the first key of `gjsify.bin` or `bin`), and the gjsify
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

1. Downloads the pinned `cli.gjs.mjs` bootstrap bundle from the gjsify
   GitHub release, verifies SHA-256.
2. Spawns `gjs -m <bundle> install -g <your-package>` — `@gjsify/cli`'s
   install backend resolves your package's transitive dependencies
   (including any native prebuilds), writes them under
   `~/.local/share/gjsify/global/`, and creates the
   `~/.local/bin/<your-bin>` launcher.

No Node, no npm, no yarn on the user's machine. Just `gjs ≥ 1.86`
(included with Fedora 43+, Debian 13+, Arch) and `curl`.

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
| `--bootstrap-url <url>` | gjsify GitHub `releases/latest/download/cli.gjs.mjs` |
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

- Any native prebuilds (`.so` + `.typelib`) declared as runtime
  dependencies of packages that contain a `gjsify.prebuilds` field.
  `@gjsify/cli`'s install backend walks those automatically and sets
  `LD_LIBRARY_PATH` / `GI_TYPELIB_PATH` for the bin launcher.

## Reference implementations

- [`@gjsify/cli`](https://github.com/gjsify/gjsify/tree/main/packages/infra/cli)
  itself — the canonical example. Its root `install.mjs` is the
  template `gjsify generate-installer` writes.
- [`@ts-for-gir/cli`](https://github.com/gjsify/ts-for-gir) — multi-bin
  GJS app distributed via the same bootstrap.
