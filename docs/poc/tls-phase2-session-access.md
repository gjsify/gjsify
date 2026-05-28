# TLS Phase 2 — `gnutls_session_t` access from `Gio.TlsConnection`

> Status: **POC scaffold shipped** (v0.4.30, `@gjsify/tls-native` Phase 2).
> Real implementation **blocked** on the struct-layout question below.
> Tracked in STATUS.md "Open TODOs → Medium priority — TLS gaps".

## Problem statement

GnuTLS exposes session resumption and channel-binding APIs that
`Gio.TlsConnection` does not surface to JS:

| GnuTLS C call                       | Surfaced by Gio? | Needed by                                                    |
| ----------------------------------- | :--------------: | ------------------------------------------------------------ |
| `gnutls_session_get_data2`          |       no         | Node's `tlsSocket.getSession()` + `'session'` event          |
| `gnutls_session_set_data`           |       no         | Node's `tls.connect({session})` resumption                   |
| `gnutls_session_is_resumed`         |       no         | Node's `tlsSocket.isSessionReused()`                         |
| `gnutls_session_channel_binding`    |       no         | Node's `tlsSocket.getFinished()` / `getPeerFinished()` for SCRAM-SHA-* SASL |

All four take a `gnutls_session_t` handle that lives inside the
glib-networking GnuTLS backend (`_GTlsConnectionGnutlsPrivate`).
`Gio.TlsConnection` keeps it private — no GI accessor.

## The open question

What is the stable way to reach `gnutls_session_t` from a
`Gio.TlsConnection` GObject instance?

Two paths considered:

### Path A — GIO-private struct walk (preferred)

Walk the `GTypeInstance → private` offset for
`GTlsConnectionGnutls` and read the `session` field.

```c
// pseudocode for the eventual implementation in session-access.vala
//
// 1. Check the connection's actual type.
GType gnutls_type = g_type_from_name ("GTlsConnectionGnutlsBase");
if (!G_TYPE_CHECK_INSTANCE_TYPE (conn, gnutls_type)) {
    throw SessionAccessError.NOT_SUPPORTED ("non-GnuTLS backend");
}

// 2. Read the private struct.
gpointer priv = G_TYPE_INSTANCE_GET_PRIVATE (conn, gnutls_type,
                                             GTlsConnectionGnutlsBasePrivate);
gnutls_session_t session = ((GTlsConnectionGnutlsBasePrivate*) priv)->session;
return (void*) session;
```

**Blocker — struct layout source of truth.** This needs the EXACT
private struct definition from a known glib-networking commit.
`glib-networking/tls/gnutls/gtlsconnection-gnutls-base.c` defines it
and the layout changes across glib-networking releases (the `session`
field's offset has moved twice between 2.74 and 2.80). The struct
is intentionally NOT in any installed header — we'd be reading offsets
from a copy in `refs/glib-networking/`.

**Current worktree status**: no `refs/glib-networking/` submodule is
checked out. Adding it is a one-line submodule add but it requires
maintainer review (it's a 30 MB ref). Once it's there, the Path A
implementation is ~50 lines in `session-access.vala`:

1. Vendor the private struct layout for the supported glib-networking
   range (a single `private struct _GTlsConnectionGnutlsBasePrivate`
   declaration in a C shim header, gated by a runtime version check
   that compares `glib_check_version()` against the supported window).
2. Replace the body of `_resolve_native_session()` to do the
   `G_TYPE_CHECK_INSTANCE_TYPE` + private-struct-read dance.
3. The rest of `session-access.vala` (every method that throws today)
   already calls the right GnuTLS APIs — they pass the `void*` straight
   through to `gnutls_session_get_data2 / set_data / channel_binding /
   is_resumed`. No JS-side changes.

The JS-side surface already in `@gjsify/tls` (the `getFinished()` /
`getPeerFinished()` / `getSession()` / `setSession()` /
`isSessionReused()` methods + the `'session'` event + the
`{session}` option) is **wired but no-op'd today**: every call falls
through `hasTlsSessionAccess() === false` → returns
`undefined` / `false` (matching Node's behavior on a build without
session support). Flipping `is_supported()` to `true` flips every
consumer transparently — no API breakage.

### Path B — Upstream patch to glib-networking (long-term)

Add `g_tls_connection_get_native_session()` (or a new GnuTLS-specific
sub-interface like `GTlsConnectionGnutlsExtension`) so the
`gnutls_session_t` is a publicly accessible pointer with a documented
lifetime contract.

**Why it's not on the critical path**: any upstream patch would
realistically take 1–2 release cycles to ship + propagate to GNOME
Platform runtimes. Path A unblocks us today on every glib-networking
version we test against.

## Acceptance criteria for closing this POC

1. `refs/glib-networking/` submodule added.
2. `GTlsConnectionGnutlsBasePrivate` layout vendored as a C shim
   header, gated by version check against the supported window.
3. `session-access.vala`'s `_resolve_native_session()` returns a real
   `gnutls_session_t` pointer (no more throw).
4. `SessionAccess.is_supported()` returns `true` when the connection
   is a `GTlsConnectionGnutls*` instance AND the linked
   glib-networking version is in the supported range.
5. A real round-trip test in `tests/integration/tls-session/`:
   open conn 1 against a test TLS server → capture session via
   `'session'` event → close → open conn 2 with `{session}` → assert
   `isSessionReused() === true` and the handshake roundtrip count
   drops from 2 to 1.
6. A SCRAM-SHA-1 channel-binding test: assert
   `getFinished()` returns a non-empty `Buffer` on TLS 1.2,
   degrades to `tls-exporter` bytes on TLS 1.3.
7. Update STATUS.md "Open TODOs" — strike the Phase 2 entry, move to
   "Completed".
8. Update `CLAUDE.md`'s `tls-native` row — promote from "Scaffold" to
   "Full".

## Why the POC ships now (not later)

The Phase 2 surface in `@gjsify/tls` is wired up today so:

- Consumer libraries (https.Agent, pg-protocol's SCRAM-SHA-* path)
  can already call `getFinished()` / `getSession()` etc. and get the
  same `undefined` they'd see on a Node build without session
  support — graceful degradation works without an API gap.
- The day the Path A bits land, every consumer flips simultaneously
  without an API-shape migration.
- The `hasTlsSessionAccess()` predicate is the single switch
  consumers gate on; we don't need a per-method runtime fallback in
  every caller.

## Related references

- RFC 5077 — TLS Session Resumption (ticket-based).
- RFC 5929 — Channel Bindings for TLS (`tls-unique`, `tls-server-end-point`).
- RFC 9266 — Channel Bindings for TLS 1.3 (`tls-exporter`).
- GnuTLS Manual §3.6 (session resumption) + §3.7 (channel binding).
- glib-networking `tls/gnutls/gtlsconnection-gnutls-base.{c,h}`.
- Node.js `lib/_tls_wrap.js` (`TLSSocket.prototype.getFinished` etc.).
