---
title: DOM & Graphics
description: Put a canvas, a WebGL context, a video or a web view inside a GTK window, using the DOM API you already know.
---

These packages let you draw with the browser APIs inside a real GTK window. You create a *bridge* widget, you get a standard `HTMLCanvasElement` (or video, or iframe) back, and the widget goes into your GTK tree like any other.

## Draw on a canvas

```typescript
import Adw from 'gi://Adw?version=1';
import { Canvas2DBridge } from '@gjsify/canvas2d';

const bridge = new Canvas2DBridge();
bridge.installGlobals();

bridge.onReady((canvas, ctx) => {
    ctx.fillStyle = '#3584e4';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '24px Adwaita Sans';
    ctx.fillStyle = '#fff';
    ctx.fillText('Hello GNOME!', 30, 70);
});

const win = new Adw.ApplicationWindow({ application: app });
win.set_default_size(600, 400);
win.set_child(bridge);
win.present();
```

`bridge` **is** a `Gtk.DrawingArea`, so `set_size_request`, `add_css_class` and every other widget method work on it. `onReady` fires once the widget has a real surface; touching the canvas before that gives you a zero-sized one.

`installGlobals()` puts `requestAnimationFrame`, `performance.now()` and the DOM globals on `globalThis`. You need it for library code written against the browser (three.js, Excalibur, p5.js); you can skip it for code you wrote yourself.

## Render with WebGL

```typescript
import Adw from 'gi://Adw?version=1';
import { WebGLBridge } from '@gjsify/webgl';

const bridge = new WebGLBridge();
bridge.installGlobals();

bridge.onReady((canvas, gl) => {
    gl.clearColor(0.2, 0.3, 0.8, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
});

const win = new Adw.ApplicationWindow({ application: app });
win.set_default_size(800, 600);
win.set_child(bridge);
win.present();
```

Same shape, different widget: `WebGLBridge` extends `Gtk.GLArea` and exposes WebGL 1.0 and 2.0. `requestAnimationFrame` is wired to the GTK frame clock, so vsync works without any setup.

## Show a video or a web page

`VideoBridge` takes a `MediaStream` through `srcObject` or a URL through `src`, and renders through GStreamer into a `Gtk.Picture`. `IFrameBridge` wraps a real `WebKit.WebView` and gives you `src`, `srcdoc`, navigation and `postMessage`. Both follow the same `onReady` pattern.

For the full lifecycle, the resize behaviour and the traps worth knowing about ahead of time, read [Bridge Widgets](/gjsify/patterns/bridges/).

## Which DOM element maps to which widget

| DOM element | Bridge class | GTK widget | Backed by |
|---|---|---|---|
| `HTMLCanvasElement` with a `2d` context | `Canvas2DBridge` | `Gtk.DrawingArea` | Cairo, PangoCairo |
| `HTMLCanvasElement` with a `webgl` or `webgl2` context | `WebGLBridge` | `Gtk.GLArea` | OpenGL ES via libepoxy |
| `HTMLVideoElement` | `VideoBridge` | `Gtk.Picture` | GStreamer, gtk4paintablesink |
| `HTMLIFrameElement` | `IFrameBridge` | `WebKit.WebView` | WebKit 6.0 |
| `HTMLImageElement` | none needed | drawn into the canvas | GdkPixbuf |

## The packages

| Package | Backed by | What you get |
|---|---|---|
| `@gjsify/dom-elements` | GdkPixbuf, `@gjsify/canvas2d-core` | Node, Element, HTMLElement, HTMLCanvasElement, HTMLImageElement, HTMLMediaElement, HTMLVideoElement, Document, MutationObserver, ResizeObserver, IntersectionObserver, DOMMatrix, FontFace, matchMedia |
| `@gjsify/canvas2d-core` | Cairo, PangoCairo | CanvasRenderingContext2D, CanvasGradient, CanvasPattern, Path2D, ImageData, with no GTK dependency at all |
| `@gjsify/canvas2d` | `@gjsify/canvas2d-core`, Gtk 4 | Everything in canvas2d-core, plus `Canvas2DBridge` |
| `@gjsify/webgl` | Gtk 4, libepoxy | WebGL 1.0 and 2.0 through a Vala native extension, plus `WebGLBridge` |
| `@gjsify/video` | Gst 1.0, Gtk 4 | HTMLVideoElement and `VideoBridge` |
| `@gjsify/iframe` | WebKit 6.0 | HTMLIFrameElement, `IFrameBridge` and the postMessage bridge |
| `@gjsify/event-bridge` | Gtk 4, Gdk 4 | GTK to DOM event mapping: mouse, pointer, keyboard, wheel, focus |
| `@gjsify/bridge-types` | pure TS | The `DOMBridgeContainer`, `BridgeEnvironment` and `BridgeWindow` interfaces, if you write your own bridge |

`@gjsify/canvas2d-core` is headless on purpose: it draws through Cairo and never touches GTK. Pair it with `@gjsify/dom-elements` and you can render in a CLI tool with no window anywhere, then call `canvas.toDataURL()` to get a PNG back.

## Globals these packages own

Importing a bridge package root has no side effects: `import { Canvas2DBridge } from '@gjsify/canvas2d'` gives you the class and nothing else. The browser globals each package owns live behind a `/register` subpath, and the default `--globals auto` injects them for you when your code references them. `@gjsify/canvas2d/register` covers `ImageData` and `Path2D`; `@gjsify/iframe/register` covers `HTMLIFrameElement` and `document.createElement('iframe')`.

## Where these run

The bridges are GTK code, so the machine needs the GNOME stack whichever runtime you use. What differs is how your JavaScript reaches it: on GJS the `gi://` imports above are the runtime's own module loader, with nothing in between, and on Node, Bun and Deno the same source builds with `--app node` and goes through [`@gjsify/node-gi`](/gjsify/projects/node-gi/).

The Canvas 2D and WebGL showcases (`canvas2d-fireworks`, `three-geometry-teapot`, `excalibur-jelly-jumper`) declare all four runtimes. The ones built on `@gjsify/iframe` (WebKit) and `@gjsify/webrtc` (GStreamer WebRTC) declare `gjs` only, so `gjsify showcase <name> --runtime node` refuses them up front instead of crashing. CI launches the `gjs` column of that matrix; the other three are declared and not yet exercised there.

## Related

- [Bridge Widgets](/gjsify/patterns/bridges/), the lifecycle in depth plus four worked examples
- [Showcases](/gjsify/showcases/), three.js, Excalibur and a WebKit browser running in GTK windows
- [Platform Support](/gjsify/platform-support/), which operating systems each native bridge reaches
