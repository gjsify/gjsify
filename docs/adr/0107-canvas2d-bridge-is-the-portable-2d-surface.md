# 107. `Canvas2DBridge` is the portable 2D surface; `Gtk.DrawingArea` keeps cairo

- Status: **Proposed**
- Date: 2026-10-12
- Deciders: Pascal Garber
- Related: `packages/framework/canvas2d/src/canvas2d-bridge.ts`; `packages/framework/file-chooser`
  (the conformance-vector pattern); `packages/nativescript-bridge/adwaita/src/widgets/gtk-drawing-area.ts`
  (the existing refusal)

## Context

An app that draws, such as a 32x32 grid of `fillRect` calls, must run from one source on GJS, in the
browser and on NativeScript. `Gtk.DrawingArea` cannot carry it: its contract is a cairo context handed
to `set_draw_func`, and there is no cairo context on NativeScript. `Canvas2DBridge` from
`@gjsify/canvas2d` already offers the Web-standard `CanvasRenderingContext2D` on GJS, but only there.

## Decision

1. **The portable 2D surface is the Web-standard Canvas2D, reached through `Canvas2DBridge`.**
   `@gjsify/canvas2d` exports it per target: the root entry is the GTK widget, `./browser` and
   `./nativescript` re-export the renderers' implementations (ADR 0014 entries, with
   `runtimes.browser` and `runtimes.nativescript` staying `none` for the cairo root). A `.blp` names
   it as the template class `$GjsifyCanvas2DBridge` on all three.
2. **`Gtk.DrawingArea` keeps real cairo semantics.** It stays refused on NativeScript
   (`set_draw_func` throws `DRAWING_AREA_REFUSAL`). No renderer fakes a cairo context.
3. **Web.** `Canvas2DBridge` is a `<gjsify-canvas2d-bridge>` element holding a real `<canvas>`;
   `getContext('2d')` returns the browser's own context. It lives in `@gjsify/adwaita-web/canvas2d`.
4. **NativeScript.** `Canvas2DBridge` is a view over an Android `ImageView` showing a `Bitmap` that
   an `android.graphics.Canvas` draws into. It lives in `@gjsify/adwaita-nativescript/canvas2d`. Its
   context is a TRUE SUBSET: `canvas.width/height`, `fillStyle`, `strokeStyle`, `lineWidth`,
   `globalAlpha`, `imageSmoothingEnabled`, `fillRect`, `clearRect`, `beginPath`, `moveTo`, `lineTo`,
   `rect`, `closePath`, `fill`, `stroke`, `save`, `restore`. Every other member is ABSENT, so calling
   it is a `TypeError`, never a silent no-op. A gradient or pattern assigned to a style throws.
   Colours are `#rgb`, `#rrggbb`, `rgb()`, `rgba()` and named colours, parsed by
   `@gjsify/canvas2d-core/color`.
5. **One size contract**, taken from the GJS widget: the canvas is created at the first allocation, in
   logical pixels; `onReady` runs once, synchronously if the context exists; an allocation change sets
   `canvas.width/height`, dispatches `resize` on the canvas, then runs the `resize` handlers and
   `onResize`. The Android bitmap is `logical x density` physical pixels and is shown 1:1 at the
   top-left with filtering off, so any scaling is nearest-neighbour.
6. **Per-platform choice stays open.** The platform files, the renderers' subpath exports and the
   registered template class let an app pick another driver for one target.

## Known deviations (not fixed here)

- **adwaita-web's `Gtk.DrawingArea` passes a `CanvasRenderingContext2D` to `set_draw_func`, not a
  cairo context.** The two APIs differ (`cr.setSourceRGB` against `ctx.fillStyle`), so cairo code
  does not run there unchanged. Fixing it means either removing that behaviour or emulating cairo.
- **Resync on draw.** GTK compares the canvas size with the allocation on every draw, so a size the
  app set itself is reset by the next `queue_draw()`. The browser and NativeScript compare with the
  previous allocation only, so it survives. The conformance vectors leave this unpinned.
- **Subset only on Android.** iOS builds the bridge but refuses to create a native view.

## Consequences

- One drawing source runs on all three targets, provided it stays in the subset.
- `@gjsify/adwaita-web` and `@gjsify/adwaita-nativescript` become optional peers of
  `@gjsify/canvas2d` (ADR 0003 exempts optional peers from the tier rule).
- The NativeScript driver is not verified on a device; it is covered off-device through a recording
  backend.

## Alternatives rejected

- **Emulate cairo on NativeScript.** A large surface for a context the Web already standardises.
- **Make `Gtk.DrawingArea` portable by giving it a canvas context everywhere.** It would turn a cairo
  contract into a different one under the same name.

## Implementation

`packages/framework/canvas2d/src/{browser,nativescript,conformance}.ts`;
`packages/web/adwaita-web/src/canvas2d/`; `packages/nativescript-bridge/adwaita/src/canvas2d/`.
