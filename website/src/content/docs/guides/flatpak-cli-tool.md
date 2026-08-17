---
title: Ship a CLI tool as a Flatpak
description: Package a headless GJS command-line tool with gjsify flatpak init --kind cli, from lockfile to Flathub PR.
---

Pick this route when your tool is headless and you want one artifact that runs
the same on Fedora, Ubuntu, Arch, openSUSE and Debian, against a GJS version
you pinned rather than the one their distro shipped. The alternatives are
compared on [Ship your app](/gjsify/ship/); for a GTK app, use
[Ship a GTK app as a Flatpak](/gjsify/guides/flatpak-app/) instead.

A `gjsify build` output is already one self-contained file, so Flatpak buys you
three specific things: the pinned runtime, any build-time helpers you need
(`glib-compile-resources`, `blueprint-compiler`) bundled once, and a sandbox
that makes it easy to say which host paths the tool may touch.

## Keep the GNOME runtime

`--kind cli` changes the metadata and the permissions, not the runtime. Your
bundle still needs the GJS interpreter at run time, plus GLib, GIO and libsoup
behind the `@gjsify/*` polyfills, and only `org.gnome.Platform` ships those.
`org.freedesktop.Platform` has no GJS, and putting one in yourself is a project
of its own. The unused GUI libraries cost nothing: Flatpak shares them between
apps.

What `--kind cli` does change: no `.desktop` file, a `console-application`
MetaInfo record, `skip-icons-check` in `flathub.json`, and an empty default
`finish-args` list (no display, no GPU).

## Describe the tool

