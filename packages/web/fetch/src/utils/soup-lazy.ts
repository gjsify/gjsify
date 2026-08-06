// SPDX-License-Identifier: MIT
// Lazy loader for the Soup 3.0 namespace.
//
// WHY dynamic, not a static `import Soup from '@girs/soup-3.0'`: a static VALUE
// import of Soup puts `import "gi://Soup?version=3.0"` at the top of every
// bundle that merely pulls `@gjsify/fetch`. The bundler's auto-globals pass
// injects `@gjsify/fetch/register/fetch` whenever code references
// `globalThis.fetch` (e.g. `@gjsify/npm-registry` during `gjsify install`), so a
// Soup-FREE command like `gjsify tsc` still linked the Soup-3.0 typelib at ESM
// link time — requiring libsoup present on hosts that never make a request, and
// forcing `libsoup3` into every consumer's CI. Resolving Soup through a DYNAMIC
// `import()` defers the typelib link to the first actual HTTP(S) send: the
// tsc/build/CLI-boot bundles no longer require libsoup, while network commands
// load it the moment they send.
//
// Dynamic `import('gi://…')` is natively supported by GJS (verified) and is the
// established gjsify idiom for a deferred typelib (see dom-elements/font-face.ts,
// gamepad/backend.ts) — no `imports.gi` polyfill needed. The specifier is a
// LITERAL (never built from a variable): every plugin that claims `gi://*` at
// build time (the `--app gjs` externals predicate, the node/browser redirects)
// matches on the resolved specifier, so a template literal would leave the
// import unclaimed on those targets.
//
// This module is only ever reached on GJS: `@gjsify/fetch` declares
// `node: native` / `browser: native`, so the Soup path is the gjs-polyfill slot
// alone; the node/node-gi and browser bundles route fetch to their native impl
// and never include this file.
import type Soup from '@girs/soup-3.0';

let cached: typeof Soup | null = null;

/** Load (once) and return the Soup 3.0 namespace, linking `gi://Soup` on first
 *  call rather than at module import. */
export async function loadSoup(): Promise<typeof Soup> {
    return (cached ??= (await (import('gi://Soup?version=3.0') as Promise<{ default: typeof Soup }>)).default);
}
