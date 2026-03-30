---
title: DOM & Graphics
description: DOM elements and graphics APIs for GJS, bridging the gap between web and GTK
---

DOM elements and graphics APIs for GJS, bridging the gap between web and GTK.

| Package | GNOME Libs | Implements |
|---|---|---|
| `dom-elements` | GdkPixbuf | Node, Element, HTMLElement, HTMLCanvasElement, HTMLImageElement, Document, MutationObserver |
| `canvas2d` | Cairo, PangoCairo | CanvasRenderingContext2D, CanvasGradient, CanvasPattern, Path2D, ImageData |
| `webgl` | Gtk 4.0, GObject, libepoxy | WebGL 1.0/2.0 via Vala native extension |
| `event-bridge` | Gtk 4.0, Gdk 4.0 | GTK→DOM event mapping (mouse, pointer, keyboard, wheel, focus) |
| `iframe` | WebKit 6.0 | HTMLIFrameElement, postMessage bridge |

## DOM Elements = GTK Widgets

Each visual DOM element is backed by a GTK widget:

| DOM Element | Widget | Backing Library |
|---|---|---|
| `HTMLCanvasElement` (2d) | `Canvas2DWidget` → `Gtk.DrawingArea` | Cairo |
| `HTMLCanvasElement` (webgl) | `CanvasWebGLWidget` → `Gtk.GLArea` | OpenGL ES / libepoxy |
| `HTMLIFrameElement` | `IFrameWidget` → `WebKit.WebView` | WebKit |
| `HTMLImageElement` | — | GdkPixbuf |

## Example: Canvas2D

```typescript
import { Canvas2DWidget } from '@gjsify/canvas2d';

const widget = new Canvas2DWidget();
widget.installGlobals();

widget.onReady((canvas, ctx) => {
  ctx.fillStyle = '#3584e4';
  ctx.fillRect(10, 10, 200, 100);
  ctx.font = '24px sans-serif';
  ctx.fillText('Hello GNOME!', 30, 70);
});

window.set_child(widget);
```

## Example: WebGL

```typescript
import { CanvasWebGLWidget } from '@gjsify/webgl';

const widget = new CanvasWebGLWidget();
widget.installGlobals();

widget.onReady((canvas, gl) => {
  gl.clearColor(0.2, 0.3, 0.8, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
});

window.set_child(widget);
```
