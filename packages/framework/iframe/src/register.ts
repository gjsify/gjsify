// Side-effect module: wires the WebKit-backed HTMLIFrameElement into the DOM.
// Imported by `--globals auto` (via `GJS_GLOBALS_MAP`) or explicitly:
//
//     import '@gjsify/iframe/register';
//
// Why a framework package owns this registration (see
// docs/adr/0012-framework-register-ownership.md): `HTMLIFrameElement` is a
// DOM-spec class whose only working implementation is a `WebKit.WebView`
// (`gi://WebKit?version=6.0`). `@gjsify/dom-elements` must stay webkitgtk-free —
// webkitgtk is an OPTIONAL system dependency of gjsify (`gjsify check` lists it
// under "Optional:", required only by this package), so hosting the class or its
// registration in the DOM pillar would make WebKitGTK mandatory for every
// `document`/`Image`/canvas consumer. `@gjsify/iframe` therefore owns both.
//
// Installing it here (rather than at barrel-import time, as before) means the
// registration is tree-shakeable, opt-out-able, and — because `HTMLIFrameElement`
// is now mapped in `GJS_GLOBALS_MAP` — reachable by `--globals auto`.

import { Document } from '@gjsify/dom-elements';

import { HTMLIFrameElement } from './html-iframe-element.js';

// Makes `document.createElement('iframe')` return our element. Idempotent:
// `registerElementFactory` is a `Map.set` keyed by tag name, so re-registering
// the same factory is a no-op.
Document.registerElementFactory('iframe', () => new HTMLIFrameElement());

// Idempotent global install: a host that already provides `HTMLIFrameElement`
// (a browser, or an app that called `IFrameBridge.installGlobals()` first) wins.
// `writable` + `configurable` keep a later unconditional `installGlobals()` able
// to replace it without throwing.
if (typeof (globalThis as Record<string, unknown>).HTMLIFrameElement === 'undefined') {
    Object.defineProperty(globalThis, 'HTMLIFrameElement', {
        value: HTMLIFrameElement,
        writable: true,
        configurable: true,
    });
}
