---
title: ts-for-gir
description: TypeScript type definition generator for GObject Introspection — strong typing, IDE jump-to-definition, autocompletion across the whole GNOME stack.
---

[ts-for-gir](https://github.com/gjsify/ts-for-gir) is the TypeScript type-definition generator that powers IDE autocomplete + type-checking for every GJSify project (and many non-gjsify GJS projects). It reads GObject Introspection (`.gir` XML) files and emits `.d.ts` declarations covering GLib, GIO, GTK, GStreamer, libadwaita, WebKit, and ~700 other GNOME-stack modules.

## What you get

- **Compile-time type safety** for every `import Gtk from 'gi://Gtk?version=4.0'`.
- **IDE jump-to-definition** into `@girs/*` declarations: hover a `Gtk.Button` to see its constructor, methods, signals.
- **Pre-generated npm packages** at [gjsify/types](https://github.com/gjsify/types) — `npm i @girs/gtk-4.0` instead of running the generator yourself.
- **First-class GJSify integration**: the [`types-gjsify`](https://github.com/gjsify/ts-for-gir/tree/main/templates/types-gjsify) starter template wires `ts-for-gir generate` into `gjsify install`, `gjsify build`, and `gjsify run` so a fresh project compiles in seconds.

## Install

Five paths — pick whichever matches your toolchain.

### GJS — no Node.js required <sub>experimental</sub>

Three equivalent Node-free options, depending on whether you want a one-shot run, a managed install, or a self-updating standalone install. All require only [GJS](https://gjs.guide/) at runtime.

**One-shot — `gjsify dlx` (npx-style, no install):**

```bash
gjsify dlx @ts-for-gir/cli list
gjsify dlx @ts-for-gir/cli generate Gtk-4.0
```

`gjsify dlx` fetches the package into a content-addressed cache (`~/.cache/gjsify/dlx`), runs its GJS bundle, and reuses the cache on subsequent invocations of the same spec. Pass `--cache-max-age 0` to force a refresh.

**Global install via the GJSify CLI:**

```bash
gjsify install -g @ts-for-gir/cli
ts-for-gir --help
```

Installs into the user-global XDG location (`~/.local/share/gjsify/global`) and symlinks the binary to `~/.local/bin/ts-for-gir`. Re-run the same command to update.

**Bootstrap installer — `curl | gjs` one-liner** (handy when the `gjsify` CLI is not yet installed):

```bash
curl -fsSL https://raw.githubusercontent.com/gjsify/ts-for-gir/main/install.js -o /tmp/install.js
gjs -m /tmp/install.js && rm /tmp/install.js
```

Installs to `~/.local/bin/`. Update later with `ts-for-gir self-update`.

### Node.js

```bash
npx @ts-for-gir/cli --help
# or globally:
npm install -g @ts-for-gir/cli
```

## Quick start

Scaffold a new project — pick a template interactively, or pass `--template <id>`:

```bash
gjsify dlx @ts-for-gir/cli create my-app
# or via npm
npx @ts-for-gir/cli create my-app
```

| Template | Best for |
|---|---|
| `types-gjsify` | Node-free GJS app — all dev scripts (install, build, run, format) routed through GJSify |
| `types-npm` | Single-package, types from `@girs/*` npm, esbuild + node |
| `types-locally` | Generate types into `./@types/` (no `@girs/*` dep) |
| `types-workspace` | npm workspace with `@girs/*` as locally-generated workspace packages |

Run it:

```bash
cd my-app
gjsify run start    # types-gjsify template
# or
npm start           # any other template
```

## Generating types yourself

If the pre-generated `@girs/*` packages don't fit (custom GIR files, project-local types, an experimental gnome-shell version, …) — generate locally:

```bash
ts-for-gir generate Gtk-4.0                  # one module
ts-for-gir generate '*'                      # everything available on the system
ts-for-gir generate Gtk-4.0 --reporter       # with diagnostics
ts-for-gir analyze -f ./ts-for-gir-report.json
ts-for-gir --help                            # full surface
```

The `--reporter` flag emits a JSON file summarising every unresolved type, version conflict, and skipped construct — `ts-for-gir analyze -f <report>` then turns that into a per-namespace severity table.

## Pre-generated `@girs/*` packages

If you just want types without running the generator:

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

All ~700 packages are listed at [github.com/gjsify/types](https://github.com/gjsify/types). Missing a module? [Open an issue](https://github.com/gjsify/ts-for-gir/issues).

## Patterns reference

The [Patterns](../../patterns/) section of this site documents the idioms that ship with the generated types:

- [**GObject classes**](../../patterns/gobject-classes/) — `GObject.registerClass()` forms, the static-block pattern, init-order rules behind [GNOME/gjs#704](https://gitlab.gnome.org/GNOME/gjs/-/work_items/704), and the `static override $gtype: GObject.GType<Foo>` declaration that narrows the statically-inherited `$gtype` from the base class.
- [**Bridge widgets**](../../patterns/bridges/) — how `Canvas2DBridge` / `WebGLBridge` / `IFrameBridge` / `VideoBridge` pair a polyfill DOM element with a real GTK widget so browser-shaped code drives the GTK surface directly.

## GJSify dogfoods its own bundler

`@ts-for-gir/cli` is built with `gjsify build --app node` — a real-world Node CLI that bundles the TypeScript compiler, TypeDoc, shiki, yargs, ejs, and ~100 transitive npm dependencies into a single executable with `--shebang` (emitting `#!/usr/bin/env node`). This makes ts-for-gir a concrete proof point that GJSify can bundle and distribute production-grade Node.js CLIs:

- Bundled deps that read their own data files at runtime (`typedoc` loading its theme assets, ejs loading templates) work correctly after install at any `node_modules` depth, because GJSify resolves those paths from the bundle's actual runtime location rather than a path baked at build time.
- Yarn PnP-resident zip packages (the ~100 Yarn-cached deps) are resolved transparently by `@gjsify/module`'s PnP-aware `createRequire`.
- The produced Node bundle is directly executable (`chmod +x`) and published to npm — no separate build wrapper script needed.

## Project structure

| Package | Responsibility |
|---|---|
| [`@ts-for-gir/cli`](https://github.com/gjsify/ts-for-gir/tree/main/packages/cli) | Command-line interface — generate, analyze, create, doc, self-update |
| [`@gi.ts/parser`](https://github.com/gjsify/ts-for-gir/tree/main/packages/parser) | Parser for GObject Introspection XML files |
| [`@ts-for-gir/lib`](https://github.com/gjsify/ts-for-gir/tree/main/packages/lib) | Core library for processing GIR data |
| [`@ts-for-gir/generator-typescript`](https://github.com/gjsify/ts-for-gir/tree/main/packages/generator-typescript) | TypeScript definition generator |
| [`@ts-for-gir/generator-html-doc`](https://github.com/gjsify/ts-for-gir/tree/main/packages/generator-html-doc) | HTML documentation generator (TypeDoc) |
| [`@ts-for-gir/generator-json`](https://github.com/gjsify/ts-for-gir/tree/main/packages/generator-json) | JSON representation for analysis + tooling |
| [`@ts-for-gir/generator-base`](https://github.com/gjsify/ts-for-gir/tree/main/packages/generator-base) | Shared base class for generators |
| [`@ts-for-gir/typedoc-theme`](https://github.com/gjsify/ts-for-gir/tree/main/packages/typedoc-theme) | Custom TypeDoc theme inspired by gi-docgen |
| [`@ts-for-gir/gir-module-metadata`](https://github.com/gjsify/ts-for-gir/tree/main/packages/gir-module-metadata) | Curated metadata (descriptions, logos, licenses) for GIR namespaces |
| [`@ts-for-gir/templates`](https://github.com/gjsify/ts-for-gir/tree/main/packages/templates) | EJS templates for generated packages |
| [`@ts-for-gir/reporter`](https://github.com/gjsify/ts-for-gir/tree/main/packages/reporter) | Reporting system for problems and statistics |
| [`@ts-for-gir/language-server`](https://github.com/gjsify/ts-for-gir/tree/main/packages/language-server) | Language server for GIR files (experimental) |

## Showcase

GNOME applications shipping with ts-for-gir-generated types:

- [Audio Player](https://flathub.org/apps/org.gnome.Decibels) · [Counters](https://flathub.org/apps/io.gitlab.guillermop.Counters) · [Ignition](https://flathub.org/apps/io.github.flattool.Ignition)
- [Learn 6502](https://flathub.org/apps/eu.jumplink.Learn6502) · [Sound Recorder](https://flathub.org/apps/org.gnome.SoundRecorder) · [Sticky Notes](https://flathub.org/apps/com.vixalien.sticky)
- [Weather](https://flathub.org/apps/org.gnome.Weather) · [K'uychi](https://flathub.org/en/apps/one.naiara.Kuychi)

GNOME Shell Extensions: [gTile](https://github.com/gTile/gTile), [Copyous](https://github.com/boerdereinar/copyous), [Rounded Window Corners](https://github.com/flexagoon/rounded-window-corners).

## Further reading

- [ts-for-gir on GitHub](https://github.com/gjsify/ts-for-gir) — source + issue tracker
- [TypeScript API Documentation](https://gjsify.github.io/docs) — generated typedoc covering GLib, GTK, GStreamer, …
- [gjsify/types](https://github.com/gjsify/types) — pre-generated `@girs/*` npm packages
- [gjsify/gnome-shell](https://github.com/gjsify/gnome-shell) — hand-written Shell Extension types
