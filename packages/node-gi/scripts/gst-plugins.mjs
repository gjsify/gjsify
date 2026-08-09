// SPDX-License-Identifier: MIT
// WHICH GStreamer plugins the runtime bundles ship — one rule, both platforms.
//
// THE FIRST ATTEMPT WAS "everything the prefix has", on the reasoning that a
// curated element list is a guess about which codecs an app will meet, and a wrong
// guess fails silently. The darwin relocation gate refused it, and was right to:
// Homebrew's `gstreamer` formula is base + good + bad + ugly + libav, so the plugin
// dir pulls in ffmpeg, aom, dav1d, x264, x265, faac, fdk-aac, libass, little-cms2 —
// and GTK+3, into a GTK4 runtime. Around 250 plugins whose closure is most of a
// media distribution.
//
// So the rule is not "guess the codecs", it is "ship the AUDIO PATH", and the two
// differ in a way that matters: the audio path is what `@gjsify/webaudio` is built
// on — decodebin over appsrc, convert/resample, out through the platform sink — and
// it is enumerable from that pipeline rather than from a hunch. Video decode,
// encoding of any kind, streaming and capture are all out.
//
// It also keeps a decision out of this file that does not belong to it: x264, x265,
// faac and fdk-aac are GPL- or patent-encumbered, and redistributing them inside a
// runtime bundle is a licensing choice for whoever ships the product, not a
// side effect of a build script reading a directory.
//
// EVERY SKIP IS LOGGED with its count by the builders. A plugin missing from the
// payload is the failure this whole area exists to prevent, so the one thing that
// must not happen is dropping them quietly.

/**
 * Plugin base names (no `libgst` prefix, no extension) the bundles ship.
 *
 * Grouped by the reason each is here, because "why is this one in the list" is the
 * question a future reader has. Names are GStreamer's plugin names, identical on
 * every platform — the builders add the platform's prefix/suffix.
 */
export const GST_AUDIO_PLUGINS = [
    // The pipeline's skeleton. `coreelements` is queue/capsfilter/fakesink/tee;
    // `app` is appsrc + appsink, which IS the JS boundary — @gjsify/webaudio pushes
    // encoded bytes into one and pulls PCM out of the other.
    'coreelements',
    'app',
    // What decodebin needs to work at all: typefind decides the format, playback
    // provides decodebin/uridecodebin itself.
    'typefindfunctions',
    'playback',
    // Parsers, then the decoders. Together these cover what a browser's
    // decodeAudioData is expected to take: WAV, MP3, AAC-in-M4A, Ogg/Vorbis, Opus,
    // FLAC. `audioparsers` supplies the mp3/aac/flac parsers decodebin autoplugs.
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

/** `true` when this plugin file belongs in the bundle. */
export function isBundledGstPlugin(fileName) {
    const base = fileName
        .replace(/^libgst/, '')
        .replace(/\.(dylib|so|dll)$/i, '')
        .toLowerCase();
    return GST_AUDIO_PLUGINS.includes(base);
}