```jsonc
// package.json
{
  "name": "ts-for-gir",
  "version": "4.0.0",
  "type": "module",
  "gjsify": {
    "flatpak": {
      "appId": "org.gjsify.TsForGir",
      "kind": "cli",
      "runtime": "gnome",
      "runtimeVersion": "50",
      "command": "ts-for-gir",

      "name":        "ts-for-gir",
      "developer":   { "id": "org.gjsify", "name": "Gjsify Authors" },
      "summary":     "GIR-to-TypeScript types generator",
      "description": "Generates @girs/* TypeScript types from .gir files.",
      "license":     { "metadata": "CC0-1.0", "project": "Apache-2.0" },
      "homepageUrl": "https://github.com/gjsify/ts-for-gir",
      "releases":    [{ "version": "4.0.0", "date": "2026-05-18" }],

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

The two read-only `--filesystem` mounts are what let a code generator see the
host's GObject-introspection data. Without them the tool starts fine and then
has nothing to read. Drop `--share=network` if your tool never goes online.

Missing metadata is reported per field with the exact config key. The manifest
is written either way; the MetaInfo is skipped until you fill the gaps and
re-run with `--force`.

## Generate the manifest

```sh
gjsify flatpak init --kind cli
```

You get `org.gjsify.TsForGir.json`:

```jsonc
{
    "id": "org.gjsify.TsForGir",
    "runtime": "org.gnome.Platform",
    "runtime-version": "50",
    "sdk": "org.gnome.Sdk",
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

plus `data/org.gjsify.TsForGir.metainfo.xml.in` (a
`<component type="console-application">` whose `<provides><binary>` names your
command) and `flathub.json` containing `{ "skip-icons-check": true }`. Both are
required to get past Flathub's linters.

`--cli-only` still works as an alias for `--kind cli`, but it is deprecated.

## Replace the meson module

The default module assumes a Meson tree. A JavaScript CLI usually wants
`buildsystem: simple` instead. Put it in your config rather than editing the
generated JSON, so `init --force` keeps it:

```jsonc
"gjsify": {
  "flatpak": {
    "modules": [
      {
        "name": "ts-for-gir",
        "buildsystem": "simple",
        "build-commands": [
          "export XDG_CACHE_HOME=\"$(pwd)/flatpak-gjsify-cache\"",
          "gjsify install --immutable",
          "gjsify build src/start.ts --app gjs --outfile bin/ts-for-gir",
          "install -Dm755 bin/ts-for-gir /app/bin/ts-for-gir"
        ],
        "sources": [
          { "type": "dir", "path": "." },
          "gjsify-sources.json"
        ]
      }
    ]
  }
}
```

Setting `modules` replaces the array outright. Use `extraModules` instead when
you want to keep the default module and add siblings beside it.

## Vendor the dependencies

Flatpak builds run with networking off, so the install has to find every
tarball on disk. Generate the source list from whatever lockfile you have:

```sh
gjsify flatpak sources --print-module
```

That reads `gjsify-lock.json`, `package-lock.json`, `yarn.lock` or
`pnpm-lock.yaml` and writes `gjsify-sources.json`: one flatpak `file` source per
tarball, each downloading into the cache layout `gjsify install` reads.
`--print-module` prints the manifest module to paste in, which is where the
`XDG_CACHE_HOME` line above comes from. No Node and no Python helper are
involved.

If you would rather keep a Node-based build inside the sandbox, use the older
path: install `flatpak-node-generator` (`pipx install flatpak-node-generator`),
run `gjsify flatpak deps --lockfile yarn.lock`, and add the resulting
`flatpak-node-sources.json` to your sources. That build also needs
`"sdkExtensions": ["org.freedesktop.Sdk.Extension.node24"]`, which puts
`/usr/lib/sdk/node24/bin` on the build `PATH` for you.

## Lint before you submit

```sh
gjsify flatpak check org.gjsify.TsForGir.json
```

Runs `appstreamcli validate --strict` on the MetaInfo (found automatically at
`data/<app-id>.metainfo.xml.in`) and `flatpak-builder-lint manifest` on the
JSON. These are the same checks Flathub's PR CI runs, so green here means green
there. Both binaries ship in the `org.flatpak.Builder` Flatpak:

```sh
flatpak install -y flathub org.flatpak.Builder
```

## Build and try it

```sh
# local install
gjsify flatpak build org.gjsify.TsForGir.json --install

# or a single-file bundle to hand around
gjsify flatpak build org.gjsify.TsForGir.json --repo repo --bundle org.gjsify.TsForGir.flatpak
```

After `--install`, your command is on the PATH inside the sandbox:

```sh
flatpak run --command=ts-for-gir org.gjsify.TsForGir --version
flatpak run --command=ts-for-gir org.gjsify.TsForGir generate -g /run/host/usr/share/gir-1.0 --outdir=$HOME/types
```

Note the `/run/host/` prefix: that is where a read-only host mount appears
inside the sandbox.

## Decide what the sandbox may touch

`--filesystem=home` opens the whole home directory. It is coarse, and it is the
pragmatic choice for a tool that writes generated code wherever the user asked
for it.

If your tool only needs its own cache and config, leave it out entirely:

```jsonc
"finishArgs": ["--share=network"]
```

The tool then sees `~/.config` and `~/.cache` as writable per-app directories
under `~/.var/app/<app-id>/`, and nothing else.

## Wire up CI

```sh
gjsify flatpak ci --manifest org.gjsify.TsForGir.json --bundle org.gjsify.TsForGir.flatpak
```

Writes `.github/workflows/flatpak.yml` around
`flatpak/flatpak-github-actions/flatpak-builder@v6`, inside the
`ghcr.io/flathub-infra/flatpak-github-actions:gnome-50` container (the tag
follows your `runtime` and `runtimeVersion`). It runs on push and PR to `main`
and uploads the `.flatpak` bundle as an artifact. Re-running is a no-op when
nothing changed, and it refuses to overwrite your edits without `--force`.

## Submit, then keep it current

1. Tag the release: `git tag v4.0.0 && git push --tags`.
2. Swap the module's source for a `git` one pinned to that tag. The generated
   `{ "type": "dir", "path": "." }` builds your working copy, which is what you
   want locally and not something Flathub can reproduce:

   ```jsonc
   "sources": [
     { "type": "git",
       "url": "https://github.com/gjsify/ts-for-gir.git",
       "tag": "v4.0.0",
       "commit": "<the sha that tag points at>" },
     "gjsify-sources.json"
   ]
   ```

3. Open a PR against
   [flathub/flathub](https://docs.flathub.org/docs/for-app-authors/submission).
4. Flathub rebuilds it in their infrastructure and publishes it.

From then on your tool has a second repo, `flathub/<app-id>`, whose manifest
pins your tag and commit. That is the `git` source from step 2: `sync-flathub`
rewrites it in place, so a manifest submitted with the `dir` default stops it
with `no git source found in modules[0].sources`.

```sh
gjsify flatpak diff                 # has Flathub fallen behind your latest tag?
gjsify flatpak sync-flathub         # repoint the pinned tag and open the PR
gjsify flatpak release v4.0.1       # the whole release in one go
```

`release` regenerates the assets, runs the linters, creates and pushes the tag,
then opens the Flathub PR. The linters run before the tag, so a failure leaves
you with nothing to undo. Try `--dry-run` first. `sync-flathub` needs `git`,
and `gh` unless you pass `--no-pr`; set `gjsify.flatpak.flathubRepo` if your
tracking repo is not named `flathub/<app-id>`.

## Reference

* [`gjsify flatpak init`](/gjsify/cli-reference/#gjsify-flatpak-init) and every config key it reads
* [`gjsify flatpak check`](/gjsify/cli-reference/#gjsify-flatpak-check)
* [`gjsify flatpak build`](/gjsify/cli-reference/#gjsify-flatpak-build) · [`sources`](/gjsify/cli-reference/#gjsify-flatpak-sources) · [`deps`](/gjsify/cli-reference/#gjsify-flatpak-deps) · [`ci`](/gjsify/cli-reference/#gjsify-flatpak-ci)
* [`gjsify flatpak sync-flathub`](/gjsify/cli-reference/#gjsify-flatpak-sync-flathub) · [`diff`](/gjsify/cli-reference/#gjsify-flatpak-diff) · [`release`](/gjsify/cli-reference/#gjsify-flatpak-release)
* [Flathub submission docs](https://docs.flathub.org/docs/for-app-authors/submission)
* [GNOME runtime releases](https://gitlab.gnome.org/GNOME/gnome-build-meta/-/releases) for picking a `runtimeVersion`
