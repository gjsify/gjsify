# @gjsify/iframe

GJS implementation of HTMLIFrameElement using WebKit 6.0. Provides IFrameBridge extending WebKit.WebView with postMessage bridge.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/iframe

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/iframe
yarn add @gjsify/iframe
```

## Usage

```typescript
import { IFrameBridge } from '@gjsify/iframe';

const widget = new IFrameBridge();

widget.onReady((iframe) => {
  iframe.contentWindow?.addEventListener('message', (event) => {
    console.log(event.data);
  });
});

widget.iframeElement.srcdoc = '<h1>Hello</h1>';
window.set_child(widget);
```

## Globals

The package root is a **side-effect-free barrel** — importing it gives you named
exports and nothing else. The DOM wiring lives in the dedicated `/register`
subpath:

```typescript
import '@gjsify/iframe/register';
```

It does two things:

- installs `globalThis.HTMLIFrameElement` (guarded — a global that already exists wins);
- registers the `'iframe'` element factory, so `document.createElement('iframe')`
  returns a WebKit-backed `HTMLIFrameElement`.

You normally never write that import: `gjsify build` defaults to `--globals auto`,
which detects a free `HTMLIFrameElement` reference in the bundled output and injects
the subpath for you. Application and example code should rely on that (see the
tree-shakeable-globals convention in `AGENTS.md`).

`IFrameBridge` itself needs neither — it constructs its `HTMLIFrameElement`
directly — so `new IFrameBridge()` works with `--globals none`. If you want the
DOM surface unconditionally (overriding whatever is there), the bridge exposes the
explicit, imperative counterpart, which installs exactly the same pair:

```typescript
widget.installGlobals();   // globalThis.HTMLIFrameElement + the 'iframe' element factory
```

> **Changed after 0.22.0** — up to and including 0.22.0, `import { IFrameBridge } from '@gjsify/iframe'`
> installed `globalThis.HTMLIFrameElement` and the `'iframe'` element factory as an
> import side effect. See
> [ADR 0012](https://github.com/gjsify/gjsify/blob/main/docs/adr/0012-framework-register-ownership.md).

## Runtimes — GJS and Node

The package binds GJS through nothing but `gi://` (`WebKit`, `JavaScriptCore`,
`GLib`, `GObject`, `Gio`), and `--app node` rewrites every one of those to
`@gjsify/node-gi`'s `requireGi(…)`. So it serves **both** hosts from one source:
`{gjs: polyfill, node: polyfill}`. That matters beyond portability — macOS and
Windows have no GJS host for this pillar at all, so Node is the *only* host on
which [ADR 0022](../../../docs/adr/0022-webkit-on-darwin.md)'s darwin backend and
[ADR 0035](../../../docs/adr/0035-web-view-on-win32.md)'s WebView2 backend can be
reached. The `node` slot was `"none"` until it was measured; the amendment and the
numbers are in ADR 0022 § *Amendment — the `node` slot*.

`browser` and `nativescript` stay `none` and that is a different kind of claim: on
those two targets `gi://` is substituted with `{}`, so a wrong declaration fails
silently rather than at module load.

The Node leg is `gjsify run test:gjs-on-node` — the SAME suite the GJS leg runs,
built `--app node` and executed over the reverse bridge, so a gjs-green/node-red
diff is attributable ([ADR 0030](../../../docs/adr/0030-one-corpus-gjs-as-oracle.md)).
Measured: 291/291 on gjs 1.88.1, 275/275 on Node 24.19.0. The difference is
`register.spec.ts`'s 16 tests, which are `on('Gjs', …)` and stand down there — so
`/register` is the one part of this package the node leg does not cover.

Its one build flag is load-bearing rather than incidental:

```
--alias @gjsify/message-channel=../../web/message-channel/lib/esm/index.js
```

`@gjsify/message-channel` declares `node: "native"`, so on the node target ADR
0014's routing sends it to `@gjsify/message-channel/globals`, i.e. to Node's own
`MessageChannel`. That is right for a node consumer and wrong for this leg: the
two hosts would then be running different programs. Measured without the alias —
`Object.prototype.toString.call(new MessageChannel())` is `[object Object]` on
Node against `[object MessageChannel]` on GJS, and `port1` reports
`[object EventTarget]`, so `IFrameMessageChannel — Symbol.toStringTag identifies
the types` fails at 274 tests instead of passing at 275. The divergence belongs to
`@gjsify/message-channel`'s slot, not to this package, so the leg pins the corpus
and leaves it there. Same device, same reason as
`scripts/node-gi-consumer-harness.mjs`'s forced sibling-polyfill closure.

## License

MIT
