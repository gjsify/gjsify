# AGENTS.md — `tests/*`

> Scope: this directory tree, and the testing rules every package follows.
> Repo-wide rules live in the [root AGENTS.md](../AGENTS.md) — read that first.
> How CI decides WHICH of these run: [docs/ci-selective.md](../docs/ci-selective.md).

## Testing

### Framework `@gjsify/unit`

```ts
import { describe, it, expect, on } from '@gjsify/unit';
export default async () => {
  await describe('module.function', async () => {
    await it('should do X', async () => { expect(result).toBe(expected); });
  });
  await on('Gjs', async () => { /* GJS-only */ });
};
```
Matchers: `toBe|toEqual|toBeTruthy|toBeFalsy|toBeNull|toBeDefined|toBeUndefined|toBeLessThan|toBeGreaterThan|toContain|toMatch|toThrow` + `.not`. Run: `gjsify workspace @gjsify/<pkg> run test[:node|:gjs]`; e2e: `node --test tests/e2e/<name>/run.mjs`.

### Rules

1. **Cross-platform pkgs:** `node:` prefix for all Node imports (value+type); **never import `@gjsify/*` directly** (except `@gjsify/unit`); aliased Web pkgs via bare specifier.
2. **GJS-only pkgs** (dom-elements, webgl): import `@gjsify/*` directly; no `test:node`. 2b. **GJS-only spec files in cross-platform pkgs** (`*.gjs.spec.ts` or `on('Gjs', …)`): direct `@gjsify/*` imports allowed — use to test impl-private internals TYPE-SAFELY instead of `as any`. 2c. **Internal-only helpers** (`src/internal/`, not in `exports`): may import sibling `@gjsify/*` even in production code; the public surface still follows rule 1.
3. Node tests prove the TEST is correct; GJS tests prove OUR impl. Both must pass.
4. Common `*.spec.ts`: both platforms, no `@girs/*`. Platform-specific parts minimal.
5. Layout: `src/index.ts` | `src/*.spec.ts` | `src/test.mts` (entry).
6. **Never weaken tests** — fix the impl. No platform guards. When the blocker is genuinely NOT ours (an upstream defect, or an assertion a PLATFORM cannot satisfy — `chmod` reading back `0o666` on NTFS, a stat-able character device, `S_IRUSR`), the sanctioned tool is **`it.failing(name, fn, reason[, {when}])`**, never a skip and never an `if (platform)` around the test. It RUNS the test, tolerates the declared failure as `xfail` (non-gating), and **fails the run the day it starts passing** — self-retiring instead of rotting. `when` scopes the EXPECTATION, not the test: `{ when: process.platform === 'win32' }` is a plain `it()` that must pass on Linux and a tolerated failure on win32. `reason` is mandatory. Three neighbours, kept distinct on purpose: `it.skip` = did not run (hides forever) · `it.failing` = declared, self-retiring · a runner **warning** = observed, nothing claimed, nothing to retire (see `warnings` in `packages/gjs/unit/src/index.ts`) — do not reach for a warning where something could be declared. Run-level sibling: **`run(ns, { requireAxes })`** — an axis THIS host matches must have executed ≥1 test through an `on()` gate or the run fails; a gate that matched and registered nothing scores zero, and only the axis that MATCHED is credited.
6b. **Hooks are SCOPED, and the summary counts two things.** `beforeEach`/`afterEach` register into the enclosing `describe`: a nested block inherits its parents' hooks and cannot unhook them, two registrations in one scope both run (before in registration order, after in reverse), and a frame is dropped when its describe returns. Until #1554 there was ONE slot per module, so a second registration silently REPLACED the first and a returning describe nulled both — measured in `@gjsify/react-native`, where a diagnostics gate ran for 12 of 49 cases and a test named "…with no diagnostic" was green with two `GLib-GObject-CRITICAL`s inside it. The summary line reads `N tests passed · M assertions · K ignored`: `N` survives a refactor, `M` does NOT — a suite asserting inside data-driven loops moves it without changing what it verifies (measured: +25 tests, +58 `expect(` sites, nothing skipped, and the number fell by 114), so quote `N` across commits and never `M` (#1557).
7. **`/register` side-effect tests in a dedicated `register.spec.ts`**, never the common spec — even for a pure-JS global, `/register` can pull GTK/Cairo via its import chain and crash Node. Common spec tests the class via named import; `register.spec.ts` tests the wiring (GJS-only, `on('Gjs',…)`). Cross-platform pkgs: `/register` test → `.gjs.spec.ts`.

**Regression tests from examples:** a real-world example uncovering a bug (GC, missing globals, CJS-ESM, MainLoop) ALWAYS gets a targeted test in the relevant `*.spec.ts` — examples are integration validation, regression tests the permanent net.

**Test sources:** port from `refs/` (`refs/node-test/` primary; `refs/deno/ext/{web,fetch,crypto,…}` for Web API), rewritten in `@gjsify/unit` with bare specifiers — never copied verbatim, never weakened. Select core behavior, GNOME-relevant edge cases, errors, cross-platform; skip V8 internals/native addons/stubbed features.

### E2E tests — `tests/e2e/`

