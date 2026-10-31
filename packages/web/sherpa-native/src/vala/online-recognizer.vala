/*
 * GjsifySherpa.OnlineRecognizer — a streaming transducer, decoded as it arrives.
 *
 * "Online" is sherpa-onnx's word for a model that emits a growing hypothesis
 * from a partial utterance; `zipformer-de-kroko`, the German engine ADR 0127
 * measured, is one. The recognizer holds the weights, a stream holds one
 * utterance's decoder state, and many streams may share one recognizer — which
 * is the entire reason the two are separate objects here rather than one.
 *
 * The decode loop a caller runs is sherpa-onnx's own:
 *
 *     stream.accept (16000, samples);
 *     while (stream.is_ready ()) stream.decode ();
 *     var text = stream.get_text ();            // interim, grows
 *     if (stream.is_endpoint ()) { … ; stream.reset (); }
 *
 * `is_endpoint` is the model's own trailing-silence rule, which is NOT the same
 * measurement as `@gjsify/vad`'s and is not a turn either (ADR 0127 decision 8).
 */

namespace GjsifySherpa {

    public class OnlineRecognizer : GLib.Object {

        /**
         * Defaults for the STRING properties below, and why they are constants
         * rather than `default =` on the property.
         *
         * valac honours a property's `default =` only for the scalar types: an
         * `int` property lands in its GParamSpec as `1`, a `float` as `1.5`, a
         * `bool` as TRUE — but a STRING property's default is dropped and the
         * spec gets NULL. Nothing warns. So `default = "cpu"` reads correctly in
         * Vala, is inherited correctly by a Vala subclass, and yet
         * `recognizer.provider` is `null` for every caller coming through GI,
         * which is every caller this package has. The `construct` block below is
         * what actually applies them.
         */
        public const string DEFAULT_PROVIDER = "cpu";
        public const string DEFAULT_DECODING_METHOD = "greedy_search";

        private Shim.Online? handle = null;

        /**
         * Streams created from this recognizer and not yet closed.
         *
         * UNOWNED, because the strong reference runs the other way: each
         * {@link OnlineStream} holds a ref on its recognizer, so the weights
         * cannot be finalized while a stream can still reach them. This list
         * exists only so {@link close} can shut the streams down FIRST — the
         * shim's stream handles keep the recognizer pointer, and freeing the
         * recognizer under a live stream is a use-after-free.
         */
        private GLib.List<unowned OnlineStream> live = new GLib.List<unowned OnlineStream> ();

        /** Path to the transducer encoder, e.g. `encoder-epoch-99-avg-1.onnx`. */
        public string encoder { get; construct; }

        /** Path to the transducer decoder. */
        public string decoder { get; construct; }

        /** Path to the transducer joiner. */
        public string joiner { get; construct; }

        /** Path to `tokens.txt`. */
        public string tokens { get; construct; }

        /** sherpa-onnx's model-type hint; %null lets it autodetect. */
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

        /** Whether {@link OnlineStream.is_endpoint} is computed at all. */
        public bool enable_endpoint { get; construct set; default = true; }

        /** Trailing silence that ends an utterance which decoded something. */
        public float rule1_min_trailing_silence { get; construct set; default = 2.4f; }

        /** Trailing silence that ends an utterance after the last non-blank. */
        public float rule2_min_trailing_silence { get; construct set; default = 1.2f; }

        /** Utterance length at which an endpoint is forced, in seconds. */
        public float rule3_min_utterance_length { get; construct set; default = 20.0f; }

        /** Sample rate the feature extractor expects. */
        public int sample_rate { get; construct set; default = 16000; }

        /** Filterbank dimension. 80 for every zipformer. */
        public int feature_dim { get; construct set; default = 80; }

        public bool enable_debug { get; construct set; default = false; }

        public bool is_open {
            get { return this.handle != null; }
        }

        /**
         * Applies the string defaults, which the GParamSpec cannot carry — see
         * {@link DEFAULT_PROVIDER}.
         *
         * Only where the caller supplied nothing. A `construct` block runs after
         * GObject has assigned the construct properties, so an explicit
         * `provider: "cuda"` is already in place here and must not be
         * overwritten; `null` is the one value that means "not given", which is
         * also why neither property is nullable in its own right.
         */
        construct {
            if (this.provider == null) {
                this.provider = DEFAULT_PROVIDER;
            }
            if (this.decoding_method == null) {
                this.decoding_method = DEFAULT_DECODING_METHOD;
            }
        }

        public OnlineRecognizer (string encoder, string decoder, string joiner, string tokens) {
            Object (encoder: encoder, decoder: decoder, joiner: joiner, tokens: tokens);
        }

