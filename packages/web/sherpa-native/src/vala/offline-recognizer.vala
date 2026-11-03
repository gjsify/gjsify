/*
 * GjsifySherpa.OfflineRecognizer — a whole-utterance transducer.
 *
 * "Offline" is sherpa-onnx's word for a model that wants the complete
 * utterance before it decodes; `parakeet-tdt-0.6b-v3`, the multilingual engine
 * ADR 0127 measured, is one. It is the better transcriber and it cannot stream,
 * which is exactly why both kinds are bound here: `@gjsify/vad` cuts the
 * recording into segments, and a segment is precisely what this takes.
 *
 * ONE STREAM DECODES ONCE. There is no reset: the stream holds features, not
 * an incremental decoder state, and a second `decode()` on the same stream
 * decodes the same audio again. A segment gets a fresh stream — they are cheap,
 * since the weights live in the recognizer.
 *
 *     var stream = recognizer.create_stream ();
 *     stream.accept (16000, segment);
 *     stream.decode ();
 *     var text = stream.get_text ();
 */

namespace GjsifySherpa {

    public class OfflineRecognizer : GLib.Object {

        /**
         * The string defaults. valac drops a `default =` on a STRING property —
         * the GParamSpec gets NULL and nothing warns, so every caller coming
         * through GI would read `null`. See
         * {@link OnlineRecognizer.DEFAULT_PROVIDER} for the full note; the
         * `construct` block below is what applies them.
         */
        public const string DEFAULT_PROVIDER = "cpu";
        public const string DEFAULT_DECODING_METHOD = "greedy_search";

        /** Applies the string defaults, only where the caller supplied nothing. */
        construct {
            if (this.provider == null) {
                this.provider = DEFAULT_PROVIDER;
            }
            if (this.decoding_method == null) {
                this.decoding_method = DEFAULT_DECODING_METHOD;
            }
        }

        private Shim.Offline? handle = null;

        /** See {@link OnlineRecognizer.live} — the reference direction is the same. */
        private GLib.List<unowned OfflineStream> live = new GLib.List<unowned OfflineStream> ();

        /** Path to the transducer encoder. */
        public string encoder { get; construct; }

        /** Path to the transducer decoder. */
        public string decoder { get; construct; }

        /** Path to the transducer joiner. */
        public string joiner { get; construct; }

        /** Path to `tokens.txt`. */
        public string tokens { get; construct; }

        /**
         * sherpa-onnx's model-type hint; %null lets it autodetect.
         *
         * Worth setting for the NeMo transducers, where it decides which
         * normalisation the features get: `nemo_transducer` for parakeet.
         */
        public string? model_type { get; construct set; default = null; }

        /** onnxruntime execution provider: `cpu`, `cuda`, `coreml`, … */
        public string provider { get; construct set; }

        public int num_threads { get; construct set; default = 1; }

        /** `greedy_search` or `modified_beam_search`; the latter takes hotwords. */
        public string decoding_method { get; construct set; }

        /** Beam width, for `modified_beam_search` only. */
        public int max_active_paths { get; construct set; default = 4; }

        /** How strongly a hotword is boosted. Only with `modified_beam_search`. */
        public float hotwords_score { get; construct set; default = 1.5f; }

        /** Added to the blank logit; above 0 makes the model emit fewer blanks. */
        public float blank_penalty { get; construct set; default = 0.0f; }

        /** Sample rate the feature extractor expects. */
        public int sample_rate { get; construct set; default = 16000; }

        /** Filterbank dimension. 80 for both zipformer and NeMo transducers. */
        public int feature_dim { get; construct set; default = 80; }

        public bool enable_debug { get; construct set; default = false; }

        public bool is_open {
            get { return this.handle != null; }
        }

        public OfflineRecognizer (string encoder, string decoder, string joiner, string tokens) {
            Object (encoder: encoder, decoder: decoder, joiner: joiner, tokens: tokens);
        }

