# `@gjsify/integration-nativescript` — on-device polyfill smoke suite

Runs a few gjsify `nativescript:'polyfill'` packages on the **real NativeScript
V8 runtime** (Android) and asserts pass/fail, closing the gap between *declaring*
a `nativescript` runtime slot and *executing* it on-device.

## What it validates & why

`package.json#gjsify.runtimes` declares per-package slots like
`{"gjs":"polyfill","node":"polyfill","browser":"polyfill","nativescript":"polyfill"}`.
`scripts/audit-runtimes.mjs` only **drift-checks** those declarations — it never
runs the code on a V8/NativeScript device. This suite bundles the portable
packages' behaviour into a tiny NS app via the `@gjsify/nativescript-vite`
composer (Vite 8 / Rolldown), launches it on an emulator, and parses pass/fail
markers out of `adb logcat` — actually executing the slots, not just bundling
them.

Currently covered (extend by adding `app/specs/<pkg>.smoke.ts` + an import in
`app/app.ts`):

- **`@gjsify/path`** — posix `join`/`resolve`/`normalize`, `basename`/`extname`/`parse`, `sep`/`delimiter`
- **`@gjsify/buffer`** — `from`/`toString` (utf8/base64/hex), `byteLength`, `concat`, `alloc`, `writeUInt8`/`readUInt8`
- **`@gjsify/stream`** (`nativescript:'polyfill'`) — `Readable.from`, `PassThrough` round-trip, `Transform` map, `pipeline`, async-iteration
- **`@gjsify/native-platform`** (`nativescript:'native'`) — `isNativeScript`/`isAndroid`/`isIOS`, `platformName()`, `assertNativeScript()`, `platformInfo()` (real OS version / SDK level / device model read from `android.os.Build` / `UIDevice`)

## Why a custom reporter, not `@gjsify/unit`

`@gjsify/unit`'s `run()` terminal path calls `process.exit()` / `imports.system.exit()`
— neither exists on NS V8 (silently swallowed) — and its result counters are not
exported. Importing it would also drag its GJS-aware `getRuntime()` /
`import('node:process')` paths into the NS bundle. So the specs depend only on
the portable package under test + a tiny local `app/reporter.ts` that prints an
unambiguous `__GJSIFY_NS__` marker grammar the logcat parser keys on. This
mirrors the browser-test rule: clean test files, not more aliases.

## Not wired into CI, excluded from the workspace

Like `tests/integration/autobahn/` (which needs Podman/Docker), this needs the
**NS CLI + an Android emulator** — which CI containers do not provide. It is
therefore:

- **excluded from the root workspace** (`!tests/integration/nativescript` in the
  root `package.json#workspaces`) so the heavy, optional NativeScript toolchain
  (`@nativescript/core`, `nativescript`, `@nativescript/vite`, `vite`) is **not**
  pulled by the workspace-wide `gjsify install` — consistent with the rule that
  no platform SDK is a hard workspace dependency;
- **not** part of `gjsify foreach test:integration` (it has no `test:gjs` /
  `test:node` script) and **not** in any GitHub Actions workflow.

It is installed and run standalone, against the **published** `@gjsify/*`
packages, so it validates the real shipped artifacts on V8. Its ranges therefore
ride the release train like the workspace-excluded showcase apps do: the
`release-train` conformance rule requires each of them to name the current
workspace version, and `scripts/bump-release-train-ranges.mjs` rewrites them
during a cut. Neither reached this manifest until the rule's walk stopped
assuming every standalone app sits two levels below its group — the ranges sat
at a long-superseded release for as long as nothing looked. To smoke
an unpublished workspace change, `gjsify pack` it and point the dep at the tarball
(this is how `@gjsify/native-platform` was validated on-device before its first
npm publish — `gjsify pack` → `"@gjsify/native-platform": "file:./<tarball>.tgz"`
→ `npm install`).

> **`"type": "module"` is intentionally absent** from `package.json`. NativeScript
> generates CommonJS build-tools under `platforms/` (the Static Binding Generator's
> `js_parser.js` uses `require`); a top-level `"type": "module"` makes Node treat
> those `.js` files as ESM and the gradle build fails with `require is not defined
> in ES module scope`. The app code is ESM regardless — Vite/Rolldown bundles it.

> **Build-chain version floor — RETIRED.** The floor is now the release train
> itself: the deps name the current workspace version, so they cannot fall back
> below it. For the record, the `0.4.36` artifacts the suite was once pinned to
> predated:
> - `@gjsify/resolve-npm` — the `module → @gjsify/module` NS alias (#457); 0.4.36
>   routed `module → @gjsify/empty`, so css-tree's `createRequire` import failed the
>   build.
> - `@gjsify/buffer` — lazy `TextEncoder`/`TextDecoder` init; 0.4.36 constructed
>   them at module-eval time and crashed on NS V8.
> - `@gjsify/vite-plugin-gjsify` — `gjsifyNativescript()` aliases `css-tree`
>   to its bundled dist (data inlined), keeping `@nativescript/core` → css-tree's
>   `createRequire` data-loads out of the bundle (they throw on NS V8); 0.4.36
>   had no such alias.
> - `@gjsify/nativescript-vite@0.4.36` — a `workspace:` range leaked into its npm
>   manifest during the manual first-publish, making it uninstallable from npm; the
>   later lines are clean (the release self-healed it).

## Running locally

```bash
cd tests/integration/nativescript
npm install                       # standalone — pulls the NS toolchain here only

# boot an AVD with the HOST GPU (software/ANGLE GL segfaults on API > 35):
"$ANDROID_HOME/emulator/emulator" -avd Medium_Phone_API_36 -gpu host -no-snapshot -no-boot-anim &
adb wait-for-device

npm test                          # = node scripts/run-on-device.mjs android
# exit 0 → all on-device cases passed; exit 1 → FAIL / regression / crash
#          (inspect logcat.android.log)
```

Under the hood `npm test` does **`ns prepare` → copy bundle into the APK assets →
`gradle assembleDebug` → `adb install` → launch → read `adb logcat`**, then
asserts `begun && complete && failed === 0`. The manual copy step is load-bearing:
NS CLI 9.0.6's Vite integration copies `.ns-vite-build/` into the APK's
`assets/app/` **only in watch mode** (the IPC handler in
`bundler-compiler-service.js`); a non-watch `ns build` / `ns run --justlaunch`
leaves the assets empty and the Static Binding Generator fails. The runner
replicates the copy so the build is deterministic and watcher-free. On-device you
also see a `PASS n/total` / `FAIL n/total` Label as a visual fallback.

## Validated

`@gjsify/path` (7/7), `@gjsify/buffer` (7/7), `@gjsify/stream` (5/5) and
`@gjsify/native-platform` (8/8) — **27/27 green on the Android NS V8 runtime**
(NS CLI 9.0.6 / runtime 9.0.4, `@nativescript/core` 9.x, Vite 8.0.16, deps `^0.7.0`,
2026-06-17). The `stream` run confirms the pure-TS stream polyfill (`Readable`/
`Writable`/`Transform`/`PassThrough`/`pipeline` + async-iteration) executes on V8;
the `native-platform` run confirms the `'native'` slot reads real `android.os.Build`
values (`platformInfo()` returned a concrete OS version / SDK level / device model,
not the off-platform `'unknown'` sentinel). Earlier run surfaced + fixed
`@gjsify/buffer`'s top-level `new TextEncoder()` (it ran at module eval, before NS
registers the global — crashed the bundle; now lazy-initialised). Record outcomes
in `status/integration-coverage.md`.
