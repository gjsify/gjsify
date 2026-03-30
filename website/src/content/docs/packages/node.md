---
title: Node.js Modules
description: 40 Node.js API modules implemented for GJS using native GNOME libraries
---

40 Node.js API modules implemented for GJS using native GNOME libraries.

| Package | GNOME Libs | Status | Notes |
|---|---|---|---|
| `assert` | — | Full | AssertionError, deepEqual, throws, strict |
| `async_hooks` | — | Full | AsyncLocalStorage, AsyncResource, createHook |
| `buffer` | — | Full | Buffer via Blob/File/atob/btoa |
| `child_process` | Gio | Full | exec/execSync, spawn/spawnSync via Gio.Subprocess |
| `cluster` | — | Stub | isPrimary, isWorker |
| `console` | — | Full | Console with stream support |
| `crypto` | GLib | Partial | Hash (GLib.Checksum), Hmac (GLib.Hmac), randomBytes/UUID |
| `dgram` | Gio | Full | UDP via Gio.Socket |
| `diagnostics_channel` | — | Full | Channel, TracingChannel |
| `dns` | Gio | Full | lookup, resolve4/6, reverse via Gio.Resolver + promises |
| `domain` | — | Stub | Deprecated |
| `events` | — | Full | EventEmitter, once, on, listenerCount |
| `fs` | Gio | Full | sync, callback, promises, streams, FSWatcher |
| `globals` | GLib | Full | process, Buffer, structuredClone, TextEncoder/Decoder, URL |
| `http` | Soup 3.0 | Partial | Server (Soup.Server), IncomingMessage, ServerResponse |
| `http2` | — | Stub | constants only |
| `https` | — | Partial | Agent, stub request/get |
| `inspector` | — | Stub | Session stub |
| `module` | Gio, GLib | Full | builtinModules, isBuiltin, createRequire |
| `net` | Gio | Full | Socket (Gio.SocketClient), Server (Gio.SocketService) |
| `os` | GLib | Full | homedir, hostname, cpus |
| `path` | — | Full | POSIX + Win32 |
| `perf_hooks` | — | Full | performance (Web API / GLib fallback) |
| `process` | GLib | Full | extends EventEmitter, env, cwd, platform |
| `querystring` | — | Full | parse/stringify |
| `readline` | — | Full | Interface, createInterface, question, prompt |
| `stream` | — | Full | Readable, Writable, Duplex, Transform, PassThrough |
| `string_decoder` | — | Full | UTF-8, Base64, hex, streaming |
| `timers` | — | Full | setTimeout/setInterval/setImmediate + promises |
| `tls` | Gio | Partial | TLSSocket via Gio.TlsClientConnection |
| `tty` | — | Full | ReadStream/WriteStream, ANSI escapes |
| `url` | GLib | Full | URL, URLSearchParams via GLib.Uri |
| `util` | — | Full | inspect, format, promisify, types |
| `v8` | — | Stub | getHeapStatistics, serialize/deserialize (JSON) |
| `vm` | — | Stub | runInThisContext (eval), Script |
| `worker_threads` | — | Stub | isMainThread only |
| `zlib` | — | Full | gzip/deflate via Web Compression API, Gio fallback |
