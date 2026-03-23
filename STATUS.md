# gjsify — Projektstatus

> Stand: 2026-03-23 (letzte Aktualisierung nach Wave 3)

## Zusammenfassung

gjsify implementiert Node.js- und Web-Standard-APIs für GJS (GNOME JavaScript / SpiderMonkey 128).
Das Projekt umfasst **39 Node.js-Pakete**, **7 Web-API-Pakete**, **3 GJS-Infrastrukturpakete** und **7 Build-Tools**.

| Kategorie | Gesamt | Voll | Partial | Stub |
|-----------|--------|------|---------|------|
| Node.js APIs | 39 | 25 (64%) | 6 (15%) | 8 (21%) |
| Web APIs | 7 | 7 (100%) | — | — |
| GJS-Infrastruktur | 3 | 2 | 1 (types) | — |
| Build-Tools | 7 | 7 | — | — |

**Testabdeckung:** ~1.900 Testfälle in 65+ Spec-Dateien. CI via GitHub Actions (Node.js 24.x + GJS auf Ubuntu 24.04).

---

## Node.js Pakete (`packages/node/`)

### Voll implementiert (25)

| Paket | GNOME Libs | Tests | Beschreibung |
|-------|-----------|-------|-------------|
| **assert** | — | 73 | AssertionError, deepEqual, throws, strict mode |
| **async_hooks** | — | 26 | AsyncLocalStorage, AsyncResource, createHook |
| **buffer** | — | 123 | Buffer via Blob/atob/btoa, alloc, from, concat |
| **child_process** | Gio, GLib | 26 | exec/execSync, execFile, spawn/spawnSync via Gio.Subprocess; cwd/env via Gio.SubprocessLauncher |
| **console** | — | 57 | Console-Klasse mit Stream-Support |
| **diagnostics_channel** | — | 26 | Channel, TracingChannel, subscribe/unsubscribe |
| **dns** | Gio, GLib | 50 (2 Specs) | lookup, resolve4/6, reverse via Gio.Resolver + dns/promises |
| **events** | — | 119 | EventEmitter, once, on, listenerCount (707 Zeilen) |
| **fs** | Gio, GLib | 40 (6 Specs) | sync, callback, promises, streams, FSWatcher |
| **module** | — | 21 | builtinModules, isBuiltin, createRequire |
| **net** | Gio, GLib | 35 | Socket (Duplex via Gio.SocketClient), Server (Gio.SocketService), isIP/isIPv4/isIPv6 |
| **os** | GLib | 240 | homedir, hostname, cpus (echte times aus /proc/stat), platform-spezifisch |
| **path** | — | 41 | POSIX + Win32 (1.052 Zeilen gesamt) |
| **perf_hooks** | — | 30 | performance (Web API / GLib Fallback), monitorEventLoopDelay, mark/measure/getEntries |
| **process** | GLib | 47 | EventEmitter-Basis, env, cwd, platform, exit |
| **querystring** | — | 63 | parse/stringify mit vollem Encoding |
| **require** | Gio, GLib | ✓ | CommonJS require() für GJS |
| **stream** | — | 66 | Readable, Writable, Duplex, Transform, PassThrough |
| **string_decoder** | — | 65 | UTF-8, Base64, hex, Streaming |
| **timers** | — | 43 (2 Specs) | setTimeout/setInterval/setImmediate + timers/promises |
| **tty** | — | 23 | ReadStream/WriteStream, isatty, ANSI, clearLine, cursorTo, getColorDepth |
| **url** | GLib | 82 | URL, URLSearchParams via GLib.Uri |
| **util** | — | 110 | inspect, format (%%, -0, BigInt, Symbol), promisify, types |
| **zlib** | — | 27 | gzip/deflate/deflateRaw Round-Trip, Konstanten, Unicode, Binary, Cross-Format-Fehler |
| **dgram** | Gio, GLib | 20 | UDP Socket via Gio.Socket mit bind, send, receive, multicast |

### Teilweise implementiert (6)

