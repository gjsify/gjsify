# Integration Tests

Runs curated subsets of popular npm packages' own test suites against
`@gjsify/*` Node.js/Web/DOM API reimplementations. These tests validate
the implementations end-to-end in a real-world consumer scenario —
complementary to the per-package unit tests under `packages/*`.

Integration tests **validate** the pillars (Node API, Web API, DOM API,
Framework). They are not themselves a pillar.

## Layout

```
tests/integration/<pkg>/
├── package.json            # @gjsify/integration-<pkg> (private)
├── tsconfig.json
├── scripts/
│   └── copy-fixtures.mjs   # optional: fixtures from an npm dep
├── fixtures/               # gitignored; populated by prebuild
├── src/
│   ├── <name>.spec.ts      # one file per upstream port
│   └── test.mts            # aggregator, imports all specs
```

## Port convention

Each `*.spec.ts` is a manual rewrite of one upstream test file into
`@gjsify/unit` style. The upstream file's structure, cases and
assertions are preserved — only the assertion dialect changes.

### Header (SPDX + attribution)

```ts
// SPDX-License-Identifier: MIT
// Ported from refs/<pkg>/test/<name>.js
// Original: Copyright (c) <upstream-holder>. <upstream-license>.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
```

### Assertion rewrite table (tape → @gjsify/unit)

| Upstream (tape) | Rewrite (@gjsify/unit) |
|---|---|
| `test('x', t => { … })` | `describe('x', async () => { await it('…', async () => { … }) })` |
| `t.equal(a, b)` | `expect(a).toBe(b)` |
| `t.deepEqual(a, b)` | `expect(a).toStrictEqual(b)` |
| `t.ok(v)` | `expect(v).toBeTruthy()` |
| `t.notOk(v)` | `expect(v).toBeFalsy()` |
| `t.error(err)` | `expect(err).toBeFalsy()` |
| `t.throws(fn)` | `expect(fn).toThrow()` |
| `t.plan(N)` + `t.end()` | omitted — `it` resolves on Promise completion |
| `client.destroy(err => cb)` | `await new Promise((res, rej) => client.destroy(err => err ? rej(err) : res()))` |

**Never weaken assertions.** If a port fails on GJS, fix the
`@gjsify/*` root cause — do not add platform guards or skip cases.
(See `CLAUDE.md` → "Fix root causes immediately.")

## Running

```bash
# One package:
cd tests/integration/webtorrent
yarn test           # builds + runs on both node and gjs
yarn test:node      # Node only
yarn test:gjs       # GJS only

# All integration tests from repo root:
yarn test:integration
```

`yarn test:integration` is **not** part of `yarn test`. Run it
explicitly when validating cross-package impact.

## Adding a new integration target

1. Create `tests/integration/<pkg>/` following the layout above.
2. `package.json` name: `@gjsify/integration-<pkg>`, `"private": true`.
3. Pin the upstream npm package in `devDependencies`.
4. Port a handful of upstream tests that are self-contained (no real
   network, no external tracker/server). Start with the smallest, no-I/O
   test as a smoke test of the infra itself.
5. `src/test.mts` imports all specs and calls `run({ suites })`.
6. If fixtures are needed, add `scripts/copy-fixtures.mjs` and wire it
   into `prebuild`.
