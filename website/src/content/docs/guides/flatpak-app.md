---
title: Ship a GTK app as a Flatpak
description: Scaffold, lint and submit a GTK/Adwaita GJS app to Flathub with gjsify flatpak, from one config block in package.json.
---

Pick this route when you want a store listing on Flathub and a GTK version you
control on every distro, rather than whatever the user's distro happens to ship.
It costs more setup than the other routes, which are compared on
[Ship your app](/gjsify/ship/). Shipping a headless tool instead? Go to
[Ship a CLI tool as a Flatpak](/gjsify/guides/flatpak-cli-tool/).

## Describe your app once

Everything the scaffold needs lives in `package.json#gjsify.flatpak` (or in
`.gjsifyrc.*`, they are merged). This is the smallest block that produces a
Flathub-acceptable result:

```jsonc
{
  "name": "eu.jumplink.Learn6502",
  "version": "0.6.5",
  "type": "module",
  "gjsify": {
    "flatpak": {
      "appId": "eu.jumplink.Learn6502",
      "kind": "app",
      "runtime": "gnome",
      "runtimeVersion": "50",
      "command": "eu.jumplink.Learn6502",

      "name":        "Learn 6502 Assembly",
      "developer":   { "id": "eu.jumplink", "name": "Pascal Garber" },
      "summary":     "Learn 6502 assembly",
      "description": "An interactive 6502 assembly learning environment.\n\nWrite, assemble and step through 6502 programs.",
      "license":     { "metadata": "CC0-1.0", "project": "MIT" },
      "homepageUrl": "https://github.com/JumpLink/easy6502",
      "bugtrackerUrl": "https://github.com/JumpLink/easy6502/issues",

      "categories": ["Education", "Development"],
      "keywords":   ["6502", "assembly", "emulator", "learning"],
      "releases":   [{ "version": "0.6.5", "date": "2026-05-15" }],

      "branding":   { "accentLight": "#5b81b8", "accentDark": "#3a5d8c" },
      "icon":       "data/icons/hicolor/scalable/apps/eu.jumplink.Learn6502.svg",

      "finishArgs": [
        "--device=dri",
        "--share=ipc",
        "--socket=fallback-x11",
        "--socket=wayland"
      ]
    }
  }
}
```

A few of these are easy to get wrong:

- **`name`** is the display name people see. It defaults to something derived
  from `package.json#name`, which is right only when that is already your app
  id. Set it when your npm name is `learn6502` and your store name is
  "Learn 6502 Assembly".
- **`developer.id`** is a reverse-DNS publisher id. AppStream requires it.
- **`summary`** is one line, 80 characters or fewer, no trailing period.
  **`description`** splits on blank lines into paragraphs, and `&`, `<` and `>`
  are escaped for you.
- **`releases`** needs at least one entry matching the version you submit.
- **`icon`** points at a scalable SVG. Flathub rejects PNG-only icon sets.
- **`finishArgs`** are the sandbox permissions. The four above are the defaults
  for `kind: "app"`, so you can leave the key out until you need more.

You do not need an SDK extension for a plain GJS app: the GNOME runtime already
carries GJS, GLib and libsoup, and `gjsify build` produces one self-contained
file. Add `sdkExtensions` only if you compile something inside the sandbox; each
`org.freedesktop.Sdk.Extension.<name>` you list also gets `/usr/lib/sdk/<name>/bin`
prepended to the build `PATH` automatically.

## Generate the scaffold

```sh
gjsify flatpak init
```

```
[gjsify flatpak init] wrote manifest: /home/you/learn6502/eu.jumplink.Learn6502.json
[gjsify flatpak init] wrote metainfo: /home/you/learn6502/data/eu.jumplink.Learn6502.metainfo.xml.in
[gjsify flatpak init] wrote desktop: /home/you/learn6502/data/eu.jumplink.Learn6502.desktop.in
[gjsify flatpak init] wrote flathub.json: /home/you/learn6502/flathub.json
```

| File | What it is |
|---|---|
| `<app-id>.json` | The Flatpak manifest: runtime, SDK, finish-args, modules |
| `data/<app-id>.metainfo.xml.in` | AppStream MetaInfo, required by Flathub |
| `data/<app-id>.desktop.in` | The desktop entry, required for GUI apps |
| `flathub.json` | Flathub policy file, `{}` for apps |

