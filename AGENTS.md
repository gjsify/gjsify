# AGENTS.md — gjsify

Node.js API implementation for GJS (GNOME JavaScript). Monorepo (`Yarn workspaces`, v0.0.4, ESM-first). All packages use native GNOME libraries — no Deno dependency remains.

## Structure

```
packages/
  node/   — 39 Node.js API polyfills (see table below)
  gjs/    — GJS modules: unit (test framework), utils, types
  infra/  — cli, esbuild-plugin-gjsify, esbuild-plugin-alias, esbuild-plugin-deepkit,
             esbuild-plugin-transform-ext, resolve-npm, empty
  web/    — Web API polyfills: fetch, dom-events, abort-controller, formdata,
             globals, html-image-element, webgl
refs/     — read-only git submodules (node, deno, bun, gjs, node-fetch,
             fetch-ie8, stream-http, headless-gl, troll,
             crypto-browserify, readable-stream, undici,
             browserify-cipher, browserify-sign, create-ecdh,
             create-hash, create-hmac, diffie-hellman, hash-base,
             pbkdf2, public-encrypt, randombytes, randomfill)
```

## Node.js Packages (`packages/node/*`)

Each is `@gjsify/<name>`. All have native GJS implementations — no Deno re-exports remain.

| Package | GNOME Libs | Status | Notes |
|---------|-----------|--------|-------|
| assert | — | Full | AssertionError, deepEqual, throws, strict mode |
| async_hooks | — | Full | AsyncLocalStorage, AsyncResource, createHook |
| buffer | — | Full | Buffer via global Blob/File/atob/btoa |
| child_process | Gio | Full | exec/execSync, execFile/execFileSync, spawn/spawnSync via Gio.Subprocess |
| cluster | — | Stub | isPrimary, isMaster, isWorker, fork throws |
| console | — | Full | Console class with stream support |
| crypto | GLib | Partial | Hash (GLib.Checksum), Hmac (GLib.Hmac), randomBytes/UUID (WebCrypto/GLib) |
| dgram | — | Stub | Socket stub, createSocket |
| diagnostics_channel | — | Full | Channel, TracingChannel, subscribe/unsubscribe |
| dns | Gio | Full | lookup, resolve4/6, reverse via Gio.Resolver + dns/promises |
| domain | — | Stub | Deprecated. Domain stub with run/bind/intercept |
| events | — | Full | EventEmitter, once, on, listenerCount |
| fs | Gio | Full | sync, callback, promises, streams, FSWatcher |
| globals | GLib | Partial | setImmediate polyfill, global setup |
| http | Soup 3.0 | Partial | Server (Soup.Server), IncomingMessage, ServerResponse, STATUS_CODES, METHODS |
| http2 | — | Stub | constants, createServer/connect throw |
| https | — | Partial | Agent, stub request/get (requires http completion) |
| inspector | — | Stub | Session stub, open/close/url |
| module | — | Full | builtinModules, isBuiltin, createRequire |
| net | Gio | Full | Socket (Duplex via Gio.SocketClient), Server (Gio.SocketService), connect/createServer |
| os | GLib | Full | homedir, hostname, cpus, platform-specific (linux.ts, darwin.ts) |
| path | — | Full | POSIX + Win32 path operations |
| perf_hooks | — | Full | performance (Web API / GLib fallback), monitorEventLoopDelay stub |
| process | GLib | Full | Process extends EventEmitter, env, cwd, platform |
| querystring | — | Full | parse/stringify |
| readline | — | Stub | Interface, createInterface, clearLine, cursorTo |
| require | Gio, GLib | Full | CommonJS require() for GJS |
| stream | — | Full | Readable, Writable, Duplex, Transform, PassThrough |
| string_decoder | — | Full | UTF-8, Base64, hex, streaming support |
| timers | — | Full | setTimeout/setInterval/setImmediate + Timeout class + timers/promises |
| tls | Gio | Partial | TLSSocket via Gio.TlsClientConnection, connect, createSecureContext |
| tty | — | Full | ReadStream/WriteStream with ANSI escapes, clearLine, cursorTo, getColorDepth |
| url | GLib | Full | URL, URLSearchParams via GLib.Uri |
| util | — | Full | inspect, format, promisify, types |
| v8 | — | Stub | getHeapStatistics, serialize/deserialize (JSON-based) |
| vm | — | Stub | runInThisContext (eval), Script class |
| worker_threads | — | Stub | isMainThread, Worker throws |
| zlib | — | Full | gzip/deflate via Web Compression API, Gio.ZlibCompressor fallback |

