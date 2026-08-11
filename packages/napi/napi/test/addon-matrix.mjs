// SPDX-License-Identifier: MIT
// @gjsify/napi — the ADDON MATRIX: real npm native addons tested against the
// shim. Each entry is consumed by test/addon-gate.mjs. Paths are relative to
// test/addons/ (the gitignored vendored-addon prefix).
//
// Fields:
//   pkg         bare import specifier the workout uses (aliased to `index`).
//   index       addon's JS entry, aliased so the bundler pins the right file.
//   addon       path to the compiled `.node` routed through loadAddon(). Prefer
//               a source build/Release binary.
//   prebuilds   dirs to rename away during the run so BOTH Node and GJS load the
//               same `addon` binary (skip when `addon` itself is the platform
//               prebuild, e.g. napi-rs).
//   aliases     extra `name=path` bundler aliases.
//   binding     bindingModules for addons whose entry does its own dynamic addon
//               require (better-sqlite3 / node-sqlite3 style).
//   async       true = a hard failure is a FINDING, not a gate failure (for a
//               capability the addon needs that is still a deferred stub).

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
        index: 'node_modules/@node-rs/argon2/index.js',
        // napi-rs ships the Rust->N-API binary as a sibling platform package —
        // a real, pure-N-API .node (different codegen than the node-addon-api
        // C++ addons above). Pinned directly: no prebuild-disable dance, because
        // napiNodeAddonPlugin entry-replaces the generated loader wholesale (see
        // packages/napi/AGENTS.md).
        addon: 'node_modules/@node-rs/argon2-linux-x64-gnu/argon2.linux-x64-gnu.node',
        workout: 'workouts/argon2.mjs',
        binding: 'napi-rs',
    },
    sqlite3: {
        // node-addon-api, fundamentally ASYNC — every op runs through a
        // Napi::AsyncWorker (napi_create/queue/complete_async_work).
        pkg: 'sqlite3',
        index: 'node_modules/sqlite3/lib/sqlite3.js',
        addon: 'node_modules/sqlite3/build/Release/node_sqlite3.node',
        prebuilds: [],
        workout: 'workouts/sqlite3.mjs',
        binding: 'node-sqlite3',
    },
};

export default ADDONS;