Each file is checked separately and skipped if it already exists, so re-running
`init` will not overwrite your hand-tuned `.desktop`. Pass `--force` when you
do want them regenerated.

If a required field is missing, the manifest is still written; the MetaInfo and
`.desktop` are held back and you get the exact key to fill in:

```
  - gjsify.flatpak.developer.id: set { id: "org.example", name: "..." }
  - gjsify.flatpak.summary: short tagline ≤80 chars, no period
  - gjsify.flatpak.license.project: SPDX id like "MIT" or "GPL-3.0-or-later"
  - gjsify.flatpak.homepageUrl: e.g. "https://example.org"
```

Fill the gaps and re-run with `--force`.

## Rich AppStream features (i18n-ready)

The plain `description: "string"` form gets you paragraphs. When you want
bullet lists, screenshots, hardware hints or translator context, `description`
also accepts an array of blocks:

```jsonc
{
  "gjsify": {
    "flatpak": {
      "summaryTranslatorHint": "App tagline shown in app stores",

      "description": [
        { "p": "Discover the fascinating world of 6502 assembly!",
          "translatorHint": "App store intro paragraph" },
        { "ul": [
            { "item": "Interactive tutorials guide you step by step",
              "translatorHint": "Tutorial feature bullet" },
            "Built-in code editor with syntax highlighting"
          ] },
        { "p": "Perfect for hobbyists, students, and curious minds." }
      ],

      "screenshots": [
        { "url": "https://example.com/screenshots/1.png",
          "caption": "Code editor and virtual game console",
          "captionTranslatorHint": "Screenshot of the main desktop layout" }
      ],

      "kudos": ["ModernToolkit", "HiDpiIcon", "TouchscreenSupport"],
      "supports":   { "controls": ["keyboard", "pointing", "touch"] },
      "requires":   { "displayLengthMin": 360 },
      "recommends": { "displayLengthMin": 480 },

      "contentRating": {
        "type": "oars-1.1",
        "attributes": { "social-info": "mild", "language-humor": "mild" }
      },

      "translateUrl": "https://hosted.weblate.org/projects/your-project/app/",

      "releases": [
        {
          "version": "0.6.5",
          "date": "2026-05-15",
          "description": [
            { "p": "GNOME 50 runtime support." },
            { "ul": ["Updated TypeScript to v6", "Fixed back-button visibility"] }
          ]
        }
      ]
    }
  }
}
```

Every `translatorHint` becomes a `<!-- TRANSLATORS: ... -->` comment right
before its tag in the generated `.metainfo.xml.in`. `xgettext` and
`msgfmt --xml --template` forward those into the `.po` files, so people
translating on Weblate or Crowdin get the context without opening your repo.

`developer.nameTranslatable` defaults to `false`, which emits
`<name translate="no">`. That is what you want for a personal or brand name.
Set it to `true` when the name is a descriptive phrase.