## Web Packages (`packages/web/*`)

| Package | GNOME Libs | Implements |
|---------|-----------|------------|
| fetch | Soup 3.0, Gio | fetch(), Request, Response, Headers |
| dom-events | — | Event, CustomEvent, EventTarget, DOMException |
| abort-controller | — | AbortController, AbortSignal (uses @gjsify/dom-events) |
| formdata | — | FormData, File |
| globals | — | Re-exports dom-events + abort-controller for global scope |
| html-image-element | — | HTMLImageElement, Image (uses happy-dom) |
| webgl | Gtk 4.0, Gio | WebGL 1.0 via Vala native extension (@gwebgl-0.1) |

## Build System

esbuild with platform-specific plugins. Same test source, different resolution per platform:

- **GJS** (`gjsify build --app gjs`): `assert` → `@gjsify/assert`, etc. Externals: `gi://*`, `cairo`, `system`, `gettext`. Target: `firefox128`.
- **Node** (`gjsify build --app node`): `@gjsify/process` → `process`, etc. Native built-ins. Target: `node18`.

Key files:
- `packages/infra/esbuild-plugin-gjsify/src/app/gjs.ts` — GJS platform config
- `packages/infra/esbuild-plugin-gjsify/src/app/node.ts` — Node platform config
- `packages/infra/resolve-npm/lib/index.mjs` — alias mappings per platform

### Commands

```bash
yarn build                # Build everything
yarn build:node           # Build all Node.js polyfill packages
yarn build:web            # Build all Web polyfill packages
yarn test                 # Test everything
yarn check                # Type-check all packages (tsc --noEmit)
```

Per-package:
```bash
yarn build:gjsify         # Build library (ESM → lib/)
yarn build:types          # Generate .d.ts
yarn build:test:gjs       # gjsify build src/test.mts --app gjs --outfile test.gjs.mjs
yarn build:test:node      # gjsify build src/test.mts --app node --outfile test.node.mjs
yarn test:node            # node test.node.mjs
yarn test:gjs             # gjs -m test.gjs.mjs
```

## GNOME Libraries (`node_modules/@girs/*`)

| Library | Package | Maps To |
|---------|---------|---------|
| GLib 2.0 | `@girs/glib-2.0` | ByteArray, Checksum, DateTime, Regex, URI, env, MainLoop |
| GObject 2.0 | `@girs/gobject-2.0` | Object system, signals, properties |
| Gio 2.0 | `@girs/gio-2.0` | File/streams (fs), Socket/InetAddress (net), TLS, DBus |
| GioUnix 2.0 | `@girs/giounix-2.0` | Unix FDs, mount monitoring |
| Soup 3.0 | `@girs/soup-3.0` | HTTP client/server (fetch, http), WebSocket, cookies |
| GJS | `@girs/gjs` | Runtime info, GJS-specific APIs |

### Node→GNOME Mapping

```
fs.*          → Gio.File, Gio.FileInputStream, Gio.FileOutputStream
Buffer        → GLib.Bytes, GLib.ByteArray, Uint8Array
EventEmitter  → custom implementation (not GObject signals)
net.Socket    → Gio.SocketConnection, Gio.SocketClient
http          → Soup.Session, Soup.Server
crypto hashes → GLib.Checksum, GLib.Hmac
process.env   → GLib.getenv(), GLib.setenv()
url.URL       → GLib.Uri
```

## Reference Implementations (`refs/`)

Read-only git submodules — do NOT modify. Use GNOME libraries internally, not copied code.

