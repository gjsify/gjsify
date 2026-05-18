---
title: Ship a CLI tool as a Flatpak
description: Use `gjsify flatpak` to package a GJS-based command-line tool — like `ts-for-gir` — into a Flatpak that runs on any modern Linux distro
---

This guide covers packaging a **headless CLI tool** built with `gjsify build` as a Flatpak. The companion guide for GUI apps is implicit in `gjsify flatpak init`'s default flags; the only thing that changes for CLI tools is the runtime permissions, not the runtime itself.

If you're shipping a GTK/Adwaita app, see the companion guide [Ship a GJS app as a Flatpak](./flatpak-app/).

> **`--cli-only` is deprecated.** It still works as an alias for `--kind cli` for one-or-two releases of backwards compatibility, then will be removed.

## Why Flatpak for a CLI tool?

A `gjsify build` output is already a single self-contained file (`gjs -m bundle.js`) — so why add Flatpak?

* **Distro-agnostic distribution.** Users on Fedora, Ubuntu, Arch, openSUSE, Debian get the same binary with the same GJS version, regardless of what their distro packages.
* **Pinned runtime.** GJS 1.86 / SpiderMonkey 140 today, GJS 1.88 next year — your Flatpak keeps targeting the runtime you tested against, not whatever's on the user's box.
* **No system dependencies.** Need `glib-compile-resources`, `blueprint-compiler`, `flatpak-builder` itself for nested builds? Bundle them once, ship them everywhere.
* **Sandboxed file access.** Easier to reason about (and audit) what host paths a CLI can touch — useful for code-generation tools that read system GIR files but shouldn't write outside their working dir.

## 1. Why the runtime stays `org.gnome.Platform`

This is the load-bearing decision and the most common gotcha: **a GJS bundle still needs the GJS interpreter at runtime**, not just at build time.

| Runtime | Has GJS? | Verdict for `gjsify build` output |
|---|---|---|
| `org.gnome.Platform` | ✅ Yes (GJS + GLib + GIO + GObject + GTK + Adwaita) | **Use this.** |
| `org.freedesktop.Platform` | ❌ No GJS | Avoid for `gjsify build` output. Bundling GJS into the manifest module graph is the entire "build a Linux distribution" rabbit hole. |

Your bundle imports through `gi://*`, `system`, `cairo`, `gettext`, and the `@gjsify/*` polyfills route every Node/Web API call to libsoup, GLib, Gio, GdkPixbuf, etc. — all of which the GNOME runtime ships, none of which Freedesktop does.

The unused GUI libs (GTK, Adwaita) cost nothing at runtime — Flatpak shares them across applications via the OSTree repo.

`gjsify flatpak init --kind cli` keeps `org.gnome.Platform` as the runtime and only strips the GUI **finish-args** (`--device=dri`, `--socket=wayland`, `--socket=fallback-x11`).

## 2. Generate the manifest

`gjsify flatpak init --kind cli` reads `package.json#gjsify.flatpak` and writes `<app-id>.json`:

```jsonc
// package.json
{
  "name": "ts-for-gir",
  "version": "4.0.0",
  "type": "module",
  "gjsify": {
    "flatpak": {
      "appId": "org.gjsify.TsForGir",
      "runtime": "gnome",
      "runtimeVersion": "50",
      "sdkExtensions": [
        "org.freedesktop.Sdk.Extension.node24"
      ],
      "command": "ts-for-gir",
      "finishArgs": [
        "--share=network",
        "--filesystem=home",
        "--filesystem=/usr/share/gir-1.0:ro",
        "--filesystem=/usr/share/gobject-introspection-1.0:ro"
      ]
    }
  }
}
```

```sh
gjsify flatpak init --kind cli
```

Produces `org.gjsify.TsForGir.json`:

