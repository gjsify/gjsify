---
title: Node.js Modules
description: 42 Node.js API modules implemented for GJS using native GNOME libraries
---

42 Node.js API modules (plus `@gjsify/node-polyfills` meta) implemented for GJS using native GNOME libraries.

| Package | GNOME Libs | Status | Notes |
|---|---|---|---|
| `assert` | — | Full | AssertionError, deepEqual, throws, strict |
| `async_hooks` | — | Full | AsyncLocalStorage, AsyncResource, createHook |
| `buffer` | — | Full | Buffer via Blob/File/atob/btoa |
| `child_process` | Gio | Full | exec/execSync, spawn/spawnSync via Gio.Subprocess |
| `cluster` | — | Stub | isPrimary, isWorker |
| `console` | — | Full | Console with stream support |
| `constants` | — | Full | Flattened `os.constants` + `fs.constants` (deprecated Node alias) |
| `crypto` | GLib | Full | Hash / Hmac / PBKDF2 / HKDF / scrypt / AES / DH / ECDH / Sign / Verify / KeyObject / X509 |
| `dgram` | Gio | Full | UDP via Gio.Socket |
| `diagnostics_channel` | — | Full | Channel, TracingChannel |
| `dns` | Gio | Full | lookup, resolve4/6, reverse via Gio.Resolver + promises |
| `domain` | — | Stub | Deprecated |
| `events` | — | Full | EventEmitter (prototype methods enumerable for socket.io v4) |
| `fs` | Gio | Full | sync/callback/promises/streams/FSWatcher; URL path args everywhere |
| `globals` | GLib | Full | process, Buffer, structuredClone, TextEncoder/Decoder, URL, queueMicrotask |
| `http` | Soup 3.0 | Partial | Server (Soup.Server), IncomingMessage, ServerResponse, Agent |
| `http2` | — | Stub | constants only |
| `https` | — | Partial | Agent, stub request/get |
| `inspector` | — | Stub | Session stub |
| `module` | Gio, GLib | Full | builtinModules, isBuiltin, createRequire |
| `net` | Gio | Full | Socket (Gio.SocketClient), Server (Gio.SocketService) |
| `os` | GLib | Full | homedir, hostname, cpus |
| `path` | — | Full | POSIX + Win32 |
| `perf_hooks` | — | Full | performance (Web API / GLib fallback) |
| `process` | GLib | Full | extends EventEmitter, env, cwd, platform, nextTick |
| `querystring` | — | Full | parse/stringify |
| `readline` | — | Full | Interface, createInterface, question, prompt |
| `sqlite` | Gda 6.0 | Partial | DatabaseSync / StatementSync on libgda SQLite provider |
| `stream` | — | Full | Readable, Writable, Duplex, Transform, PassThrough |
| `string_decoder` | — | Full | UTF-8, Base64, hex, streaming |
| `sys` | — | Full | Deprecated alias for `util` |
| `timers` | — | Full | setTimeout/setInterval/setImmediate + promises (GLib-safe) |
| `tls` | Gio | Partial | TLSSocket via Gio.TlsClientConnection |
| `tty` | — | Full | ReadStream/WriteStream, ANSI escapes |
| `url` | GLib | Full | URL (static `createObjectURL`/`revokeObjectURL`), URLSearchParams via GLib.Uri |
| `util` | — | Full | inspect, format, promisify, types |
| `v8` | — | Stub | getHeapStatistics, serialize/deserialize (JSON) |
| `vm` | — | Partial | runInThisContext, runInNewContext, Script, compileFunction |
| `worker_threads` | Gio, GLib | Partial | MessageChannel/Port/BroadcastChannel, subprocess Worker — no SharedArrayBuffer |
| `ws` (npm) | Soup 3.0 | Partial | `ws`-compat WebSocket client + WebSocketServer over `@gjsify/websocket` |
| `zlib` | — | Full | gzip/deflate via Web Compression API, Gio fallback |

## Meta

| Package | Purpose |
|---|---|
| `@gjsify/node-polyfills` | Umbrella dep — pulls every Node polyfill so scaffolds resolve any `node:*` import out of the box |
