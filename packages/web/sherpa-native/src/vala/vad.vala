/*
 * GjsifySherpa.Vad — Silero voice activity detection over sherpa-onnx.
 *
 * The knobs are CONSTRUCT PROPERTIES rather than ten positional arguments: the
 * detector has nine of them, every one has a sensible default, and
 * `new Vad({ model: …, minSilenceDuration: 0.3 })` is what that looks like from
 * GJS. Construction cannot fail, so opening is its own step — a constructor
 * that throws is not something GObject can express.
 *
 * WHAT THIS REPORTS, AND WHAT IT REFUSES TO
 * ─────────────────────────────────────────
 * Two different things, and conflating them is the mistake ADR 0127 decision 8
 * exists to prevent:
 *
 *   • {@link is_speech} is the LIVE edge — true while the detector is inside
 *     speech. That is what drives a "listening" indicator.
 *   • {@link next_segment} yields a COMPLETED segment, once
 *     {@link min_silence_duration} of silence has closed it.
 *
 * Neither is a turn. Whether a pause means the speaker finished is a policy
 * question about a conversation, and it is decided above this layer; a VAD
 * measures acoustics and nothing else.
 */

namespace GjsifySherpa {

    public class Vad : GLib.Object {

        private Shim.Vad? handle = null;

        /** Path to `silero_vad.onnx`. Supplied by the caller; never shipped. */
        public string model { get; construct; }

        /** Speech probability above which a window counts as speech. */
        public float threshold { get; construct set; default = 0.5f; }

        /**
         * Silence that closes a segment, in seconds.
         *
         * 0.3 is this library's default because it is ADR 0127 decision 8's:
         * 300 ms is short enough that a reply does not feel late and long
         * enough to sit out the pause inside a sentence. sherpa-onnx's own
         * default is 0.5.
         */
        public float min_silence_duration { get; construct set; default = 0.3f; }

        /** Speech shorter than this is discarded as a click or a cough. */
        public float min_speech_duration { get; construct set; default = 0.25f; }

        /** A segment is closed at this length even without a pause. */
        public float max_speech_duration { get; construct set; default = 20.0f; }

        /** Samples per inference window. 512 is Silero v4/v5 at 16 kHz. */
        public int window_size { get; construct set; default = 512; }

        /** Sample rate of the audio fed to {@link accept}. Silero wants 16 kHz. */
        public int sample_rate { get; construct set; default = 16000; }

        /** onnxruntime threads. One is enough for Silero and the cheapest. */
        public int num_threads { get; construct set; default = 1; }

        /**
         * The detector's internal ring buffer, in seconds.
         *
         * It has to exceed {@link max_speech_duration}, or a long segment is
         * truncated at the buffer rather than at the limit.
         */
        public float buffer_size_in_seconds { get; construct set; default = 30.0f; }

        /** Make sherpa-onnx print its configuration and decisions to stderr. */
        public bool enable_debug { get; construct set; default = false; }

        /** Whether {@link open} has run and {@link close} has not. */
        public bool is_open {
            get { return this.handle != null; }
        }

        public Vad (string model) {
            Object (model: model);
        }

        /**
         * Load the model and start detecting.
         *
         * Calling this twice is a no-op rather than a leak — the second call
         * returns with the first handle in place.
         */
        public void open () throws SherpaError {
            if (this.handle != null) {
                return;
            }

            require_file ("Silero VAD model", this.model);

            if (this.buffer_size_in_seconds <= this.max_speech_duration) {
                // Not fatal to sherpa-onnx, but it silently truncates segments
                // at the buffer instead of at max_speech_duration, which reads
                // as a VAD that cuts people off for no reason.
                warning ("buffer-size-in-seconds (%g) should exceed max-speech-duration (%g)",
                         this.buffer_size_in_seconds, this.max_speech_duration);
            }

            this.handle = Shim.Vad.open (this.model,
                                         this.threshold,
                                         this.min_silence_duration,
                                         this.min_speech_duration,
                                         this.max_speech_duration,
                                         this.window_size,
                                         this.sample_rate,
                                         this.num_threads,
                                         this.buffer_size_in_seconds,
                                         this.enable_debug ? 1 : 0);

            if (this.handle == null) {
                throw new SherpaError.OPEN_FAILED (
                    "sherpa-onnx refused the VAD configuration for %s (reason on stderr)",
                    this.model);
            }
        }

        /** Release the model. Idempotent; the object stays reusable via `open`. */
        public void close () {
            this.handle = null;
        }

        private unowned Shim.Vad require_handle () throws SherpaError {
            if (this.handle == null) {
                throw new SherpaError.NOT_OPEN ("the VAD is not open");
            }
            return this.handle;
        }

        /**
         * Feed mono float samples in [-1, 1], recorded at {@link sample_rate}.
         *
         * ANY length is fine. The detector keeps what does not fill a window
         * and prepends it to the next call, so a caller may hand over whatever
         * its capture source produced — `@gjsify/media-capture`'s PCM source
         * emits whatever GStreamer buffered, and it does not have to be
         * re-chunked for this.
         */
        public void accept (float[] samples) throws SherpaError {
            this.require_handle ().accept (samples);
        }

        /** True while the detector is INSIDE speech right now. */
        public bool is_speech () throws SherpaError {
            return this.require_handle ().is_speech () != 0;
        }

        /** Whether a completed segment is waiting for {@link next_segment}. */
        public bool has_segment () throws SherpaError {
            return this.require_handle ().is_empty () == 0;
        }

        /**
         * Close an in-progress segment and queue it — end of input.
         *
         * Without this the final utterance of a file or a stopped recording is
         * never reported: nothing followed it that could be silence.
         */
        public void flush () throws SherpaError {
            this.require_handle ().flush ();
        }

        /** Drop every queued segment, keeping the model state. */
        public void clear () throws SherpaError {
            this.require_handle ().clear ();
        }

        /** Drop every queued segment AND the model state. */
        public void reset () throws SherpaError {
            this.require_handle ().reset ();
        }

        /**
         * Take the oldest completed segment. %false when none is queued.
         *
         * @samples is the segment's audio and @start its offset from the first
         * sample ever accepted, in samples — which is what lets a caller place
         * it on a timeline without counting along.
         *
         * A BOOLEAN RETURN rather than the nullable `float[]?` this used to be,
         * because a nullable array does not survive GObject-Introspection:
         * measured under gjs, a NULL C array with length 0 arrives in
         * JavaScript as an EMPTY ARRAY, so `=== null` is false and the two
         * cases that have to be told apart — "nothing queued" and "a segment"
         * — collapse into each other. The predicate is the one part of this
         * that cannot be mis-marshalled, so it is what the API returns.
         */
        public bool next_segment (out float[] samples, out int64 start) throws SherpaError {
            unowned var vad = this.require_handle ();

            var n = vad.peek (out start);
            if (n < 0) {
                samples = new float[0];
                start = 0;
                return false;
            }

            samples = new float[n];
            vad.read (samples);
            vad.pop ();
            return true;
        }
    }
}
