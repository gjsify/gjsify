# 84. A GJS bundle finds its addon by package IDENTITY, resolved at run time

- Status: **Accepted**
- Date: 2026-09-29
- Deciders: Pascal Garber
- Related: [ADR 0011](0011-napi-host-in-gjs.md) (N-API over GJS),
  [ADR 0024](0024-ship-installable-artifacts.md) (shipped artifacts),
  [ADR 0076](0076-a-node-bin-is-rebuilt-for-the-host-runtime.md) (the same bundle-anchored
  runtime resolution for a rebuilt bin), `#1842` (`--app node` keeps addons external),
  `packages/infra/rolldown-plugin-gjsify/src/plugins/napi-node-addon.ts`,
  `packages/infra/rolldown-plugin-gjsify/src/shims/{module-resolve,addon-resolve}.ts`

## Context

`--app gjs` routes a Node-API addon through `@gjsify/napi` by replacing the acquisition
helper with a shim. All four shim shapes baked the `.node` path the BUILD host selected,
absolute:

```js
export default loadAddon("/home/<user>/…/node_modules/@signalapp/libsignal-client/prebuilds/linux-x64/@signalapp+libsignal-client.node");
```

Measured on postbote: move the checkout and the built bundle dies with
`gjsify-napi: cannot resolve addon path '…'`. So a GJS bundle containing any third-party
addon is valid only on the machine and at the path that built it — it cannot be installed,
copied, packaged, or built in CI and run anywhere else. `gjsify ship` relocates node-gi's own
addon; it knows nothing about a consumer's.

Two more defects follow from the same "decide at build time" posture: a cross-build (a CI job
producing linux-arm64 on an x64 runner) bakes the RUNNER's binary, and a package shipping many
platforms has all but one of them discarded before the bundle can know which host it runs on.

`--app node` is not affected and is not in scope: #1842 keeps addon packages external, and Node
resolves them from `node_modules` relative to their own files.

## Decision

A shim records the addon's **package identity** — a `<package>/<subpath>` spec per platform —
and resolves it at RUN time from the bundle's own location.

1. **The build enumerates, it does not select.** `enumerateAddonTargets()` returns every
   platform the addon package ships (`prebuilds/<tuple>/<best tag>` per tuple, `build/Release`
   and `build/Debug` for the build host, every installed napi-rs platform sibling, every local
   `<binaryName>.<triple>.node`), keyed by a platform key (`linux-x64`, `linux-x64-musl`,
   `darwin-arm64`). Per-tuple tag selection stays node-gyp-build's, so the entry for the build
   host is the binary Node would load.

2. **The bundle picks by the RUNNING host**, from `process.platform`/`process.arch` plus
   `process.env.LIBC`: exact key, then the libc-agnostic key, then the single libc variant, then
   a `*` entry (a directly imported `.node`, which names one file and needs no selection).

3. **The package root is resolved at run time**, through the same `__gjsifyBundleUrl` banner +
   `createRequire` anchor the module-resolve shim already uses for every bundled dep that reads
   its own files (ADR 0076 clause 5 is the same mechanism). The addon is never copied and never
   leaves its package, so a `.node` that `dlopen`s a sibling `.so` or reads a data file beside
   itself keeps working.

4. **A bundle beside no `node_modules` REFUSES, naming the layout a packaging step would
   fill** — `<bundle dir>/addons/<package>/<subpath>`. It does not return that path: the
   directory is a declaration nothing fills yet, so the path reaches `loadAddon` as a bare
   ENOENT naming neither the package nor the remedy, where an error naming both and the two
   ways out is strictly better. Wiring `gjsify ship` and `gjsify install` to copy the addon
   PACKAGE (not the bare `.node`, per clause 3) into it is a follow-up.

5. **A `.node` under no `node_modules` keeps its absolute path, and says so.** A locally
   built addon no package owns has no identity to record, so the build writes the path itself
   and the resolver returns it unchanged. This is not a return to the defect: before this ADR
   the path was baked in and the file loaded, and it still does. What it gives up is
   RELOCATABILITY, and one build warning per entry says so rather than shipping it silently.
   Identity-based resolution is the improvement, not a precondition.

6. **No banner, no rewrite of the decision.** `--library cjs` under GJS emits no bundle-URL
   banner, so there is no anchor, and the plugin DECLINES every shape with one warning naming
   the reason — it does not keep the absolute path. Emitting one would reintroduce exactly the
   defect this ADR removes, for a mode that cannot anchor at run time anyway; a
   knowingly-unloadable artifact is worse than an unrewritten one, and the untouched module
   still gets default resolution. A `--library cjs` build is a library for a consumer's own
   toolchain, which resolves its addons itself. `gjsify build --app gjs` always has the banner.

The build-time probe stays, narrowed to a GATE: a package with no compiled `.node` anywhere is
still `AddonNotBuiltError` at build time, because failing then is better than failing at launch.

## Consequences

- A GJS bundle with a third-party addon is relocatable, installable and cross-buildable, and its
  bytes name no machine — which is also what makes an addon-using bundle reproducible between two
  checkouts (the `verify-committed-bundles` property).
- The bundle now carries a small per-addon table instead of one string. For an
  `npm install`ed tree that table has ONE entry; `gjsify install` materialises every platform
  package, so there it has as many as the package declares. Bytes, not megabytes — nothing is
  copied into `dist/`.
- The failure moves. A missing binary for the running host used to be a build error and is now a
  runtime error naming the host and the platforms the table knows. The build-time gate keeps the
  common case (nothing compiled at all) early.
- A cross-build only works if the target's binary is INSTALLED on the builder. That is true for a
  multi-platform npm package and for `gjsify install`; it is not something the bundler can fix.
- libc is read from `process.env.LIBC`, not probed — the shim does no filesystem work. On a musl
  host with an unset `LIBC` the lookup falls through to the libc-agnostic entry, which is what
  node-gyp-build's own untagged prebuilds assume.

## Alternatives considered

- **Copy the selected `.node` into `dist/` as an asset** (`new URL('./…', import.meta.url)`).
  Solves relocation and the no-`node_modules` case in one step, and is the obvious answer — but
  it picks the platform at build time, so cross-builds and multi-platform packages stay broken;
  it breaks every addon that loads a sibling library or data file relative to itself (copying the
  siblings too is just "keep the package", i.e. clause 3); and it puts tens of megabytes into
  every `dist/` whether or not the deployment needs it. Kept as the SHAPE of clause 4's
   declared `addons/` layout, but as a packaging step, not a build-time default.
- **Copy plus runtime fallback.** The union of both mechanisms' cost with none of the copy's
  advantages once clause 4 exists: the copy is what a packaging step does, not what every build
  does.
- **Walk `node_modules` from `import.meta.url` in hand-written shim code.** This is clause 3, and
  the reason it is not a new walk is that the walk already exists and is load-bearing
  (`shims/module-resolve.ts`); a second one would drift.
- **Re-run node-gyp-build's selection at run time** (readdir the package under `@gjsify/fs`).
  Strictly more faithful — it would see a binary the build tree did not have — but it puts
  `node:fs` into every addon-using bundle and duplicates the tag-parsing algorithm on the
  runtime side. The enumerated table gets the same answer for every tree the build can see.
