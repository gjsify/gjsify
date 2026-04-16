// Async bridging between GstPromise and JavaScript Promises.
//
// Reference: refs/node-gst-webrtc/src/gstUtils.ts (ISC, Ratchanan Srirattanamet)
// Adapted from node-gtk to GJS — GJS can marshal JS closures directly into
// `Gst.Promise.new_with_change_func`, which removes the need for a native
// wrapper (node-gst-webrtc's NgwNative.Promise).

import Gst from 'gi://Gst?version=1.0';
import GLib from 'gi://GLib?version=2.0';

/**
 * Wrap a GstPromise-consuming emit into a JS Promise.
 *
 * Usage:
 *   const reply = await withGstPromise((promise) => {
 *     webrtcbin.emit('create-offer', options, promise);
 *   });
 */
export function withGstPromise(
    emit: (promise: Gst.Promise) => void,
): Promise<Gst.Structure | null> {
    return new Promise((resolve, reject) => {
        const gstPromise = Gst.Promise.new_with_change_func((p: Gst.Promise) => {
            const result = p.wait();
            switch (result) {
                case Gst.PromiseResult.INTERRUPTED:
                    reject(new Error('GstPromise interrupted'));
                    return;
                case Gst.PromiseResult.EXPIRED:
                    reject(new Error('GstPromise expired'));
                    return;
                case Gst.PromiseResult.REPLIED: {
                    const reply = p.get_reply();
                    if (reply && reply.has_field('error')) {
                        const errVal = reply.get_value('error') as any;
                        const gerr = errVal?.get_boxed?.() as GLib.Error | undefined;
                        reject(new Error(gerr?.message ?? 'GstPromise error'));
                        return;
                    }
                    resolve(reply);
                    return;
                }
                default:
                    reject(new Error(`Unexpected GstPromise result: ${result}`));
            }
        });
        emit(gstPromise);
    });
}