```jsonc
{
    "id": "org.gjsify.TsForGir",
    "runtime": "org.gnome.Platform",
    "runtime-version": "50",
    "sdk": "org.gnome.Sdk",
    "sdk-extensions": [
        "org.freedesktop.Sdk.Extension.node24"
    ],
    "build-options": {
        "append-path": "/usr/lib/sdk/node24/bin:/app/bin"
    },
    "command": "ts-for-gir",
    "finish-args": [
        "--share=network",
        "--filesystem=home",
        "--filesystem=/usr/share/gir-1.0:ro",
        "--filesystem=/usr/share/gobject-introspection-1.0:ro"
    ],
    "modules": [
        {
            "name": "TsForGir",
            "buildsystem": "meson",
            "sources": [{ "type": "dir", "path": "." }]
        }
    ]
}
```

For a CLI that reads the host's GObject-introspection repository (which is what `ts-for-gir` does to generate types), the two `--filesystem=/usr/share/gir-1.0:ro` and `--filesystem=/usr/share/gobject-introspection-1.0:ro` mounts are essential. Without them the CLI can run, but it has nothing to read.

`--share=network` is only needed if your CLI hits the network (e.g. for npm-registry access). Drop it if the tool is fully offline.

### MetaInfo XML and flathub.json

`gjsify flatpak init --kind cli` also writes:

* **`data/<app-id>.metainfo.xml.in`** — a `<component type="console-application">` AppStream record with `<provides><binary>` pointing at your CLI's command name. Flathub validation requires this.
* **`flathub.json`** — policy stub with `{ "skip-icons-check": true }`. CLI tools have no `.desktop` entry and no icon, and `flatpak-builder-lint` would otherwise reject the build with `appstream-missing-icon`.

For the MetaInfo file to be emitted, your `gjsify.flatpak` config needs at minimum:

```jsonc
{
  "gjsify": {
    "flatpak": {
      "kind": "cli",
      "developer":   { "id": "org.gjsify", "name": "Gjsify Authors" },
      "summary":     "GIR-to-TypeScript types generator",
      "description": "Generates @girs/* TypeScript types from .gir files.",
      "license":     { "metadata": "CC0-1.0", "project": "Apache-2.0" },
      "homepageUrl": "https://github.com/gjsify/ts-for-gir",
      "releases":    [{ "version": "4.0.0", "date": "2026-05-18" }]
    }
  }
}
```

Missing fields are reported with a per-field hint pointing at the exact config key; the manifest still writes successfully, only MetaInfo/.desktop are skipped. Fill in the gaps and re-run with `--force` to regenerate.

### Lint locally before submitting to Flathub

```sh
gjsify flatpak check org.gjsify.TsForGir.json
```

Runs `appstreamcli validate --strict` against the MetaInfo XML (autodetected from `data/<app-id>.metainfo.xml.in`) plus `flatpak-builder-lint manifest` against the JSON. Both ship inside the `org.flatpak.Builder` Flatpak — `flatpak install -y flathub org.flatpak.Builder` if missing. Exit code is non-zero if any linter fails; the same checks run inside Flathub's PR CI, so green here means green there.

## 3. Replace the meson module if your tool ships without meson

