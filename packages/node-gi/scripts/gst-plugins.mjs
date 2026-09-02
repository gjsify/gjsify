// SPDX-License-Identifier: MIT
// WHICH GStreamer plugins the runtime bundles ship — one rule, both platforms: the AUDIO PATH,
// not "everything the prefix has". Homebrew's `gstreamer` is base + good + bad + ugly + libav, so
// the plugin dir pulls in ffmpeg, aom, dav1d, x264, x265, faac, fdk-aac, libass, little-cms2 —
// and GTK+3, into a GTK4 runtime — around 250 plugins whose closure is most of a media
// distribution; the darwin relocation gate refused it. The audio path is enumerable instead of
// guessed: it is what `@gjsify/webaudio` runs on (decodebin over appsrc, convert/resample, out
// through the platform sink) PLUS THE SOURCE IT READS FROM — see `soup` below, which is the one
// place this list was measurably too narrow. Video decode, encoding of any kind, capture, and
// every streaming SINK, server or adaptive-streaming demuxer are out.
// It also keeps a licensing choice out of a script that reads a directory — x264, x265, faac and
// fdk-aac are GPL- or patent-encumbered, and redistributing them inside a runtime bundle belongs
// to whoever ships the product. The builders LOG every skip with its count; a plugin silently
// missing from the payload is the failure this area exists to prevent.

/**
 * Plugin base names (no `libgst` prefix, no extension) the bundles ship, grouped by the reason
 * each is here. Names are GStreamer's plugin names, identical on every platform — the builders
 * add the platform's prefix/suffix.
 */
export const GST_AUDIO_PLUGINS = [
    // The pipeline's skeleton: `coreelements` is queue/capsfilter/fakesink/tee, `app` is
    // appsrc + appsink — the JS boundary @gjsify/webaudio pushes encoded bytes into and pulls
    // PCM out of.
    'coreelements',
    'app',
    // What decodebin needs to work at all: typefind decides the format, playback provides
    // decodebin/uridecodebin itself.
    'typefindfunctions',
    'playback',
    // Parsers, then decoders, covering what a browser's decodeAudioData is expected to take:
    // WAV, MP3, AAC-in-M4A, Ogg/Vorbis, Opus, FLAC. `audioparsers` supplies the mp3/aac/flac
    // parsers decodebin autoplugs.
    'audioparsers',
    'wavparse',
    'isomp4',
    'ogg',
    'vorbis',
    'opus',
    'flac',
    'mpg123',
    'alaw',
    'mulaw',
    'auparse',
    'audioconvert',
    'audioresample',
    'audiorate',
    'audiomixer',
    'volume',
    'audiotestsrc',
    // THE OTHER SOURCE, and the one correction this list has needed. A pipeline reads from a file
    // or from a URL, and only the file half shipped: `filesrc` rides in on coreelements, while
    // `playback` — already above — IS playbin3/uridecodebin3, elements whose entire job is to take
    // a URI. So the bundles advertised URI playback and could open exactly one scheme. Measured on
    // the published darwin-x64 and win32-x64 bundles: `Gst.ElementFactory.make('souphttpsrc',
    // null)` returned null on both while playbin3, decodebin3 and filesrc all resolved — a desktop
    // app played its bundled episode and found no source element for its live stream, on the two
    // platforms where the bundle IS the runtime.
    //
    // It costs more than its 107 KiB, and NEITHER cost is reachable by a link walk, so both are
    // seeded explicitly — the shape librsvg already needed, for the same reason:
    //
    //   • libsoup. The plugin does not link it. Since 1.18 it g_module_opens
    //     `libsoup-3.0.0.dylib` / `soup-3.0-0.dll` by leaf name through its own loader shim, so
    //     `otool -L` reports glib + gstreamer and nothing else, and a closure walk seeded from the
    //     plugin finds no soup at all. Measured on darwin-x64: +2.8 MiB — libsoup 521 KiB, plus
    //     libpsl, libnghttp2 and libsqlite3, the last of which enters only because
    //     build-gtk-runtime-darwin.mjs § resolveBrewDep now follows a KEG-ONLY reference.
    //   • a GIO TLS backend. libsoup does https through `GTlsConnection`, whose implementation is
    //     a glib-networking MODULE that GIO g_module_opens out of its module dir — and the bundles
    //     ship their own libgio while shipping no module, so every TLS request in a
    //     bundle-activated process gets the dummy backend. Measured on darwin-x64 with the host
    //     module dir emptied: an https URL fails as `Internal data stream error` out of
    //     souphttpsrc, i.e. the http-only half of this widening would have shipped and looked
    //     finished. +6.67 MiB. It is a declared `tls-backend` data set in bundle-data.mjs, so its
    //     absence fails the build and the publish gate instead of the user's stream.
    //   • NOT the trust anchors, and that asymmetry is the one to remember: the two payloads above
    //     make https RESOLVE, not SUCCEED. The shipped gnutls reaches its roots through the
    //     shipped libp11-kit, which finds its trust module in a COMPILED-IN directory with no env
    //     override — so it cannot be repointed the way GIO_MODULE_DIR repoints the module above,
    //     and no file list can check it. gst-elements.test.mjs asks the running backend instead;
    //     ADR 0037 § Consequences carries the measurement.
    //
    // 9.36 MiB (+13 %) on darwin-x64 — and 47.8 MiB (+62 %) on win32-x64, which is NOT the same
    // decision costing the same thing twice: gvsbuild builds libpsl against ICU, so `icudt78.dll`
    // alone is 31.6 MiB. The per-platform table lives ONCE, in ADR 0037 § Decision drivers — this
    // line carried its own ~8 MiB before review, a figure taken before the keg-only lookup pulled
    // libsqlite3 into the closure, i.e. the second-copy drift this file's own header warns about.
    // Quote a percentage without its platform and it is wrong on the other one.
    //
    // No licensing question OF THE KIND THIS FILE'S HEADER KEEPS OUT — but the payload is mixed,
    // not the "all LGPL" this line first claimed: LGPL-2.1+/LGPL-3+ (libsoup, glib-networking,
    // gnutls and its closure), Apache-2.0 (OpenSSL 3, which is gvsbuild's TLS backend), MIT
    // (libpsl, nghttp2, MIT Kerberos), BSD (p11-kit), Unicode (ICU), public domain (SQLite). What
    // the header excludes is the CODEC question — x264, x265, faac, fdk-aac — and none of that
    // enters here: no codec, no patent claim, nothing whose redistribution is the product author's
    // call rather than ours. See ADR 0037 § Consequences for the OpenSSL licence text that is
    // currently NOT shipped on win32.
    'soup',
    // Output. `autodetect` is autoaudiosink, which picks the platform sink below.
    'autodetect',
    'osxaudio', // darwin
    'wasapi2', // win32 (modern); `directsound` remains as the fallback
    'directsound',
];

