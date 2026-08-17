---
title: ts-for-gir
description: The generator behind the @girs/* TypeScript types, so gi:// imports get autocomplete, jump-to-definition and type-checking across the GNOME stack.
---

When you type `Gtk.Button` in a gjsify app and get autocomplete, a signal signature and jump-to-definition, that comes from [ts-for-gir](https://github.com/gjsify/ts-for-gir). It reads GObject Introspection `.gir` XML and emits `.d.ts` declarations for GLib, Gio, GTK, GStreamer, libadwaita, WebKit and around 700 other modules on the GNOME stack.

Most of the time you never run it. The declarations are published as the `@girs/*` npm packages, and `gjsify create` already puts the ones its templates need into your `package.json`. You come here for three reasons: the module you want has no published package, you are on a GNOME version the published types do not cover, or you want types generated from your own `.gir` files.

It is also usable on its own. Plenty of GJS projects that never touch gjsify install `@girs/*` for the types alone.

## Install

Five paths. Pick whichever matches your toolchain.

### GJS, without Node.js

Three Node-free options, depending on whether you want a one-shot run, a managed install, or a self-updating standalone install. All of them need only [GJS](https://gjs.guide/) at runtime.

**One shot, npx-style, nothing installed:**

```bash
gjsify dlx @ts-for-gir/cli list
gjsify dlx @ts-for-gir/cli generate Gtk-4.0
```

`gjsify dlx` fetches the package into a content-addressed cache under `$XDG_CACHE_HOME/gjsify/dlx/`, runs its GJS bundle, and reuses the cache next time you ask for the same spec. The cache expires after seven days; pass `--cache-max-age 0` to force a refresh now.

**Managed global install through the gjsify CLI:**

```bash
gjsify install -g @ts-for-gir/cli
ts-for-gir --help
```

That installs into `~/.local/share/gjsify/global/` and symlinks the binary into `~/.local/bin/`. Re-run the same command to update.

**Bootstrap installer**, handy when you do not have the `gjsify` CLI yet:

```bash
curl -fsSL https://raw.githubusercontent.com/gjsify/ts-for-gir/main/install.js -o /tmp/install.js
gjs -m /tmp/install.js && rm /tmp/install.js
```

It installs to `~/.local/bin/`. Update later with `ts-for-gir self-update`.

### Node.js

```bash
npx @ts-for-gir/cli --help
# or globally:
npm install -g @ts-for-gir/cli
```

## Scaffold a project

`create` sets up a project with the types already wired up. Pick a template interactively, or name one with `--template <id>`:

```bash
gjsify dlx @ts-for-gir/cli create my-app
# or via npm
npx @ts-for-gir/cli create my-app
```

| Template | Best for |
|---|---|
| `types-gjsify` | A Node-free GJS app: types from `@girs/*`, and install, build, run and format all routed through the gjsify CLI |
| `types-npm` | A single package, types from `@girs/*` on npm, esbuild and node |
| `types-locally` | Types generated straight into `./@types/` with no `@girs/*` dependency |
| `types-workspace` | An npm workspace with `@girs/*` generated as local workspace packages |

Then run it:

```bash
cd my-app
gjsify run start    # types-gjsify template
# or
npm start           # any other template
```

The templates live in [`packages/cli/templates/`](https://github.com/gjsify/ts-for-gir/tree/main/packages/cli/templates) if you want to read one before scaffolding.

## Generate types yourself

When the published `@girs/*` packages don't fit, generate locally:

```bash
ts-for-gir list                              # what GIR namespaces this system has
ts-for-gir generate Gtk-4.0                  # one module
ts-for-gir generate '*'                      # everything available on the system
ts-for-gir generate Gtk-4.0 --reporter       # also write a diagnostics report
ts-for-gir analyze -f ./ts-for-gir-report.json
ts-for-gir --help                            # the full surface
```

`--reporter` writes a JSON file (`ts-for-gir-report.json` by default) listing every unresolved type, version conflict and skipped construct. `ts-for-gir analyze -f <report>` turns that into a readable summary, and it takes filters so you can narrow down:

```bash
ts-for-gir analyze -f ./ts-for-gir-report.json --severity error critical
ts-for-gir analyze -f ./ts-for-gir-report.json --namespace GLib --top 5
ts-for-gir analyze -f ./ts-for-gir-report.json --category type_resolution --detailed
```

## Use the pre-generated packages

If you want types and no generator run:

```bash
npm install @girs/gjs @girs/gtk-4.0
```

```ts
import '@girs/gjs';
import '@girs/gjs/dom';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';

const button = new Gtk.Button();
```

All of them are listed at [github.com/gjsify/types](https://github.com/gjsify/types). Missing a module? [Open an issue](https://github.com/gjsify/ts-for-gir/issues).

## Patterns that come with the types

Two pages on this site document the idioms the generated declarations expect:

- [GObject classes](/gjsify/patterns/gobject-classes/) covers the `GObject.registerClass()` forms, the static-block pattern, init-order rules, and the `static override $gtype` declaration that narrows the inherited `$gtype`.
- [Bridge widgets](/gjsify/patterns/bridges/) covers how `Canvas2DBridge`, `WebGLBridge`, `IFrameBridge` and `VideoBridge` pair a polyfill DOM element with a real GTK widget, so browser-shaped code drives the GTK surface directly.

## How the CLI itself is built

`@ts-for-gir/cli` is built with gjsify, twice. `gjsify build --app node` produces the executable `bin/ts-for-gir` you get from npm, and `gjsify build --app gjs` produces `bin/ts-for-gir-gjs`, the GJS bundle that `gjsify dlx @ts-for-gir/cli` runs. That second bundle is why the Node-free install paths above work at all.

The Node bundle keeps its heavier runtime dependencies (`typedoc`, `ejs`, `yargs`, `inquirer` and friends) external and installs them from npm as usual; the GJS bundle inlines everything, because there is no npm install step on that path.

Both are executable directly, with the shebang written by the build rather than by a wrapper script. If you are curious how a bundle keeps finding its own data files after a global install, that is covered in [How It Works](/gjsify/how-it-works/#location-independent-bundles).

## What is in the repository

| Package | Responsibility |
|---|---|
| [`@ts-for-gir/cli`](https://github.com/gjsify/ts-for-gir/tree/main/packages/cli) | The command line: generate, analyze, create, list, doc, self-update |
| [`@gi.ts/parser`](https://github.com/gjsify/ts-for-gir/tree/main/packages/parser) | Parser for GObject Introspection XML |
| [`@ts-for-gir/lib`](https://github.com/gjsify/ts-for-gir/tree/main/packages/lib) | Core library for processing GIR data |
| [`@ts-for-gir/generator-typescript`](https://github.com/gjsify/ts-for-gir/tree/main/packages/generator-typescript) | The TypeScript definition generator |
| [`@ts-for-gir/generator-html-doc`](https://github.com/gjsify/ts-for-gir/tree/main/packages/generator-html-doc) | HTML documentation generator (TypeDoc) |
| [`@ts-for-gir/generator-json`](https://github.com/gjsify/ts-for-gir/tree/main/packages/generator-json) | JSON representation for analysis and tooling |
| [`@ts-for-gir/generator-base`](https://github.com/gjsify/ts-for-gir/tree/main/packages/generator-base) | Shared base class for the generators |
| [`@ts-for-gir/typedoc-theme`](https://github.com/gjsify/ts-for-gir/tree/main/packages/typedoc-theme) | TypeDoc theme modelled on gi-docgen |
| [`@ts-for-gir/gir-module-metadata`](https://github.com/gjsify/ts-for-gir/tree/main/packages/gir-module-metadata) | Curated metadata (descriptions, logos, licenses) for GIR namespaces |
| [`@ts-for-gir/templates`](https://github.com/gjsify/ts-for-gir/tree/main/packages/templates) | EJS templates for the generated packages |
| [`@ts-for-gir/reporter`](https://github.com/gjsify/ts-for-gir/tree/main/packages/reporter) | The reporting system behind `--reporter` and `analyze` |
| [`@ts-for-gir/language-server`](https://github.com/gjsify/ts-for-gir/tree/main/packages/language-server) | Language server for GIR files (experimental) |

## Apps shipping with these types

GNOME applications:

- [Audio Player](https://flathub.org/apps/org.gnome.Decibels) · [Counters](https://flathub.org/apps/io.gitlab.guillermop.Counters) · [Ignition](https://flathub.org/apps/io.github.flattool.Ignition)
- [Learn 6502](https://flathub.org/apps/eu.jumplink.Learn6502) · [Sound Recorder](https://flathub.org/apps/org.gnome.SoundRecorder) · [Sticky Notes](https://flathub.org/apps/com.vixalien.sticky)
- [Weather](https://flathub.org/apps/org.gnome.Weather) · [K'uychi](https://flathub.org/en/apps/one.naiara.Kuychi)

GNOME Shell extensions: [gTile](https://github.com/gTile/gTile), [Copyous](https://github.com/boerdereinar/copyous), [Rounded Window Corners](https://github.com/flexagoon/rounded-window-corners).

## Further reading

- [ts-for-gir on GitHub](https://github.com/gjsify/ts-for-gir) for the source and the issue tracker
- [TypeScript API documentation](https://gjsify.github.io/docs), the generated typedoc covering GLib, GTK, GStreamer and the rest
- [gjsify/types](https://github.com/gjsify/types) for the pre-generated `@girs/*` npm packages
- [gjsify/gnome-shell](https://github.com/gjsify/gnome-shell) for hand-written Shell Extension types
