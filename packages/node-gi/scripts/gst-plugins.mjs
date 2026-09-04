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
    // Parsers, then decoders. What is COVERED is WAV, MP3, Ogg/Vorbis, Opus and FLAC, and the
    // list of formats with the element that decodes each is `GST_AUDIO_DECODERS` below — the
    // registry is asked for those, because `decodebin` resolving says nothing about what it can
    // autoplug. `audioparsers` supplies the mp3/aac/flac parsers decodebin reaches for.
    //
    // AAC-in-M4A is NOT covered, and this sentence used to say it was: `isomp4` demuxes the
    // container and `aacparse` parses the stream, after which nothing decodes it. The gap is
    // stated in `GST_FORMAT_GAPS` with the licensing reason rather than left in a claim.
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
    // call rather than ours. Every one of those terms now travels with the binaries: chasing
    // OpenSSL's found that the win32 licence gate could not fail at all, and that 14 shipped DLLs —
    // GLib among them — had no text in any published bundle. ADR 0037 § Consequences carries it.
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

/**
 * The list above's spelling of a plugin file: no `libgst`/`gst` prefix, no extension, lowercase.
 *
 * CASE-INSENSITIVE THROUGHOUT, and it was not: the extension strip carried `/i` while the prefix
 * strip did not, so `LIBGSTAPP.DLL` — the archive's spelling, not ours — kept its prefix and read
 * as an unknown plugin. Same for a versioned `libgstapp.so.0`. No caller reaches either shape
 * today, and both would now REPORT rather than mis-parse, which is the direction that ends in a
 * red build instead of a silent one.
 */
function gstPluginBaseName(fileName) {
    return fileName
        .replace(/^.*[\\/]/, '')
        .replace(/^(lib)?gst/i, '')
        .replace(/\.(dylib|dll)$/i, '')
        .replace(/\.so(\.\d+)*$/i, '')
        .toLowerCase();
}

/**
 * The plugins whose ABSENCE is a build failure rather than a counted skip.
 *
 * Without `app` there is no JS boundary, without `playback` there is no decodebin, and without
 * `soup` a URI pipeline reports a healthy `Gst.init()` and then finds no source element far away
 * in the application.
 *
 * THIS USED TO SAY the rest of the list "degrades honestly — a prefix without `mpg123` loses MP3
 * and says so in the skip count". It does not, and #1544 is what that cost. The builders log what
 * they SKIPPED out of what they WALKED; a plugin the source archive never contained is never
 * walked, so it is never skipped, so it is never counted. Measured on the published
 * `@gjsify/gtk-runtime-win32-x64@0.47.0`: `mpg123`, `vorbis`, `flac` and `wasapi2` were absent
 * with no line about any of them, an application played nothing, and the mp3 stream failed as
 * `Internal data stream error` — the string this file documents for a missing TLS backend, which
 * it was not. {@link missingBundledGstPlugins} is the answer to the count's blind spot.
 */
export const GST_REQUIRED_PLUGINS = ['app', 'playback', 'soup'];

/**
 * The DECODER behind each format the audio path claims to take, keyed by format.
 *
 * A plugin list is the payload; this is the CLAIM, and they are not the same question. `decodebin`
 * resolving says nothing about whether anything can decode what it autoplugs — measured on win32,
 * where `decodebin3`, `playbin3`, `filesrc` and `souphttpsrc` all resolved and `mpg123audiodec`
 * was null. So the running registry is asked for the element that actually decodes, one per
 * format, and `gst-elements.test.mjs` is where that question is put.
 *
 * The header of this file lists the formats "a browser's decodeAudioData is expected to take". AAC
 * is in that sentence and has never been in the list: `isomp4` demuxes the container and
 * `audioparsers` supplies `aacparse`, after which the stream reaches no decoder at all. The two
 * elements that would decode it are `faad` (gst-plugins-bad, GPL) and `avdec_aac` (libav, whose
 * whole closure this file refuses one screen up), so it is a licensing decision rather than an
 * oversight — and it belongs in {@link GST_FORMAT_GAPS} where it is stated, not in a sentence that
 * claims coverage.
 */
export const GST_AUDIO_DECODERS = [
    { format: 'WAV / PCM', element: 'wavparse', plugin: 'wavparse' },
    { format: 'MP3', element: 'mpg123audiodec', plugin: 'mpg123' },
    { format: 'Ogg / Vorbis', element: 'vorbisdec', plugin: 'vorbis' },
    { format: 'Opus', element: 'opusdec', plugin: 'opus' },
    { format: 'FLAC', element: 'flacdec', plugin: 'flac' },
    { format: 'A-law', element: 'alawdec', plugin: 'alaw' },
    { format: 'µ-law', element: 'mulawdec', plugin: 'mulaw' },
];

/**
 * Formats the audio path does NOT take, with the reason — declared so the claim is one place.
 *
 * An entry here is a promise NOT made. It is not an exemption from a check: nothing in
 * `GST_AUDIO_DECODERS` names these, so no probe looks for them, and this list exists so the
 * header's sentence about what a browser takes cannot quietly cover more than the payload does.
 */