| Paket | GNOME Libs | Tests | Was funktioniert | Was fehlt |
|-------|-----------|-------|-----------------|-----------|
| **crypto** | GLib | 78 (6 Specs) | Hash, Hmac, randomBytes/UUID, PBKDF2, HKDF, **Cipher/Decipher (AES-CBC/CTR/ECB)**, **scrypt (RFC 7914)** | Sign/Verify, ECDH, DH, KeyObject, X509Certificate, AES-GCM |
| **globals** | — | 15 | setImmediate Polyfill | Vollständige globalThis-Konfiguration |
| **http** | Soup 3.0, Gio, GLib | 42 (2 Specs) | Server (Soup.Server), IncomingMessage, ServerResponse, STATUS_CODES, Agent, Round-Trip | Client-seitig: http.request(), http.get() noch unvollständig |
| **https** | — | ✓ | Agent-Stub | Vollständige Implementierung benötigt fertiges http |
| **readline** | — | 50 | Interface, createInterface, \r Line-Ending Support | Cursor-Navigation, History, Completion, Prompt |
| **tls** | Gio, GLib | ✓ | TLSSocket via Gio.TlsClientConnection, connect | createServer, TLS Session Resumption, ALPN |

### Stubs (8)

| Paket | Tests | Beschreibung | Aufwand |
|-------|-------|-------------|---------|
| **cluster** | ✓ | isPrimary, isMaster, isWorker; fork() wirft | Hoch — benötigt Multiprozess-Architektur |
| **domain** | ✓ | Deprecated Node.js API; pass-through | Niedrig — bewusst minimal |
| **http2** | ✓ | Nur constants exportiert; create* wirft | Hoch — HTTP/2-Protokoll komplex |
| **inspector** | ✓ | Session.post(), open/close; leer | Mittel — V8-spezifisch, schwer portierbar |
| **v8** | ✓ | getHeapStatistics (JSON-basiert), serialize/deserialize | Mittel — V8-spezifisch |
| **vm** | ✓ | runInThisContext (eval), Script-Klasse | Mittel — Sandbox-Isolation begrenzt |
| **worker_threads** | ✓ | isMainThread; Worker wirft | Hoch — GJS hat kein natives Threading-API |

---

## Web-API-Pakete (`packages/web/`)

Alle 7 Pakete haben echte Implementierungen:

| Paket | LOC | GNOME Libs | Tests | Web-APIs |
|-------|-----|-----------|-------|----------|
| **dom-events** | 1.323 | — | 97 | Event, EventTarget, CustomEvent, DOMException |
| **fetch** | 1.674 | Soup 3.0, Gio, GLib | 24 | fetch(), Request, Response, Headers, Referrer-Policy |
| **formdata** | 438 | — | ✓ | FormData, File, Multipart-Encoding |
| **abort-controller** | 291 | — | 19 | AbortController, AbortSignal (.abort, .timeout, .any) |
| **globals** | 14 | — | 1 | Re-Export von dom-events + abort-controller |
| **html-image-element** | 347 | GdkPixbuf | 2 | HTMLImageElement, Image() |
| **webgl** | 5.662 | gwebgl, Gtk 4, Gio | 12 | WebGLRenderingContext (1.0), Canvas, Extensions |

### Fehlende Web-APIs

Noch nicht implementiert (aber potenziell relevant für GJS-Projekte):

| API | Priorität | Hinweise |
|-----|----------|---------|
| **WebSocket** | Hoch | Soup 3.0 hat WebSocket-Support (Soup.WebsocketConnection) |
| **TextEncoder/TextDecoder** | Mittel | In GJS teilweise nativ vorhanden; Polyfill für Encoding-Varianten |
| **crypto.subtle (WebCrypto)** | Mittel | Teilweise über GLib.Checksum möglich |
| **URL/URLSearchParams (global)** | Niedrig | Existiert in @gjsify/url, fehlt als globaler Export |
| **Blob/File (global)** | Niedrig | In GJS teilweise nativ; globals-Paket könnte re-exportieren |
| **ReadableStream/WritableStream** | Niedrig | Web Streams API — Grundlage für fetch-Body |
| **structuredClone** | Niedrig | In SpiderMonkey 128 nativ verfügbar |
| **Performance (global)** | Niedrig | @gjsify/perf_hooks existiert; Web-Export fehlt |

---

## Build-Infrastruktur

| Paket | Funktion | Status |
|-------|---------|--------|
| **@gjsify/cli** | `gjsify build` CLI | Voll |
| **esbuild-plugin-gjsify** | Plattform-Orchestrierung (GJS/Node/Browser) | Voll |
| **esbuild-plugin-alias** | Modul-Alias-Auflösung | Voll |
| **esbuild-plugin-transform-ext** | Import-Extensionen normalisieren | Voll |
| **esbuild-plugin-deepkit** | Deepkit Type-Reflection | Voll |
| **resolve-npm** | Zentrale Alias-Registry (60+ Mappings) | Voll |
| **empty** | Stub-Modul für Plattform-Exclusion | Voll |

