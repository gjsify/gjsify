/*
 * WebrtcbinBridge — webrtcbin signals → main-thread signals.
 *
 * webrtcbin emits on-negotiation-needed / on-ice-candidate /
 * on-data-channel plus notify::*-state from GStreamer's internal
 * streaming thread. GJS blocks JS callbacks on non-main threads, so
 * the bridge connects on the C (Vala) side, captures arguments, hops
 * to the GLib main context via GLib.Idle.add(), and only then emits
 * its own signals which JS can safely consume.
 *
 * Usage from JS:
 *   const bridge = new GjsifyWebrtc.WebrtcbinBridge(webrtcbin);
 *   bridge.connect('icecandidate', (_b, mline, cand) => { ... });
 *   bridge.connect('datachannel', (_b, channel) => { ... });
 */
namespace GjsifyWebrtc {

    public class WebrtcbinBridge : GLib.Object {

        public Gst.Element bin { get; construct; }

        /** on-negotiation-needed */
        public signal void negotiation_needed();
        /** on-ice-candidate(uint sdp_mline_index, string candidate) */
        public signal void icecandidate(uint sdp_mline_index, string candidate);
        /**
         * on-data-channel — fired with a pre-wrapped DataChannelBridge so
         * the wrapper is installed (and thus its signal handlers are active)
         * *before* any on-message-* callbacks can fire on the streaming
         * thread. Without this eager wrap, the first few messages from the
         * remote peer would race the JS-side setup and get dropped.
         */
        public signal void datachannel(DataChannelBridge channel_bridge);
        /** notify::connection-state */
        public signal void connection_state_changed();
        /** notify::signaling-state */
        public signal void signaling_state_changed();
        /** notify::ice-connection-state */
        public signal void ice_connection_state_changed();
        /** notify::ice-gathering-state */
        public signal void ice_gathering_state_changed();

        private ulong[] _handler_ids = {};

        public WebrtcbinBridge(Gst.Element bin) {
            Object(bin: bin);
        }

        construct {
            _handler_ids += GLib.Signal.connect(bin, "on-negotiation-needed",
                (GLib.Callback) on_negotiation_needed_cb, this);
            _handler_ids += GLib.Signal.connect(bin, "on-ice-candidate",
                (GLib.Callback) on_ice_candidate_cb, this);
            _handler_ids += GLib.Signal.connect(bin, "on-data-channel",
                (GLib.Callback) on_data_channel_cb, this);
            _handler_ids += bin.notify["connection-state"].connect(this.handle_connection_state);
            _handler_ids += bin.notify["signaling-state"].connect(this.handle_signaling_state);
            _handler_ids += bin.notify["ice-connection-state"].connect(this.handle_ice_connection_state);
            _handler_ids += bin.notify["ice-gathering-state"].connect(this.handle_ice_gathering_state);
        }

        // ---- C-ABI callbacks for dynamic (non-VAPI) webrtcbin signals ----
        // Signatures must match the GObject signal marshallers exactly
        // (element as first arg, signal args next, user_data last).

        [CCode (instance_pos = -1)]
        private static void on_negotiation_needed_cb(Gst.Element element,
                                                     WebrtcbinBridge self) {
            GLib.Idle.add(() => {
                self.negotiation_needed();
                return false;
            });
        }

        [CCode (instance_pos = -1)]
        private static void on_ice_candidate_cb(Gst.Element element,
                                                uint mline_index,
                                                string candidate,
                                                WebrtcbinBridge self) {
            uint idx = mline_index;
            string cand = candidate;
            GLib.Idle.add(() => {
                self.icecandidate(idx, cand);
                return false;
            });
        }

        [CCode (instance_pos = -1)]
        private static void on_data_channel_cb(Gst.Element element,
                                               Gst.WebRTCDataChannel channel,
                                               WebrtcbinBridge self) {
            // Eagerly wrap the incoming channel in a DataChannelBridge *on
            // the streaming thread* so its signal handlers are installed
            // before any on-message-* callbacks can fire. This avoids a
            // race where early messages would arrive before the JS-side
            // RTCDataChannel (and thus the DataChannelBridge) is created.
            var bridge = new DataChannelBridge(channel);
            GLib.Idle.add(() => {
                self.datachannel(bridge);
                return false;
            });
        }

        // ---- notify:: handlers for state-change properties ----

        private void handle_connection_state(GLib.ParamSpec pspec) {
            GLib.Idle.add(() => {
                this.connection_state_changed();
                return false;
            });
        }

        private void handle_signaling_state(GLib.ParamSpec pspec) {
            GLib.Idle.add(() => {
                this.signaling_state_changed();
                return false;
            });
        }

        private void handle_ice_connection_state(GLib.ParamSpec pspec) {
            GLib.Idle.add(() => {
                this.ice_connection_state_changed();
                return false;
            });
        }

        private void handle_ice_gathering_state(GLib.ParamSpec pspec) {
            GLib.Idle.add(() => {
                this.ice_gathering_state_changed();
                return false;
            });
        }

        /**
         * Disconnect all handlers from the wrapped webrtcbin. Call this
         * from RTCPeerConnection.close() to break the reference cycle
         * before the pipeline is torn down.
         */
        public void dispose_bridge() {
            foreach (ulong id in _handler_ids) {
                if (GLib.SignalHandler.is_connected(bin, id)) {
                    GLib.SignalHandler.disconnect(bin, id);
                }
            }
            _handler_ids = {};
        }
    }
}
