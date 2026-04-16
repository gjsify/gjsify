/*
 * DataChannelBridge — GstWebRTCDataChannel signals → main-thread signals.
 *
 * Same rationale as WebrtcbinBridge: GStreamer data-channel signals
 * (on-open / on-close / on-error / on-message-string /
 * on-message-data / on-buffered-amount-low) fire on the streaming
 * thread, GJS blocks cross-thread JS callbacks, so we mirror them
 * through a GLib.Idle.add() hop.
 *
 * Usage from JS:
 *   const bridge = new GjsifyWebrtc.DataChannelBridge(gstDataChannel);
 *   bridge.connect('message-string', (_b, str) => { ... });
 *   bridge.connect('message-data', (_b, bytes) => { ... });
 */
namespace GjsifyWebrtc {

    public class DataChannelBridge : GLib.Object {

        public Gst.WebRTCDataChannel channel { get; construct; }

        /** on-open */
        public signal void opened();
        /** on-close */
        public signal void closed();
        /** on-error(GLib.Error) — delivered as the message string */
        public signal void error_occurred(string message);
        /** on-message-string(string) */
        public signal void message_string(string data);
        /** on-message-data(GLib.Bytes) */
        public signal void message_data(GLib.Bytes data);
        /** on-buffered-amount-low */
        public signal void buffered_amount_low();
        /** notify::ready-state — fires on state transitions (connecting/open/closing/closed) */
        public signal void ready_state_changed();

        private ulong[] _handler_ids = {};

        public DataChannelBridge(Gst.WebRTCDataChannel channel) {
            Object(channel: channel);
        }

        construct {
            _handler_ids += channel.on_open.connect(this.handle_open);
            _handler_ids += channel.on_close.connect(this.handle_close);
            _handler_ids += channel.on_error.connect(this.handle_error);
            _handler_ids += channel.on_message_string.connect(this.handle_message_string);
            _handler_ids += channel.on_message_data.connect(this.handle_message_data);
            _handler_ids += channel.on_buffered_amount_low.connect(this.handle_buffered_amount_low);
            _handler_ids += channel.notify["ready-state"].connect(this.handle_ready_state_changed);
        }

        private void handle_open() {
            GLib.Idle.add(() => {
                this.opened();
                return false;
            });
        }

        private void handle_close() {
            GLib.Idle.add(() => {
                this.closed();
                return false;
            });
        }

        private void handle_error(GLib.Error err) {
            string msg = (err != null && err.message != null) ? err.message : "RTCDataChannel error";
            GLib.Idle.add(() => {
                this.error_occurred(msg);
                return false;
            });
        }

        private void handle_message_string(string? str) {
            string payload = str ?? "";
            GLib.Idle.add(() => {
                this.message_string(payload);
                return false;
            });
        }

        private void handle_message_data(GLib.Bytes? data) {
            GLib.Bytes payload = data ?? new GLib.Bytes(new uint8[0]);
            GLib.Idle.add(() => {
                this.message_data(payload);
                return false;
            });
        }

        private void handle_buffered_amount_low() {
            GLib.Idle.add(() => {
                this.buffered_amount_low();
                return false;
            });
        }

        private void handle_ready_state_changed(GLib.ParamSpec pspec) {
            GLib.Idle.add(() => {
                this.ready_state_changed();
                return false;
            });
        }

        /** Disconnect all handlers from the wrapped channel. */
        public void dispose_bridge() {
            foreach (ulong id in _handler_ids) {
                if (GLib.SignalHandler.is_connected(channel, id)) {
                    GLib.SignalHandler.disconnect(channel, id);
                }
            }
            _handler_ids = {};
        }
    }
}
