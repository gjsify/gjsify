// One-line banner that polyfills the Explicit Resource Management well-known
// symbols `Symbol.dispose` / `Symbol.asyncDispose` on GJS.
//
// GJS / SpiderMonkey (through gjs 1.88) does not expose these symbols, yet the
// `using` / `await using` syntax is downleveled by tsc, esbuild, babel and bun
// to a helper that resolves them as:
//
//     Symbol.dispose      || Symbol.for("Symbol.dispose")
//     Symbol.asyncDispose || Symbol.for("Symbol.asyncDispose")
//
// i.e. they fall back to the GLOBAL-REGISTRY symbol when the native one is
// missing. The disposable OBJECTS those helpers consume are, however, built
// with computed members like `{ [Symbol.dispose]() {} }` — and when
// `Symbol.dispose` is `undefined` that member lands under the string key
// "undefined", so the helper's `Symbol.for("Symbol.dispose")` lookup misses and
// throws `Object not disposable`.
//
// Defining the symbols as the registered symbols makes both sides agree:
// object construction and helper lookup resolve to the very same symbol. It
// must run before any module init (npm packages build disposable singletons at
// top level), so it ships as part of the byte-1 GJS banner alongside the
// process stub.
//
// Kept on a single line: the banner runs before any source-map-aware machinery,
// so newlines here would shift every bundle line number by one.

export const GJS_WELLKNOWN_SYMBOLS_STUB =
    'if(!Symbol.dispose)Symbol.dispose=Symbol.for("Symbol.dispose");' +
    'if(!Symbol.asyncDispose)Symbol.asyncDispose=Symbol.for("Symbol.asyncDispose");';
