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
6. **Never weaken tests** — fix the impl. No platform guards. When the blocker is genuinely NOT ours (an upstream defect, or an assertion a PLATFORM cannot satisfy — `chmod` reading back `0o666` on NTFS, a stat-able character device, `S_IRUSR`), the sanctioned tool is **`it.failing(name, fn, reason[, {when}])`**, never a skip and never an `if (platform)` around the test. It RUNS the test, tolerates the declared failure as `xfail` (non-gating), and **fails the run the day it starts passing** — self-retiring instead of rotting. `when` scopes the EXPECTATION, not the test: `{ when: process.platform === 'win32' }` is a plain `it()` that must pass on Linux and a tolerated failure on win32. `reason` is mandatory. Three neighbours, kept distinct on purpose: `it.skip` = did not run (hides forever) · `it.failing` = declared, self-retiring · a runner **warning** = observed, nothing claimed, nothing to retire (see `warnings` in `packages/gjs/unit/src/index.ts`) — do not reach for a warning where something could be declared.
7. **`/register` side-effect tests in a dedicated `register.spec.ts`**, never the common spec — even for a pure-JS global, `/register` can pull GTK/Cairo via its import chain and crash Node. Common spec tests the class via named import; `register.spec.ts` tests the wiring (GJS-only, `on('Gjs',…)`). Cross-platform pkgs: `/register` test → `.gjs.spec.ts`.

**Regression tests from examples:** a real-world example uncovering a bug (GC, missing globals, CJS-ESM, MainLoop) ALWAYS gets a targeted test in the relevant `*.spec.ts` — examples are integration validation, regression tests the permanent net.

**Test sources:** port from `refs/` (`refs/node-test/` primary; `refs/deno/ext/{web,fetch,crypto,…}` for Web API), rewritten in `@gjsify/unit` with bare specifiers — never copied verbatim, never weakened. Select core behavior, GNOME-relevant edge cases, errors, cross-platform; skip V8 internals/native addons/stubbed features.

### Browser tests — `tests/browser/` (Playwright, Firefox/SpiderMonkey)

Third axis alongside `test:gjs`/`test:node`. **The goal is GJS, not the browser**: they verify the native browser platform behaves the way our GJS impl claims — they do NOT test our GJS packages in a browser. **`src/test.browser.mts` must use browser globals directly** — never import `@gjsify/<pkg>` impls or spec files that do: Web APIs are already global in the browser, and importing our packages drags `@girs/*`/`gi://` in transitively, forcing workaround aliases. The correct fix is always a clean test file, not more aliases. **`@girs/*` or `gi://*` appearing in a browser/Node bundle = a missing alias somewhere in the chain — fix the import; never mask with `external:` (unresolvable bare specifiers) or a blanket empty-module map.** Build: `build:test:browser` → `gjsify build src/test.browser.mts --app browser` (the target's `gjsImportsEmptyPlugin` silences what leaks via `@gjsify/unit`; only two aliases exist: `assert`→`@gjsify/assert`, `process`→`@gjsify/empty`). 12 packages have browser tests; GJS-only packages (webaudio, webrtc, gamepad) have none — no browser equivalent of libsoup/GStreamer/Manette. Run: `cd tests/browser && npx playwright test --project=firefox` (add `--project=chromium` for engine diffs).

### Integration tests — `tests/integration/`

Curated upstream tests from npm packages run against `@gjsify/*` — validates pillars end-to-end in a real consumer. Layout: `tests/integration/<pkg>/` → `@gjsify/integration-<pkg>`, `private:true`; specs `src/*.spec.ts`, aggregator `src/test.mts`; fixtures copied at prebuild from the npm devDep into gitignored `fixtures/`, loaded via `new URL('../fixtures/…', import.meta.url)` — NOT bundled, NOT committed. Scripts: `gjsify foreach test:integration[:node|:gjs]` — deliberately NOT part of `gjsify foreach test` (opt-in; tracked gaps must not block PRs).

**Port convention — manual rewrite to `@gjsify/unit`** (no test-compat shim; revisit when a 2nd dialect lands). Header per file:
```ts
// SPDX-License-Identifier: MIT
// Ported from refs/<pkg>/test/<name>.js
// Original: Copyright (c) <holder>. <license>.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
```
tape→unit: `t.equal`→`toBe` | `t.deepEqual`→`toStrictEqual` | `t.ok/notOk`→`toBeTruthy/Falsy` | `t.error(err)`→`expect(err).toBeFalsy()` | `t.throws(fn)`→`toThrow()` | `t.plan/t.end` omitted | callback cleanup → promisified. **Never weaken**; failure → root-cause fix. Exception: pre-known out-of-scope gap → wrap in `on('Node.js', …)` + document in header + `status/open-todos.md`. Suites + pass counts: `status/integration-coverage.md` (webtorrent, socket.io, streamx, chokidar, autobahn, claude-agent-sdk, devtools-cdp, …).

**Non-port suites:** `autobahn/` runs the crossbario fuzzingserver in Podman/Docker against BOTH `@gjsify/websocket` (W3C/Soup) and `@gjsify/ws` drivers — isolates wrapper-layer from transport-layer bugs; baselines committed under `reports/baseline/`, diffed by `scripts/validate-reports.mjs`; not in CI (Podman-in-CI needs privileged containers). `devtools-cdp/` drives `InspectorProtocolClient` against a live WebKit remote inspector — opt-in via `GJSIFY_CDP_INSPECTOR_PORT` (unset ⇒ one passing "skipped" test); launch recipe in the suite README.
