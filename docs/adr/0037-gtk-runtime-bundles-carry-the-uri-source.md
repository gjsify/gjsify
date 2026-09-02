# 37. The GTK runtime bundles carry the http(s) source, and the TLS backend behind it

- Status: **Accepted**
- Date: 2026-09-02
- Deciders: Pascal Garber
- Related: [ADR 0017 (native package distribution)](0017-native-package-distribution.md),
  [ADR 0018 (the OS axis is a declared claim)](0018-os-axis-declaration.md),
  [ADR 0023 (which GTK a node-gi process uses)](0023-gtk-source-precedence.md),
  `packages/node-gi/scripts/gst-plugins.mjs` (the allowlist and its reasoning)

## Context

`@gjsify/gtk-runtime-darwin-{x64,arm64}` and `@gjsify/gtk-runtime-win32-x64` are the
batteries-included GTK runtimes a node-gi app installs on the two platforms where the
system has no GTK to borrow. They ship a curated slice of GStreamer, not the whole
plugin dir: Homebrew's `gstreamer` formula alone carries ~275 plugins whose closure is
most of a media distribution, and the darwin relocation gate refused it.

The curation rule is written in `gst-plugins.mjs` and is not in question here: **the
audio path, not everything the prefix has.** What was in question is where the audio
path begins.

Measured on the published bundles, on both platforms:

| | |
|---|---|
| `Gst.ElementFactory.make('playbin3' \| 'decodebin3' \| 'filesrc')` | an element |
| `Gst.ElementFactory.make('souphttpsrc')` | **null** |
| `Gio.tls_backend_get_default().supports_tls()` | **false** |

A desktop app playing a bundled podcast episode worked; the same app playing a live
radio stream found no source element. That is not a codec gap — `playback`, i.e.
`playbin3`/`uridecodebin3`, was already in the list, and those elements exist to take a
URI. The bundle advertised URI playback and could open exactly one scheme.

The second row is the part that would have been missed by fixing only the first.
`GTlsConnection` has no implementation inside GIO: glib-networking ships one as a module
that GIO `g_module_open`s out of one directory whose compiled-in default is the *build
machine's* prefix. The bundles ship their own `libgio` and shipped no module, so a
bundle-activated process answered every TLS request with the dummy backend — and
`souphttpsrc` reports that as `Internal data stream error`, a network error to read and a
missing module in fact. `@gjsify/tls`, `@gjsify/http2` and `@gjsify/ws` fail the same way
one layer up.

## Decision drivers

- **The list stays enumerable.** Its value is that somebody can read it and say what the
  bundle can do. "Everything the prefix has" fails silently in the other direction (a
  250-plugin closure the relocation gate refuses, plus a licensing choice made by a script
  that reads a directory).
- **A URI source is not "streaming".** The excluded category is encoders, video decode,
  capture, and streaming *sinks*, *servers* and adaptive-streaming demuxers — things a
  bundle would carry to *produce* or *republish* media. Reading one is the same operation
  as `filesrc`, which already ships.
- **The alternative exists and is worse for the common case.** A consumer can feed
  `appsrc` itself; the bundle already supports it and `@gjsify/webaudio` is built on it.
  But that means reimplementing HTTP in JS — redirects, chunked transfer, range requests,
  reconnect, ICY metadata — and it cannot use `playbin3`/`uridecodebin3` at all, because
  those take a URI, not a pad. For pushing bytes you already hold, `appsrc` remains the
  right answer and nothing here changes it.
