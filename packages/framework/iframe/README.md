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

## Where `gi://WebKit` 6.0 comes from

This package imports `gi://WebKit?version=6.0` and never branches on the
operating system. Which typelib answers to that name is decided by packaging —
one backend per OS:

| OS | provider | engine |
|---|---|---|
| Linux | the system WebKitGTK | WebKit |
| macOS | [`@gjsify/webkit-native`](../webkit-native/README.md) ([ADR 0022](https://github.com/gjsify/gjsify/blob/main/docs/adr/0022-webkit-on-darwin.md)) | Apple's WebKit |
| Windows | [`@gjsify/webview2-native`](../webview2-native/README.md) ([ADR 0035](https://github.com/gjsify/gjsify/blob/main/docs/adr/0035-web-view-on-win32.md)) | Chromium, via WebView2 |

Both shims are ordinary dependencies of this package and contain no JavaScript.
Each one's prebuilt library and typelib arrive through its *own* per-target
`optionalDependencies`, which a package manager installs only on the matching
`os`/`cpu` and silently skips everywhere else
([ADR 0017](https://github.com/gjsify/gjsify/blob/main/docs/adr/0017-native-package-distribution.md)).
So a Linux install pulls in two empty packages and no binaries at all.

> **Windows is stage 1, and stage 1 is not a widget.** `@gjsify/webview2-native`
> hosts an OS-composited child window that sits *outside* GSK's scene graph, and
> the hosted path itself — re-parenting under a real GTK toplevel, bounds
> tracking, hiding on unmap — is **not yet verified**; everything green so far
> ran against a hidden parking window. Read that package's README before
> relying on it: a full-page document in a window works, a web view used as an
> ordinary widget does not.

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
which [ADR 0022](https://github.com/gjsify/gjsify/blob/main/docs/adr/0022-webkit-on-darwin.md)'s
darwin backend and
[ADR 0035](https://github.com/gjsify/gjsify/blob/main/docs/adr/0035-web-view-on-win32.md)'s
WebView2 backend can be reached. The `node` slot was `"none"` until it was
measured; the amendment is ADR 0022 § *Amendment — the `node` slot*.

`node: "polyfill"` describes the `gjsify build --app node` path, which is where
the `gi://` specifiers are rewritten. Importing the published `lib/esm` straight
out of `node_modules` is not that path and does not work — Node has no loader for
the `gi:` scheme.

`browser` and `nativescript` stay `none` and that is a different kind of claim: on
those two targets `gi://` is substituted with `{}`, so a wrong declaration fails
silently rather than at module load.

The Node leg is `gjsify run test:gjs-on-node` — the SAME suite the GJS leg runs,
built `--app node` and executed over the reverse bridge, so a gjs-green/node-red
diff is attributable
([ADR 0030](https://github.com/gjsify/gjsify/blob/main/docs/adr/0030-one-corpus-gjs-as-oracle.md)).
Both legs run every test in the suite, `/register` included; neither stands down.
The same bundle also runs green on Bun and Deno — one `--app node` bundle serves
all three Node-API hosts — which is why the register gate names all four runtimes
rather than only the one CI happens to invoke.

One import spelling is load-bearing rather than incidental: the ports come from
`@gjsify/message-channel/core`, not from the bare package. That package declares
`node: "native"`, so the bare specifier routes to the host's own `MessageChannel`
— which has no transport hook, no `_partner`, and reports `Symbol.toStringTag`
`EventTarget`. The WebKit bridge needs all three, so on the node target the bare
specifier broke port transfer outright. `./core` is the same implementation at a
specifier slot routing does not rewrite.

## License

MIT
