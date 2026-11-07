# 134. HTTPS trusts the OS store on every target, through `@gjsify/tls-trust`

- Status: **Accepted**
- Date: 2026-11-03
- Deciders: Pascal Garber
- Depends on: [ADR 0117 (Android GI namespaces are selected at build time)](0117-android-gi-namespaces-are-selected-at-build-time.md)
  § 3 — this ADR closes its "OPEN, for the owner: the Android CA store", and its stage 2 is
  where the Android half lands;
  [ADR 0037 (GTK runtime bundles carry the URI source)](0037-gtk-runtime-bundles-carry-the-uri-source.md)
  § Consequences — "the bundles ship the TLS implementation, not the trust anchors"
- Recorded owner decisions (2026-11-03): the Android TLS backend is **OpenSSL**; a gjsify app
  trusts **what the OS trusts** by default; a Mozilla bundle is an **opt-in**

## Context

Which roots a gjsify app trusts today depends on where it runs, and nothing in the code says so:

- **GJS on Linux** verifies through glib-networking's default `GTlsDatabase`
  (`packages/node/tls/src/verify.ts`, `chainFlags()`), which reaches the distro store through
  gnutls and p11-kit. That works because the distro built p11-kit for its own prefix.
- **The darwin and win32 GTK bundles** ship gnutls or OpenSSL, but no anchors. ADR 0037 measured
  a green suite over an empty trust store on Linux and left the darwin and win32 answer to their
  CI legs, which check only that `get_default_database()` is non-NULL.
- **Android via node-gi** has no glib-networking yet (ADR 0117 § 4). When it does, OpenSSL's
  compiled-in `OPENSSLDIR` points into the sysroot's build prefix, which does not exist on a
  device. TLS would reject every certificate, or trust whatever someone puts at that path.
- **Node**, where `@gjsify/*` tests also run, uses its bundled Mozilla list by default, and the
  OS store only with `--use-system-ca`.
- `@gjsify/tls` exports `rootCertificates` as `[]` (`packages/node/tls/src/index.ts`) and has
  neither `getCACertificates()` nor `setDefaultCACertificates()`. Code ported from Node that
  reads the list gets an empty one.

So the same `fetch('https://…')` can work on one target, fail on another, and trust a different
set of roots on a third. The owner's requirement is the opposite: **one behaviour on every OS,
through one package, built on an existing standard rather than a gjsify invention.**

## Decision

### 1. The vocabulary is Node's, not ours

Node already standardised how a JavaScript runtime names its trust stores
(`tls.getCACertificates(type)`, verified on Node 24.19: `bundled` 120 roots, `system` 363 on
this Fedora host):

| type | meaning |
|---|---|
| `system` | the OS store |
| `bundled` | a shipped Mozilla list (Node: NSS `certdata.txt`) |
| `extra` | `NODE_EXTRA_CA_CERTS` |
| `default` | what a connection without `ca` verifies against |

Certificates are PEM strings (RFC 7468), and `tls.setDefaultCACertificates(certs)` replaces
`default`. `@gjsify/tls-trust` implements exactly this surface. `@gjsify/tls` re-exports it as
`getCACertificates`, `setDefaultCACertificates` and `rootCertificates` (`bundled`, as in Node),
so ported code finds the API where Node has it. There is no second gjsify-specific API.

### 2. `default` is `system + extra`, on every target

That is Node's `--use-system-ca` behaviour, made the default. The reasons:

- an enterprise or admin-installed root works the way it works in every other app on the machine;
- the OS vendor maintains revocations and removals, so we are not a trust-root operator;
- there are zero bytes to ship.

`bundled` replaces `system` only when the app asks for it (§ 4). The Node test leg runs with
`--use-system-ca` so the three runtimes agree.

### 3. One mechanism: resolve the set, then install it as Gio's default database

Each backend gets its anchors through the same path:

1. `@gjsify/tls-trust` resolves `default` to a PEM list, using the per-target `system` source
   below.
2. Where the backend's own default database is not already that set, the package writes the set
   to one PEM file in the app's cache directory and installs `Gio.TlsFileDatabase.new(file)` as
   the default with `Gio.TlsBackend.set_default_database()` (GLib ≥ 2.60).
3. Gio-side verification stays unchanged (`verify.ts` keeps asking `get_default_database()`), so
   `@gjsify/fetch`, `tls`, `http2`, `ws` and libsoup all inherit the result.

