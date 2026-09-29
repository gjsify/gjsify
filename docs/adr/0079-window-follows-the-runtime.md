# 79. `window` follows the runtime: no define on Node, an EventTarget on GJS

- Status: **Accepted**
- Date: 2026-09-25
- Deciders: Pascal Garber
- Related: `packages/infra/rolldown-plugin-gjsify/AGENTS.md` § `--globals` modes

## Context

`--app gjs`, `--app node` and `--app browser` all pass `define: { window: 'globalThis' }` to the
bundler. The define predates the squashed history. It served DOM consumers: `window.innerWidth`
or `window.addEventListener` became `globalThis.…`, and `--globals auto` sees `globalThis.X` as a
use of `X`.

A define rewrites source, including the checks a library uses to decide whether it runs in a
browser. `typeof window === 'undefined'` becomes `typeof globalThis === 'undefined'`, which is
false everywhere. Measured with @mtcute/web (a Telegram client) from a Node-style entry, with the
spike's `addEventListener` shim turned off:

| run | result |
|---|---|
| source on Node | passes: `typeof window` is `'undefined'`, the exit hook uses `process.on` |
| `gjsify build --app node`, run on Node | `TypeError: globalThis.addEventListener is not a function` |
| `gjsify build --app gjs`, run on GJS | the same `TypeError` |

The hook is `typeof window === 'undefined' ? () => {} : (… window.addEventListener('beforeunload',
…))`.

The two targets fail for different reasons:

- **Node has no `window`.** On `--app node` the define is the only reason the bundle takes the
  browser branch, so the bundle is a different program from its source.
- **GJS has one of its own.** `gjs/global.cpp` defines `window` on every global as a
  non-configurable, read-only alias of the global object. Measured on GJS 1.88.1: `typeof window`
  is `'object'`, `window === globalThis`, and `delete globalThis.window` throws. On GJS the define
  is an identity, and removing it changes nothing a program can observe. The browser branch runs
  because the host says it is a window. What fails is the next call: the GJS global is not an
  EventTarget.

`@gjsify/dom-elements/register/document` already turns the global into an EventTarget, through
the window-scope event bus the GTK event bridge dispatches on. That is only reachable in a
project that has the DOM package installed and references `document`.

## Decision

1. `--app node` no longer defines `window`. `global: 'globalThis'` stays, because `global` is
   Node's.
2. `--app gjs` keeps the define. It is an identity on GJS, and the host decides `typeof window`.
3. The window-scope event bus (`installWindowEventBus`) moves from `@gjsify/dom-elements` to
   `@gjsify/dom-events`, with a new register, `@gjsify/dom-events/register/global-event-target`.
   `GJS_GLOBALS_MAP` maps `addEventListener`, `removeEventListener` and `dispatchEvent` to it.
   `--globals auto` injects it when a bundle calls one of them on `globalThis`, `window` or
   `self`, which is how every other global reaches a GJS bundle. `register/document` imports
   the same register, so the GTK event bridge and a library's `window.addEventListener` still
   share one bus.

`--app browser` and the Vite preset keep the define. A page's `window` is `globalThis`.

## Consequences

- A `--app node` bundle sees the same `typeof window` as its source run on Node.
- On GJS, library code that takes its browser branch finds an EventTarget there. A
  `'beforeunload'` listener is registered and never fires, as in a browser tab that is never
  closed. `@gjsify/dom-events` is a web-pillar package that CLI projects already install, so
  the injection does not depend on the DOM package.
- A reverse-bridge `--app node` build that needs `window` gets it from `register/document`,
  which sets `window` at runtime. It did before as well, because the define only rewrote the
  identifier.
- Further browser-only calls in such a branch (`localStorage`, `location`) are separate gaps.
  They surface as named `ReferenceError`s.

## Alternatives considered

- **Drop the define on GJS too and inject `window` from a register.** It cannot change the
  outcome: GJS's own `window` is non-configurable, so `typeof window` stays `'object'`. The
  `window` identifier would also no longer reach the detector as `globalThis.X`.
- **Hide GJS's `window` for DOM-less programs.** The property cannot be deleted or redefined.
  Shadowing it with a bundle-scope `var window` would break `window === globalThis`, which DOM
  code relies on (Excalibur's `x instanceof Window`).
