# @gjsify/timers

GJS implementation of the Node.js `timers` module. Provides setTimeout, setInterval, setImmediate, and their promises API.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/timers

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/timers
yarn add @gjsify/timers
```

## Usage

```typescript
import { setTimeout, setInterval, setImmediate } from '@gjsify/timers';
import { setTimeout as delay } from '@gjsify/timers/promises';

setTimeout(() => console.log('hello'), 1000);

await delay(1000);
console.log('1 second later');
```

## The returned handle is Node-compatible

`setTimeout` / `setInterval` return a handle carrying the full `NodeJS.Timeout`
surface, so the cast third-party code used to need is gone:

```typescript
const sweep = setInterval(() => rooms.sweep(), 30_000);
sweep.unref();            // no cast, no `as unknown as { unref?: () => void }`
sweep.hasRef();           // → boolean
sweep.refresh();          // reschedule from now, returns the same handle
clearInterval(sweep);     // or `sweep.close()`, or `+sweep` for the numeric ID
```

Members: `ref()`, `unref()`, `hasRef()`, `refresh()`, `close()`,
`[Symbol.toPrimitive]()` (→ the numeric timer ID, for libraries that key a Map
on it), `[Symbol.dispose]()` and `_onTimeout()` (what `@types/node` declares, and
what libraries call directly when they drive a handle themselves).
`clearTimeout` / `clearInterval` accept the handle itself, a foreign Node
handle, or a bare number — the check is structural, so it survives a duplicated
copy of this module in a bundle.

### What `unref()` means on GJS

**On Node, `unref()` really releases the event loop** and the process may exit
while the timer is pending. On GJS it **cannot**, and this package does not
pretend otherwise:

- `Gtk.Application` / `GLib.MainLoop` own the loop — not the JS heap. Nothing a
  timer does decides whether the app keeps running.
- The only GLib operation that releases a source's hold on the loop
  (`g_source_unref`) also destroys the source. That is the double-unref
  SIGSEGV this package exists to avoid, so the timers are backed by
  `GLib.timeout_add` and numeric source IDs for exactly this reason.

So on GJS `unref()` is **recorded and reported**: `hasRef()` returns `false`
after it, and the timer keeps firing. Code that calls `unref()` to mean "don't
let this timer hold my process open" is correct on both runtimes — it simply
has no work to do on GJS, because the app, not the timer, decides that.

## License

MIT