Where the `system` source is per target:

| target | `system` source | the backend default must be replaced? |
|---|---|---|
| GJS, Linux | glib-networking's default database (distro p11-kit / bundle file) | no; enumerate it for `getCACertificates('system')` |
| GTK bundle, darwin | the Keychain's trust settings | **to measure** (stage 2) |
| GTK bundle, win32 | the `ROOT` system store | **to measure** (stage 2) |
| NativeScript Android | `/system/etc/security/cacerts`, minus the user's disabled set in `/data/misc/user/0/cacerts-removed` | **yes**: OpenSSL's compiled-in dir does not exist on the device |
| NativeScript iOS, browser | the platform's own HTTP stack | out of scope: no GLib TLS runs there |

Android's user store (`/data/misc/user/0/cacerts-added`) is **not** part of `system`. Since API 24
an app's default network security config does not trust user CAs either, so this matches the
platform. An app that wants it (for example, debugging through `mitmproxy`) opts in explicitly
(§ 4). It is never trusted silently.

### 4. Opt-ins are declared, not ambient

- **`bundled`** comes from a separate data-only package, `@gjsify/tls-trust-mozilla`. It is
  generated from CCADB's list of Mozilla-included roots (MPL-2.0, the licence travels with it)
  and versioned by its source date. An app that never declares it ships zero bytes of it.
  Selecting it is an app-config field read at startup: `system`, `bundled` or `system+bundled`.
- **Android user CAs** use the same config field (`androidUserCAs: true`), never an env var.
- **`NODE_EXTRA_CA_CERTS`** is honoured on every target, as in Node.

### 5. The check is "a known root verifies", not "the store is non-empty"

ADR 0037's lower bound (`get_default_database()` non-NULL) stays, and one assertion runs on every
leg (Linux, darwin, win32, Node, S9): `getCACertificates('default')` contains ISRG Root X1. It is
identified by SHA-256 fingerprint (`96:BC:EC:06:…:08:C6`) and valid until 2035-06-04, so it is an
offline-stable fixture, present in both Node's `bundled` and this host's `system` set. A
locally signed chain must also verify against the default database once its root is passed to
`setDefaultCACertificates()`, and fail without it. Together the two assertions separate "a store
exists", "it holds the public web's roots" and "replacing it takes effect".

## Consequences

- One sentence describes HTTPS trust for every gjsify target, and Node-ported code that reads the
  CA list gets a real one.
- Android stage 2 (ADR 0117) needs no CA payload in the AAR. It needs a cache-dir write at
  startup, which costs cold start: **to measure** against ADR 0110's budget before stage 2
  merges.
- The darwin and win32 bundles may turn out to need the same "install a file database" step, with
  a Keychain or `ROOT`-store reader. If so, that is native code in a gjsify package and gets its
  own amendment with the measurement.
- `@gjsify/tls`'s `rootCertificates` stops being `[]`. That is a visible change for anyone who
  tested against the empty array, and it is the bug this ADR fixes.

## What this does NOT decide

- **Revocation** (OCSP, CRL, CRLite). The gap in `status/open-todos/runtime-apis.md` § TLS gaps
  stays open.
- **Certificate pinning** and per-host trust. That stays `tls.connect({ ca })`, as in Node.
- **JNI `X509TrustManagerExtensions`.** It is the most correct Android source (it is what Java
  HTTP clients get, including the network security config), and it is § 3's eventual replacement
  for the directory read. It waits until the directory read is measured to be insufficient.
- **iOS and the browser**, which do not run GLib TLS.

## Implementation

1. **`@gjsify/tls-trust` with the Linux and Node legs.** Ship the API from § 1 and re-export it
   from `@gjsify/tls`. Run § 5's test on Linux GJS and Node (`--use-system-ca`). No backend
   replacement is needed yet.
2. **Android**, together with ADR 0117 stage 2 (glib-networking plus OpenSSL in the sysroot):
   read the `cacerts` dir, install the file database, run § 5 on the S9 and measure cold start.
3. **darwin / win32**: run § 5 on the bundle legs. A red result there reopens § 3's table for
   that row.
4. **`@gjsify/tls-trust-mozilla`** with a scheduled regeneration job from CCADB, when the first
   app asks for `bundled`.
