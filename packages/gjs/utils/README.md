# @gjsify/utils

Shared utility functions for gjsify packages including error polyfills, structured clone, and GNOME library helpers.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/utils
```

## Two entry points

The package has a GJS-only half and a cross-runtime half, and the specifier you import
from decides which one you get. Pick the narrowest one that covers your imports.

| Specifier | Runtimes | Contents |
|---|---|---|
| `@gjsify/utils/core` | GJS · Node · browser · NativeScript | everything that is well-defined without GLib/Gio |
| `@gjsify/utils` | **GJS only** | `…/core` plus the six modules that call into GLib/Gio |
| `@gjsify/utils/main-loop` | GJS · Node · browser · NativeScript | just `ensureMainLoop` / `quitMainLoop` |

```typescript
// Cross-runtime — safe from a package whose browser / nativescript slot is
// `polyfill` or `partial`.
import { makeCallable, nextTick, createNodeError, registerGlobal } from '@gjsify/utils/core';

// GJS-only — importing this is a declaration that your package reaches GLib/Gio.
import { cli, existsSync, readBytesAsync } from '@gjsify/utils';
```

`@gjsify/utils/core` carries the pure helpers (`makeCallable`, `deferEmit`,
`initErrorV8Methods`, the `gio-errors` errno mapping — `createNodeError`,
`createGLibFileError`, `isNotFoundError` and the `GIO_ERROR_TO_NODE` /
`GLIB_FILE_ERROR_TO_NODE` tables — `registerGlobal`, `notImplemented`,
`warnNotImplemented`, `queueMicrotask`, `structuredClone`) plus the two
**GJS-guarded** modules that probe `globalThis.imports?.gi` and fall back to a
portable path (`ensureMainLoop` / `quitMainLoop`, `nextTick`).

The root barrel adds `gbytesToUint8Array`, `cli`, `readJSON`, `existsFD`, `existsSync`,
`gioAsync`, `readBytesAsync`, `inputStreamAsyncIterator`, `resolve`, `getProgramExe`,
`getProgramDir`, `getPathSeparator` and `getNodeModulesPath` — all of which take a
top-level `@girs/*` value import or a bare `imports.*` read and therefore only work
under GJS.

Off GJS the bundler substitutes an empty module for `@girs/*`, so a GJS-only helper
reached from a browser bundle does **not** fail at build or load time — it throws a
`TypeError` the first time it is called. `scripts/audit-runtimes.mjs --check` enforces
the split statically; see
[ADR 0014](../../../docs/adr/0014-utils-core-subpath-and-platform-entry-routing.md).

## License

MIT
