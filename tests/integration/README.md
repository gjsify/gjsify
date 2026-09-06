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

## Suites

| Suite | Validates | STATUS section |
|---|---|---|
| `acorn/` | acorn + acorn-walk AST parser | `### acorn + acorn-walk` |
| `autobahn/` | `@gjsify/ws` against the Autobahn WebSocket conformance pillar | `### autobahn` |
| `axios/` | `@gjsify/http` + `@gjsify/fetch` consumer | `### axios` |
| `chalk/` | `@gjsify/{tty,process}` ANSI color + level gating via supports-color | `### chalk` |
| `cosmiconfig/` | `@gjsify/fs` + `@gjsify/path` + dynamic ESM `import(file://…)` | `### cosmiconfig` |
| `deepkit-type-compiler/` | TypeScript compiler API (Phase D-1 W) | `### @deepkit/type-compiler` |
| `dotenv/` | `@gjsify/process` (process.env Proxy round-trip through GLib.{get,set,unset}env) + `@gjsify/fs.readFileSync` | `### dotenv` |
| `effect/` | Effect 4's fiber runtime end to end — `@gjsify/{timers,process,fs,path,abort-controller}` under the hardest scheduling consumer in the tree, plus upstream's layer-parameterised `FileSystem` conformance suite run over BOTH `node:fs` and `@gjsify/effect-platform`'s Gio layer | `### effect` |
| `execa/` | `@gjsify/child_process` spawn + stdio + env forwarding | `### execa` |
| `fast-glob/` | `@gjsify/fs` readdir + glob walk semantics | `### fast-glob` |
| `gettext-parser/` | PO/MO byte-equality binary read/write | covered in suite README |
| `lightningcss/` | byte-equality of CSS minify across native/wasm/npm backends | `### lightningcss` |
| `loro-crdt/` | WASM CRDT round-trip | covered in suite README |
| `mcp-inspector-cli/` | MCP server inspector CLI subprocess lifecycle | `### mcp-inspector-cli` |
| `mcp-typescript-sdk/` | MCP TypeScript SDK transport layer | `### mcp-typescript-sdk` |
| `minify-xml/` | RegExp engine parity for the heavy lookbehind chains | `### minify-xml` |
| `pkg-types/` + `get-tsconfig/` | TypeScript config + extends-chain readers | `### pkg-types + get-tsconfig` |
| `rolldown-native/` | `@gjsify/rolldown-native` Vala/Rust bundler bridge | covered in STATUS |
| `rollup-pluginutils/` | `@rollup/pluginutils` helper toolkit | `### @rollup/pluginutils` |
| `socket.io/` | `@gjsify/http` + `@gjsify/ws` (full Socket.IO server + client) | `### socket.io` |
| `streamx/` | `@gjsify/stream` + queueMicrotask injection | `### streamx` |
| `tls-session/` | `@gjsify/tls-native` Phase 2 SessionAccess — real-handshake session resumption + RFC 5929 / RFC 9266 channel binding | `### tls-session` |
| `ts-for-gir/` | full ts-for-gir generator chain on GJS | `### ts-for-gir` |
| `typescript-tsc/` | TypeScript `tsc` CLI on GJS | covered in STATUS |
| `undici/` | `undici.fetch` + `undici.request` + `undici.WebSocket` (npm `undici@7`) | `### undici` |
| `webtorrent/` | `@gjsify/fs` + `@gjsify/stream` + bittorrent-protocol | `### webtorrent` |
| `worker-stress/` | `@gjsify/worker_threads` + `@gjsify/sab-native` | `### worker-stress` |
| `yargs/` | yargs CLI parser | `### yargs` |

Each suite's section in [`status/integration-coverage.md`](../../status/integration-coverage.md) lists per-port test counts (Node / GJS / skipped) and any `@gjsify/*` root-cause fix landed alongside it.

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
