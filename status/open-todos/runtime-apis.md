<!-- Authored Open-TODO sections — area: Node.js runtime APIs.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### Two XMLHttpRequest implementations, and the docs name the wrong one as the only one

`@gjsify/xmlhttprequest` ships a class in `src/index.ts`. `@gjsify/fetch` ships another in
`src/xhr.ts` (11 269 bytes). `packages/infra/resolve-npm/lib/index.mjs` routes the SCOPED
name to the second one on gjs (`:536`) and to `@gjsify/empty` on node (`:714`), with a
comment at `:533` that says it outright — *"xmlhttprequest (implemented in @gjsify/fetch)"*.
So a bundled consumer of `@gjsify/xmlhttprequest` never reaches that package's own class; it
is reached only by an unbundled `lib/esm` import, which is what the published tarball offers.

Measured with a probe consumer while #1505 was written: the instance carries `upload`, which
exists only in `fetch/src/xhr.ts`.

`packages/web/AGENTS.md` said the opposite in both directions until this entry was filed —
*"**No XHR** — that lives in `@gjsify/xmlhttprequest`"* on the fetch row, while an 11 KB
`xhr.ts` sat in that package and the routing table one directory over named it. Two files in
one tree contradicting each other, and the reader following the AGENTS.md row lands in the
implementation no bundle uses. The rows are corrected; the DUPLICATION is not.

What is undecided, and why this is an entry rather than a fix: which class should survive.
#1505 gave `src/index.ts` its first spec and fixed two defects in it (a `responseType === ''`
that returned a FakeBlob instead of text, and WebIDL constants missing from the constructor),
neither of which was ever checked against `fetch/src/xhr.ts` — which declares the same
constants as module-level `export const`s and may or may not carry the same defect. Deleting
either class is a published-contract change (`@gjsify/xmlhttprequest` is tier 1), and merging
them is a decision about which package OWNS the API, not a refactor. Establish that first.



### `canPlayType` answers from a hardcoded list, and one of its answers is now known wrong

`@gjsify/webaudio`'s `HTMLAudioElement` carries `SUPPORTED_TYPES`, a hardcoded set of MIME types
commented as "GStreamer-supported (common on GNOME systems)". It includes `audio/aac` and
`audio/mp4`.

On a GNOME host that is usually true — `gst-libav` is installed and `avdec_aac` resolves. **In a
`@gjsify/gtk-runtime-*` bundle it is false**, and now measurably so: the audio payload carries no
AAC decoder at all, which #1544's amendment to ADR 0037 states as a declared gap
(`GST_FORMAT_GAPS`). So a shipped application asks `canPlayType('audio/aac')`, is told the format
is playable, and then fails at decode — the exact distance between a claim and a registry that the
plugin-gap work closed one layer down.

**Why it is not a one-line deletion.** Removing `audio/aac` makes the answer wrong in the other
direction on every ordinary GNOME desktop, which is the platform that file was written for. The
honest answer is to ask the registry — the same question `gst-elements.test.mjs` puts — rather than
to guess in either direction.

**What makes it awkward** is the direction of the dependency: the format table lives in
`packages/node-gi/scripts/gst-plugins.mjs`, and `@gjsify/webaudio` is Tier 1 while `@gjsify/node-gi`
is Tier 2, so it cannot import it. Either the table moves somewhere both may read, or webaudio asks
GStreamer directly (`Gst.ElementFactory` is already in reach through `gst-init.ts`) and the table
stays the BUILDER's declaration. The second is smaller and does not move a published contract.


### `@gjsify/sqlite` reads three value shapes back wrong

