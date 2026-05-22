---
title: Patterns
description: Idiomatic recipes for gjsify-on-GJS code — class definitions, bridge widgets, signal handlers, async / mainloop coordination.
---

Patterns documents the **idioms** for writing gjsify-on-GJS code. Where the [Guides](../guides/install/) section answers *"how do I ship X"* and the [Packages](../packages/overview/) section is API reference, this section answers *"what's the right way to write X"* — the smell-free shapes that hold up across GJS quirks, GObject lifetime, and the cross-platform `@gjsify/*` contract.

Each page lists one or more **preferred patterns** with a short rationale, then names the **rough edges** (init-order traps, GC pitfalls, type-inference holes) so you can recognise them before they bite. Snippets are runnable as written and link to a working example under [`examples/`](https://github.com/gjsify/ts-for-gir/tree/main/examples) where applicable.

## Current pages

- [**GObject classes**](./gobject-classes/) — `GObject.registerClass()` forms, the static-block pattern, init-order rules, `$gtype` declarations.

## Planned

The list grows as we collect real-world friction. Open issues for new ideas:

- **Bridges** — `Canvas2DBridge` / `WebGLBridge` / `IFrameBridge` / `VideoBridge` lifecycle, `installGlobals()` + `onReady()` conventions, `ResizeObserver` semantics.
- **Signal handlers** — `connect` / `disconnect`, weak references, GC concerns, GLib mainloop coordination.
- **`/register` subpath convention** — when to import `<pkg>/register` directly vs rely on `gjsify build --globals auto`.
- **Async on GJS** — Promise / async-await composition with the GLib main context.
- **Native bridges** — when to reach for Vala, prebuild conventions, GIRepository search-path setup.
