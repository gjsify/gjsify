// Conversions between seconds (Web video API) and GStreamer's nanosecond
// `BigInt` timebase (used by `Gst.Format.TIME` throughout GStreamer). Lives
// in @gjsify/dom-elements so HTMLVideoElement/HTMLAudioElement can use it
// directly; @gjsify/video re-exports these for consumers of the bridge
// package. Kept as pure number math — no runtime Gst import required.

const NS_PER_SECOND = 1_000_000_000;

/**
 * Convert seconds (number) to GStreamer nanoseconds (bigint).
 * Rounds to the nearest nanosecond to avoid floating-point drift over
 * repeated back-and-forth conversions.
 */
export function secondsToGstTime(seconds: number): bigint {
    return BigInt(Math.round(seconds * NS_PER_SECOND));
}

/**
 * Convert GStreamer nanoseconds to seconds (number).
 * Accepts both `bigint` (the runtime type from GStreamer queries) and `number`
 * (what the `@girs/gst-1.0` typings currently declare — a known GIR bug for
 * `gint64` return values in `query_position` / `query_duration`).
 */
export function gstTimeToSeconds(nanoseconds: bigint | number): number {
    return Number(nanoseconds) / NS_PER_SECOND;
}
