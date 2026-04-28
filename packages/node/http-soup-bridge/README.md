# @gjsify/http-soup-bridge

Vala-based main-thread bridge for libsoup HTTP server. Used by
[`@gjsify/http`](../http/) to keep MCP / SSE / long-poll workloads stable on
GJS.

## Why this package exists

`@gjsify/http` is built on top of `Soup.Server` / `Soup.ServerMessage`. Two
GJS↔libsoup binding races make the server crash silently with
`gjs exited with code null` for any non-trivial workload that involves a
non-GJS HTTP client (MCP Inspector subprocess, browser EventSource, raw
`node -e fetch`):

1. **Boxed-Source GC race.** A JS wrapper around a libsoup-internal
   `GLib.Source` survives past the underlying source's lifetime. SpiderMonkey
   GC eventually finalises it (`g_timeout_add_seconds(10, …)` in
   `GjsContextPrivate::trigger_gc_if_needed`), the finalizer calls
   `g_source_unref` on a freed source, and `g_source_unref_internal:
   assertion 'old_ref > 0' failed` is followed immediately by SIGSEGV.

2. **Shared-`GMainContext` ref imbalance.** The thread-default `GMainContext`
   is shared between libsoup's `SoupMessageIOHTTP1.async_context`
   (`refs/libsoup/libsoup/server/http1/soup-server-message-io-http1.c:70,87`)
   and GJS's own `MainLoop::spin` (`refs/gjs/gjs/mainloop.cpp:28-29`). The
   libsoup C-side ref/unref pairs are correct; the imbalance comes from the
   GJS binding layer, where some Boxed wrapper retains a ref past the
   underlying object's lifetime. Surfaces as
   `g_main_context_unref: assertion 'g_atomic_int_get (&context->ref_count)
   > 0' failed`.

Both crashes have the same shape: a JS-visible refcounted libsoup boxed (or
something containing one) ends up at refcount zero on the C side while a JS
finalizer still believes it owns a reference.

The solution is to keep every libsoup boxed in C-space. This package
exposes three thin GObject classes from Vala — `Server`, `Request`,
`Response` — that own the underlying `Soup.Server` / `Soup.ServerMessage`
privately. JS callers only see the bridge classes plus signals dispatched
through `GLib.Idle.add()` to the main context, so SpiderMonkey GC can never
race a libsoup-side cleanup.

The same pattern is used in
[`@gjsify/webrtc-native`](../../web/webrtc-native/) for the equivalent
GstWebRTC threading problem.

## Implementation outline

* `src/vala/server.vala` — `Server` class wraps `Soup.Server`, emits
  `request_received(req, res)` / `upgrade(req, iostream, head)` signals.
* `src/vala/request.vala` — `Request` class wraps `Soup.ServerMessage`'s
  read side: method, url, headers, body, peer-close detection.
* `src/vala/response.vala` — `Response` class wraps the write side:
  `set_header`, `write_head`, `write_chunk`, `end`, plus the pause/unpause
  bookkeeping that previously lived in `@gjsify/http`'s
  `SoupMessageLifecycle.ts`.
* `src/vala/peer-close-watch.vala` — C-side helper that does
  `g_socket_create_source(IN | HUP | ERR)` + non-blocking
  `g_socket_receive(MSG_PEEK, 1)` to detect peer half-close on paused
  long-poll messages. (This is the capability we couldn't get from JS:
  `Gio.Socket.condition_check` doesn't expose `POLLRDHUP` and
  `Gio.Socket.receive_message(MSG_PEEK)` is not introspectable.)

## Build

```bash
yarn workspace @gjsify/http-soup-bridge run init:meson
yarn workspace @gjsify/http-soup-bridge run build:meson
yarn workspace @gjsify/http-soup-bridge run build:prebuilds
```

This produces `prebuilds/linux-x86_64/{libgjsifyhttpsoupbridge.so,
GjsifyHttpSoupBridge-1.0.gir, GjsifyHttpSoupBridge-1.0.typelib}`. The
`@gjsify/cli` runtime injects `LD_LIBRARY_PATH` and `GI_TYPELIB_PATH` from
the `gjsify.prebuilds` field at startup, so consumers don't need to install
the bridge into a system path.

The CI workflow at `.github/workflows/prebuilds.yml` builds prebuilds for
linux-x86_64, linux-aarch64, linux-ppc64, linux-s390x, and linux-riscv64
and auto-commits them to the repo. x86_64 and aarch64 use native GitHub
runners; ppc64, s390x, and riscv64 use QEMU via `uraimo/run-on-arch-action`.

## TS types

Until `@girs/gjsifyhttpsoupbridge-1.0` is published to npm, types are
generated locally from the freshly-built GIR via `ts-for-gir`:

```bash
npx @ts-for-gir/cli generate \
    --package --npmScope=@girs --outdir=node_modules \
    --girDirectories=packages/node/http-soup-bridge/build \
    GjsifyHttpSoupBridge-1.0
```

After publication this step disappears — the package's `dependencies`
already references `@girs/gjsifyhttpsoupbridge-1.0`.
