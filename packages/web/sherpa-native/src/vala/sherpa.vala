/*
 * GjsifySherpa — what this bridge is, and what it deliberately is not.
 *
 * sherpa-onnx is a C++ speech toolkit whose C API hands out opaque handles and
 * takes configuration in nested structs. Neither travels through JavaScript, so
 * this library is the thin layer that holds the handles: a Silero voice activity
 * detector, a streaming (online) transducer recognizer, and a whole-utterance
 * (offline) one. Everything a caller can express in TypeScript — model
 * discovery and download, PCM plumbing, event shapes, the turn-taking policy —
 * belongs ABOVE this line, in `@gjsify/vad` and `@gjsify/speech-recognition`
 * (ADR 0127 decisions 5 and 8).
 *
 * MODELS ARE NEVER PART OF A PREBUILD. Every path here is supplied by the
 * caller, and this package ships none: the models are hundreds of megabytes and
 * their licences differ from sherpa-onnx's own Apache-2.0 (ADR 0127 decision
 * 14). `@gjsify/vad` fetches Silero on first use.
 *
 * The recognizers are TRANSDUCER-ONLY — encoder/decoder/joiner plus a tokens
 * file. That is the family both engines ADR 0127 measured belong to, and a
 * model family nobody has run is a claim rather than a binding. Adding one is a
 * parameter in src/c/gjsify-sherpa-shim.c; whisper belongs in
 * `@gjsify/whisper-native` (decision 7), not here.
 */

namespace GjsifySherpa {

    /**
     * Every failure in this library.
     *
     * sherpa-onnx's own C API answers NULL and writes its reason to stderr, so
     * the detail in these messages is what this library could establish BEFORE
     * handing a configuration over — above all which model file is missing,
     * which is the overwhelmingly common failure and the one a NULL cannot name.
     */
    public errordomain SherpaError {
        /** A model file does not exist or cannot be read. The message names it. */
        MODEL_MISSING,
        /** sherpa-onnx refused the configuration; its reason went to stderr. */
        OPEN_FAILED,
        /** The object was used before `open()` or after `close()`. */
        NOT_OPEN,
    }

    /** The statically linked sherpa-onnx version, e.g. `2.0.1`. */
    public string version () {
        return Shim.version ();
    }

    /** The onnxruntime version sherpa-onnx was built against, e.g. `1.28.2`. */
    public string onnxruntime_version () {
        return Shim.onnxruntime_version ();
    }

    /**
     * Whether @path is readable, as sherpa-onnx itself would judge it.
     *
     * Exposed because the TypeScript layer's model-cache check wants the
     * engine's own answer rather than a second opinion from Gio.
     */
    public bool file_exists (string path) {
        return Shim.file_exists (path) != 0;
    }

    /**
     * Throw {@link SherpaError.MODEL_MISSING} naming @path unless it is readable.
     *
     * Called by every `open()` below, for the reason in the domain's own doc:
     * it is the one diagnosis available before sherpa-onnx gets the chance to
     * fail silently.
     */
    internal void require_file (string label, string path) throws SherpaError {
        if (Shim.file_exists (path) == 0) {
            throw new SherpaError.MODEL_MISSING ("%s not found: %s", label, path);
        }
    }
}
