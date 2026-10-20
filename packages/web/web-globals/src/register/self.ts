// Registers: self

/**
 * `self` is the web platform's name for the global object: in a window and in a worker
 * `self === globalThis`. GJS does not define it, even though it DOES define `window` as a
 * non-configurable alias of the global (`gjs/global.cpp`) — so a host that already claims to be a
 * window is missing the other half of the same identity.
 *
 * What finds the gap is UMD. A bundle built with webpack's `globalObject: 'self'` ends in
 * `}(self, …)` and reads the name UNCONDITIONALLY, with no `typeof` guard to take a different
 * branch — joi's browser build (`joi/dist/joi-browser.min.js`, selected by its `browser` field) is
 * one, and it dies at import with `ReferenceError: self is not defined` before any of its code
 * runs.
 *
 * **This is a register, not a `transform.define`, and the difference is the whole point.** A
 * `define: { self: 'globalThis' }` would rewrite source: `typeof self === 'undefined'` becomes
 * `typeof globalThis === 'undefined'`, which is false on every runtime, so every isomorphic guard
 * in the bundle flips and the program stops being its source (ADR 0079, measured there on
 * @mtcute/web). It would also rewrite the TARGET of a bare `self = …` into `globalThis = …`, the
 * same defect the window-assign plugin exists to undo. A register writes the property at runtime
 * and rewrites nothing, and `--globals auto` already excludes a name that appears only inside
 * `typeof` — so a guard alone does not pull this in, and a real read does.
 */
interface _SelfGlobal {
    self?: typeof globalThis;
}

const g = globalThis as unknown as _SelfGlobal;

if (typeof g.self === 'undefined') {
    Object.defineProperty(globalThis, 'self', {
        value: globalThis,
        enumerable: true,
        writable: true,
        configurable: true,
    });
}