- **Cost has to be a number, not a feeling — and it is a number PER PLATFORM.** Both
  columns below are file-set differences between the published `0.45.0` bundle and the
  widened artifact of the run that built this branch, not estimates.

  darwin-x64 (Homebrew `gstreamer` 1.28.5, `libsoup` 3.6.6, `glib-networking` 2.80.1):

  | | |
  |---|---|
  | `libgstsoup` | 122 KiB |
  | libsoup + libpsl + libnghttp2 + libsqlite3 | 2.02 MiB |
  | `libgiognutls` + gnutls, nettle, hogweed, gmp, p11-kit, libtasn1, libidn2, libunistring | 6.83 MiB |
  | `Soup-3.0.typelib` + the added licence texts | 411 KiB |
  | **total** | **9.36 MiB on a 72.7 MiB bundle (+13 %)** |

  win32-x64 (gvsbuild), and it is **not** the same order of magnitude — the number this
  ADR first carried was the darwin one, stated as if it were the cost:

  | | |
  |---|---|
  | `gstsoup.dll` + `Soup-3.0.typelib` + the two GIO modules | 199 KiB |
  | libsoup + libpsl + nghttp2 + sqlite3 | 3.62 MiB |
  | OpenSSL (`libcrypto-3-x64`, `libssl-3-x64`) — gvsbuild's TLS backend is `gioopenssl` | 8.21 MiB |
  | MIT Kerberos (`gssapi64`, `krb5_64`, `comerr64`, `k5sprt64`) — libsoup's Negotiate auth | 1.73 MiB |
  | **ICU (`icudt78` 31.6 MiB, `icuuc78`, `harfbuzz-icu`)** — pulled in by `psl-5.dll` | **34.04 MiB** |
  | **total** | **47.80 MiB on a 77.5 MiB bundle (+62 %)** |

  ICU alone is more than three times the entire darwin addition, and it arrives for one
  transitive reason: gvsbuild builds libpsl against ICU where Homebrew builds it against
  libidn2 + libunistring (2.2 MiB, already in the darwin column). Nothing about the
  DECISION needs ICU. Reducing it is a gvsbuild-side change — build libpsl with
  `-Druntime=libidn2`, or drop PSL from libsoup — and is follow-up work, not a blocker
  recorded as solved.

- **Licensing raises nothing new *in kind*, but "all LGPL" is not true.** The payload is
  mixed and the notice payload has to say so: LGPL-2.1+/LGPL-3+ (libsoup, glib-networking,
  gnutls, nettle, hogweed, gmp, libtasn1, libidn2, libunistring), **Apache-2.0** (OpenSSL 3
  on win32), **MIT** (libpsl, nghttp2, MIT Kerberos), BSD (p11-kit), Unicode/ICU, and
  public domain (SQLite). What matters for the allowlist is that none of it is the excluded
  category — x264, x265, faac and fdk-aac are kept out because redistributing a GPL- or
  patent-encumbered *codec* inside a runtime bundle is the product author's decision, not
  the runtime's. **No codec and no patent claim enters here**, and that part of the claim
  holds on both platforms.

## Decision

**Widen the allowlist by exactly one plugin — `soup` — and ship what it needs to work,
including over https.** Concretely:

1. `soup` joins `GST_AUDIO_PLUGINS`, in a group whose comment states it as *the other
   source*, alongside the file source that already ships.
2. Both builders ship the prefix's **GIO modules** (`lib/gio/modules`), relocated and
   verified like any other native payload, and node-gi points `GIO_MODULE_DIR` at them.
3. Neither libsoup nor the TLS module is reachable by a link walk — the plugin
   `g_module_open`s libsoup by leaf name on unix, and nothing links a GIO module at all —
   so both are **explicitly seeded**, the third instance of the shape librsvg established.
4. The TLS backend becomes a declared `tls-backend` runtime data set, so an empty module
   dir fails the build *and* `verify-bundle-manifest.mjs` before publish.
5. `GST_REQUIRED_PLUGINS` names the plugins whose absence is a build failure rather than a
   counted skip (`app`, `playback`, `soup`), and the builders check the set they actually
   copied.

## Consequences

- The bundles grow **+13 % on darwin and +62 % on win32**, and the asymmetry is the part
  to carry forward: the two platforms do not pay the same price for the same decision, so
  a single percentage stated without its platform is wrong on one of them. The allowlist
  entry that costs it points here rather than restating the table.
