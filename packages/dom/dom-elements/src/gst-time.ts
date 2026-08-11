// Conversions between seconds (Web video API) and GStreamer's nanosecond `BigInt`
// timebase (`Gst.Format.TIME`). Pure number math, so no runtime Gst import is needed.

const NS_PER_SECOND = 1_000_000_000;

/** Seconds to GStreamer nanoseconds, rounded to avoid drift over repeated round-trips. */
export function secondsToGstTime(seconds: number): bigint {
    return BigInt(Math.round(seconds * NS_PER_SECOND));
}

/**
 * GStreamer nanoseconds to seconds. Accepts `number` as well as `bigint` because the
 * `@girs/gst-1.0` typings declare `gint64` returns as `number` (`query_position` /
 * `query_duration`), while the runtime hands back a `bigint`.
 */
export function gstTimeToSeconds(nanoseconds: bigint | number): number {
    return Number(nanoseconds) / NS_PER_SECOND;
}
