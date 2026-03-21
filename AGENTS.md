# AGENTS.md — gjsify

## Project Goal

gjsify implements the Node.js API for GJS (GNOME JavaScript runtime). The long-term goal is to remove the Deno dependency entirely and replace all `@gjsify/deno_std` re-exports with native GJS implementations backed by GNOME libraries.

## Architecture

**Monorepo** (Yarn workspaces) structured as:

```
packages/
  node/     — Node.js API polyfills (17 packages: assert, buffer, console, events, fs, globals, http, net, os, process, querystring, require, stream, tty, url, util, zlib)
  gjs/      — GJS-specific modules (unit test framework, gio helpers, utils)
  infra/    — Build tooling (CLI, esbuild plugins, module resolution)
  web/      — Web API polyfills (fetch, dom-events, abort-controller, webgl)
  deno/     — Deno runtime + std lib (BEING REMOVED)
```

### Node.js Packages (`packages/node/*`)

Each package is `@gjsify/<name>` and provides a Node.js-compatible module for GJS.

**Current state** — most packages are thin re-exports from Deno:
```typescript
export * from '@gjsify/deno_std/node/assert';
import assert from '@gjsify/deno_std/node/assert';
export default assert;
```

**Packages already with custom GJS implementations** (no Deno dependency):
- `os` — uses GLib bindings, platform-specific files (linux.ts, darwin.ts)
- `fs` — uses Gio for file operations (sync, callback, promises, streams)
- `querystring` — pure TypeScript implementation
- `net` — partial (isIP/isIPv4/isIPv6 via Gio.InetAddress)
- `require` — full CommonJS require() for GJS
- `http` — partial (header validation)

**Packages still re-exporting from Deno** (need replacement):
- assert, buffer, console, events, process, stream, tty, url, util, zlib

### Module Resolution / Bundler

The `@gjsify/cli` uses esbuild with platform-specific plugins:

- **GJS build** (`gjsify build --app gjs`): aliases `assert` → `@gjsify/assert`, `buffer` → `@gjsify/buffer`, etc. Externals: `gi://*`, `cairo`, `system`, `gettext`. Target: firefox128 (GJS 1.86.0 / SpiderMonkey 128).
- **Node build** (`gjsify build --app node`): aliases `@gjsify/process` → `process`, etc. Uses native Node.js built-ins. Target: node18.

This means: when tests import `from 'assert'`, GJS gets `@gjsify/assert`, Node gets the built-in. Same test code, different implementations.

Key files:
- `packages/infra/esbuild-plugin-gjsify/src/app/gjs.ts` — GJS platform config
- `packages/infra/esbuild-plugin-gjsify/src/app/node.ts` — Node platform config
- `packages/infra/resolve-npm/lib/index.mjs` — alias mappings per platform

## Reference Implementations

When implementing a Node.js API, consult these sources (vendored as git submodules):

| Source | Path | Notes |
|--------|------|-------|
| Node.js | `refs/node/` | Canonical behavior — the spec |
| Deno | `refs/deno/` | TypeScript, closest to our use case |
| Bun | `refs/bun/` | Alternative TS/Zig implementation |
| GJS | `refs/gjs/` | GJS runtime internals (C++/JS), check for built-in capabilities and SpiderMonkey integration details |

Do NOT copy code blindly. GJS must use GNOME libraries internally. Use `refs/gjs/` to understand GJS internals — e.g. `modules/` for built-in JS modules, `gjs/` for the C++ runtime, `gi/` for GObject Introspection bindings.

## GNOME Libraries (`node_modules/@girs/*`)

Available TypeScript bindings for GObject Introspection:

| Library | Package | Use For |
|---------|---------|---------|
| GLib 2.0 | `@girs/glib-2.0` | ByteArray, MainLoop, IOChannel, Checksum, DateTime, Regex, URI |
| GObject 2.0 | `@girs/gobject-2.0` | Object system, signals, properties |
| Gio 2.0 | `@girs/gio-2.0` | **Filesystem** (File, FileInfo, streams), **Networking** (Socket, InetAddress, TLS), **App** (DBus, Settings) |
| GioUnix 2.0 | `@girs/giounix-2.0` | Unix file descriptors, mount monitoring |
| Soup 3.0 | `@girs/soup-3.0` | HTTP client/server, WebSocket, cookies |
| GJS | `@girs/gjs` | GJS-specific APIs, runtime info |

### Common Mapping Patterns

- `fs.*` → `Gio.File`, `Gio.FileInputStream`, `Gio.FileOutputStream`
- `Buffer` → `GLib.Bytes`, `GLib.ByteArray`, `Uint8Array`
- `EventEmitter` → `GObject.Object` signals or custom implementation
- `net.Socket` → `Gio.SocketConnection`, `Gio.SocketClient`
- `http` → `Soup.Session`, `Soup.Server`
- `crypto` hashes → `GLib.Checksum`, `GLib.Hmac`
- `process.env` → `GLib.getenv()`, `GLib.setenv()`

## Native Extensions (Vala)