**GJS-Infrastruktur:**

| Paket | Funktion | Status |
|-------|---------|--------|
| **@gjsify/unit** | Test-Framework (describe/it/expect) | Voll |
| **@gjsify/utils** | Gio-Wrapper, Prozess-Info, Encoding | Voll |
| **@gjsify/types** | GIR TypeScript-Bindings | Manuell |

---

## GNOME-Bibliothek-Nutzung

| GNOME Lib | Verwendung in |
|-----------|--------------|
| **Gio 2.0** | fs, net, dns, child_process, dgram, tls, require, fetch |
| **GLib 2.0** | crypto, url, os, process, dns, child_process, dgram, tls, require |
| **Soup 3.0** | http, fetch |
| **Gtk 4.0** | webgl |
| **GdkPixbuf 2.0** | html-image-element |
| **gwebgl 0.1** | webgl (Vala-Extension) |

---

## Metriken

| Metrik | Wert |
|--------|------|
| Node.js-Pakete gesamt | 39 |
| Davon voll implementiert | 25 (64%) |
| Davon teilweise | 6 (15%) |
| Davon Stubs | 8 (21%) |
| Web-API-Pakete | 7 (alle implementiert) |
| Testfälle gesamt | ~1.900 |
| Spec-Dateien | 65+ |
| GNOME-integrierte Pakete | 13 (28%) |
| Alias-Mappings (GJS) | 60+ |
| Referenz-Submodule | 27 |

---

## Prioritäten / Nächste Schritte

### Hohe Priorität

1. **crypto vervollständigen** — ~~Cipher/Decipher (AES)~~✓, ~~scrypt~~✓. Noch offen: Sign/Verify, DH/ECDH, KeyObject, AES-GCM. Referenzen: `refs/browserify-sign/`, `refs/create-ecdh/`, `refs/diffie-hellman/`.
2. **http Client-Seite** — `http.request()`, `http.get()` vollständig via Soup.Session implementieren. Referenzen: `refs/undici/`, `refs/stream-http/`.
3. **https** — Aufbauend auf http + tls.
4. **WebSocket (Web-API)** — Soup.WebsocketConnection als Basis.

### Mittlere Priorität

5. **readline vervollständigen** — Cursor-Navigation, History, Tab-Completion.
6. **tls Server-Seite** — createServer, Session Resumption.
7. **Testabdeckung erhöhen** — Besonders für crypto, http, net, tls. Mehr Tests aus `refs/node-test/` und `refs/bun/test/` portieren.
8. **worker_threads** — Prüfen ob GJS-Threads oder GLib.Thread nutzbar sind.

### Niedrige Priorität

9. **vm** — Sandbox-Isolation über SpiderMonkey Realms (experimentell).
10. **v8** — Heap-Statistiken über GJS-Runtime-Info approximieren.
11. **cluster** — Multi-Prozess via Gio.Subprocess-Pool.
12. **http2** — Soup 3.0 unterstützt HTTP/2 teils nativ.
13. **inspector** — GJS Debugger-Integration (gjs --debugger).

---

## Changelog

### 2026-03-23 — Wave 6

**Crypto-Ausbau — Implementierung + Tests:**

| Paket | Komponente | Tests | Beschreibung |
|-------|-----------|-------|-------------|
| crypto | Cipher/Decipher | +25 | Pure-JS AES (FIPS-197): CBC, CTR, ECB; PKCS#7 Padding; NIST-Testvektoren |
| crypto | scrypt | +11 | RFC 7914 (Salsa20/8 + BlockMix + ROMix); Sync + Async; RFC-Testvektoren |

**Neue Implementierungen:**
- **cipher.ts:** Vollständige AES-128/192/256 Implementierung in reinem TypeScript. S-Box, InvS-Box, KeyExpansion, MixColumns, ShiftRows. Modi: CBC (mit IV-Chaining), CTR (Stream-Cipher), ECB (kein IV). PKCS#7 Padding mit setAutoPadding().
- **scrypt.ts:** RFC 7914 scrypt in reinem TypeScript. Nutzt Salsa20/8 Core, BlockMix, ROMix. Verwendet intern pbkdf2Sync (bereits vorhanden).

### 2026-03-23 — Wave 5

**Networking-Fundament — Tests + Implementierungs-Polish:**

