---
title: Solid JSX
description: Compile SolidJS JSX for a GTK 4 build with @gjsify/rolldown-plugin-solid. Universal generate mode, the tsconfig half that goes with it, and the silent failure it exists to stop.
---

[`@gjsify/rolldown-plugin-solid`](https://www.npmjs.com/package/@gjsify/rolldown-plugin-solid)
compiles SolidJS JSX during a gjsify build, in `universal` generate mode — the only mode whose
output contains no DOM. It targets the renderer in
[`@gjsify/gtk-host/solid`](/gjsify/guides/ui-frameworks/), and it is the whole compile step: a
`.tsx` entry plus this plugin is a GTK app.

It is an ordinary Rolldown plugin, so it also loads under Rollup and Vite.

## Install

```bash
gjsify install @gjsify/rolldown-plugin-solid @gjsify/gtk-host solid-js
```

## Wire it up

Name the plugin in `package.json#gjsify`. There is no JS-form config file to add:

```jsonc
{
    "gjsify": {
        "bundler": {
            "plugins": [{ "name": "@gjsify/rolldown-plugin-solid" }]
        }
    }
}
```

Then build the `.tsx` entry like any other:

```bash
gjsify build src/app.tsx --app gjs --outfile dist/app.gjs.mjs
gjsify run dist/app.gjs.mjs
```

Or drop it into a Rolldown / Vite config directly:

```ts
// rolldown.config.ts
import { solidPlugin } from '@gjsify/rolldown-plugin-solid';

export default {
    plugins: [solidPlugin({ moduleName: '@gjsify/gtk-host/solid' })],
};
```

### Options

| Option | Default | What it does |
|---|---|---|
| `moduleName` | `@gjsify/gtk-host/solid` | Module the compiler imports the renderer ops from. |
| `generate` | `universal` | `babel-preset-solid` mode. `dom` emits `document.createElement`, which GJS does not have. |
| `include` | `/\.(m\|c)?[jt]sx$/` | Which modules to compile. A `.ts` file cannot contain JSX, so widening this is a mistake. |

## The TypeScript half, and both halves are required

```jsonc
{
    "compilerOptions": {
        "jsx": "preserve",
        "jsxImportSource": "@gjsify/gtk-host",
        "strict": true
    }
}
```

`jsx: "preserve"` is what this plugin needs — the JSX has to survive TypeScript so Babel can
take it, and `"react"` is refused outright with `jsxImportSource` (TS5089).

`noImplicitAny` — which `strict` turns on — is not optional either. With `jsx: "preserve"`, no
`jsxImportSource` and `noImplicitAny` off, **every JSX element is implicitly `any` and `tsc`
exits 0 having checked nothing**. A project in that state watches a clean type check go by and
concludes the type surface works.

One gap the surface cannot close: TypeScript exempts every hyphen-containing JSX attribute
from excess-property checking, so `<gtk-box no-such={1} />` is accepted. Both spellings are
generated, so a declared `can-focus="yes"` still fails on its *value* — but prefer `canFocus`,
which is checked both ways.

## Why Babel, in an oxc toolchain

Solid's JSX is a **compiler**, not a runtime. `babel-plugin-jsx-dom-expressions` turns markup
into straight-line calls against a renderer, and no oxc or SWC port of it exists. Rolldown's
own transformer cannot stand in.

That matters because of what happens when nothing is configured. Pointed at a `.tsx` with no
JSX policy, the transformer defaults to the automatic React runtime and emits
`import { jsx } from "react/jsx-runtime"`. GJS cannot resolve a bare specifier at all, so the
build reports the miss as a **warning**, exits 0 — and the artifact dies at its first import
under `gjs`. Measured end to end: exit 0, then exit 1.

`gjsify build --app gjs` now refuses that case up front. Give it a `.tsx` entry with no
`gjsify.bundler.transform.jsx` and no tsconfig `compilerOptions.jsx`, and the build stops with
an error naming the file and the three ways to answer the question. The refusal is scoped to
`--app gjs`: on `--app node` and `--app browser` the React default is a legitimate answer for a
project that has React installed.

Babel is loaded on the first matching module, so a build with no JSX in it never pays for it.

## What the compiler emits

Measured on real markup:

```js
var _el$ = _$createElement("adw-application-window"),
    _el$2 = _$createElement("adw-toolbar-view");
_$insertNode(_el$, _el$2);
_$setProp(_el$, "title", "solid-host counter");
```

Three consequences, and each is a thing the host has to do rather than the adapter:

- **Children are inserted before properties are set**, and `createElement` never sees a prop.
  A construct-only property such as `cssName` therefore only survives because the host defers
  materialisation and rebuilds when it has to.
- **Handlers arrive through `setProp`** under their JSX spelling (`onClicked`), not through a
  separate op.
- **The renderer op names are emitted literally.** They are the member names of Solid's
  `Renderer<NodeType>` — `createElement`, `createTextNode`, `insertNode`, `insert`, `spread`,
  `setProp`, `mergeProps`, `effect`, `memo`, `createComponent`, `render`, `use` — so
  `moduleName` must re-export all twelve under exactly those names. A renderer that exports
  eleven builds fine and fails with `MISSING_EXPORT` on the twelfth, only for the JSX that
  happens to need it.

## Import control flow from the adapter

`For`, `Index`, `Show` and `Dynamic` come from `@gjsify/gtk-host/solid`, never from
`solid-js/web`. That package is Solid's DOM renderer: its components build DOM elements
nothing here can place. Measured with `<Dynamic component="GtkLabel">` imported from
`solid-js/web` into a GJS bundle — the box's children were just the static sibling, with no
throw, no GTK diagnostic and exit 0. Importing it also makes `--globals auto` inject
`document`, `HTMLCanvasElement` and `Path2D`, and pull `gi://Gdk`, `GdkPixbuf`, `Pango` and
`PangoCairo` into the bundle.

## What it does not do

The plugin is the compile step and nothing else. No `<style>` or CSS handling — GTK styling is
a `Gtk.CssProvider` concern. No dev or HMR mode. `generate: "dom"` and `"ssr"` are settable and
untested, because nothing here has a DOM to render into.

## Related

- [UI Frameworks](/gjsify/guides/ui-frameworks/) for the host, the widget table and the
  placement rules
- [Vue SFCs](/gjsify/guides/vue-sfc/) for the same pipeline on `@vue/compiler-sfc`
- [`solid-host-counter`](https://github.com/gjsify/gjsify/tree/main/showcases/gtk/solid-host-counter),
  a complete window that asserts its own widget tree on every launch
- [`@gjsify/rolldown-plugin-solid` on npm](https://www.npmjs.com/package/@gjsify/rolldown-plugin-solid)
