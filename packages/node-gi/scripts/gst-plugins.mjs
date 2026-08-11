// SPDX-License-Identifier: MIT
// WHICH GStreamer plugins the runtime bundles ship — one rule, both platforms: the AUDIO PATH,
// not "everything the prefix has". Homebrew's `gstreamer` is base + good + bad + ugly + libav, so
// the plugin dir pulls in ffmpeg, aom, dav1d, x264, x265, faac, fdk-aac, libass, little-cms2 —
// and GTK+3, into a GTK4 runtime — around 250 plugins whose closure is most of a media
// distribution; the darwin relocation gate refused it. The audio path is enumerable instead of
// guessed: it is what `@gjsify/webaudio` runs on (decodebin over appsrc, convert/resample, out
// through the platform sink). Video decode, encoding of any kind, streaming and capture are out.
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
    const base = fileName
        .replace(/^(lib)?gst/, '')
        .replace(/\.(dylib|so|dll)$/i, '')
        .toLowerCase();
    return GST_AUDIO_PLUGINS.includes(base);
}
