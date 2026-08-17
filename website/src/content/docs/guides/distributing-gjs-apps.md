---
title: Ship a one-line installer
description: Generate an install.mjs so people install your GJS app with one curl command, without Node and without root.
---

Pick this route when you iterate fast and want users on the newest version
today rather than whenever a distro package catches up; everything lands under
`~/.local`, so no `sudo` is involved. The other routes (deb, rpm, Flatpak, dlx)
are compared on [Ship your app](/gjsify/ship/).

## Generate the installer

From the root of your app:

```bash
gjsify generate-installer
```

That writes `install.mjs` next to your `package.json`, already filled in with
your npm package name, your bin name (the first key of `gjsify.bin`, else of
`bin`), and the URL of the gjsify bootstrap bundle.

Commit it:

```bash
git add install.mjs && git commit -m "chore: add the gjsify installer"
git push
```

Your README's install section is now a single command:

```bash
curl -fsSL https://github.com/<you>/<repo>/raw/main/install.mjs \
  -o /tmp/i.mjs && gjs -m /tmp/i.mjs && rm /tmp/i.mjs
```

## What your users get

The script downloads the pinned `cli.gjs.mjs` bootstrap bundle, verifies it
against the published SHA-256, and uses it to install your package from npm
with its dependencies and any native prebuilds. Your package lands in
`~/.local/share/gjsify/global/`, and a launcher appears at
`~/.local/bin/<your-bin>`.

Nothing else has to be on their machine: no Node, no npm, no yarn. They need
`curl` and `gjs` 1.86 or newer. Fedora 43+, Arch and Debian forky/sid qualify;
Debian 13 "trixie" ships 1.82.3 and does not, and the installer says so with
the right `apt` line instead of failing halfway.

## Options your users can pass

The generated `install.mjs` takes flags of its own, so someone can pin a
version or reuse the script for a different package:

```bash
gjs -m install.mjs --tag 1.4.0            # a version or an npm dist-tag
gjs -m install.mjs --force                # reinstall over an existing copy
gjs -m install.mjs --target @me/other-pkg
gjs -m install.mjs --help
```

It also reads four environment variables:

| Variable | Effect |
|---|---|
| `GJSIFY_GLOBAL_PREFIX` | Install prefix. Default `~/.local/share/gjsify/global`. |
| `GJSIFY_GLOBAL_BIN_DIR` | Where the launcher goes. Default `~/.local/bin`. |
| `GJSIFY_INSTALL_BOOTSTRAP_URL` | Alternate bootstrap bundle. A `file://` URL works. |
| `GJSIFY_INSTALL_REGISTRY` | npm registry override. |

## Change what gets generated

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
| `--bin-name <name>` | first key of `gjsify.bin`, else of `bin` |
| `--bootstrap-url <url>` | gjsify's GitHub `releases/latest/download/cli.gjs.mjs` |
| `--output <file>` | `install.mjs` in the current directory |
| `--force` | overwrite an existing file |

On an airgapped network, or from a fork, host your own bootstrap bundle and
point `--bootstrap-url` at it. Users can still override it per run with
`GJSIFY_INSTALL_BOOTSTRAP_URL`, so you don't need a second script for the
exceptions.

## Make your package installable

Two things have to be true of what you publish. First, `package.json` names the
GJS entry bundle:

```json
{
  "gjsify": {
    "bin": { "my-app": "./dist/my-app.gjs.mjs" }
  }
}
```

Second, that bundle is built for GJS:

```bash
gjsify build src/index.ts --app gjs --outfile dist/my-app.gjs.mjs --shebang
```

`--shebang` prepends `#!/usr/bin/env -S gjs -m` and marks the file executable.
The installed launcher wraps any `.mjs` target in `exec gjs -m …` regardless,
so this is optional; with it, the file also runs when someone invokes it
directly.

If your app depends on packages carrying native prebuilds, there is nothing to
configure. The installer walks them and bakes the matching typelib and library
search paths into the launcher. Which prebuilds exist for which host is a
separate question, answered in
[Platform Support](/gjsify/platform-support/); how the lookup works is in
[How It Works](/gjsify/how-it-works/).

## Working examples

- [`@gjsify/cli`](https://github.com/gjsify/gjsify/tree/main/packages/infra/cli)
  ships the `install.mjs` that this command copies and substitutes into.
- [`@ts-for-gir/cli`](https://github.com/gjsify/ts-for-gir) uses the same
  bootstrap for a package with several bins.