- **The win32 licence gate could not fail, and nine projects were behind it — not one.**
  `libcrypto-3-x64.dll` and `libssl-3-x64.dll` arrive with this decision (gvsbuild's TLS
  backend is `gioopenssl`) and Apache-2.0 § 4 requires the licence to travel with the
  binary. Chasing that one payload found the mechanism instead: the win32 step attributes
  by PREFIX and `assertLicenseCoverage` ran its per-binary rules only under `per-binary`
  attribution, so the win32 call asserted "at least one licence text was recovered" and
  nothing more — a corpus of one file would have passed it. Measured on this branch's own
  win32 artifact: **90 shipped binaries, 45 documented projects, and 14 binaries whose
  project the bundle documents nowhere** — `glib` (five DLLs, LGPL-2.1-or-later),
  `gobject-introspection`, `freetype`, `graphene`, `libtiff`, `libxml2`, `zlib`, `sqlite`
  and `openssl`. GLib has been unlicensed in every published win32 tarball; only OpenSSL
  and SQLite are new. Replaying that artifact through the old gate returns **0 problems**
  and through the new one **14**, each naming its binary — and the published `0.45.0`
  tarball, which carries neither new payload, returns **0** and **11**.

  Fixed in this ADR's own change, and the shape is deliberate. Per-binary attribution
  still is not recoverable from a flat build tree, so the shipped notice keeps saying so;
  what changed is that prefix attribution stopped being *unfalsifiable*.
  `WIN32_LICENSE_FAMILIES` declares which project each bundled leaf belongs to — a NAME
  map, never a statement of terms, so it cannot make a false licence claim and a leaf it
  does not know fails the build by name. `assertLicenseCoverage` refuses any binary whose
  family the corpus documents no text for, in **either** mode, and refuses prefix
  attribution offered without a family table at all. The binaries checked are now every
  binary the tarball carries, the GStreamer plugins, pixbuf loaders, GIO modules and the
  plugin-scanner executable included, as on darwin. Where gvsbuild documents nothing (it
  has no install step for some, and installs OpenSSL's as `LICENSE` while OpenSSL 3 ships
  `LICENSE.txt`), the text comes from the upstream release the prefix pins, vendored under
  the win32 builder's `licenses-not-in-prefix/` with its provenance — the prefix stays
  authoritative and is never overridden. `manifest.licenses.binariesCovered` records the
  count on both platforms, and `verify-bundle-manifest.mjs` refuses a bundle without it,
  so a tarball built by a pre-gate builder cannot publish either.

  **A name map cannot state wrong terms, but it can name the wrong project — and did.**
  The two failure modes the review found are the two the shape allows, and both are now
  held by a test rather than by care: a binary in NEITHER of the lists the builder
  assembled is never asked about at all (`gst-plugin-scanner.exe`, the bundle's one
  non-library binary, sat in `libexec/` outside both), and two leaves that look like one
  library can be two projects (`girepository-2.0-0.dll` is glib's since 2.80,
  `girepository-1.0-1.dll` is still gobject-introspection's own — matched by one pattern,
  the notice named glib as the project behind a gobject-introspection binary and shipped
  glib's text for it). Naming the wrong project is the worse half: it produces a positive,
  complete-looking claim. What bounds it is that the map only ever selects a text the
  corpus already holds, so the damage is a misattribution and never an invented licence.
- `Soup-3.0.typelib` now has a backing library in the bundle, so the typelib planner stops
  dropping it. `@gjsify/{tls,http2,ws}` gain a working TLS stack on a bundle-activated
  process as a consequence, not as a separate feature.
- The Windows build gains two gvsbuild projects (`glib-networking`, `libsoup3`) and a
  second gvsbuild invocation, because gst-plugins-good's `soup` feature is meson `auto`
  and *silently* produces no plugin when libsoup is absent from the prefix. The prefix
  assertion after the build now names `gstsoup.dll` instead of counting plugins.
- **The bundles ship the TLS implementation, not the trust anchors.** `supports_tls()` —
  the question decision 4's data set and the first version of the runtime gate both asked —
  answers for the module's PRESENCE, and is `true` on a bundle that rejects every
  certificate in existence. Measured on linux-x64 by bind-mounting an empty directory over
  p11-kit's module dirs: `gst-elements.test.mjs` passed in full at exit 0, and every
  handshake failed with `Unacceptable TLS certificate`. The anchors reach the shipped
  gnutls through the shipped libp11-kit (it is in the cost table above), which resolves its
  trust module out of a compiled-in directory — `/usr/share/p11-kit/modules`,
  `/etc/pkcs11/modules`, i.e. the BUILD prefix — and unlike GIO's module dir there is no env
  override to repoint it with: the entire `P11_KIT_*` surface is `DEBUG`, `NO_USER_CONFIG`,
  `STRICT` and `URI_LOWERCASE`. So decision 2's repair does not reach this layer, and
  decision 4's file-list check cannot see it either.
- **So the anchors are asked of the running backend, on the OS the bundle is for.**
  `gst-elements.test.mjs` asserts `g_tls_backend_get_default_database()` is non-NULL —
  glib-networking returns NULL exactly when the system trust holds zero certificates — and
  that file runs on the staged bundle in the darwin and win32 windowing jobs. It is a LOWER
  BOUND, deliberately: a non-empty database still does not say which roots are in it, and no
  offline check can. What it does settle is the difference between "a TLS backend loaded"
  and "TLS can succeed", which is the difference this ADR's second measured row is about one
  layer up. If it reports red on a platform, that bundle needs a trust payload of its own
  before it may claim https; the measurement above was taken on Linux, and the per-platform
  answer is the CI leg's to give, not this document's to predict.
- Widening again needs the same evidence this did: a measured user-visible gap, a measured
  closure cost, and a gate that fails when the payload is absent. The list is not a
  starting point that grows by argument.