Found while adding the parameter-binding regression suite; all three are in the READ
path (`data-model-reader.ts` / libgda's data model), none of them in what gets bound, so
they were deliberately left out of the binding fix rather than bundled into it.

1. **An integral REAL past 2^53 throws instead of reading.** `convertValue()` treats any
   integral JS number over `Number.MAX_SAFE_INTEGER` as an out-of-range INTEGER and raises
   `OutOfRangeError`, but a SQLite REAL that happens to be integral — `1e21` — is not one.
   Telling them apart needs the column's storage class, which the reader never consults.
   Declared as `it.failing` in `param-binding.spec.ts`, so it retires itself when fixed.
   Node returns `1e21` here.

2. **A typeless column holding mixed types reads back as strings.** libgda types a data
   model column ONCE, so a column holding `'text'`, `42.0` and `NULL` comes back with the
   number as the string `"42.0"`. Node reads each value with its own storage class. The
   affected spec asserts `typeof(a)` per row instead, which is a homogeneous text column
   and therefore reads the same on both runtimes.

3. **`CAST(x AS TEXT)` yields an unconverted `Gda.Text` boxed value.** `convertValue()`
   has no branch for it, so it falls through and the caller gets `{}` instead of a string.

None of the three is reachable from `postbote`'s index today, which is why the binding fix
did not wait for them.


### Every callback-form `fs` entry point calls the callback from INSIDE its try

The shape, repeated across `callback.ts`, `fd-ops.ts` and `utimes.ts`:

```ts
Promise.resolve().then(() => {
    try {
        mkdirSync(path, options);
        callback(null);          // <- inside the try
    } catch (err) {
        callback(err);           // <- so a THROWING callback lands here
    }
});
```

A user callback that throws is therefore re-entered immediately with its own
exception as the `err` argument — one call the caller never made, and the second
one looks to them like the operation failed. Node calls the callback once.

Found while closing #1046: the new `mkdtemp` copied the pattern, and its K-19 case
(`calls` must be 1) is what exposed it. `mkdtemp` now computes inside the try and
calls outside it; the siblings are unchanged, because it is a behavioural change to
~10 entry points and belongs in its own measured pass rather than riding an
unrelated PR.

Whoever takes it: the repair is mechanical, but the ASSERTION is the interesting
half — the test has to prove the callback is entered exactly once, which means
letting it throw. On the GJS leg that surfaces as an "Unhandled promise rejection"
warning, so a suite that treats warnings as failures cannot express this rule.


### `fs.cp` and `fs.rm` were measured beside #1046 and deliberately left alone

Both came up while closing #1046's four divergences and neither belongs in that
change. The numbers are here so the next reader does not re-measure them, and so
nobody "fixes" `cp` by copying `copyFile`'s new set-ID mask into it.

**`cp` is already right, and Node is inconsistent with itself.** Measured on node
v24.15.0, source mode 4755:

| call | destination | result |
|---|---|---|
| `copyFileSync` | absent or present | `0755` — set-user-ID and set-group-ID dropped |
| `cpSync(file, file)` | absent | `4755` — KEPT |
| `cpSync(file, file)` | present | `0755` |
| `cpSync(dir, dir, {recursive:true})` | either | `0755` for every file inside |

So `cp` preserves the bits exactly when the destination did not exist, and
`@gjsify/fs` — which lets `Gio.File.copy` reproduce the whole mode — already
matches that case. Masking in `cp.ts` would INTRODUCE a divergence rather than
close one. Reproducing the other two rows means teaching `cpOneSyncFile` whether
it is the top-level entry or a recursive descendant, which is a change to the
walk, not to a mask. It is also not the security shape `copyFile`'s was: an
existing destination means the file was already there.

**`fs.rm` with no callback CRASHES Node rather than validating.** Every other
callback entry point throws `ERR_INVALID_ARG_TYPE` synchronously (measured across
all of them while writing K-20); `fs.rm(path, {force:true})` returns and then dies
inside `node:internal/fs/rimraf:51` at `callback(err)`. `fs.close(fd)` is the only
one that is genuinely silent-and-fine, and K-16 pins it.

`@gjsify/fs` therefore leaves `rm` unvalidated too — matching Node — which means a
missing callback there is still an unhandled rejection GJS cannot report. Adding
`requireCallback` to it would be strictly better behaviour and a deliberate
divergence from the reference; that is a decision, not a bug fix, so it is not in
#1046's PR. Nothing can depend on the crash, so the decision is cheap whenever
someone wants to take it.


### `@gjsify/http2` lazy native-dispatcher loads still use a bare `require`

Two sites load the optional native HTTP/2 dispatcher through a bare `require(...)` from ESM source — `src/client-session.ts` (`_setupNativeClient`, reached from `connect()`) and `src/server/http2-server.ts` (`_startNativeListen`, reached from `listen()`). This is the class documented in AGENTS.md § CJS-ESM Interop → "Our source is ESM": the call resolves at build time inside a bundle and is a `ReferenceError` from the unbundled `lib/` we publish. Neither obvious fix applies as-is:

- a **static import** would pull `native-{client-,}dispatcher`'s static `gi://GLib` / `gi://Gio` / `@gjsify/http2-native` imports into EVERY http2 consumer, defeating the optional-native-package design;
- **`await import()`** (the ESM way to lazy-load) requires making both call paths async, i.e. changing `connect()` / `listen()` — and Node's `listen()` contract is synchronous.

So it needs a real design decision inside `@gjsify/http2` (e.g. resolving the dispatcher during an already-async phase, or an explicit async opt-in), not a lint fix. Both sites carry an `oxlint-disable-next-line typescript/no-require-imports` with the reason inline; they are the only sanctioned disables of that rule in the tree.


### Two copies of the process-memory reader, and the `@gjsify/v8` node slot is why

`@gjsify/utils/core`'s `host-process` module and `@gjsify/v8`'s `heap/{linux,darwin,win32}.ts` read the same figures from the same sources with the same degraded contract (`ps(1)` has no data/peak column, so both report `0` there). The lift was made and REVERTED, and the reason is worth having written down before someone makes it again: routing v8's reads through `/core` removes the last `@girs/*` value import from that package, `audit-runtimes --check` then derives `runtimes.node: "native"` from the source signals instead of the declared `"none"`, and `Detect runtime-triplet drift` is one of the three checks that block a merge. Promoting the slot is a change to published ADR-0014 routing (a `native` slot sends the package root to `<pkg>/globals`, which `@gjsify/v8` does not ship), not a comment. So the question to answer FIRST is what `@gjsify/v8`'s node slot should be — `none` (this package does not serve Node) or `native` (Node has its own `node:v8`) — and the deduplication follows from it. Both files name the shared contract so it cannot drift silently in the meantime.


### `@gjsify/sqlite`'s GJS suite ABORTS the process, and the trigger is a GC window

Not a failing assertion — `SIGABRT`. Measured on darwin-x64 / gjs 1.88.1 / libgda 6.0, running `database-sync.spec.ts` alone under the real harness:

```
DatabaseSync.prototype.close()
GLib-GObject:ERROR:../gobject/gobject.c:6103:_weak_ref_set:
  assertion failed: (weak_ref_data_list_find (new_wrdata, weak_ref) < 0)
Bail out!   gjs exited with code null
```

It stayed invisible until the `/var` vs `/private/var` fix landed, because the node leg failed first and the `&&` chain never reached the gjs one.

**Ruled out, each by measurement rather than by reading:** bare libgda (`Gda.Connection.new_from_string` + `open()` + `close()`, nothing of ours in the process) does not abort · leaked connections plus an explicit `system.gc()` do not abort · the same operations driven through the real `DatabaseSync` API outside the harness do not abort · a specific test is not responsible, and neither is a leaked connection from the constructor block — the constructor validates (`parsePath`, `validateOptions`) BEFORE it opens, so a throwing construction never creates one.

**What the bisect says.** Keeping the first N `it()` rows of the constructor block and rebuilding: N=0 ok, **N=1 CRASH**, N=2 ok, N=3 ok, **N=11 CRASH**. Non-monotonic — the number of preceding rows perturbs *when* the collector runs relative to the libgda objects' lifetimes, and nothing more. That is the signature of a GC window in the interaction between GJS's object-wrapper machinery (toggle refs / `GWeakRef`) and libgda's objects, not of a condition in our code. It is therefore NOT fixable by editing a spec, and a fix that appeared to work by adding or removing a test row would be luck.

Next step is instrumentation, not more bisecting: run under `GJS_DEBUG_ALL`/`G_DEBUG=fatal-warnings` with a breakpoint on `_weak_ref_set` to see which object is being re-registered, and whether the second registration comes from GJS's wrapper or from libgda. If it is GJS's, this joins the libgda row already in `upstream-patch-candidates.md`; if it is ours, the owner is `DatabaseSync`'s lifecycle. Until then there is no workaround to maintain, which is why this is here and not in that table.


### child_process instant-exit pid — upstream GIO gap (issue #503; rewrite scoped + rejected)

`@gjsify/child_process`'s `spawn()`/`exec` read `child.pid` from `Gio.Subprocess.get_identifier()`, which returns `null` once GSubprocess's child-watch (GLib worker-thread context) reaps the child — so an instant-exit child on a saturated runner can lose its pid (Node always reports one). **Resolved at the test layer** (deterministic alive-when-checked process) + **documented as an upstream GIO limitation** (see Upstream GJS Patch Candidates). The `GLib.spawn_async_with_pipes_and_fds` + `DO_NOT_REAP_CHILD` rewrite was scoped and **rejected for now**: it regresses `child.kill()` to a `/bin/kill` shell-out and reimplements env/cwd/stdio/wait-status reaping on a critical path. Revisit IF: (a) a real consumer needs a reliable pid for instant-exit children, or (b) upstream GIO exposes a spawn-time pid. **Filed upstream: [GNOME/glib#3981](https://gitlab.gnome.org/GNOME/glib/-/work_items/3981)**; maintainer verdict: accessor "would be OK" but de-prioritised in favour of pidfds, so the deterministic alive-process test + spawn-time capture (`_capturePidAtSpawn`) is our stable, permanent posture, not a temporary workaround.


### The `process.exit()` guards are right, and five comments explain them wrongly

`packages/node/process`'s `exitProcess` is declared `never` and blocks in
`for (;;) context.iteration(true)` after idle-scheduling `system.exit(code)`
(`internal/exit.ts`), landed as `ba64356b6e fix(process): make process.exit() not
come back`. Before that it was genuinely deferred and RETURNED under GJS, and
several `return process.exit(…)` guards were written with that as their stated
reason.

The guards are still correct — `return` marks the end of control flow for the
reader and the type checker, and `run.ts` additionally propagates through
`process.exitCode` because `gjsify run <script>` dispatches a nested
`gjsify run <bundle>` IN PROCESS. What is stale is the REASON printed beside
them: `commands/run.ts:319,342,439,467`, `commands/test.ts:85,185` and
`utils/node-script.ts:81` still say a bare exit "falls through" or "is deferred".

Deliberately not swept in the PR that added the spawn-teardown gate: that PR
rewrote the two runners and left no stale premise in the code it touched, and a
comment sweep belonging to `ba64356b6e` does not belong in a review about spawn
routing. Each site needs its own sentence — the guards do not all stand for the
same reason — which is why this is a task and not a find-and-replace.


### `@gjsify/sqlite` exec() compound-statement (CREATE TRIGGER) splitting

`DatabaseSync.prototype.exec()`'s `#splitStatements()` is comment/quote-aware, but still a token-level scanner, not a parser — a compound statement whose body carries inner semicolons is shattered: `CREATE TRIGGER t … BEGIN INSERT …; … END;` splits at the `;` after the inner `INSERT`, yielding `incomplete input`. node:sqlite gets this right because SQLite's real parser knows `BEGIN…END`. **Clean fix = let libgda's own statement tokenizer do the splitting** — currently blocked because `Gda.SqlParser.parse_string()` used iteratively hits a double-free under GJS and `parse_string_as_batch()` returns `Gda.Batch` objects rather than `Gda.Statement`s. A heuristic port of SQLite's `sqlite3_complete()` state machine was considered and NOT taken (mis-handles `CASE…END;`, adds risk to the transaction `BEGIN; … COMMIT;` path). Revisit when the libgda `parse_string` limitation is resolved (then the hand-rolled splitter can be retired entirely).


### TLS gaps that Gio does not surface (Workstream B follow-up)

Server-side SNI, session resumption and channel binding are resolved (see the `@gjsify/tls`/`tls-native` status entries). Remaining gaps map to GnuTLS/OpenSSL features Gio's GI bindings do not expose:

- **OCSP stapling.** Neither client- nor server-side OCSP is exposed by Gio (`gnutls_ocsp_status_request_*` has no GI binding), so `tls.connect({requestOCSP})` / the `'OCSPResponse'` event cannot be implemented end-to-end without a native bridge wiring `request_ocsp_status` into `Gio.TlsConnection`. Partial unblocker shipped: `@gjsify/tls-native` Phase 1 `parseOcspResponse(bytes)` (RFC 6960 DER parser), surfaced via `@gjsify/tls` with the `hasOcspSupport()` graceful-degradation gate — consumers can fetch OCSP responses themselves (e.g. via the cert's AIA responder URL) and validate status without bypassing Gio's TLS stack. The Gio-side `request_ocsp` wiring (responses arriving automatically over the handshake) stays open.
- **DH params / explicit ECDH curves / ticket-key rotation.** Gio does not expose `g_tls_server_connection_set_dh_params` or equivalent. Server tuning happens via `GIO_USE_TLS=gnutls` env at process level; not per-connection.


### `@gjsify/https`'s Server does not terminate TLS

`https.createServer({ cert, key })` returns an `http.Server` that ignores the certificate and
listens in plain text (`packages/node/https/src/index.ts`), so on GJS no `https.Server` can
carry a `wss:` endpoint or serve HTTPS at all. The ws spec for TLS
(`packages/node/ws/src/wss-lifecycle.spec.ts`) attaches a TLS `Soup.Server` through ws's
`{ server }` mode on GJS for that reason, while its Node leg uses `https.createServer`. The
likely shape: hand the PEM pair to the http-soup-bridge's `Soup.Server` as `tls-certificate`
and listen with `Soup.ServerListenOptions.HTTPS`. Done when that spec uses
`https.createServer` on both legs.


### SharedArrayBuffer constructor opt-in (Mozilla pref)

- **`SharedArrayBuffer` constructor is unavailable in stock GJS** (`typeof SharedArrayBuffer` is `undefined` on GJS 1.88): Mozilla disables it unless the SpiderMonkey embedder opts in, and GJS does not. Upstream patch candidate: enable the SharedMemory pref in `gjs/engine.cpp` + the matching `Atomics.wait`/`notify` capability bits. Workaround landed: `@gjsify/sab-native`'s `SharedBuffer` (method-accessor API + free-function `atomics` namespace over memfd/mmap/futex) does not require the constructor at all and is wired into `Worker.postMessage`.
- **Generic `ArrayBuffer` cross-process transferList.** `Worker.postMessage(value, transferList)` for a plain `ArrayBuffer` (not a `SharedBuffer`) still goes through JSON IPC and stays a deep-clone, not a zero-copy hand-off — the SCM_RIGHTS side-channel only carries memfd-backed regions; arbitrary ArrayBuffers would need a generic binary IPC frame format (or a SharedBuffer-as-ArrayBuffer wrapper the structured-clone layer recognises). Lower priority — SharedBuffer covers the high-bandwidth workloads.

Use `@gjsify/worker_threads` `MessageChannel` (in-process) for zero-copy / pure-`ArrayBuffer` workloads today; cross-process SharedBuffer for shared-memory workloads across subprocess workers.


### Autobahn — wire into CI

Full Autobahn suite (core + permessage-deflate + performance 9.\*) is part of the committed baseline. Remaining: (1) the `6.4.x` NON-STRICT fragmented-text timing needs an upstream libsoup change (fragment-level UTF-8 validation — see Upstream GJS Patch Candidates); (2) Podman-in-CI needs privileged containers (or socket sharing) the Fedora-based CI doesn't currently grant — until then the suite is a manual opt-in run + baseline-commit workflow. Plan: wire the autobahn scripts into a nightly CI job once Podman-in-CI is unblocked.


### Autobahn driver — `System.exit()` bypass in bundled driver context

`System.exit(0)` called from the bundled driver's `Promise.then` continuation silently returns without terminating the gjs process (the GLib main loop `ensureMainLoop()` starts for Soup keeps the process alive after `main()` resolves), even though the same call works from a standalone script or a MainLoop idle callback. `scripts/run-driver.mjs` compensates with a watchdog (waits for the `Done.` marker, 3 s grace, then SIGKILL — no data loss; the report is flushed before `Done.`). Next steps to remove it: isolate whether the block is in `@gjsify/process`'s `exit()` shim, the `globalThis.imports` patching, or an interaction with `@gjsify/node-globals/register`; write a minimal reproducer outside the Autobahn pillar; fix root-cause and inline `gjs -m dist/driver-*.gjs.mjs` back into the package scripts.


### `@gjsify/sqlite` — expand API surface

Libgda does not expose session/changeset, WAL-mode toggles, backup or VFS APIs, so those are open gaps beyond the current DatabaseSync/StatementSync coverage. The closest paths: (a) wrap sqlite3 directly via libsqlite3 GI bindings (expensive — no upstream GIR), or (b) live with the libgda-shaped subset and document the gaps per API. (b) is the current direction; `sqlite.constants` (SQLITE_CHANGESET_\*) remains unimplemented until (a).

