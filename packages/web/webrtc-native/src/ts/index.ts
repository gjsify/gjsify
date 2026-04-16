// @gjsify/webrtc-native — thin TS wrapper around the GjsifyWebrtc GIR module.
//
// The real implementation lives in src/vala/*.vala, compiled to
// prebuilds/<platform>/libgjsifywebrtc.so + GjsifyWebrtc-0.1.typelib by
// meson. This module only loads the typelib via `gi://` and exposes it
// with TypeScript types. Consumers should import the classes from here
// instead of using `imports.gi.GjsifyWebrtc` directly — that way we
// isolate the `gi://` resolution in one place and can adjust the load
// path (LD_LIBRARY_PATH / GI_TYPELIB_PATH) if needed.

import type Gst from '@girs/gst-1.0';
import type GObject from '@girs/gobject-2.0';
import type GLib from '@girs/glib-2.0';

// The typelib is loaded on-demand. `gjsify run` sets LD_LIBRARY_PATH /
// GI_TYPELIB_PATH from the package's "gjsify.prebuilds" field before the
// runtime resolves `gi://GjsifyWebrtc`.
// @ts-expect-error — resolved at runtime via GI
import GjsifyWebrtc from 'gi://GjsifyWebrtc?version=0.1';

/**
 * Wraps GstPromise so its change_func callback — which GStreamer invokes
 * on the streaming thread — is delivered on the GLib main context via a
 * `replied` or `rejected` signal.
 */
export interface PromiseBridge extends GObject.Object {
    readonly promise: Gst.Promise;
    connect(signal: 'replied', cb: (self: PromiseBridge, reply: Gst.Structure | null) => void): number;
    connect(signal: 'rejected', cb: (self: PromiseBridge, message: string) => void): number;
    connect(signal: string, cb: (...args: any[]) => void): number;
    disconnect(id: number): void;
}

/**
 * Mirrors webrtcbin's async signals onto the main thread. Connect on the
 * bridge, not on the element directly — GJS blocks JS callbacks from the
 * streaming thread.
 */
export interface WebrtcbinBridge extends GObject.Object {
    readonly bin: Gst.Element;
    connect(signal: 'negotiation-needed', cb: (self: WebrtcbinBridge) => void): number;
    connect(signal: 'icecandidate', cb: (self: WebrtcbinBridge, sdpMLineIndex: number, candidate: string) => void): number;
    connect(signal: 'datachannel', cb: (self: WebrtcbinBridge, channelBridge: DataChannelBridge) => void): number;
    connect(signal: 'connection-state-changed', cb: (self: WebrtcbinBridge) => void): number;
    connect(signal: 'signaling-state-changed', cb: (self: WebrtcbinBridge) => void): number;
    connect(signal: 'ice-connection-state-changed', cb: (self: WebrtcbinBridge) => void): number;
    connect(signal: 'ice-gathering-state-changed', cb: (self: WebrtcbinBridge) => void): number;
    connect(signal: string, cb: (...args: any[]) => void): number;
    disconnect(id: number): void;
    dispose_bridge(): void;
}

/** Mirrors GstWebRTCDataChannel signals onto the main thread. */
export interface DataChannelBridge extends GObject.Object {
    /** The underlying GstWebRTCDataChannel. Use Gst.WebRTCDataChannel for methods. */
    readonly channel: Gst.Element & { /* GstWebRTCDataChannel */ [key: string]: any };
    connect(signal: 'opened', cb: (self: DataChannelBridge) => void): number;
    connect(signal: 'closed', cb: (self: DataChannelBridge) => void): number;
    connect(signal: 'error-occurred', cb: (self: DataChannelBridge, message: string) => void): number;
    connect(signal: 'message-string', cb: (self: DataChannelBridge, data: string) => void): number;
    connect(signal: 'message-data', cb: (self: DataChannelBridge, data: GLib.Bytes) => void): number;
    connect(signal: 'buffered-amount-low', cb: (self: DataChannelBridge) => void): number;
    connect(signal: 'ready-state-changed', cb: (self: DataChannelBridge) => void): number;
    connect(signal: string, cb: (...args: any[]) => void): number;
    disconnect(id: number): void;
    dispose_bridge(): void;
}

interface PromiseBridgeCtor { new (): PromiseBridge; }
interface WebrtcbinBridgeCtor { new (args: { bin: Gst.Element }): WebrtcbinBridge; }
interface DataChannelBridgeCtor { new (args: { channel: unknown }): DataChannelBridge; }

const mod = GjsifyWebrtc as {
    PromiseBridge: PromiseBridgeCtor;
    WebrtcbinBridge: WebrtcbinBridgeCtor;
    DataChannelBridge: DataChannelBridgeCtor;
};

export const PromiseBridge = mod.PromiseBridge;
export const WebrtcbinBridge = mod.WebrtcbinBridge;
export const DataChannelBridge = mod.DataChannelBridge;
