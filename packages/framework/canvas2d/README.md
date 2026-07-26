# @gjsify/canvas2d

GJS implementation of CanvasRenderingContext2D using Cairo and PangoCairo. Provides Canvas2DBridge extending Gtk.DrawingArea.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/canvas2d

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/canvas2d
yarn add @gjsify/canvas2d
```

## Usage

```typescript
import { Canvas2DBridge } from '@gjsify/canvas2d';

const widget = new Canvas2DBridge();
widget.installGlobals();

widget.onReady((canvas, ctx) => {
  ctx.fillStyle = 'red';
  ctx.fillRect(0, 0, 100, 100);
});

window.set_child(widget);
```

## Globals

The package root is a **side-effect-free barrel** — importing it gives you named
exports and nothing else. Browser globals are installed by the dedicated
`/register` subpath:

```typescript
import '@gjsify/canvas2d/register';   // globalThis.ImageData, globalThis.Path2D
```

You normally never write that import: `gjsify build` defaults to `--globals auto`,
which detects a free `ImageData` / `Path2D` reference in the bundled output and
injects the subpath for you. Application and example code should rely on that (see
the tree-shakeable-globals convention in `AGENTS.md`) — an explicit `/register`
import in app code hides auto-detection gaps.

What each entry point gives you:

| | `@gjsify/canvas2d` | `@gjsify/canvas2d/register` |
|---|---|---|
| `CanvasRenderingContext2D`, `CanvasGradient`, `CanvasPattern`, `Path2D`, `ImageData`, `parseColor`, `Canvas2DBridge` | named exports | — |
| `globalThis.ImageData`, `globalThis.Path2D` | — | ✅ |
| `globalThis.CanvasRenderingContext2D`, `globalThis.HTMLCanvasElement`, `globalThis.DOMMatrix{,ReadOnly}` and the `'2d'` context factory | — | ✅ (delegated to `@gjsify/dom-elements/register/canvas`, which owns them) |

`Canvas2DBridge` depends on the `'2d'` context factory and imports
`@gjsify/dom-elements/register/canvas` itself, so `canvas.getContext('2d')` works
on a bridge even with `--globals none`.

> **Changed after 0.22.0** — up to and including 0.22.0, `import { Canvas2DBridge } from '@gjsify/canvas2d'`
> installed `ImageData` / `Path2D` / `CanvasRenderingContext2D` on `globalThis` as an
> import side effect and registered a second, duplicate `'2d'` context factory. See
> [ADR 0012](https://github.com/gjsify/gjsify/blob/main/docs/adr/0012-framework-register-ownership.md).

## License

MIT
