// SPDX-License-Identifier: MIT
// Lazy loader for the Soup 3.0 namespace.
//
// Dynamic, not a static `import Soup from '@girs/soup-3.0'`: a static VALUE import puts
// `import "gi://Soup?version=3.0"` at the top of every bundle that merely pulls
// `@gjsify/fetch`, and the auto-globals pass injects `@gjsify/fetch/register/fetch`
// wherever code references `globalThis.fetch` — so a Soup-FREE command like `gjsify tsc`
// linked the Soup-3.0 typelib at ESM link time, requiring libsoup on hosts that never make
// a request. A DYNAMIC `import()` defers the link to the first HTTP(S) send.
//
// Dynamic `import('gi://…')` is natively supported by GJS and is the established gjsify
// idiom for a deferred typelib (see dom-elements/font-face.ts, gamepad/backend.ts). The
// specifier is a LITERAL, never built from a variable: every plugin claiming `gi://*` at
// build time (the `--app gjs` externals predicate, the node/browser redirects) matches the
// resolved specifier, so a template literal would leave the import unclaimed.
//
// Only ever reached on GJS: `@gjsify/fetch` declares `node: native` / `browser: native`, so
// the Soup path is the gjs-polyfill slot alone.
import type Soup from '@girs/soup-3.0';

let cached: typeof Soup | null = null;

/** Load (once) and return the Soup 3.0 namespace, linking `gi://Soup` on first
 *  call rather than at module import. */
export async function loadSoup(): Promise<typeof Soup> {
    return (cached ??= (await (import('gi://Soup?version=3.0') as Promise<{ default: typeof Soup }>)).default);
}
