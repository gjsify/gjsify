// @gjsify/lightningcss-wasm — GJS-compatible loader for the lightningcss
// WebAssembly bundle.
//
// Adapted from refs/lightningcss/wasm/wasm-node.mjs (Devon Govett, MIT).
// Modifications:
//  - Reads the .wasm via @gjsify/fs (Soup-free, GJS-native) instead of
//    Node's fs.readFileSync.
//  - getRandomValues comes from globalThis.crypto, which @gjsify/webcrypto
//    registers under --globals auto (the Web Crypto API spec, not Node's
//    `node:crypto` shim).
//  - SpiderMonkey 140 has the synchronous `new WebAssembly.{Module,Instance}`
//    constructors but lacks instantiateStreaming for `file://` URLs, so we
//    use the constructors directly.
//
// Pure-JS — bundled by `gjsify build --library esm` so consumers can
// import the resulting ESM with no native deps.

import { Environment, napi } from './napi-wasm.mjs';
import { await_promise_sync, createBundleAsync } from './async.mjs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const wasmUrl = new URL('../wasm/lightningcss_node.wasm', import.meta.url);

// `gjsify build` rewrites `import.meta.url` to be portable. At runtime
// we read the bytes via the host's fs polyfill — under GJS that's
// @gjsify/fs (Gio.File backed); under Node it's the real `fs`.
const wasmBytes = fs.readFileSync(fileURLToPath(wasmUrl));
const wasmModule = new WebAssembly.Module(wasmBytes);

let env;
const instance = new WebAssembly.Instance(wasmModule, {
  env: {
    ...napi,
    await_promise_sync,
    __getrandom_v03_custom: (ptr, len) => {
      const buf = env.memory.subarray(ptr, ptr + len);
      // globalThis.crypto from @gjsify/webcrypto/register on GJS;
      // node:crypto webcrypto on Node 19+.
      globalThis.crypto.getRandomValues(buf);
    },
  },
});
instance.exports.register_module();
env = new Environment(instance);
const wasm = env.exports;
const bundleAsyncInternal = createBundleAsync(env);

export default async function init() {
  // No-op. Kept for API compatibility with the npm `lightningcss-wasm`
  // package whose browser-side loader needs an explicit init().
}

export function transform(options) {
  return wrap(wasm.transform, options);
}

export function transformStyleAttribute(options) {
  return wrap(wasm.transformStyleAttribute, options);
}

export function bundle(options) {
  return wrap(wasm.bundle, {
    ...options,
    resolver: {
      read: (filePath) => fs.readFileSync(filePath, 'utf8'),
    },
  });
}

export async function bundleAsync(options) {
  if (!options.resolver?.read) {
    options.resolver = {
      ...options.resolver,
      read: (filePath) => fs.readFileSync(filePath, 'utf8'),
    };
  }
  return wrap(bundleAsyncInternal, options);
}

function wrap(call, options) {
  if (typeof options.visitor === 'function') {
    let deps = [];
    options.visitor = options.visitor({
      addDependency(dep) {
        deps.push(dep);
      },
    });

    let result = call(options);
    if (result instanceof Promise) {
      result = result.then((res) => {
        if (deps.length) {
          res.dependencies ??= [];
          res.dependencies.push(...deps);
        }
        return res;
      });
    } else if (deps.length) {
      result.dependencies ??= [];
      result.dependencies.push(...deps);
    }
    return result;
  }
  return call(options);
}

export { browserslistToTargets } from './browserslistToTargets.js';
export { Features } from './flags.js';
export { composeVisitors } from './composeVisitors.js';