| Path | Use |
|------|-----|
| `refs/node/` | Canonical Node.js behavior (the spec). Check `lib/<name>.js` |
| `refs/deno/` | TypeScript reference, closest to gjsify's use case |
| `refs/bun/` | Alternative TS/Zig implementation |
| `refs/gjs/` | GJS internals: `modules/` (built-in JS), `gjs/` (C++ runtime), `gi/` (GObject Introspection) |
| `refs/node-fetch/` | Reference for `@gjsify/fetch` |
| `refs/fetch-ie8/` | Minimal fetch polyfill internals |
| `refs/stream-http/` | HTTP via Node.js streams — reference for `@gjsify/http` |
| `refs/headless-gl/` | Headless WebGL — reference for `packages/web/webgl/` |
| `refs/troll/` | GJS utility patterns (Sonny Piers) |
| `refs/crypto-browserify/` | Pure-JS crypto orchestrator — wires together the sub-packages below for `@gjsify/crypto` |
| `refs/browserify-cipher/` | AES cipher/decipher (createCipher, createCipheriv, getCiphers) — dep of crypto-browserify |
| `refs/browserify-sign/` | Sign/Verify (createSign, createVerify) + algo list — dep of crypto-browserify |
| `refs/create-ecdh/` | ECDH key exchange (createECDH) — dep of crypto-browserify |
| `refs/create-hash/` | Hash streaming (createHash, MD5/SHA) — dep of crypto-browserify |
| `refs/create-hmac/` | HMAC streaming (createHmac) — dep of crypto-browserify |
| `refs/diffie-hellman/` | DH key agreement (createDiffieHellman, getDiffieHellman) — dep of crypto-browserify |
| `refs/hash-base/` | Base class for streaming hash transforms — dep of create-hash/create-hmac |
| `refs/pbkdf2/` | PBKDF2 key derivation (pbkdf2, pbkdf2Sync) — dep of crypto-browserify |
| `refs/public-encrypt/` | RSA encrypt/decrypt (publicEncrypt, privateDecrypt) — dep of crypto-browserify |
| `refs/randombytes/` | Random byte generation (randomBytes) — dep of crypto-browserify |
| `refs/randomfill/` | Random buffer filling (randomFill, randomFillSync) — dep of crypto-browserify |
| `refs/readable-stream/` | Maintained Node.js stream polyfill — reference for edge cases |
| `refs/undici/` | Official Node.js HTTP client — reference for `@gjsify/http` client-side |

## Official Node.js npm Packages

Some Node.js core modules are published as standalone npm packages (pure JS, browser-compatible). Because our esbuild bundler aliases `buffer` → `@gjsify/buffer`, `events` → `@gjsify/events`, etc., these packages can work in GJS builds without modification — the bundler injects our GJS-compatible implementations.

**Usable as direct dependencies (instead of reimplementing):**

