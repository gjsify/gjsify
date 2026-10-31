/*
 * sherpa-shim.vapi — Vala's view of src/c/gjsify-sherpa-shim.h.
 *
 * Every declaration here is a scalar, a string, or an OPAQUE pointer. That is
 * the whole point of the shim: sherpa-onnx's own configuration structs nest
 * twenty-two sub-structs that upstream appends to every release, and a VAPI
 * restating such a layout is a second truth that drifts — silently, since a
 * stale struct is not a compile error but a model path read out of the middle
 * of another field. The shim header explains this at length; this file is only
 * allowed to exist because there is no layout left in it to get wrong.
 *
 * The three handle types are [Compact] classes, so Vala frees them on scope
 * exit and on field assignment through their `free_function`. None of them
 * appears in this library's public API — the GjsifySherpa classes hold them in
 * PRIVATE fields — which is what keeps them out of the generated GIR, where a
 * type with no GType has nothing to say.
 *
 * Not a GObject namespace and not installed: this VAPI describes code that is
 * compiled INTO libgjsifysherpa, reached through `--vapidir` (meson.build).
 */

[CCode (cheader_filename = "gjsify-sherpa-shim.h")]
namespace Shim {

    /** sherpa-onnx's own version string, owned by the library. */
    [CCode (cname = "gjsify_sherpa_shim_version")]
    public unowned string version ();

    /** The onnxruntime version sherpa-onnx was built against. */
    [CCode (cname = "gjsify_sherpa_shim_onnxruntime_version")]
    public unowned string onnxruntime_version ();

    /**
     * Whether @filename is readable, through sherpa-onnx's own check.
     *
     * `int32`, not `bool`: the shim is plain C and answers 0/non-zero. The
     * GjsifySherpa classes convert at their boundary.
     */
    [CCode (cname = "gjsify_sherpa_shim_file_exists")]
    public int32 file_exists (string filename);

    /**
     * An open Silero VAD.
     *
     * `open` is nullable and the handle carries no error detail: sherpa-onnx
     * writes its own reason to stderr and returns NULL, so the callers in
     * vad.vala check the model paths with {@link file_exists} first in order to
     * have something to name.
     */
    [Compact]
    [CCode (cname = "GjsifySherpaShimVad", has_type_id = false,
            free_function = "gjsify_sherpa_shim_vad_close",
            lower_case_cprefix = "gjsify_sherpa_shim_vad_")]
    public class Vad {
        public static Vad? open (string model,
                                 float threshold,
                                 float min_silence_duration,
                                 float min_speech_duration,
                                 float max_speech_duration,
                                 int32 window_size,
                                 int32 sample_rate,
                                 int32 num_threads,
                                 float buffer_size_in_seconds,
                                 int32 debug);

        /** Any @samples length is legal — the detector buffers the remainder. */
        public void accept ([CCode (array_length_type = "int32_t")] float[] samples);

        public int32 is_speech ();
        public int32 is_empty ();
        public void flush ();
        public void clear ();
        public void reset ();

        /** Length of the fetched front segment, or -1 when none is queued. */
        public int32 peek (out int64 start);

        /** Copies the fetched segment into @dest, which must be `peek` long. */
        public void read ([CCode (array_length_type = "int32_t")] float[] dest);

        public void pop ();
    }

    [Compact]
    [CCode (cname = "GjsifySherpaShimOnline", has_type_id = false,
            free_function = "gjsify_sherpa_shim_online_close",
            lower_case_cprefix = "gjsify_sherpa_shim_online_")]
    public class Online {
        public static Online? open (string encoder,
                                    string decoder,
                                    string joiner,
                                    string tokens,
                                    string? model_type,
                                    string? provider,
                                    int32 num_threads,
                                    string? decoding_method,
                                    int32 max_active_paths,
                                    float hotwords_score,
                                    float blank_penalty,
                                    int32 enable_endpoint,
                                    float rule1_min_trailing_silence,
                                    float rule2_min_trailing_silence,
                                    float rule3_min_utterance_length,
                                    int32 sample_rate,
                                    int32 feature_dim,
                                    int32 debug);
    }

    [Compact]
    [CCode (cname = "GjsifySherpaShimOnlineStream", has_type_id = false,
            free_function = "gjsify_sherpa_shim_online_stream_close",
            lower_case_cprefix = "gjsify_sherpa_shim_online_stream_")]
    public class OnlineStream {
        /**
         * A stream of @recognizer. The handle keeps the recognizer POINTER, so
         * the C recognizer has to outlive it; GjsifySherpa.OnlineStream holds a
         * strong reference on its recognizer object for exactly that reason.
         */
        [CCode (cname = "gjsify_sherpa_shim_online_stream_open")]
        public static OnlineStream? open (Online recognizer, string? hotwords);

        public void accept (int32 sample_rate,
                            [CCode (array_length_type = "int32_t")] float[] samples);

        public void input_finished ();
        public int32 is_ready ();
        public int32 is_endpoint ();
        public void decode ();
        public void reset ();

        /** The interim text. Owned — the shim `g_strdup`s it. */
        public string text ();

        /** The full result as JSON. Owned. */
        public string json ();
    }

    [Compact]
    [CCode (cname = "GjsifySherpaShimOffline", has_type_id = false,
            free_function = "gjsify_sherpa_shim_offline_close",
            lower_case_cprefix = "gjsify_sherpa_shim_offline_")]
    public class Offline {
        public static Offline? open (string encoder,
                                     string decoder,
                                     string joiner,
                                     string tokens,
                                     string? model_type,
                                     string? provider,
                                     int32 num_threads,
                                     string? decoding_method,
                                     int32 max_active_paths,
                                     float hotwords_score,
                                     float blank_penalty,
                                     int32 sample_rate,
                                     int32 feature_dim,
                                     int32 debug);
    }

    [Compact]
    [CCode (cname = "GjsifySherpaShimOfflineStream", has_type_id = false,
            free_function = "gjsify_sherpa_shim_offline_stream_close",
            lower_case_cprefix = "gjsify_sherpa_shim_offline_stream_")]
    public class OfflineStream {
        [CCode (cname = "gjsify_sherpa_shim_offline_stream_open")]
        public static OfflineStream? open (Offline recognizer, string? hotwords);

        public void accept (int32 sample_rate,
                            [CCode (array_length_type = "int32_t")] float[] samples);

        public void decode ();

        /** The decoded text. Owned. */
        public string text ();

        /** The full result as JSON. Owned. */
        public string json ();
    }
}