When TypeScript alone is not sufficient (e.g. low-level graphics, system APIs without GIR bindings), native extensions are written in **Vala**. Vala transpiles to GObject C code but is far more readable. The compiled library is exposed to GJS via GObject Introspection (GIR).

Example: `packages/web/webgl/` — WebGL implementation using Vala + Meson build system.

Pattern: Vala source → Meson build → shared library + GIR typelib → usable from GJS via `gi://` imports.

Prefer TypeScript whenever possible. Only use Vala when direct C-level system access is required.

## Testing

### Framework: `@gjsify/unit`

Located at `packages/gjs/unit/`. BDD-style API:

```typescript
import { describe, it, expect, on } from '@gjsify/unit';

export default async () => {
  await describe('module.function', async () => {
    await it('should do X', async () => {
      expect(result).toBe(expected);
    });
  });
};
```

Matchers: `toBe`, `toEqual`, `toBeTruthy`, `toBeFalsy`, `toBeNull`, `toBeDefined`, `toBeUndefined`, `toBeLessThan`, `toBeGreaterThan`, `toContain`, `toMatch`, `toThrow`, plus `.not` negation.

Runtime-conditional tests:
```typescript
await on('Gjs', async () => { /* GJS-only */ });
await on('Node.js', async () => { /* Node-only */ });
```

### Test File Structure

```
packages/node/<name>/src/
  index.ts          — implementation
  *.spec.ts         — test specs
  test.mts          — test entry point (imports all specs)
```

### Running Tests

```bash
# Per-package
cd packages/node/<name>
yarn build:test:gjs    # gjsify build src/test.mts --app gjs --outfile test.gjs.mjs
yarn build:test:node   # gjsify build src/test.mts --app node --outfile test.node.mjs
yarn test:node         # node test.node.mjs
yarn test:gjs          # gjs -m test.gjs.mjs
```

### Test Design Principle

Tests import from the bare module specifier (e.g., `from 'assert'`). The bundler resolves this to the appropriate implementation per platform. Running tests on Node.js validates test correctness against the reference implementation. Running on GJS validates our implementation. Both must pass.

## Build Commands

```bash
yarn build              # Build everything
yarn build:node         # Build all Node.js polyfill packages
yarn test               # Test everything
```

Per-package:
```bash
yarn build:gjsify       # Build library (ESM + CJS output to lib/)
yarn build:types        # Generate .d.ts type definitions
```

## Package Structure Convention

Each `packages/node/<name>/` package:
- `package.json`: name `@gjsify/<name>`, version 0.0.4, type "module"
- Conditional exports: `./lib/esm/index.js` (import), `./lib/cjs/index.js` (require)
- Scripts: `build:gjsify`, `build:types`, `build:test:gjs`, `build:test:node`, `test`, `test:gjs`, `test:node`
- Dependencies: `@girs/*` for GNOME bindings (implementation), `@gjsify/unit` (devDep, testing)

## Implementation Workflow

When replacing a Deno re-export with a native GJS implementation:

1. Check the current re-export in `packages/node/<name>/src/index.ts`
2. Study the Node.js API surface (check `refs/node/lib/<name>.js`)
3. Consult reference implementations: `refs/deno/`, `refs/bun/`
4. Implement using GNOME libraries (`@girs/*`), check types in `node_modules/@girs/`
5. Write tests in `*.spec.ts` using `@gjsify/unit`
6. Verify tests pass on Node.js first (`yarn test:node`), then GJS (`yarn test:gjs`)
7. Remove `@gjsify/deno_std` from the package's `package.json` dependencies

## Constraints

- Target: GJS 1.86.0 (SpiderMonkey 128 / esbuild target `firefox128`)
- ESM-first (`"type": "module"`), but also emit CJS
- No Deno APIs in new code — use only GNOME libs + standard JS
- Tests must work on both Node.js and GJS with the same source
- Do not modify files under `refs/` — those are read-only reference submodules

## GJS 1.86.0 / SpiderMonkey 128 — Available JS Features

SpiderMonkey 128 supports ES2024. Key features available without polyfills:

- `Object.is`, `Object.groupBy`, `Map.groupBy`
- `Promise.withResolvers`
- `Set` methods: `intersection`, `union`, `difference`, `symmetricDifference`, `isSubsetOf`, `isSupersetOf`, `isDisjointFrom`
- `Array.fromAsync`
- `structuredClone`
- `Map`, `Set`, `WeakSet`, `WeakRef`, `FinalizationRegistry`, `Symbol`, all TypedArrays
- `SharedArrayBuffer`
- `Intl.Segmenter`
- `globalThis`
- `??`, `?.`, `??=`, `||=`, `&&=`
- Top-level `await`
- Private class fields, static class fields

**NOT available** (V8-specific, will never be in SpiderMonkey):
- `Error.captureStackTrace` — use conditional check: `if (typeof Error.captureStackTrace === 'function')`
- `Error.stackTraceLimit` — skip or guard with typeof check

A polyfill for `Error.captureStackTrace` exists in `packages/gjs/utils/src/error.ts`.
