---
title: Ship a GJS app as a Flatpak
description: Use `gjsify flatpak` to scaffold and submit a GTK/Adwaita GJS app to Flathub — manifest + MetaInfo + .desktop + flathub.json from a single config block
---

This guide covers packaging a **GTK/Adwaita desktop application** built with `gjsify build` as a Flathub-ready Flatpak. For CLI tools (no UI, no `.desktop`), see [Ship a CLI tool as a Flatpak](./flatpak-cli-tool/) instead.

## What `gjsify flatpak init --kind app` produces

Running `gjsify flatpak init` (the default `--kind app`) in a project with a complete `gjsify.flatpak` config block emits four files in one pass:

| Path | Purpose |
|---|---|
| `<app-id>.json` | Flatpak manifest (runtime, SDK, finish-args, modules) |
| `data/<app-id>.metainfo.xml.in` | AppStream MetaInfo (`<component type="desktop-application">`) — Flathub-mandatory |
| `data/<app-id>.desktop.in` | Freedesktop `.desktop` entry — Flathub-mandatory for GUI apps |
| `flathub.json` | Flathub policy stub (empty `{}` for apps; customise per [Flathub docs](https://docs.flathub.org/docs/for-app-authors/maintenance#extra-data)) |

Each output is **independently checked for existence and skipped if present** — re-running `init` won't clobber a hand-edited `.desktop` or MetaInfo. Pass `--force` to regenerate.

## 1. Configure `package.json#gjsify.flatpak`

The minimum config that produces a Flathub-acceptable scaffold:

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

      "sdkExtensions": [
        "org.freedesktop.Sdk.Extension.node24",
        "org.freedesktop.Sdk.Extension.typescript"
      ],
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

What each block does:

* **`kind: "app"`** — selects desktop-application MetaInfo + .desktop generation.
* **`developer.id`** — reverse-DNS publisher id (required for AppStream OARS 1.1+).
* **`summary` / `description`** — single-line ≤80-char tagline, then `<p>`-paragraph body (blank lines split paragraphs; `&`/`<`/`>` are XML-escaped automatically).
* **`license.metadata` / `license.project`** — SPDX IDs; `metadata` defaults to `CC0-1.0`.
* **`releases`** — feeds AppStream's `<releases>` section. Flathub requires at least one entry matching the version you're submitting.
* **`branding`** — light + dark accent colours rendered into GNOME Software's app card; optional but recommended.
* **`icon`** — scalable SVG path. Flathub mandates an SVG (PNG-only is rejected); a missing icon path triggers a warning, not an error.

## Rich AppStream features (i18n-ready)

The simple `description: "string"` form above splits on blank lines into `<p>` blocks. For richer content — bullet lists, per-string translator hints, kudos, supports/requires, content_rating attributes — use the full schema:

```jsonc
{
  "gjsify": {
    "flatpak": {
      // ...basic fields above...

      "summaryTranslatorHint": "App tagline shown in app stores",

      "description": [
        { "p": "Discover the fascinating world of 6502 assembly!",
          "translatorHint": "App store intro paragraph" },
        { "ul": [
            { "item": "Interactive tutorials guide you step by step",
              "translatorHint": "Tutorial feature bullet" },
            "Built-in code editor with syntax highlighting",
            { "item": "Debug your programs with real-time inspection",
              "translatorHint": "Debugger feature bullet" }
          ], "translatorHint": "Feature list intro hint" },
        { "p": "Perfect for hobbyists, students, and curious minds." }
      ],

      "developer": {
        "id": "eu.jumplink",
        "name": "Pascal Garber",
        "email": "pascal@example.com",
        "nameTranslatable": false
      },

      "translateUrl": "https://hosted.weblate.org/projects/your-project/app/",
      "iconRemote": "https://raw.githubusercontent.com/you/your-repo/main/data/icons/hicolor/scalable/apps/eu.jumplink.Learn6502.svg",

      "kudos": ["ModernToolkit", "HiDpiIcon", "TouchscreenSupport", "UserDocs"],

      "supports": {
        "controls": ["keyboard", "pointing", "touch"]
      },
      "requires": {
        "displayLengthMin": 360
      },
      "recommends": {
        "displayLengthMin": 480
      },

      "contentRating": {
        "type": "oars-1.1",
        "attributes": {
          "social-info": "mild",
          "language-humor": "mild"
        }
      },

      "provides": {
        "binaries": ["eu.jumplink.Learn6502"],
        "mimetypes": ["application/x-6502-asm"]
      },

      "screenshots": [
        { "url": "https://example.com/screenshots/1.png",
          "caption": "Code editor and virtual game console",
          "captionTranslatorHint": "Screenshot of the main desktop layout" },
        { "url": "https://example.com/screenshots/2.png",
          "caption": "Appearance settings" }
      ],

      "releases": [
        {
          "version": "0.6.5",
          "date": "2026-05-15",
          "description": [
            { "p": "GNOME 50 runtime support.",
              "translatorHint": "Release notes for 0.6.5 — GNOME runtime update" },
            { "ul": [
              "Updated TypeScript to v6",
              "Fixed back-button visibility bug"
            ]}
          ]
        }
      ]
    }
  }
}
```

Every translatable string is emitted with a `<!-- TRANSLATORS: ... -->` comment immediately before its tag. `xgettext` (or `msgfmt --xml --template`) picks these up automatically and forwards them as `#. TRANSLATORS:` comments into the generated `.po` files — so contributors on Weblate / Crowdin see the context without leaving their editor.

The `developer.nameTranslatable: false` (default) emits `<name translate="no">` — recommended for personal/brand names. Set to `true` for descriptive phrases that should be localised.

Missing required fields surface as per-field hints with the exact config key when you run init:

```
[gjsify flatpak init] Manifest written, but MetaInfo / .desktop are skipped — config gaps:
  - gjsify.flatpak.developer.id: set { id: "org.example", name: "..." }
  - gjsify.flatpak.summary: short tagline ≤80 chars, no period
  - gjsify.flatpak.license.project: SPDX id like "MIT" or "GPL-3.0-or-later"
  - gjsify.flatpak.homepageUrl: e.g. "https://example.org"

Fill these fields in package.json#gjsify.flatpak (or .gjsifyrc.*) and re-run with --force.
```

The manifest still writes successfully — only MetaInfo + .desktop are deferred until the config is complete.

## 2. Generate the scaffold

```sh
gjsify flatpak init
```

Output:

```
[gjsify flatpak init] wrote manifest: ./eu.jumplink.Learn6502.json
[gjsify flatpak init] wrote metainfo: ./data/eu.jumplink.Learn6502.metainfo.xml.in
[gjsify flatpak init] wrote desktop:  ./data/eu.jumplink.Learn6502.desktop.in
[gjsify flatpak init] wrote flathub.json: ./flathub.json
```

To regenerate after editing the config block, run with `--force`:

```sh
gjsify flatpak init --force
```

## 3. Validate locally before submitting to Flathub

```sh
gjsify flatpak check eu.jumplink.Learn6502.json
```

This runs the same linters Flathub's PR CI runs:

1. `appstreamcli validate --strict <metainfo>` — AppStream/OARS conformance.
2. `flatpak-builder-lint manifest <manifest>` — Flathub manifest policy.
3. (optional, with `--repo <path>`) `flatpak-builder-lint repo <path>` — post-build repo lint.

Both binaries ship in the `org.flatpak.Builder` Flatpak. If they're missing, `gjsify flatpak check` prints the install hint:

```sh
flatpak install -y flathub org.flatpak.Builder
flatpak run --command=appstreamcli org.flatpak.Builder validate --strict data/<app-id>.metainfo.xml.in
flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest <app-id>.json
```

A non-zero exit code from `gjsify flatpak check` means Flathub PR CI will fail too — fix the warnings before opening the PR.

## 4. Build the bundle

```sh
gjsify flatpak deps --lockfile yarn.lock --out flatpak-node-sources.json
gjsify flatpak build eu.jumplink.Learn6502.json --install
flatpak run eu.jumplink.Learn6502
```

If everything works, you have a locally installed Flatpak. Test it like an end-user would: launch from GNOME Activities, click around, verify file dialogs / portals / theming.

## 5. Wire CI

```sh
gjsify flatpak ci
```

Scaffolds `.github/workflows/flatpak.yml` matching the upstream Flathub action shape — `flatpak/flatpak-github-actions/flatpak-builder@v6` inside the `ghcr.io/flathub-infra/flatpak-github-actions:gnome-50` container.

## 6. Submit to Flathub

1. Tag the release in your repo (`git tag v0.6.5 && git push --tags`).
2. Open a PR against `flathub/flathub` per the [Flathub submission docs](https://docs.flathub.org/docs/for-app-authors/submission). The PR contains your `<app-id>.json` manifest only — MetaInfo and .desktop are emitted into the build inside your project's source tree.
3. The Flathub reviewer runs the same `flatpak-builder-lint` + `appstreamcli` checks you just ran locally. Green-on-green is the expected case.

## What about icons?

GUI apps must ship a scalable SVG at `data/icons/hicolor/scalable/apps/<app-id>.svg`. The `gjsify.flatpak.icon` config field points at that path so `init` can warn when it's missing; the actual install happens through your manifest's modules section (typically a Meson `install_subdir('icons')` or a `simple`-buildsystem `install -Dm644` step).

If you have only PNG icons today, generate an SVG before submitting — Flathub rejects PNG-only icon sets.

## Reference

* [`gjsify flatpak init`](../../cli-reference/#gjsify-flatpak-init) — manifest + MetaInfo + .desktop + flathub.json scaffold
* [`gjsify flatpak check`](../../cli-reference/#gjsify-flatpak-check) — local Flathub-lint pass
* [`gjsify flatpak build`](../../cli-reference/#gjsify-flatpak-build) — flatpak-builder wrapper
* [`gjsify flatpak deps`](../../cli-reference/#gjsify-flatpak-deps) — node-deps offline cache
* [`gjsify flatpak ci`](../../cli-reference/#gjsify-flatpak-ci) — workflow scaffold
* [Flathub submission docs](https://docs.flathub.org/docs/for-app-authors/submission)
* [AppStream MetaInfo reference](https://www.freedesktop.org/software/appstream/docs/chap-Metadata.html#sect-Metadata-DesktopApps) — semantics for every tag generated by init
