# Code-quality & consistency audit 2026-07-11 — findings + backlog

A fresh, whole-repository audit of gjsify (130 packages, ~174k LOC) across six
dimensions: package-manifest consistency, technical debt / root-cause-rule
violations, code duplication & shared-`core` gaps, `packages/infra/*` internal
quality, import-graph & barrel purity, and AGENTS.md/STATUS.md↔reality drift.

This complements the [2026-07-01 architecture review](2026-07-01-architecture-review.md)
(which produced ADRs 0001–0009). That review looked at the *concept and pillar
structure*; this one looks at *code-level drift and debt that has accumulated
below the automated gates*. STATUS.md `## Open TODOs` remains the tracker for
remaining work; this file is the *why + priority* record for the new findings.

## Verdict

The codebase is **healthy**. `audit-runtimes --check` is green (every published
package declares a tier; dependency-direction and ADR-0005 node-gi isolation
hold on every edge); the release train is uniform at 0.17.0; the import graph is
**acyclic** with **zero** relative cross-package imports and **zero** bare
Node-builtin imports; there are no blanket lint disables and no leftover debug
prints. This is a precision-cleanup backlog, not a rescue. The findings cluster
in five areas: doc-count drift, a handful of genuine debt items, incomplete
shared-`core` adoption, `packages/infra/cli` internal duplication, and one
latent cross-platform boundary leak.

## Landed in this pass (branch `refactor/audit-consistency-cleanup`)

Eight commits, each validated (`gjsify tsc`, package specs on Node + GJS, or the
`run-command` e2e) and committed inside the gjsify submodule:

1. **`docs:` reconcile package/suite counts** — header + Summary + Metrics were
   stale and self-contradicting (node appeared as 43 / 47 / 48). Fixed to the
   tree: node **48**, web **26**, build/infra **21** (was 16 and 18),
   integration **35** (was 22 and 24), E2E **80+**; and the mis-declared
   canonical-exemplars runtime triplet (abort-controller/dom-exception are
   `node:native`, all carry a `nativescript` slot).
2. **`refactor(cli):` unify the permissive `package.json` readers** (A1 partial)
   — 3 identical copies → one `utils/pkg-json.ts`; the 3 install-path
   throw-variants left intact + documented.
3. **`docs:` this audit report.**
4. **`refactor(cli):` centralize the GJS system probes** (A3) — `gjsExit` /
   `gjsSystemVersion` in `runtime.ts`; 5 inline `imports.system` casts removed.
5. **`feat(webcrypto):` wrapKey / unwrapKey** (D1) — the root-cause-rule gap,
   from `exportKey`→`encrypt` / `decrypt`→`importKey` via extracted usage-check-
   free `_encryptImpl`/`_decryptImpl`. 490/490 GJS specs green (+ Node native).
