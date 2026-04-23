---
title: DOM & Graphics
description: DOM elements and graphics APIs for GJS, bridging the gap between web and GTK
---

DOM elements and graphics APIs for GJS, bridging the gap between web and GTK.

| Package | GNOME Libs | Implements |
|---|---|---|
| `dom-elements` | GdkPixbuf, `@gjsify/canvas2d-core` | Node, Element, HTMLElement, HTMLCanvasElement (auto-registers `'2d'` context factory), HTMLImageElement, HTMLMediaElement, HTMLVideoElement, Document, MutationObserver, ResizeObserver, IntersectionObserver |
| `canvas2d-core` | Cairo, PangoCairo | **Headless** CanvasRenderingContext2D, CanvasGradient, CanvasPattern, Path2D, ImageData — no GTK dependency |
| `canvas2d` | `@gjsify/canvas2d-core`, Cairo, PangoCairo, Gtk 4 | Re-exports canvas2d-core + FontFace + Canvas2DBridge → Gtk.DrawingArea |
| `webgl` | Gtk 4.0, GObject, libepoxy | WebGL 1.0/2.0 via Vala native extension |
| `event-bridge` | Gtk 4.0, Gdk 4.0 | GTK→DOM event mapping (mouse, pointer, keyboard, wheel, focus) |
| `iframe` | WebKit 6.0 | HTMLIFrameElement, IFrameBridge → WebKit.WebView, postMessage bridge |
| `video` | Gst 1.0, Gtk 4.0 | HTMLVideoElement, VideoBridge → Gtk.Picture (gtk4paintablesink). `srcObject` (MediaStream from getUserMedia/WebRTC) + `src` (URI via playbin) |
| `bridge-types` | — | DOMBridgeContainer interface, BridgeEnvironment, BridgeWindow |

## DOM Elements = GTK Widgets

Each visual DOM element is backed by a GTK widget:

| DOM Element | Widget | Backing Library |
|---|---|---|
| `HTMLCanvasElement` (2d) | `Canvas2DBridge` → `Gtk.DrawingArea` | Cairo + PangoCairo |
| `HTMLCanvasElement` (webgl/webgl2) | `WebGLBridge` → `Gtk.GLArea` | OpenGL ES / libepoxy via `gwebgl` Vala |
| `HTMLIFrameElement` | `IFrameBridge` → `WebKit.WebView` | WebKit 6.0 |
| `HTMLVideoElement` | `VideoBridge` → `Gtk.Picture` | gtk4paintablesink (GStreamer) |
| `HTMLImageElement` | — | GdkPixbuf |

## Example: Canvas2D

```typescript
import { Canvas2DBridge } from '@gjsify/canvas2d';

const widget = new Canvas2DBridge();
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
import { WebGLBridge } from '@gjsify/webgl';

const widget = new WebGLBridge();
widget.installGlobals();

widget.onReady((canvas, gl) => {
  gl.clearColor(0.2, 0.3, 0.8, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
});

window.set_child(widget);
```
