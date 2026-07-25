// SPDX-License-Identifier: MIT
// @gjsify/napi — the ADDON MATRIX: real npm native addons gegentested against
// the shim. Each entry is consumed by test/addon-gate.mjs. Paths are relative
// to test/addons/ (the gitignored vendored-addon prefix).
//
// Fields:
//   pkg         bare import specifier the workout uses (aliased to `index`).
//   index       addon's JS entry, aliased so the bundler pins the right file.
//   addon       absolute-under-addons path to the compiled `.node` to route
//               through loadAddon(). Prefer a source build/Release binary.
//   prebuilds   optional dirs to rename away during the run so BOTH Node and
//               GJS load the same `addon` binary (skip when `addon` itself is
//               the platform prebuild, e.g. napi-rs).
//   aliases     extra `name=path` bundler aliases (rarely needed).
//   binding     optional bindingModules for addons whose entry does its own
//               dynamic addon require (better-sqlite3 / node-sqlite3 style).
//   async       true = a hard failure is a FINDING, not a gate failure (used
//               while a capability the addon needs was a deferred stub). Unset
//               now that async_work is implemented — node-sqlite3 passes, so a
//               regression must fail hard.

export const ADDONS = {
    bufferutil: {
        pkg: 'bufferutil',
        index: 'node_modules/bufferutil/index.js',
        addon: 'node_modules/bufferutil/build/Release/bufferutil.node',
        prebuilds: ['node_modules/bufferutil/prebuilds'],
        workout: 'workouts/bufferutil.mjs',
    },
    'utf-8-validate': {
        pkg: 'utf-8-validate',
        index: 'node_modules/utf-8-validate/index.js',
        addon: 'node_modules/utf-8-validate/build/Release/validation.node',
        prebuilds: ['node_modules/utf-8-validate/prebuilds'],
        workout: 'workouts/utf-8-validate.mjs',
    },
    argon2: {
        pkg: '@node-rs/argon2',
        // napi-rs: the linux-x64-gnu platform binary IS a pure N-API .node
        // (Rust codegen). Pinned directly; no prebuild-disable dance needed
        // because the JS loader is replaced wholesale (see binding).
        index: 'node_modules/@node-rs/argon2/index.js',
        // napi-rs ships the compiled Rust->N-API binary as a sibling platform
        // package; this IS a real, pure-N-API .node (different codegen than the
        // node-addon-api C++ addons above).
        addon: 'node_modules/@node-rs/argon2-linux-x64-gnu/argon2.linux-x64-gnu.node',
        workout: 'workouts/argon2.mjs',
        binding: 'napi-rs',
        // TRANSPARENT: napiNodeAddonPlugin now ENTRY-REPLACES the napi-rs
        // generated loader — it detects `@node-rs/argon2`'s native `index.js`
        // (package.json `napi`/optionalDependencies signal), resolves the
        // current-platform sibling `.node`, and swaps the whole module for
        // `module.exports = loadAddon(<abs .node>)`. The generated-loader body
        // (`createRequire` + per-platform require chain) no longer reaches the
        // bundle, so GJS-under-shim is byte-identical to Node — a hard PASS, same
        // as the C/C++ addons.
    },
    sqlite3: {
        // node-addon-api, fundamentally ASYNC — every op runs through a
        // Napi::AsyncWorker (napi_create/queue/complete_async_work). Passes
        // byte-identical now that async_work is implemented.
        pkg: 'sqlite3',
        index: 'node_modules/sqlite3/lib/sqlite3.js',
        addon: 'node_modules/sqlite3/build/Release/node_sqlite3.node',
        prebuilds: [],
        workout: 'workouts/sqlite3.mjs',
        binding: 'node-sqlite3',
    },
};

export default ADDONS;