        /** Load the weights. Loading a transducer takes seconds and ~500 MB. */
        public void open () throws SherpaError {
            if (this.handle != null) {
                return;
            }

            require_file ("encoder", this.encoder);
            require_file ("decoder", this.decoder);
            require_file ("joiner", this.joiner);
            require_file ("tokens", this.tokens);

            this.handle = Shim.Online.open (this.encoder,
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
                                            this.enable_endpoint ? 1 : 0,
                                            this.rule1_min_trailing_silence,
                                            this.rule2_min_trailing_silence,
                                            this.rule3_min_utterance_length,
                                            this.sample_rate,
                                            this.feature_dim,
                                            this.enable_debug ? 1 : 0);

            if (this.handle == null) {
                throw new SherpaError.OPEN_FAILED (
                    "sherpa-onnx refused the online recognizer configuration (reason on stderr)");
            }
        }

        /**
         * Release the weights, closing every live stream first.
         *
         * The order is the point: a shim stream handle holds the recognizer
         * pointer, so the recognizer may not go first. Same arrangement as
         * GjsifySqlite.Database and its statements.
         */
        public void close () {
            // Emptied before the loop so that each stream's forget() becomes a
            // no-op and cannot mutate a list being walked — the same move
            // GjsifySqlite.Database.close makes, for the same reason.
            GLib.List<unowned OnlineStream> pending = (owned) this.live;
            this.live = new GLib.List<unowned OnlineStream> ();

            foreach (unowned OnlineStream stream in pending) {
                stream.close ();
            }

            this.handle = null;
        }

        internal unowned Shim.Online require_handle () throws SherpaError {
            if (this.handle == null) {
                throw new SherpaError.NOT_OPEN ("the online recognizer is not open");
            }
            return this.handle;
        }

        internal void forget (OnlineStream stream) {
            this.live.remove (stream);
        }

        /**
         * A stream for one utterance.
         *
         * @hotwords is a newline-separated contextual-biasing list for THIS
         * stream, or %null for none; it only has an effect with
         * {@link decoding_method} set to `modified_beam_search`.
         */
        public OnlineStream create_stream (string? hotwords = null) throws SherpaError {
            var stream = new OnlineStream (this, hotwords);
            this.live.prepend (stream);
            return stream;
        }
    }

    /**
     * One utterance's decoder state.
     *
     * Obtained from {@link OnlineRecognizer.create_stream}. Holds a strong
     * reference on its recognizer, so a caller may drop the recognizer and keep
     * decoding.
     */
    public class OnlineStream : GLib.Object {

        private Shim.OnlineStream? handle = null;
        private OnlineRecognizer? recognizer = null;

        public bool is_open {
            get { return this.handle != null; }
        }

        internal OnlineStream (OnlineRecognizer recognizer, string? hotwords) throws SherpaError {
            this.recognizer = recognizer;
            this.handle = Shim.OnlineStream.open (recognizer.require_handle (), hotwords);

            if (this.handle == null) {
                this.recognizer = null;
                throw new SherpaError.OPEN_FAILED (
                    "sherpa-onnx could not create an online stream (reason on stderr)");
            }
        }

        /** Release the decoder state. Idempotent. */
        public void close () {
            this.handle = null;
            if (this.recognizer != null) {
                this.recognizer.forget (this);
                this.recognizer = null;
            }
        }

        private unowned Shim.OnlineStream require_handle () throws SherpaError {
            if (this.handle == null) {
                throw new SherpaError.NOT_OPEN ("the online stream is closed");
            }
            return this.handle;
        }

        /** Feed mono float samples in [-1, 1] recorded at @sample_rate. */
        public void accept (int sample_rate, float[] samples) throws SherpaError {
            this.require_handle ().accept (sample_rate, samples);
        }

        /** No more samples follow: pad the tail so it can be decoded. */
        public void input_finished () throws SherpaError {
            this.require_handle ().input_finished ();
        }

        /** Whether enough frames are buffered for another {@link decode}. */
        public bool is_ready () throws SherpaError {
            return this.require_handle ().is_ready () != 0;
        }

        /**
         * Whether the model's trailing-silence rules say the utterance ended.
         *
         * The model's own measurement, not `@gjsify/vad`'s, and not a turn.
         */
        public bool is_endpoint () throws SherpaError {
            return this.require_handle ().is_endpoint () != 0;
        }

        /** Decode one chunk. Only legal while {@link is_ready}. */
        public void decode () throws SherpaError {
            this.require_handle ().decode ();
        }

        /** Clear the decoder state after an endpoint, keeping the stream. */
        public void reset () throws SherpaError {
            this.require_handle ().reset ();
        }

        /** The text decoded so far — interim, and it grows. */
        public string get_text () throws SherpaError {
            return this.require_handle ().text ();
        }

        /** The full result as JSON: tokens, timestamps, per-token probabilities. */
        public string get_json () throws SherpaError {
            return this.require_handle ().json ();
        }
    }
}
