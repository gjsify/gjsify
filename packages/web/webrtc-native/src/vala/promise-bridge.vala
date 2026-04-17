/*
 * PromiseBridge — GstPromise → main-thread signal.
 *
 * Gst.Promise.new_with_change_func() invokes its callback on the
 * GStreamer streaming thread. GJS blocks cross-thread JS callbacks to
 * prevent SpiderMonkey VM corruption, so the bridge catches the reply
 * on the C side, hops to the GLib main context via GLib.Idle.add(),
 * and only then emits the `replied` / `rejected` signals — which JS
 * can safely handle.
 *
 * Usage from JS:
 *   const pb = new GjsifyWebrtc.PromiseBridge();
 *   pb.connect('replied', (_self, reply) => resolve(reply));
 *   pb.connect('rejected', (_self, msg) => reject(new Error(msg)));
 *   webrtcbin.emit('create-offer', opts, pb.promise);
 */
namespace GjsifyWebrtc {

    public class PromiseBridge : GLib.Object {

        /** Emitted on the main thread when the GstPromise replied successfully. */
        public signal void replied(Gst.Structure? reply);

        /** Emitted on the main thread when the GstPromise failed or expired. */
        public signal void rejected(string message);

        private Gst.Promise _promise;

        /** Consumer passes this to webrtcbin.emit('create-offer', opts, promise). */
        public Gst.Promise promise { get { return _promise; } }

        construct {
            // Keep a strong ref to `this` across the async hop.
            var self = this;
            _promise = new Gst.Promise.with_change_func((p) => {
                var result = p.wait();

                // Copy the reply off the promise so we can reach it from
                // the main-thread handler without holding the streaming-thread's
                // ownership model.
                Gst.Structure? reply_copy = null;
                string? error_message = null;

                if (result == Gst.PromiseResult.REPLIED) {
                    unowned Gst.Structure? reply = p.get_reply();
                    if (reply != null) {
                        reply_copy = reply.copy();
                        if (reply_copy.has_field("error")) {
                            unowned GLib.Value? err_val = reply_copy.get_value("error");
                            if (err_val != null) {
                                GLib.Error err = (GLib.Error) err_val.get_boxed();
                                error_message = err != null ? err.message : "GstPromise error";
                            }
                        }
                    }
                } else if (result == Gst.PromiseResult.EXPIRED) {
                    error_message = "GstPromise expired";
                } else if (result == Gst.PromiseResult.INTERRUPTED) {
                    error_message = "GstPromise interrupted";
                }

                GLib.Idle.add(() => {
                    if (error_message != null) {
                        self.rejected(error_message);
                    } else {
                        self.replied(reply_copy);
                    }
                    return false;
                });
            });
        }
    }
}
