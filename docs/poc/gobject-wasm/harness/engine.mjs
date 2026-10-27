// SPDX-License-Identifier: MIT
// PoC harness — instantiate the Emscripten node-gi engine and register it with the
// package's `wasm` host seam (packages/node-gi/node-gi/host.wasm.js).
//
// Identical on Node and in a page: both get the engine through the ES module the
// Emscripten build emits, and both hand the N-API exports over the same one-shot
// global. `import` must come AFTER this resolves, hence the two-step shape — the
// caller awaits `startEngine()` and only then imports the package.

/**
 * Instantiate the Wasm engine and register it for `@gjsify/node-gi`.
 * @param {string} moduleUrl URL of the emitted `node_gi.mjs`
 * @param {string} typelibDir where the typelibs were embedded in the Emscripten FS
 * @returns {Promise<{ module: object, binding: Record<string, any>, ms: number }>}
 */
export async function startEngine(moduleUrl, typelibDir = '/typelibs') {
    // Node is given a file: URL, a page a site-absolute path — resolve both to an
    // absolute URL so the sibling emnapi.mjs can be found next to the engine.
    const engine = new URL(moduleUrl, globalThis.location?.href).href;
    const t0 = performance.now();
    const { default: createNodeGi } = await import(engine);
    const { getDefaultContext } = await import(new URL('./emnapi.mjs', engine).href);
    const module = await createNodeGi();
    const binding = module.emnapiInit({ context: getDefaultContext() });
    // The typelibs are baked into the Emscripten virtual FS at link time (--embed-file):
    // there is no GI_TYPELIB_PATH to read and no host directory to find them in.
    binding.prependSearchPath(typelibDir);
    globalThis.__nodeGiWasmBinding = binding;
    return { module, binding, ms: performance.now() - t0 };
}