| Paket | Vorher | Nachher | Schwerpunkte |
|-------|--------|---------|-------------|
| net | 8 | 35 | isIP/isIPv4/isIPv6 komplett, Socket/Server API, TCP echo/multi-connect (Node.js) |
| dgram | 10 | 20 | createSocket Optionen, bind, UDP send/receive Round-Trip (Node.js) |
| http | 24 | 42 (2 Specs) | STATUS_CODES/METHODS, Agent, Server Round-Trip (GET/POST/404/Headers, Node.js) |

### 2026-03-23 — Wave 4

**Test-Erweiterungen (Quick Wins für bereits implementierte Pakete):**

| Paket | Vorher | Nachher | Schwerpunkte |
|-------|--------|---------|-------------|
| dns | 3 | 50 (2 Specs) | Konstanten, lookup-Optionen (family/all), resolve4/6, reverse, dns/promises komplett |
| timers | 28 | 43 (2 Specs) | Ordering, negative Delays, nested Timers, refresh, setInterval mit AbortController |
| zlib | 15 | 27 | Unicode, Binary, große Daten, Konstanten, Cross-Format-Fehler, Gzip-Magic-Bytes |
| module | 14 | 21 | createRequire, builtinModules Validierung, isBuiltin mit Subpaths/Prefixes |
| tty | 14 | 23 | isatty mit verschiedenen fds, ReadStream/WriteStream Properties |
| perf_hooks | 18 | 30 | mark/measure/getEntries, clearMarks, toJSON, timeOrigin-Validierung |

### 2026-03-23 — Wave 1–3

**Neue Tests (Auswahl):**

| Paket | Vorher | Nachher | Quelle |
|-------|--------|---------|--------|
| crypto | 38 | 144 | +Hmac Specs, PBKDF2/HKDF-Tests |
| os | — | 240 | Umfangreiche Referenz-Tests portiert |
| util | 52 | 110 | format Edge Cases (%%, -0, BigInt, Symbol) |
| events | 60 | 119 | Erweiterte EventEmitter-Tests |
| buffer | 52 | 123 | Encoding, alloc, compare, slice |
| url | — | 82 | URL/URLSearchParams-Kompatibilitätstests |
| stream | 49 | 66 | Async Scheduling, Backpressure |
| console | — | 57 | Console.log/warn/error, Formatting |
| readline | 15 | 50 | Line-Endings, Interface-Events |
| child_process | 4 | 26 | cwd, env, encoding, spawnSync |
| diagnostics_channel | 8 | 26 | Channel, TracingChannel |
| module | 6 | 14 | builtinModules, isBuiltin |

**Implementierungs-Fixes:**

- **crypto:** GLib.Hmac durch pure-JS HMAC ersetzt (RFC 2104) wegen Segfault. PBKDF2 + HKDF nutzen die neue Hmac-Implementierung. 144 Tests auf beiden Plattformen grün.
- **child_process:** `cwd` und `env` Optionen via `Gio.SubprocessLauncher`; `spawnSync` mit encoding-Support.
- **readline:** `\r` als eigenständiges Line-Ending erkannt.
- **util.format:** `%%` Escape, `-0`, BigInt, Symbol, `%i` mit Infinity→NaN, remaining args ohne Quotes.
- **os.cpus:** Echte `times` aus `/proc/stat` (jiffies → ms) statt Nullen.

---

## Architektur-Übersicht

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Application                         │
├─────────────────────────────────────────────────────────────────┤
│  import 'fs'  │  import 'http'  │  import 'stream'  │  fetch() │
├───────────────┴─────────────────┴────────────────────┴──────────┤
│              esbuild + @gjsify/esbuild-plugin-gjsify            │
│         (aliased: fs → @gjsify/fs, http → @gjsify/http)        │
├─────────────────────────────────────────────────────────────────┤
│                    @gjsify/* Implementierungen                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ @gjsify/  │  │ @gjsify/  │  │ @gjsify/  │  │ @gjsify/fetch │  │
│  │ fs       │  │ http     │  │ stream   │  │               │  │
│  └────┬─────┘  └────┬─────┘  └──────────┘  └──────┬────────┘  │
│       │              │                              │           │
├───────┴──────────────┴──────────────────────────────┴───────────┤
│                     GNOME Libraries (GIR)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Gio 2.0  │  │ Soup 3.0 │  │ GLib 2.0 │  │ Gtk 4.0  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
├─────────────────────────────────────────────────────────────────┤
│              GJS (SpiderMonkey 128 / ES2024)                    │
└─────────────────────────────────────────────────────────────────┘
```
