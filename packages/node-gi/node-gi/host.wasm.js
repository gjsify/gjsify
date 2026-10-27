// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the WebAssembly host seam (package.json `imports` → `#host`,
// condition `wasm`). EXPERIMENTAL: added by the GObject-in-Wasm prototype, see
// docs/poc/gobject-wasm/ and docs/reports/2026-10-27-gobject-wasm-prototype.md.
//
// The third host variant beside host.node.js and host.nativescript.js, and the only
// source change the JS layer needed to run the Emscripten build: nothing above this
// file knows the engine is a .wasm rather than a .node.
//
// Two things differ from every other host. There is no module system that can load the
// engine synchronously — an Emscripten MAIN_MODULE build must be compiled and
// instantiated asynchronously — so the embedder instantiates it and hands the N-API
// exports in through a one-shot global, which this file captures and deletes (the same
// no-side-channel discipline as host.node.js's GJS loader). And there is no OS event
// loop to co-pump, so RUNTIME is its own value: gi.js then arms the portable
// GLib-iteration pump it already uses for Bun/Deno, which is the only shape a browser
// main thread allows (nothing here may block).
const BINDING_KEY = '__nodeGiWasmBinding';

/**
 * Which JS runtime we are on. Not one of the four desktop runtimes: there is no
 * libuv to bridge and no `node:` builtin to reach for. gi.js reads this and takes
 * the Bun/Deno branch — the portable timer pump over `iterateMainContext`.
 * @type {'wasm'}
 */
export const RUNTIME = 'wasm';

/**
 * Defer the engine to first use. The embedder must assign the global BEFORE the first
 * `ensureNative()`, and an eager load at import would force it to do so before the
 * import — which an ESM graph cannot express without top-level await in user code.
 * @type {boolean}
 */
export const LAZY_NATIVE = true;

/**
 * Same answer as the desktop hosts: a Wasm build runs the same programs, so
 * `GObject.registerClass` keeps GJS's invalid-base error. See host.node.js.
 * @type {boolean}
 */
export const FOREIGN_PARENT_CLASSES = false;

// Timers from the global scope — the one set a browser and a bare Node/Emscripten
// shell both have. setImmediate is not a Web platform API.
export const setImmediate =
    typeof globalThis.setImmediate === 'function'
        ? globalThis.setImmediate.bind(globalThis)
        : (fn, ...args) => globalThis.setTimeout(fn, 0, ...args);
export const setInterval = globalThis.setInterval.bind(globalThis);
export const clearInterval = globalThis.clearInterval.bind(globalThis);

// The only `process` surface gi.js reads is on('beforeExit'), and a page has no such
// event: the tab's task queue never "runs empty" in a way the program may observe.
// Registrations are swallowed — the portable pump arms itself in requireGi and keeps
// its own ref count, so there is nothing to re-arm.
const env = {};
export const runtimeProcess = {
    env,
    platform: 'wasm',
    argv: [],
    on() {
        return runtimeProcess;
    },
    once() {
        return runtimeProcess;
    },
    exit(code = 0) {
        throw new Error(`@gjsify/node-gi: process.exit(${code}) is unavailable on a Wasm host`);
    },
};

// No bundled-GTK windowing loader here: nothing was written, nothing to replay.
export function windowingEnvWrites() {
    return [];
}

export function bundledLocaleDir() {
    return undefined;
}

/**
 * Hand back the already-instantiated engine. The embedder runs the Emscripten factory,
 * calls `emnapiInit({ context })` and assigns the resulting N-API exports to
 * `globalThis.__nodeGiWasmBinding`; this captures and deletes it.
 * @returns {Record<string, any>} the native engine
 */
export function loadNativeHost() {
    const binding = globalThis[BINDING_KEY];
    if (!binding) {
        throw new Error(
            '@gjsify/node-gi: no Wasm engine registered. Instantiate the Emscripten build, call ' +
                `emnapiInit({ context }) and assign the result to globalThis.${BINDING_KEY} before the ` +
                'first use of this package.',
        );
    }
    delete globalThis[BINDING_KEY];
    return binding;
}