6. **`fix(cli):` propagate a non-zero gjs exit through run's script dispatch** —
   a bug FOUND during execution, NOT in the 6-agent audit: `gjsify run <script>`
   whose body is `gjsify run <bundle>` returned 0 on failure, so a failing
   `test:gjs` was swallowed and could pass `gjsify foreach test` (CI) green.
   `runGjsBundle` now sets `process.exitCode` synchronously and returns before
   the `exitOnSuccess` `process.exit(0)` can override it. Reproduced + fixed +
   e2e-guarded (#8).
7. **`test(web):` wire the orphaned GJS suites** — ALSO found during execution:
   fetch / formdata / webcrypto shipped a `test:gjs` (490 / 103 / 49 specs)
   their `test` script never ran — unlike 87 other packages — so `foreach test`
   skipped their GJS leg. Wired in (each verified green first). Pairs with #6.
8. **`test(e2e):` guard run-script gjs exit propagation** — regression for #6.

Findings **#6 and #7 are the highest-impact of the session** — a live
CI-masking bug and a real GJS test-coverage gap — and neither was in the
original audit; they surfaced only from running the GJS validation path.

(Backlog rows A3 and D1 below are now landed; A1 partially.)

## Why the rest is a backlog, not landed here

Most remaining items touch code whose behaviour only manifests under **GJS**
(webcrypto, the Adwaita/devtools GTK widgets, the framework bridges) or on the
**safety-critical install path** (ADR-0001). Verifying those correctly needs a
GJS build+run (or the install e2e), which is why they are specified here for
execution with proper validation rather than landed type-check-only. Each entry
notes the validation it needs.

## Backlog

### A. `packages/infra/cli` — dedup & consistency (Node-side, `gjsify tsc`-verifiable)

| # | Finding | Recommendation | Prio |
|---|---------|----------------|------|
| A1 | `readPackageJson` ×6 (3 remaining throw-variants) | Optional: add `readPackageJsonOrThrow(path, label)` to `utils/pkg-json.ts` and migrate flatpak + install-global; **keep** pkg-json-edit's install-save variant | P3 |
| A2 | `parseSpec` implemented twice with divergent defaults — `pkg-json-edit.ts` (range→undefined) vs `install-backend-native.ts` (range→`'latest'`, throws on scoped-without-slash); `@`-split byte-duplicated | One `parseSpec(raw, { defaultRange })`; `parseSpecName = parseSpec(x).name`. **Touches the install resolver — validate with the install e2e** | P2 |
| A3 | GJS host sub-probes re-inlined: `imports.system.exit` ×3 (index.ts, oxc-resolve `setOxcExitCode`, install.ts `forceExit`), `imports.system.version` ×2 (cli-app.ts, node-version.ts) | Add `gjsExit(code): boolean` + `gjsSystemVersion(): number\|undefined` next to `isGjs()` in `rolldown-plugin-gjsify/src/utils/runtime.ts`; migrate the 5 sites | P2 |
| A4 | Dual-engine pick copy-pasted: `bundler-pick.ts` (`shouldUseNative`/`tryLoadNative`) ≡ `oxc-resolve.ts` (`shouldUseNativeOxfmt`/`tryLoadNativeOxfmt`) — same env tri-branch + memoized probe + dual-resolve + `catch→null` | `createDualEngineResolver({ envVar, specifier, probe, label })` → `{ shouldUseNative, tryLoad }`. **Engine selection — validate a real GJS + Node build** | P2 |
| A5 | `spawn→Promise<void>` wrappers ×6 (`foreach.ts`, `flatpak/build.ts`, `install.ts`, `check.ts`, `workspace.ts`, `oxc-resolve.ts`) diverge on close-vs-exit, ENOENT hint, color seeding, and the **GJS async-exit gotcha** — `oxc-resolve` uses `spawnSync` under GJS on purpose, but `foreach.ts`/`flatpak/build.ts` `await` async `spawn` and risk the documented 0%-CPU hang | `spawnToCompletion(cmd, args, opts)` centralizing the `isGjs()`→spawnSync decision + ENOENT hint + color. **Closes a latent correctness bug — validate under the GJS bundle** | **P1** |
| A6 | `walkUp`/ancestor loops re-coded with ad-hoc caps (`workspace-root`, `oxc-resolve` ×2, `bundler-pick`, `build-cache`); "read my own @gjsify/cli version" ×3 files | Shared `walkUp(start, maxDepth?)` generator + one `readOwnCliVersion()` | P3 |
| A7 | `npm-registry/src/index.ts` (778 lines, 365 impl) and `workspace/src/index.ts` (547, 265 impl) ship implementation in the barrel — direct violation of the barrel-only rule | Split npm-registry → `packument/tarball/retry/integrity/npmrc/auth/whoami/errors`; workspace → `discover/graph/changed-files/glob`; `index.ts` becomes re-exports. Pure move, guarded by each package's spec | P2 |
| A8 | `install.ts#workspaceInstallLocked` (~380 lines) and `actions/build.ts#buildApp` (~253 lines) are God-functions | Extract `planWorkspaceDependencies`/`wireWorkspaceSymlinks`/`applyScopedOverrides` and `resolveOutputTarget`/`assembleUserPlugins`/`buildGjsifyPluginFactory`. **ADR-0001 install path — needs the install e2e + care; treat as its own PR** | P2 |
| A9 | Typed errors stop at the install/workspace layer: 86 generic `throw new Error('gjsify install: …')`, no `InstallError`/`WorkspaceCycleError`/`InvalidSpecError` for machine-distinguishable failures | Introduce a small typed-error set for the branchable cases; leave informational throws | P3 |

### B. Shared-`core` adoption gaps (GJS/browser — needs build+run or visual check)

| # | Finding | Recommendation | Prio |
|---|---------|----------------|------|
| B1 | **`@gjsify/adwaita-web` never adopted `@gjsify/adwaita-core`** — it reimplements Combo/Spin/Toggle/Expander/Alert state inline (~150–180 lines), and its toast overlay **lacks the one-at-a-time queue** `AdwToastQueue` provides → a real fidelity divergence from `Adw.ToastOverlay`. adwaita-core is pure-TS all-`polyfill`; adwaita-nativescript already composes it. | adwaita-web depends on + composes adwaita-core (fixes the toast queue). **Browser build + visual** | **P1** (fixes a bug) |
| B2 | devtools tree-walk hand-written twice: `framework/devtools/src/widget-tree.ts` (GTK) and `nativescript-bridge/devtools/src/view-tree.ts` (NS) — `parseNodePath`/`jsonSafe` byte-identical, ~80 lines shared-with-injected-primitives; the "generic walk in devtools-protocol" the docs claim does not exist | Generic `tree-walk.ts` in `@gjsify/devtools-protocol` parameterized by a `NodeAdapter<T>` (getChildren/getType/getName/…); each adapter keeps ~6 lines. **GTK + NS build** | P2 |
| B3 | `@gjsify/devtools` (GTK) `_guard()` re-codes the `MethodRegistry` pause policy byte-identically instead of routing through it (contradicts the class-comment + AGENTS.md claim) | `enforcePause(kind, paused, method)` in devtools-protocol, called by both adapters; correct the doc claim | P3 |
| B4 | storybook `_buildControls` loop triplicated across the 3 renderers (~39 lines, identical `console.warn` guard) — the one residual after storybook-core | `bindControls(instance, factory)` in `storybook-core/src/controls.ts` | P3 |

### C. Cross-package pure-TS byte helpers (needs 3-target build validation)

| # | Finding | Recommendation | Prio |
|---|---------|----------------|------|
| C1 | `concatBytes` copy-pasted ~13× (zlib, compression-streams, stream/consumers, crypto/browser/*, fs/browser/*, buffer/blob), the fast-path/`byteLength` variance already drifting; base64 tables+enc/dec duplicated (webcrypto/util.ts ≡ buffer/base64.ts); `randomUUID` v4 formatter ×3; `bytesToHex`/`hexToBytes` scattered | A side-effect-free `@gjsify/buffer/bytes` subpath (`concatBytes`, `formatUuidV4`, hex; consolidate base64 onto buffer). **Must resolve on GJS+Node+Browser — validate `--app {gjs,node,browser}`; `@gjsify/buffer`, not GJS-only `@gjsify/utils`** | P2 |
| C2 | bigint→bytes byte-identical in `crypto/src/asn1.ts` + `key-object.ts` | intra-crypto local helper (no cross-package concern) | P3 |

### D. Technical debt / root-cause-rule (needs GJS run)

| # | Finding | Recommendation | Prio |
|---|---------|----------------|------|
| D1 | **WebCrypto `wrapKey`/`unwrapKey` throw "not yet implemented"** (`web/webcrypto/src/subtle.ts`) and are untracked in STATUS.md — the one squarely root-cause-rule-violating gap | Implement from primitives already in the file: wrapKey = `exportKey`→`encrypt`; unwrapKey = `decrypt`→`importKey`. Round-trip spec. **GJS webcrypto run** | **P1** |
| D2 | `@gjsify/dgram` UDP send/receive skip-guarded to Node (`index.spec.ts` ×2) though GJS is the primary target and `ensureMainLoop()` exists; `@gjsify/eventsource` connection suite (~350 lines) skipped on GJS with a weak "needs a Node HTTP server" justification (other packages serve HTTP on GJS via Soup) | Un-skip on GJS (drive via `ensureMainLoop()` / a Soup server); root-cause any impl gap surfaced. **GJS run** | P2 |
| D3 | http2 repeats `catch {}` ~13× for best-effort `connection.close` | `closeQuietly(conn)` helper with one explanatory comment | P3 |
| D4 | webgl `@girs/gwebgl` type TODOs (`uniform.ts:117,169`) cast Uint32Array/Float32Array | fix in the gwebgl `@girs` regen, then drop the casts | P3 |
| D5 | ~30 stale `eslint-disable-*` comments (Biome/node-fetch-port era; oxlint ignores them; all rule-scoped) | convert to `// oxlint-disable-next-line <rule> -- <reason>` or delete | P4 |

### E. Barrel purity & cross-platform boundary

| # | Finding | Recommendation | Prio |
|---|---------|----------------|------|
| E1 | `framework/iframe/src/index.ts` and `framework/canvas2d/src/index.ts` have top-level `globalThis` writes + factory registration at module load, with no `register.ts` — violates both the barrel-only rule and the framework "no globalThis writes" rule | Move the side effects to `src/register.ts` (idempotent guards), wire `exports["./register"]` + `sideEffects`, leave `index.ts` a pure barrel (the dom-elements pattern). **Note: changes when the globals register (import vs `/register`) — audit consumers first; may warrant an ADR** | P2 |
| E2 | Latent leak: 22 browser-slotted `packages/node/*` (stream, events, buffer, process, os, fs, http, dns, module, ws) statically import GJS-only `@gjsify/utils`; a `browser:polyfill` slot resolves to the GJS impl at bundle time, so any util touching GLib/Gio breaks at call time off-GJS. Also, `stream`/`fs`/`os`/`process`/`http` ship a `src/browser.ts` the root `.` export and alias layer never route to. | Either declare a `runtimes` triplet on `@gjsify/utils` and split its pure helpers (`makeCallable`/`nextTick`/`queueMicrotask`/`registerGlobal`) into a cross-platform `-core`, or route these packages' browser slot through their `./browser` subpath. **Whole-axis change — ADR-worthy**; latent today (none browser-graduated) | P2 |
| E3 | Doc self-contradiction: the meta-monorepo AGENTS.md says "index.ts = barrel re-exports only" but gjsify's package layout documents "`src/index.ts`(impl)" for polyfill pillars (~65 files carry impl). The real invariant is *no side-effects* in index.ts, which gjsify's own AGENTS.md already states correctly | Scope the meta-repo rule (barrel-only for infra/framework; impl-allowed-no-side-effects for polyfills) — a one-line clarification in the outer `gjsify/workspace` AGENTS.md | P3 |

## Suggested order

1. ~~**D1** (wrapKey/unwrapKey)~~ ✓ landed. Remaining P1s: **B1** (adwaita-web
   toast one-at-a-time queue — a real fidelity bug; browser-validate) and **A5**
   (spawnToCompletion — a *suspected* latent hang: note `runGjsBundle`'s own
   async-`spawn`+await-`close` ran 490+ GJS specs here without hanging, so
   confirm the gotcha actually bites foreach/flatpak before unifying 6 wrappers).
2. **A2/A3/A4/A7** — the infra dedup cluster (mechanical, spec-guarded).
3. **C1/B2** — the shared-`core` extractions (need the 3-target / GTK+NS builds).
4. **A8/E2** — the God-function splits and the utils boundary; ADR-scale, own PRs.
5. **D2/D3/D4/A6/A9/B3/B4/E1/E3/D5** — the long tail.

## Cross-repo note

E3's clarification lives in the outer `gjsify/workspace` AGENTS.md (a different
submodule), not this repo. Everything else is in-repo.
