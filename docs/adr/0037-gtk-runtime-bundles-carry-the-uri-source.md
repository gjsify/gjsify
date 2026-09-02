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
- **Cost has to be a number, not a feeling.** Measured on darwin-x64 (Homebrew
  `gstreamer` 1.28.5, `libsoup` 3.6.6, `glib-networking` 2.80.1):

  | | |
  |---|---|
  | `libgstsoup` | 107 KiB |
  | libsoup + libpsl + libnghttp2 + libsqlite3 | ~2.8 MiB |
  | `libgiognutls` + gnutls, nettle, hogweed, gmp, p11-kit, libtasn1, libidn2, libunistring | 6.67 MiB |
  | **total** | **~9.6 MiB on an 85 MiB bundle (+13 %)** |

- **Licensing raises nothing new.** Everything added is LGPL-2.1+ / LGPL-3+ dynamically
  linked libraries of the same family as the GLib and GTK the bundle already relocates and
  attributes per binary. This is *not* the category the allowlist keeps out — x264, x265,
  faac and fdk-aac are excluded because redistributing a GPL- or patent-encumbered codec
  inside a runtime bundle is the product author's decision, not the runtime's. No codec and
  no patent claim enters here.

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

- The bundles grow ~13 %. That is the price of the capability and it is stated in the
  allowlist next to the entry that costs it.
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