The full field list is in the
[CLI Reference](/gjsify/cli-reference/#gjsify-flatpak-init).

## Check it before Flathub does

```sh
gjsify flatpak check eu.jumplink.Learn6502.json
```

This runs the same two linters Flathub's PR CI runs: `appstreamcli validate
--strict` on your MetaInfo, and `flatpak-builder-lint manifest` on the
manifest. Add `--repo <path>` after a build to lint the exported repo as well.

A non-zero exit here means a red PR on Flathub, so fix it now. Both binaries
live in the `org.flatpak.Builder` Flatpak, and `check` prints the install hint
when they are missing:

```sh
flatpak install -y flathub org.flatpak.Builder
```

## Build and run it locally

Flatpak builds have no network access, so dependencies have to be vendored
first. Generate an offline source list from your lockfile:

```sh
gjsify flatpak sources --print-module
```

That reads `gjsify-lock.json`, `package-lock.json`, `yarn.lock` or
`pnpm-lock.yaml`, writes `gjsify-sources.json`, and with `--print-module` shows
you the manifest module to paste in: point `XDG_CACHE_HOME` at the vendored
cache and run `gjsify install --immutable` offline. No Node and no Python
helper involved.

If you already build with Node inside the sandbox, `gjsify flatpak deps` wraps
the `flatpak-node-generator` tool instead and writes
`flatpak-node-sources.json`.

Then build and install:

```sh
gjsify flatpak build eu.jumplink.Learn6502.json --install
flatpak run eu.jumplink.Learn6502
```

Now use it the way a user would: launch it from the GNOME overview, open a file
dialog, switch to dark mode, check the icon in the app grid.

## Wire up CI

```sh
gjsify flatpak ci
```

Writes `.github/workflows/flatpak.yml` around
`flatpak/flatpak-github-actions/flatpak-builder@v6`, running inside
`ghcr.io/flathub-infra/flatpak-github-actions:gnome-50`. The container tag
follows your `runtime` and `runtimeVersion`. Re-running is a no-op when the
file is unchanged and refuses to clobber your edits without `--force`.

## Submit to Flathub

1. Tag the release: `git tag v0.6.5 && git push --tags`.
2. Repoint the module's source at that tag. `init` writes
   `{ "type": "dir", "path": "." }`, which builds your working copy: right for
   the local build above, not something Flathub can reproduce. The submitted
   manifest needs a `git` source with a `tag` and the `commit` it resolves to.
3. Open a PR against
   [flathub/flathub](https://docs.flathub.org/docs/for-app-authors/submission)
   containing your `<app-id>.json`. The MetaInfo and `.desktop` stay in your
   own source tree; the manifest installs them during the build.
4. The reviewer runs the same `appstreamcli` and `flatpak-builder-lint` checks
   you ran locally.

## Keep Flathub current after a release

Once you are on Flathub, your app has a second repo (`flathub/<app-id>`) whose
manifest pins your tag and commit. That is the `git` source from step 2:
`sync-flathub` rewrites it in place, so a manifest submitted with the `dir`
default stops it with `no git source found in modules[0].sources`.

```sh
gjsify flatpak diff                 # is Flathub behind your latest tag?
gjsify flatpak sync-flathub         # clone it, repoint the tag, open the PR
gjsify flatpak release v0.6.6       # do the whole release in one go
```

`release` chains the rest: regenerate the assets, run the linters, create and
push the tag, then open the Flathub PR. The linters run *before* the tag is
created, so a failure leaves you with no tag rather than a half-published
release. Add `--dry-run` to see the plan first.

`sync-flathub` needs `git`, and `gh` unless you pass `--no-pr`. If your Flathub
repo is not named `flathub/<app-id>`, set `gjsify.flatpak.flathubRepo`.

## About icons

Ship a scalable SVG at `data/icons/hicolor/scalable/apps/<app-id>.svg`. The
`gjsify.flatpak.icon` field points at it so `init` can warn when it is missing;
the actual install happens in your manifest's modules, usually a Meson
`install_subdir('icons')` or an `install -Dm644` line. Flathub rejects
PNG-only icon sets, so convert before you submit.

## Reference

* [`gjsify flatpak init`](/gjsify/cli-reference/#gjsify-flatpak-init) and every config key it reads
* [`gjsify flatpak check`](/gjsify/cli-reference/#gjsify-flatpak-check)
* [`gjsify flatpak build`](/gjsify/cli-reference/#gjsify-flatpak-build) · [`sources`](/gjsify/cli-reference/#gjsify-flatpak-sources) · [`deps`](/gjsify/cli-reference/#gjsify-flatpak-deps) · [`ci`](/gjsify/cli-reference/#gjsify-flatpak-ci)
* [`gjsify flatpak sync-flathub`](/gjsify/cli-reference/#gjsify-flatpak-sync-flathub) · [`diff`](/gjsify/cli-reference/#gjsify-flatpak-diff) · [`release`](/gjsify/cli-reference/#gjsify-flatpak-release)
* [Flathub submission docs](https://docs.flathub.org/docs/for-app-authors/submission)
* [AppStream MetaInfo reference](https://www.freedesktop.org/software/appstream/docs/chap-Metadata.html#sect-Metadata-DesktopApps)