export const GST_FORMAT_GAPS = [
    {
        format: 'AAC (in M4A)',
        why:
            '`isomp4` demuxes the container and `aacparse` parses the stream; nothing decodes it. ' +
            '`faad` is GPL and `avdec_aac` brings the libav closure this file refuses — both are a ' +
            "redistribution decision for whoever ships the product, not this script's.",
    },
];

/**
 * Plugins a platform's source archive does not contain, DECLARED, with what it costs.
 *
 * The `check-committed-musl` shape: a gap that is written down, printed on every build, and fails
 * the day it stops applying. Without it the only two options are a silently incomplete bundle
 * (what #1544 measured) or a red build for a payload decision nobody has taken yet — and the first
 * is how a runtime advertises a format it cannot play.
 *
 * `retires` is not decoration: {@link missingBundledGstPlugins} reports a gap whose plugin DID
 * arrive as a problem of its own, so an entry cannot outlive the archive that justified it.
 */
export const GST_PLUGIN_GAPS = {
    'win32-x64': [
        {
            plugin: 'mpg123',
            why: 'no MP3 decoding. gvsbuild carries the plugin only if libmpg123 was built, and it was not — measured on @gjsify/gtk-runtime-win32-x64@0.47.0, where a bundled mp3 asset and an mp3 stream both failed (#1544).',
        },
        {
            plugin: 'vorbis',
            why: 'no Ogg/Vorbis decoding: `ogg` demuxes the container and nothing decodes the stream inside it.',
        },
        {
            plugin: 'flac',
            why: 'no FLAC decoding. Same upstream cause as the two above: the gst-plugins-good element links libFLAC, and a gvsbuild prefix carries it only if that library was built.',
        },
        {
            plugin: 'wasapi2',
            why: 'the modern Windows sink. Costs nothing today: `directsound` ships and `autoaudiosink` resolves to it — listed because it is the same silent absence, not because it breaks anything.',
        },
    ],
};

/**
 * The output sinks that belong to ONE platform, so the other's absence is not a gap.
 *
 * The list above is one list for both bundles because every other plugin in it is portable. These
 * are not, and a checker that did not know it would report `osxaudio` missing from every Windows
 * bundle — an alarm that is wrong on every run, which is the kind that gets switched off.
 */
export const GST_PLATFORM_SINKS = {
    darwin: ['osxaudio'],
    win32: ['wasapi2', 'directsound'],
};

/**
 * Every plugin `<os>-<arch>`'s bundle is expected to carry.
 *
 * REFUSES AN OS IT DOES NOT KNOW rather than answering. An unrecognised os makes every
 * platform sink foreign, so the expectation quietly stops requiring an audio sink at all —
 * a typo in a target string would have relaxed the check instead of failing it, which is
 * this file's own subject one level up. Every caller passes a literal.
 */
export function expectedGstPlugins(target) {
    const os = String(target).split('-')[0];
    if (!Object.hasOwn(GST_PLATFORM_SINKS, os)) {
        throw new Error(
            `gst-plugins: "${target}" names no platform this bundles for. Known: ` +
                `${Object.keys(GST_PLATFORM_SINKS).join(', ')} — the \`process.platform\` spelling.`,
        );
    }
    const foreign = new Set(
        Object.entries(GST_PLATFORM_SINKS)
            .filter(([platform]) => platform !== os)
            .flatMap(([, sinks]) => sinks),
    );
    return GST_AUDIO_PLUGINS.filter((name) => !foreign.has(name));
}

/**
 * Which expected plugins the bundle does not carry, split by whether anybody said so.
 *
 * THE COUNT'S BLIND SPOT, closed. A builder logs what it skipped out of what it walked, so a
 * plugin the source archive never contained produces no line at all — and that is how four of
 * them left the win32 bundle silently (#1544). This compares the DECLARATION against what was
 * actually copied, which is a set difference and cannot be blind in that direction.
 *
 * `retired` is the half that keeps the gap list honest: a declared gap whose plugin DID arrive is
 * reported too, so an entry cannot outlive the archive that justified it.
 *
 * @param {Iterable<string>} shippedFileNames plugin leaf names as they landed in the bundle
 * @param {string} target `<os>-<arch>`, the key {@link GST_PLUGIN_GAPS} is written under
 * @returns {{ undeclared: string[], declared: {plugin: string, why: string}[], retired: string[] }}
 */
export function missingBundledGstPlugins(shippedFileNames, target) {
    const shipped = new Set();
    for (const f of shippedFileNames) shipped.add(gstPluginBaseName(f));
    const gaps = GST_PLUGIN_GAPS[target] ?? [];
    const declaredNames = new Set(gaps.map((gap) => gap.plugin));
    return {
        undeclared: expectedGstPlugins(target).filter((name) => !shipped.has(name) && !declaredNames.has(name)),
        declared: gaps.filter((gap) => !shipped.has(gap.plugin)),
        retired: gaps.filter((gap) => shipped.has(gap.plugin)).map((gap) => gap.plugin),
    };
}

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