One suite per directory (`run.mjs`, `node:test`), driving the built CLI from OUTSIDE. Two shared
modules, NEITHER re-implementable in a suite: `helpers.mjs` (repo paths, packing, project setup,
`spawnUntilReady` — a suite that only BUILDS an app has not shown it runs) and
`mock-registry.mjs` — the npm harness (`packageTar` · `packageTarball` · `sriSha512` ·
`startMockRegistry` · `runCli`/`runCliSync`). A registry that must MISBEHAVE uses `onRequest`
(answer INSTEAD of the default routes) or `onPackument` (edit the document about to be sent), never
a private server. `scripts/check-e2e-harness-duplication.mjs` fails on a private copy — a raw
`createServer` included — and holds the incident; its ALLOWED ledger carries the suites whose
subject IS a different npm API (publish, onboard, self-update) and is self-retiring. A suite-specific POLICY over the shared runner stays local (`build-cache`'s hermetic env);
a second implementation does not. `runCli` defaults to 30 s — longer goes at the CALL SITE.

### Browser tests — `tests/browser/` (Playwright, Firefox/SpiderMonkey)

Third axis alongside `test:gjs`/`test:node`. **The goal is GJS, not the browser**: they verify the native browser platform behaves the way our GJS impl claims — they do NOT test our GJS packages in a browser. **`src/test.browser.mts` must use browser globals directly** — never import `@gjsify/<pkg>` impls or spec files that do: Web APIs are already global in the browser, and importing our packages drags `@girs/*`/`gi://` in transitively, forcing workaround aliases. The correct fix is always a clean test file, not more aliases. **`@girs/*` or `gi://*` appearing in a browser/Node bundle = a missing alias somewhere in the chain — fix the import; never mask with `external:` (unresolvable bare specifiers) or a blanket empty-module map.** Build: `build:test:browser` → `gjsify build src/test.browser.mts --app browser` (the target's `gjsImportsEmptyPlugin` silences what leaks via `@gjsify/unit`; only two aliases exist: `assert`→`@gjsify/assert`, `process`→`@gjsify/empty`). Opt in with `src/test.browser.mts`; GJS-only ones (webaudio, webrtc, gamepad) cannot: no browser equivalent of libsoup/GStreamer/Manette. Run: `cd tests/browser && npx playwright test --project=firefox` (add `--project=chromium` for engine diffs). A **browser-ONLY** package (`src/test.browser.mts`, no `src/test.{mts,ts}`) reaches a runner through that ONE `run({…})` and nowhere else, and the entry sits outside the tsconfig program (`include: src/**/*.ts` misses `.mts`), so a dropped import still type-checks and silently stops running. Two halves hold it: `scripts/check-browser-test-registration.mjs` (static — every suite a spec exports, `…Test` or default, registered, and `build:test:browser` paired with the entry file) and `results.total > 0` in `specs/unit.spec.ts` — `browserSignalDone()` signals done UNCONDITIONALLY, so a bundle registering nothing reports 0/0/0 green. That floor counts ASSERTIONS, so an entirely `on(…)`-gated bundle trips it too.

### Integration tests — `tests/integration/`

Curated upstream tests from npm packages run against `@gjsify/*` — validates pillars end-to-end in a real consumer. Layout: `tests/integration/<pkg>/` → `@gjsify/integration-<pkg>`, `private:true`; specs `src/*.spec.ts`, aggregator `src/test.mts`; fixtures copied at prebuild from the npm devDep into gitignored `fixtures/`, loaded via `new URL('../fixtures/…', import.meta.url)` — NOT bundled, NOT committed. Scripts: each suite declares `test` / `test:node` / `test:gjs`; run them from the repo ROOT with `gjsify run test:integration` (which foreaches `test` over `@gjsify/integration-*`). **NOT `gjsify foreach test:integration`** — no suite declares that script, so it matches nothing and exits 0 having run nothing (`foreach` hard-fails a zero-match `--include` PATTERN, never a zero-match SCRIPT name). Deliberately NOT part of `gjsify foreach test` (opt-in; tracked gaps must not block PRs). CI gates the subset measured green in the CI image, via `main.yml`'s `integration` job; the cause held against each suite left out is in `status/integration-coverage.md`.

**Port convention — manual rewrite to `@gjsify/unit`** (no test-compat shim; revisit when a 2nd dialect lands). Header per file:
```ts
// SPDX-License-Identifier: MIT
// Ported from refs/<pkg>/test/<name>.js
// Original: Copyright (c) <holder>. <license>.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
```
tape→unit: `t.equal`→`toBe` | `t.deepEqual`→`toStrictEqual` | `t.ok/notOk`→`toBeTruthy/Falsy` | `t.error(err)`→`expect(err).toBeFalsy()` | `t.throws(fn)`→`toThrow()` | `t.plan/t.end` omitted | callback cleanup → promisified. **Never weaken**; failure → root-cause fix. Exception: pre-known out-of-scope gap → wrap in `on('Node.js', …)` + document in header + `status/open-todos.md`. Suites + pass counts: `status/integration-coverage.md` (webtorrent, socket.io, streamx, chokidar, autobahn, claude-agent-sdk, devtools-cdp, …).

**Non-port suites:** `autobahn/` runs the crossbario fuzzingserver in Podman/Docker against BOTH `@gjsify/websocket` (W3C/Soup) and `@gjsify/ws` drivers — isolates wrapper-layer from transport-layer bugs; baselines committed under `reports/baseline/`, diffed by `scripts/validate-reports.mjs`; not in CI (Podman-in-CI needs privileged containers). `devtools-cdp/` drives `InspectorProtocolClient` against a live WebKit remote inspector — opt-in via `GJSIFY_CDP_INSPECTOR_PORT` (unset ⇒ one passing "skipped" test); launch recipe in the suite README.
