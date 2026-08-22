# @gjsify/cli

CLI tool for building and running GJS applications. Bundles TypeScript/JavaScript with
[Rolldown](https://rolldown.rs/), resolving each `node:*` import onto gjsify's
GNOME-backed implementation for a GJS target and onto the runtime's own for a Node,
Bun or Deno one — from unchanged source.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

The CLI runs on GJS, Node.js, Bun and Deno, and it installs on all four. On a GNOME box
`gjs` ≥ 1.86 and `curl` are enough — no Node.js at install time or ever after:

```bash
curl -fsSL https://github.com/gjsify/gjsify/releases/latest/download/install.mjs \
  -o /tmp/g.mjs && gjs -m /tmp/g.mjs && rm /tmp/g.mjs
```

That lays the CLI down under `~/.local/share/gjsify/global/` with a launcher at
`~/.local/bin/gjsify`; `gjsify self-update` refreshes it in place. Windows has no `gjs`
binary, so take one of the other three there. Pick a single route — each of them puts its
own `gjsify` launcher on your PATH:

**npm**

```bash
npm install -g @gjsify/cli
```

**Bun**

```bash
bun add -g @gjsify/cli
```

**Deno**

```bash
deno install -g -A -n gjsify npm:@gjsify/cli
```

Whichever route you pick you get the same `gjsify` command, and the runtime you installed
with becomes the one it builds for by default. To pin the CLI per project instead of
globally, add it as a dev dependency (`npm install -D @gjsify/cli`) — that is how every
scaffolded template is wired. PATH notes and the update command for each route:
[Install & Update](https://gjsify.github.io/gjsify/guides/install/).

## Usage

```bash
gjsify create my-app --template gtk-minimal   # scaffold a GTK 4 + TypeScript app
cd my-app
gjsify install                                # resolve npm deps, no npm required
gjsify run dev                                # watch, rebuild and relaunch on change
```

`create` writes the build scripts too, so `gjsify run build`, `run start` and `run check`
work from there on. Reaching for the underlying commands directly:

```bash
gjsify build src/index.ts --app gjs --outfile dist/index.gjs.js
gjsify run dist/index.gjs.js    # launch it, with the native-prebuild environment set
gjsify info dist/index.gjs.js   # print that environment instead of launching
gjsify ship                     # package the built app as a .deb and an .rpm
```

`ship` runs the project's own `build` script, stages one payload and wraps it per format,
with no manifest to maintain — see [Ship your app](https://gjsify.github.io/gjsify/ship/).
Every command and flag is in the
[CLI Reference](https://gjsify.github.io/gjsify/cli-reference/).

Without a global install, reach the CLI through your runtime's package runner instead:
`npx @gjsify/cli@latest …`, `bunx @gjsify/cli@latest …` or
`deno run -A --reload --min-dep-age=0 npm:@gjsify/cli@latest …`. Keep the `@latest` tag,
and on Deno those two extra flags: all three runners reuse a cached copy of an unpinned
bin, and Deno adds a second rule that refuses anything published in the last 24 hours.
Neither one tells you it happened — the
[measurement](https://gjsify.github.io/gjsify/guides/install/#which-version-do-npx-bunx-and-deno-run-give-you)
is in the install guide.

## Native prebuilds

Packages that ship compiled artifacts declare them with
`"gjsify": { "prebuilds": "prebuilds", "platforms": ["linux-x64", "darwin-arm64", …] }`
and stage them under `prebuilds/<os>-<arch>[-musl]/`. `run`, `info`, `tsc` and the bin
launchers `install` writes all resolve that directory for the running host, and export
`GI_TYPELIB_PATH` plus the library-search variable the host's dynamic loader actually
reads — `LD_LIBRARY_PATH` on Linux, `DYLD_LIBRARY_PATH` on macOS (dyld ignores the Linux
one), `PATH` on Windows (`LoadLibrary` has no dedicated variable).

The target is spelled `${process.platform}-${process.arch}`, which is what a running
process can compute about itself, so locating the directory needs no translation step. The
resolver still probes a package's own declared spelling first and the retired uname one
(`linux-x86_64`) last, so a tarball published before the rename keeps loading. A package
with no artifact for your host is skipped — every native bridge is optional at runtime.

- How the lookup works, and how to set the same environment by hand:
  [How It Works](https://gjsify.github.io/gjsify/how-it-works/#native-prebuilds-and-gjsify-run)
- Which artifacts exist per package:
  [Platform Support](https://gjsify.github.io/gjsify/platform-support/)

## License

MIT
