/*
 * ReceiverBridge — per-receiver incoming media pipeline.
 *
 * Manages the GStreamer elements for one RTCRtpReceiver's incoming
 * media path: muted source → tee (initial), then on connect_to_pad()
 * wires webrtcbin output → decodebin → tee (replacing the muted source).
 *
 * All GStreamer signal handling (especially decodebin's pad-added which
 * fires on the streaming thread) happens in C/Vala. JS only receives
 * the main-thread-safe `media_flowing` signal when decoded media is
 * actively flowing through the tee.
 *
 * Usage from JS:
 *   const bridge = new GjsifyWebrtc.ReceiverBridge({ pipeline, kind: 'audio' });
 *   bridge.connect_to_pad(webrtcbinSrcPad);
 *   bridge.connect('media-flowing', () => { track._setMuted(false); });
 */
namespace GjsifyWebrtc {

    public class ReceiverBridge : GLib.Object {

        public Gst.Pipeline pipeline { get; construct; }
        public string kind { get; construct; }

        /** Emitted on main thread when decoded media replaces the muted source. */
        public signal void media_flowing();

        private Gst.Element? _muted = null;
        private Gst.Element _tee;
        private Gst.Element? _decodebin = null;
        private bool _switched = false;
        private static int _counter = 0;

        public ReceiverBridge(Gst.Pipeline pipeline, string kind) {
            Object(pipeline: pipeline, kind: kind);
        }

        construct {
            int id = _counter++;

            // Create muted source (silence for audio, black for video)
            if (kind == "audio") {
                _muted = Gst.ElementFactory.make("audiotestsrc", "recv-muted-audio-%d".printf(id));
                _muted.set_property("wave", 4);       // silence
                _muted.set_property("is-live", true);
            } else {
                _muted = Gst.ElementFactory.make("videotestsrc", "recv-muted-video-%d".printf(id));
                _muted.set_property("pattern", 2);     // black
                _muted.set_property("is-live", true);
            }

            // Create tee for fan-out to track consumers
            _tee = Gst.ElementFactory.make("tee", "recv-tee-%d".printf(id));
            _tee.set_property("allow-not-linked", true);

            // Add to pipeline and link: muted → tee
            pipeline.add(_muted);
            pipeline.add(_tee);

            var muted_src = _muted.get_static_pad("src");
            var tee_sink = _tee.get_static_pad("sink");
            muted_src.link(tee_sink);

            _muted.sync_state_with_parent();
            _tee.sync_state_with_parent();
        }

        /**
         * Wire the webrtcbin output pad through decodebin into the tee.
         * Must be called from the main thread (JS calls this from
         * _handlePadAdded via the WebrtcbinBridge signal).
         */
        public void connect_to_pad(Gst.Pad src_pad) {
            if (_decodebin != null) return; // already connected

            int id = _counter++;
            _decodebin = Gst.ElementFactory.make("decodebin", "recv-decodebin-%d".printf(id));
            pipeline.add(_decodebin);

            // Link webrtcbin src pad → decodebin sink
            var dec_sink = _decodebin.get_static_pad("sink");
            src_pad.link(dec_sink);

            // Connect decodebin's pad-added signal — this fires on the
            // streaming thread, which is why this entire class exists
            _decodebin.pad_added.connect(this.on_decode_pad_added);

            _decodebin.sync_state_with_parent();
        }

        /**
         * Called on the STREAMING THREAD when decodebin has decoded the
         * incoming RTP stream and created a src pad with raw media.
         */
        private void on_decode_pad_added(Gst.Element element, Gst.Pad new_pad) {
            // Only process src pads (decoded output)
            if (new_pad.direction != Gst.PadDirection.SRC) return;

            // Guard: only switch once (decodebin may fire multiple pad-added)
            if (_switched) return;
            _switched = true;

            // Switch tee input from muted source to decoded pad
            var tee_sink = _tee.get_static_pad("sink");
            var old_peer = tee_sink.get_peer();

            if (old_peer != null) {
                // Add DROP probe on old pad to prevent errors during unlink
                old_peer.add_probe(
                    Gst.PadProbeType.BLOCK | Gst.PadProbeType.DATA_DOWNSTREAM,
                    () => { return Gst.PadProbeReturn.DROP; }
                );
                old_peer.unlink(tee_sink);
            }

            // Link decoded pad to tee
            new_pad.link(tee_sink);

            // Stop and remove muted element
            if (_muted != null) {
                _muted.set_state(Gst.State.NULL);
                pipeline.remove(_muted);
                _muted = null;
            }

            // Disconnect from decodebin pad-added (no longer needed)
            _decodebin.pad_added.disconnect(this.on_decode_pad_added);

            // Notify JS on main thread
            GLib.Idle.add(() => {
                this.media_flowing();
                return false;
            });
        }

        /** Request a src pad from the tee for a track consumer. */
        public Gst.Pad request_src_pad() {
            return _tee.request_pad_simple("src_%u");
        }

        /** Release a previously requested src pad. */
        public void release_src_pad(Gst.Pad pad) {
            _tee.release_request_pad(pad);
        }

        /** Clean up all GStreamer elements. Call from RTCRtpReceiver._dispose(). */
        public void dispose_bridge() {
            if (_decodebin != null) {
                _decodebin.set_state(Gst.State.NULL);
                pipeline.remove(_decodebin);
                _decodebin = null;
            }
            if (_muted != null) {
                _muted.set_state(Gst.State.NULL);
                pipeline.remove(_muted);
                _muted = null;
            }
            _tee.set_state(Gst.State.NULL);
            pipeline.remove(_tee);
        }
    }
}