        /** Load the weights. parakeet-tdt-0.6b int8 is ~650 MB on disk. */
        public void open () throws SherpaError {
            if (this.handle != null) {
                return;
            }

            require_file ("encoder", this.encoder);
            require_file ("decoder", this.decoder);
            require_file ("joiner", this.joiner);
            require_file ("tokens", this.tokens);

            this.handle = Shim.Offline.open (this.encoder,
                                             this.decoder,
                                             this.joiner,
                                             this.tokens,
                                             this.model_type,
                                             this.provider,
                                             this.num_threads,
                                             this.decoding_method,
                                             this.max_active_paths,
                                             this.hotwords_score,
                                             this.blank_penalty,
                                             this.sample_rate,
                                             this.feature_dim,
                                             this.enable_debug ? 1 : 0);

            if (this.handle == null) {
                throw new SherpaError.OPEN_FAILED (
                    "sherpa-onnx refused the offline recognizer configuration (reason on stderr)");
            }
        }

        /** Release the weights, closing every live stream first. */
        public void close () {
            GLib.List<unowned OfflineStream> pending = (owned) this.live;
            this.live = new GLib.List<unowned OfflineStream> ();

            foreach (unowned OfflineStream stream in pending) {
                stream.close ();
            }

            this.handle = null;
        }

        internal unowned Shim.Offline require_handle () throws SherpaError {
            if (this.handle == null) {
                throw new SherpaError.NOT_OPEN ("the offline recognizer is not open");
            }
            return this.handle;
        }

        internal void forget (OfflineStream stream) {
            this.live.remove (stream);
        }

        /**
         * A stream for one utterance, to be decoded once.
         *
         * @hotwords is a newline-separated contextual-biasing list, or %null;
         * it only has an effect with `modified_beam_search`.
         */
        public OfflineStream create_stream (string? hotwords = null) throws SherpaError {
            var stream = new OfflineStream (this, hotwords);
            this.live.prepend (stream);
            return stream;
        }
    }

    /**
     * One utterance's features, decoded once.
     *
     * Obtained from {@link OfflineRecognizer.create_stream}. Holds a strong
     * reference on its recognizer.
     */
    public class OfflineStream : GLib.Object {

        private Shim.OfflineStream? handle = null;
        private OfflineRecognizer? recognizer = null;

        public bool is_open {
            get { return this.handle != null; }
        }

        internal OfflineStream (OfflineRecognizer recognizer, string? hotwords) throws SherpaError {
            this.recognizer = recognizer;
            this.handle = Shim.OfflineStream.open (recognizer.require_handle (), hotwords);

            if (this.handle == null) {
                this.recognizer = null;
                throw new SherpaError.OPEN_FAILED (
                    "sherpa-onnx could not create an offline stream (reason on stderr)");
            }
        }

        /** Release the features. Idempotent. */
        public void close () {
            this.handle = null;
            if (this.recognizer != null) {
                this.recognizer.forget (this);
                this.recognizer = null;
            }
        }

        private unowned Shim.OfflineStream require_handle () throws SherpaError {
            if (this.handle == null) {
                throw new SherpaError.NOT_OPEN ("the offline stream is closed");
            }
            return this.handle;
        }

        /**
         * Add mono float samples in [-1, 1] recorded at @sample_rate.
         *
         * May be called repeatedly before {@link decode} — the features
         * accumulate — but not after it.
         */
        public void accept (int sample_rate, float[] samples) throws SherpaError {
            this.require_handle ().accept (sample_rate, samples);
        }

        /** Decode everything accepted so far. Once per stream. */
        public void decode () throws SherpaError {
            this.require_handle ().decode ();
        }

        /** The decoded text. Empty before {@link decode}. */
        public string get_text () throws SherpaError {
            return this.require_handle ().text ();
        }

        /** The full result as JSON: tokens, timestamps, per-token probabilities. */
        public string get_json () throws SherpaError {
            return this.require_handle ().json ();
        }
    }
}
