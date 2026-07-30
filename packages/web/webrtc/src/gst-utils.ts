// Async bridging between GstPromise and JavaScript Promises.
//
// Reference: refs/node-gst-webrtc/src/gstUtils.ts (ISC, Ratchanan Srirattanamet)
//
// Why a native bridge? Gst.Promise.new_with_change_func() invokes its
// callback on GStreamer's internal streaming thread. GJS blocks any JS
// callback invoked from a non-main thread (to prevent SpiderMonkey VM
// corruption), so the change_func is never delivered to JS — the Promise
// would hang forever.
//
// `@gjsify/webrtc-native/PromiseBridge` is a Vala helper that registers
// the change_func on the C side, hops through `g_main_context_invoke()`
// to the GLib main thread, and only then emits `replied` / `rejected`
// signals which JS can safely consume.

import type Gst from 'gi://Gst?version=1.0';
import { PromiseBridge } from '@gjsify/webrtc-native';

/**
 * Wrap a GstPromise-consuming emit into a JS Promise that resolves on the
 * main thread.
 *
 * Usage:
 *   const reply = await withGstPromise((promise) => {
 *     webrtcbin.emit('create-offer', options, promise);
 *   });
 */
export function withGstPromise(emit: (promise: Gst.Promise) => void): Promise<Gst.Structure | null> {
    return new Promise((resolve, reject) => {
        const bridge = new PromiseBridge();
        bridge.connect('replied', (_b: unknown, reply: Gst.Structure | null) => {
            resolve(reply);
        });
        bridge.connect('rejected', (_b: unknown, message: string) => {
            reject(new Error(message));
        });
        emit(bridge.promise);
    });
}

/**
 * Read the RTP CNAME of a webrtcbin — "the CNAME of the associated
 * RTCPeerConnection" that W3C § 5.2 getParameters exposes as `rtcp.cname`.
 *
 * webrtcbin's internal rtpbin generates one canonical name per connection
 * (used in its RTCP SDES packets) and exposes it through rtpbin's `sdes`
 * GstStructure (`application/x-rtp-source-sdes, cname=(string)…`). The
 * rtpbin child is class-installed by GstWebRTCBin under the fixed name
 * "rtpbin".
 */
export function getRtcpCname(webrtcbin: Gst.Element): string | undefined {
    try {
        const rtpbin = (webrtcbin as Gst.Bin).get_by_name('rtpbin') as (Gst.Element & { sdes?: Gst.Structure }) | null;
        const cname = rtpbin?.sdes?.get_string('cname');
        return cname ?? undefined;
    } catch {
        return undefined;
    }
}