The `gjsify flatpak init` default assumes a Meson-built source tree (matches the [GUI flatpak workflow](https://docs.flathub.org/docs/for-app-authors/maintenance/)). For a pure JS CLI tool, swap the module for a `simple` buildsystem with explicit build commands. Edit the manifest:

```jsonc
"modules": [
    {
        "name": "ts-for-gir",
        "buildsystem": "simple",
        "build-commands": [
            "yarn install --immutable",
            "gjsify build src/start.ts --outfile bin/ts-for-gir-gjs",
            "install -Dm755 bin/ts-for-gir-gjs /app/bin/ts-for-gir"
        ],
        "sources": [
            { "type": "git", "url": "https://github.com/gjsify/ts-for-gir.git", "tag": "v4.0.0" },
            { "type": "file", "path": "flatpak-node-sources.json" }
        ]
    }
]
```

The second source — `flatpak-node-sources.json` — comes from `gjsify flatpak deps` (next step) and lets `yarn install --immutable` succeed inside Flatpak's offline build sandbox.

## 4. Generate the offline node-modules cache

Flatpak builds run with `--share=network` disabled by default. `yarn install` therefore needs a pre-populated cache. `gjsify flatpak deps` wraps the upstream `flatpak-node-generator` Python tool:

```sh
# One-time install of the wrapper:
pipx install flatpak-node-generator

# Generate the cache from your lockfile:
gjsify flatpak deps --lockfile yarn.lock --out flatpak-node-sources.json
```

The output is the JSON file you reference from your manifest's `sources:` array.

> **Long-term goal:** the gjsify ecosystem aims for a Node-free build chain. When `gjsify install` (a future Yarn replacement) and a GJS-native `gjsify build` exist, the Node SDK extension and `flatpak-node-generator` step both drop out. Tracked in [STATUS.md → Node-free build chain](https://github.com/gjsify/gjsify/blob/main/STATUS.md). For now, Node 24 + flatpak-node-generator are part of the build-time (not runtime) story.

## 5. Build the bundle

`gjsify flatpak build` wraps `flatpak-builder` with sensible defaults:

```sh
# Local install + Flathub-shaped tarball:
gjsify flatpak build org.gjsify.TsForGir.json --install --tarball org.gjsify.TsForGir.tar.gz

# Or: produce a portable single-file bundle for distribution:
gjsify flatpak build org.gjsify.TsForGir.json --repo repo --bundle org.gjsify.TsForGir.flatpak
```

After `--install`, your CLI is on PATH inside the Flatpak — try it:

```sh
flatpak run --command=ts-for-gir org.gjsify.TsForGir --version
flatpak run --command=ts-for-gir org.gjsify.TsForGir generate -g /run/host/usr/share/gir-1.0 --outdir=$HOME/types
```

## 6. Wire CI

`gjsify flatpak ci` scaffolds `.github/workflows/flatpak.yml` matching the upstream Flathub action shape:

```sh
gjsify flatpak ci --manifest org.gjsify.TsForGir.json --bundle org.gjsify.TsForGir.flatpak
```

The generated workflow runs on every push + PR to `main`, builds the manifest in the `ghcr.io/flathub-infra/flatpak-github-actions:gnome-50` container, and uploads the `.flatpak` bundle as an artifact.

Re-running `gjsify flatpak ci` is idempotent: if the file already exists with byte-identical content, the command is a no-op. If you've hand-edited the workflow, the command refuses to overwrite without `--force`.

## What about user-config files?

Flatpak sandboxes the user's home dir by default. `--filesystem=home` (in the manifest above) opens the entire home — coarse but pragmatic for a CLI tool that may need to write generated code anywhere the user dropped them.

If your CLI only needs `~/.cache/<app-id>/` and `~/.config/<app-id>/`, drop `--filesystem=home` and rely on Flatpak's per-app XDG dirs:

```jsonc
"finish-args": [
    "--share=network"
    // No --filesystem=home — XDG_*_HOME is automatically per-app.
]
```

The CLI will see `~/.config` and `~/.cache` as writable per-app paths under `~/.var/app/<app-id>/`.

## Submitting to Flathub

Once the bundle works locally:

1. Tag the release in your repo (`git tag v4.0.0 && git push --tags`).
2. Update the manifest's `sources:` git tag to match.
3. Submit the manifest to Flathub by [opening a PR against `flathub/flathub`](https://docs.flathub.org/docs/for-app-authors/submission).
4. The Flathub bot rebuilds the bundle in their infra and publishes it to https://flathub.org/apps/org.gjsify.TsForGir.

## Reference

* [`gjsify flatpak init`](../../cli-reference/#gjsify-flatpak-init) — manifest + MetaInfo + .desktop + flathub.json scaffold
* [`gjsify flatpak check`](../../cli-reference/#gjsify-flatpak-check) — local Flathub-lint pass
* [`gjsify flatpak build`](../../cli-reference/#gjsify-flatpak-build) — flatpak-builder wrapper
* [`gjsify flatpak deps`](../../cli-reference/#gjsify-flatpak-deps) — node-deps offline cache
* [`gjsify flatpak ci`](../../cli-reference/#gjsify-flatpak-ci) — workflow scaffold
* [Flathub submission docs](https://docs.flathub.org/docs/for-app-authors/submission)
* [GNOME runtime release notes](https://gitlab.gnome.org/GNOME/gnome-build-meta/-/releases) — pin `runtime-version` to a version that ships the GJS you tested against
