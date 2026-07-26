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

## License

MIT