/**
 * `true` when this plugin file belongs in the bundle.
 *
 * The `lib` prefix is OPTIONAL, and getting that wrong shipped an empty bundle: GStreamer names a
 * plugin `libgstcoreelements.dylib` on darwin and `gstcoreelements.dll` on Windows, so a `^libgst`
 * strip left the Windows leaf as `gstcoreelements`, matched nothing and skipped ALL 83 plugins —
 * green, because the typelib symmetry gate checks typelib against LIBRARY and knows nothing about
 * plugins.
 */
export function isBundledGstPlugin(fileName) {
    const base = gstPluginBaseName(fileName);
    return GST_AUDIO_PLUGINS.includes(base);
}

/** The list above's spelling of a plugin file: no `libgst`/`gst` prefix, no extension, lowercase. */
function gstPluginBaseName(fileName) {
    return fileName
        .replace(/^(lib)?gst/, '')
        .replace(/\.(dylib|so|dll)$/i, '')
        .toLowerCase();
}

/**
 * The plugins whose ABSENCE is a build failure rather than a counted skip.
 *
 * The rest of the list degrades honestly — a prefix without `mpg123` loses MP3 and says so in the
 * skip count. These do not: without `app` there is no JS boundary, without `playback` there is no
 * decodebin, and without `soup` a URI pipeline reports a healthy `Gst.init()` and then finds no
 * source element far away in the application. The builders already refuse a bundle with ZERO
 * plugins; this is that same rule made specific, because the zero check passed while the one
 * element an app actually asked for was missing.
 */
export const GST_REQUIRED_PLUGINS = ['app', 'playback', 'soup'];

/**
 * Which of {@link GST_REQUIRED_PLUGINS} the given plugin files do NOT cover. Both builders call
 * this with the set they actually COPIED, so "the prefix had it" and "the bundle carries it"
 * cannot drift apart.
 * @param {Iterable<string>} shippedFileNames plugin leaf names as they landed in the bundle
 * @returns {string[]} required plugin names with nothing behind them
 */
export function missingRequiredGstPlugins(shippedFileNames) {
    const shipped = new Set();
    for (const f of shippedFileNames) shipped.add(gstPluginBaseName(f));
    return GST_REQUIRED_PLUGINS.filter((name) => !shipped.has(name));
}
