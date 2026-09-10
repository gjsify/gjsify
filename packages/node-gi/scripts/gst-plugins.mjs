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

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The ONE parser of a plugin FILE name, in `@gjsify/manifest-conformance` — the package that
// also holds the conformance rule reading these same directories. It lived here first and was
// wrong twice in the same way: the extension strip carried `/i` while the prefix strip did not,
// so `LIBGSTAPP.DLL` (an archive's spelling, not ours) kept its prefix and read as an unknown
// plugin, as did a versioned `libgstapp.so.0`. A second copy of that parser is a second place
// for the same bug, and the builders and the audit must not disagree about what a file is.
import { gstPluginBaseName } from '../../infra/manifest-conformance/lib/rules/media-capabilities.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `packages/node-gi`, the parent of every `gtk-runtime-<target>` package. */
const NODE_GI_DIR = dirname(HERE);

/**
 * Every bundle package's `gjsify.mediaCapabilities`, keyed by `<os>-<arch>`.
 *
 * DERIVED FROM THE DIRECTORIES, never listed: a fourth bundle is picked up the day it exists,
 * which is the same reason `field-coverage` derives the declared field set instead of holding a
 * list of fields somebody remembered to extend.
 *
 * THE CLAIM LIVES IN THE MANIFEST, and that is the whole point of the move. What a bundle can
 * decode differs per platform — the win32 payload carries no MP3 decoder while both darwin ones
 * do — and while that difference lived in THIS file it was invisible to everybody outside this
 * repository: a build script is not published, and a consumer choosing a package can read only
 * what npm hands them. So each bundle now states its own audio contract, `@gjsify/manifest-conformance`'s
 * `media-capabilities` rule holds it against the shipped plugin files, and the two readers below
 * (the builders, and `gst-elements.test.mjs` against the running registry) read that one
 * declaration rather than a second copy of it.
 */
function readMediaCapabilities() {
    const out = {};
    for (const entry of readdirSync(NODE_GI_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('gtk-runtime-')) continue;
        const target = entry.name.slice('gtk-runtime-'.length);
        const manifestPath = join(NODE_GI_DIR, entry.name, 'package.json');
        let manifest;
        try {
            manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        } catch (error) {
            // A bundle directory with no readable manifest cannot be answered for, and answering
            // `{}` would make every gap below silently empty — a payload check that requires
            // nothing. Loud, at import time, where the cause is one line away.
            throw new Error(`gst-plugins: cannot read ${manifestPath}: ${error.message}`);
        }
        const caps = manifest.gjsify?.mediaCapabilities;
        if (caps === undefined) {
            throw new Error(
                `gst-plugins: ${manifest.name} declares no \`gjsify.mediaCapabilities\`. Every bundle owes its own ` +
                    'audio contract — see `media-capabilities` in @gjsify/manifest-conformance, which fails on this too.',
            );
        }
        out[target] = caps;
    }
    return out;
}

const MEDIA_CAPABILITIES = readMediaCapabilities();

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
    // Parsers, then decoders — what this list SEEDS the copy with, which is not the same as what
    // any one bundle ends up carrying. The list of formats a target actually claims, with the
    // element that decodes each, is that bundle's own `gjsify.mediaCapabilities` ({@link
    // gstAudioDecoders}): the registry is asked for those, because `decodebin` resolving says
    // nothing about what it can autoplug. `audioparsers` supplies the mp3/aac/flac parsers
    // decodebin reaches for.
    //
    // Seeding a plugin here is a request, not a promise. `mpg123`, `vorbis` and `flac` are seeded
    // and the win32 archive has none of them, which is exactly why the CLAIM cannot live in this
    // file: a seed that matched nothing is byte-identical to a seed that matched (#1544).
    //
    // AAC-in-M4A is NOT covered anywhere, and a sentence here used to say it was: `isomp4`
    // demuxes the container and `aacparse` parses the stream, after which nothing decodes it.
    // Every bundle states that gap in its own manifest, with the licensing reason.
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
 * The DECODER behind each format a TARGET's bundle claims to take.
 *
 * A plugin list is the payload; this is the CLAIM, and they are not the same question. `decodebin`
 * resolving says nothing about whether anything can decode what it autoplugs — measured on win32,
 * where `decodebin3`, `playbin3`, `filesrc` and `souphttpsrc` all resolved and `mpg123audiodec`
 * was null. So the running registry is asked for the element that actually decodes, one per
 * format, and `gst-elements.test.mjs` is where that question is put.
 *
 * PER TARGET, and it never was. One list for every bundle read as "the audio path takes these
 * seven formats", which is true of the darwin bundles and false of the win32 one by three of the
 * seven — the asymmetry only became visible through `GST_PLUGIN_GAPS`, i.e. through a second list
 * a reader had to remember to consult. Reading the claim out of the bundle's own manifest removes
 * that second step: a target's answer is one array, and a format missing from BOTH arrays is a
 * conformance failure rather than a silence.
 *
 * @param {string} target `<os>-<arch>`
 * @returns {{format: string, element: string, plugin: string}[]}
 */
