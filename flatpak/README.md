# `org.freedesktop.Sdk.Extension.gjsify`

A Flatpak **SDK extension** that provides the Node-free gjsify build toolchain
inside a Flatpak build sandbox. A GJS / GNOME application can then run
`gjsify build` at build time **without a network connection and without a
Node.js toolchain** — the exact shape Flathub's no-network build phase requires.

It is modelled directly on `org.freedesktop.Sdk.Extension.node24`: a
`build-extension: true` manifest that installs its payload under
`/usr/lib/sdk/gjsify` and exposes an `enable.sh`.

## What it ships

Mounted at `/usr/lib/sdk/gjsify`:

| Path | Content |
|---|---|
| `bin/gjsify` | wrapper → `gjs -m …/dist/cli.gjs.mjs` (sets `GI_TYPELIB_PATH` + `LD_LIBRARY_PATH` itself) |
| `bin/gjsify-tsc` | wrapper → `gjs -m …/node_modules/@gjsify/tsc/dist/tsc.gjs.mjs` (the Node-free `tsc`) |
| `lib/gjsify/dist/cli.gjs.mjs` | the committed Node-free GJS bundle of the `@gjsify/cli` |
| `lib/gjsify/package.json` | `@gjsify/cli`'s package.json (so `gjsify --version` is correct) |
| `lib/gjsify/shims/*.js` | the `rolldown-plugin-gjsify` build shims (`console-gjs`, `unicorn-magic`, `module-resolve`) that `gjsify build --app gjs` injects |
| `lib/gjsify/node_modules/@gjsify/{rolldown,lightningcss}-native/` | the native-bridge JS wrappers (`@gjsify/cli` dynamic-imports these at runtime; their `gi://` typelib resolves via `GI_TYPELIB_PATH`) |
| `lib/gjsify/node_modules/@gjsify/tsc/` | the `gjsify tsc` bundle + its 108 `lib*.d.ts` (so `gjsify check`/`gjsify tsc` work in the sandbox) |
| `lib/girepository-1.0/*.typelib` | `GjsifyRolldown` + `GjsifyLightningcss` GI typelibs (arch-specific) |
| `lib/*.so` | the matching native shared libraries (Rust bridges) |
| `enable.sh` | `PATH += /usr/lib/sdk/gjsify/bin` + the GI env |

The native prebuilds (typelibs + `.so`) are shipped per-architecture via
`only-arches`-tagged sources — currently `x86_64` and `aarch64` (whichever the
build is for is the only one fetched). Those two names are *flatpak's* arch
vocabulary and are unrelated to the `<os>-<arch>` prebuild directory they point
at, which is spelled the way `process.arch` spells it
(`prebuilds/linux-x64/`, `prebuilds/linux-arm64/`). The JS payload (CLI bundle,
shims, tsc libs, native JS wrappers) is architecture-independent.

**GJS itself is NOT bundled** — it is provided by the consuming SDK
(`org.gnome.Sdk`), exactly as `node24` relies on its base `org.freedesktop.Sdk`.
The extension builds against `org.freedesktop.Sdk//24.08`, so it mounts into any
SDK that inherits the freedesktop `Extension` point — including `org.gnome.Sdk`
(where `gjs` lives). `gjsify build`, `gjsify run` and `gjsify tsc` / `gjsify check`
all work (the CLI resolves `@gjsify/tsc` and the native bridges from the
extension's own `node_modules`, anchored at the bundle location).

## Build it

Needs `flatpak-builder` and `org.freedesktop.Sdk//24.08`
(`flatpak install flathub org.freedesktop.Sdk//24.08`). The payload (CLI bundle +
prebuilds) is read from the committed workspace artifacts, so build the bundle +
prebuilds first if they are stale.

```sh
cd flatpak
flatpak-builder --force-clean --disable-rofiles-fuse build-dir \
  org.freedesktop.Sdk.Extension.gjsify.json
# → build-dir/files == the /usr/lib/sdk/gjsify tree
```

To install it into a local repo for consumption:

```sh
flatpak-builder --force-clean --repo=repo --disable-rofiles-fuse build-dir \
  org.freedesktop.Sdk.Extension.gjsify.json
flatpak remote-add --user --no-gpg-verify gjsify-local repo
flatpak install --user gjsify-local org.freedesktop.Sdk.Extension.gjsify
```

(`build-dir/`, `repo/` and `.flatpak-builder/` are git-ignored.)

## Consume it from a GNOME app

Add the extension to the app manifest and put its `bin` on `PATH`. The CLI
wrapper is self-contained (it sets the GI env), so `append-path` is all that is
required; sourcing `enable.sh` is optional belt-and-suspenders.

```json
{
  "sdk": "org.gnome.Sdk",
  "sdk-extensions": ["org.freedesktop.Sdk.Extension.gjsify"],
  "build-options": { "append-path": "/usr/lib/sdk/gjsify/bin" },
  "modules": [{
    "name": "my-app",
    "buildsystem": "simple",
    "build-commands": ["gjsify build src/main.ts --app gjs --outfile dist/main.js", "…install…"]
  }]
}
```

`gjsify flatpak init --sdk-extension org.freedesktop.Sdk.Extension.gjsify`
scaffolds exactly this (`sdk-extensions` + the derived
`/usr/lib/sdk/gjsify/bin` append-path).

## Distribution

Building the extension is unrelated to where it is published. Per Flathub's
Generative-AI policy (Requirements → "Generative AI policy"), Flatpak
**extensions and runtimes are explicitly in scope** for the AI-content rules, so
a Flathub submission would depend on the discretionary "mature, well-maintained
projects" exception. A **gjsify-owned OSTree remote** sidesteps that entirely.
The distribution choice is deliberately left open — this directory only provides
the buildable artifact.
