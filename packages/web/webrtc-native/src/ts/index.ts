// @gjsify/webrtc-native — thin TS wrapper around the GjsifyWebrtc GIR module.
//
// The real implementation lives in src/vala/*.vala, compiled to
// prebuilds/<platform>/libgjsifywebrtc.so + GjsifyWebrtc-0.1.typelib by
// meson. This module only loads the typelib via `gi://` and exposes it
// with TypeScript types. Consumers should import the classes from here
// instead of using `imports.gi.GjsifyWebrtc` directly — that way we
// isolate the `gi://` resolution in one place and can adjust the load
// path (LD_LIBRARY_PATH / GI_TYPELIB_PATH) if needed.
//
// Types provided by @girs/gjsifywebrtc-0.1.

// The typelib is loaded on-demand. `gjsify run` sets LD_LIBRARY_PATH /
// GI_TYPELIB_PATH from the package's "gjsify.prebuilds" field before the
// runtime resolves `gi://GjsifyWebrtc`.
import GjsifyWebrtc from 'gi://GjsifyWebrtc?version=0.1';

export const PromiseBridge = GjsifyWebrtc.PromiseBridge;
export type PromiseBridge = GjsifyWebrtc.PromiseBridge;

export const WebrtcbinBridge = GjsifyWebrtc.WebrtcbinBridge;
export type WebrtcbinBridge = GjsifyWebrtc.WebrtcbinBridge;

export const DataChannelBridge = GjsifyWebrtc.DataChannelBridge;
export type DataChannelBridge = GjsifyWebrtc.DataChannelBridge;

export const ReceiverBridge = GjsifyWebrtc.ReceiverBridge;
export type ReceiverBridge = GjsifyWebrtc.ReceiverBridge;