export function gstAudioDecoders(target) {
    return capabilitiesFor(target).audioDecode.map(({ format, element, plugin }) => ({ format, element, plugin }));
}

/**
 * Formats a target's bundle does NOT take, with the reason — a promise NOT made.
 *
 * An entry here is not an exemption from a check: nothing in {@link gstAudioDecoders} names these,
 * so no probe looks for them, and the list exists so a sentence about what the audio path takes
 * cannot quietly cover more than the payload does. AAC is the standing one on every target
 * (`isomp4` demuxes, `aacparse` parses, nothing decodes; `faad` is GPL and `avdec_aac` brings the
 * libav closure the header refuses), and it has no `plugin` at all — nothing was ever going to be
 * copied, so there is no file whose arrival could retire it.
 *
 * @param {string} target `<os>-<arch>`
 */
export function gstFormatGaps(target) {
    return capabilitiesFor(target).gaps.filter((gap) => gap.format !== undefined && gap.plugin === undefined);
}

/**
 * One target's `gjsify.mediaCapabilities`, or a refusal naming the target.
 *
 * REFUSES A TARGET IT DOES NOT KNOW rather than answering `{}` — the same reason
 * {@link expectedGstPlugins} refuses an unknown OS. An empty answer makes every gap vacuous and
 * every claim unmade, so a typo in a target string would RELAX both checks instead of failing
 * them, in a file whose own subject is a seed that matched nothing.
 */
function capabilitiesFor(target) {
    const caps = MEDIA_CAPABILITIES[target];
    if (caps === undefined) {
        throw new Error(
            `gst-plugins: no bundle package declares media capabilities for "${target}". Known: ` +
                `${Object.keys(MEDIA_CAPABILITIES).join(', ')} — one per packages/node-gi/gtk-runtime-<target>/.`,
        );
    }
    return caps;
}

/**
 * Plugins a platform's source archive does not contain, DECLARED, with what it costs.
 *
 * The `check-committed-musl` shape: a gap that is written down, printed on every build, and fails
 * the day it stops applying. Without it the only two options are a silently incomplete bundle
 * (what #1544 measured) or a red build for a payload decision nobody has taken yet — and the first
 * is how a runtime advertises a format it cannot play.
 *
 * Derived from the bundles' own manifests, which is where the declaration is READABLE by whoever
 * receives the tarball. The entries are the subset naming a `plugin`: a gap with only a format
 * (AAC) is about something that was never going to be copied, and holding the payload against it
 * would ask for a file no builder ever walks.
 *
 * `retires` is not decoration: {@link missingBundledGstPlugins} reports a gap whose plugin DID
 * arrive as a problem of its own, so an entry cannot outlive the archive that justified it — and
 * `media-capabilities` reports the same thing about the shipped tarball.
 */
export const GST_PLUGIN_GAPS = Object.fromEntries(
    Object.entries(MEDIA_CAPABILITIES).map(([target, caps]) => [
        target,
        caps.gaps.filter((gap) => gap.plugin !== undefined),
    ]),
);

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