| npm Package | Published By | Can Replace | Notes |
|-------------|-------------|-------------|-------|
| `readable-stream` (v4) | nodejs-foundation | `@gjsify/stream` | Official Node.js streams for userland. Deps: buffer, events, process, string_decoder — all aliased to @gjsify/* |
| `string_decoder` (v1.3) | nodejs-foundation | `@gjsify/string_decoder` | Official. Dep: safe-buffer → buffer (aliased) |

**Useful as references only (need native APIs we don't have yet):**

| npm Package | Why Reference-Only |
|-------------|-------------------|
| `undici` (v7) | HTTP client — uses net, tls, crypto internally. Useful after Phase 2 networking is done |

**Decision guideline:** Prefer reimplementing in TypeScript over depending on npm packages. Third-party npm packages cause problems in GJS because:
1. They use legacy patterns (`Transform.call(this)`, `inherits()`) incompatible with ES6 classes in SpiderMonkey
2. They reference globals like `Buffer` or `process` that aren't available at module load time in GJS
3. Circular dependencies arise when the bundler aliases `crypto`/`stream`/`buffer` back to our implementations
4. The `"browser"` field in package.json may not be respected by the bundler depending on `mainFields` config

Use npm packages only as **references** (read the source, understand the algorithm, rewrite in TypeScript). Use `refs/` submodules for the same purpose. The resulting TypeScript implementation should use our own modules (`@gjsify/stream`, `@gjsify/buffer`, etc.) directly via imports, not through bundler aliases.

## Native Extensions (Vala)

For low-level system access without GIR bindings. Vala → Meson → shared library + GIR typelib → `gi://` import.

Example: `packages/web/webgl/` — WebGL via Vala + Meson. Prefer TypeScript; use Vala only when C-level access is required.

## Testing

### Framework: `@gjsify/unit` (`packages/gjs/unit/`)

```typescript
import { describe, it, expect, on } from '@gjsify/unit';

export default async () => {
  await describe('module.function', async () => {
    await it('should do X', async () => {
      expect(result).toBe(expected);
    });
  });
  await on('Gjs', async () => { /* GJS-only test */ });
  await on('Node.js', async () => { /* Node-only test */ });
};
```

Matchers: `toBe`, `toEqual`, `toBeTruthy`, `toBeFalsy`, `toBeNull`, `toBeDefined`, `toBeUndefined`, `toBeLessThan`, `toBeGreaterThan`, `toContain`, `toMatch`, `toThrow` + `.not` negation.

### Test Rules

1. Import from **bare specifiers** (`from 'assert'`), never relative paths (`'./index.ts'`). Bundler resolves per platform.
2. Node.js tests validate **test correctness** against the reference. GJS tests validate **our implementation**. Both must pass.
3. No GJS-specific code (`@girs/*`, Soup, Gio) in test files — the bundler handles platform separation.
4. File layout: `src/index.ts` (impl), `src/*.spec.ts` (specs), `src/test.mts` (entry point).

## Package Convention

Each `packages/node/<name>/`:
- `package.json`: `@gjsify/<name>`, v0.0.4, `"type": "module"`
- Exports: `./lib/esm/index.js` (import) — ESM-only, kein CJS
- Scripts: `build:gjsify`, `build:types`, `build:test:gjs`, `build:test:node`, `test`, `test:gjs`, `test:node`
- Deps: `@girs/*` (implementation), `@gjsify/unit` (devDep)

## Implementation Workflow

When extending or improving a Node.js API implementation:

1. Study the Node.js API surface: `refs/node/lib/<name>.js`
2. Consult references: `refs/deno/`, `refs/bun/`
3. Implement using GNOME libraries (`@girs/*`), check types in `node_modules/@girs/`
4. Write tests in `*.spec.ts` using `@gjsify/unit`
5. Verify: `yarn test:node` first (reference correctness), then `yarn test:gjs` (our impl)

## Type Safety

- **Import Node.js types** from `node:*` modules, don't redefine: `import type { ReadableOptions } from 'node:stream'`
- Global types (`BufferEncoding`, `NodeJS.Platform`) from `@types/node` are auto-available
- Use `unknown` over `any`; keep `any` only where Node.js API requires it
- Use `as unknown as T` instead of `as any` for unrelated type casts
- Type error callbacks as `NodeJS.ErrnoException | null`
- Validate with `yarn check` (`tsc --noEmit`)

## Constraints

- Target: GJS 1.86.0 / SpiderMonkey 128 (ES2024) / esbuild `firefox128`
- ESM-only — kein CJS-Support, alle Pakete sind ausschließlich ESM
- No Deno APIs — GNOME libs + standard JS only
- Tests must pass on both Node.js and GJS from same source
- Do not modify `refs/` — read-only submodules

## SpiderMonkey 128 — JS Feature Availability

**Available (ES2024):** `Object.groupBy`, `Map.groupBy`, `Promise.withResolvers`, `Set` methods (intersection, union, difference, symmetricDifference, isSubsetOf, isSupersetOf, isDisjointFrom), `Array.fromAsync`, `structuredClone`, `SharedArrayBuffer`, `Intl.Segmenter`, `globalThis`, `??`, `?.`, `??=`, `||=`, `&&=`, top-level `await`, private/static class fields, `WeakRef`, `FinalizationRegistry`.

**NOT available (V8-only, never in SpiderMonkey):**
- `Error.captureStackTrace` — guard: `if (typeof Error.captureStackTrace === 'function')`
- `Error.stackTraceLimit` — guard with typeof check
- Polyfill: `packages/gjs/utils/src/error.ts`
