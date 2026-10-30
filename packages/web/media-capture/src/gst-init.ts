// Lazy GStreamer initialization shared by the capture chain and its consumers.
//
// This module is GJS-only — the Node alias layer routes it to @gjsify/empty.

import Gst from 'gi://Gst?version=1.0';
import GLib from 'gi://GLib?version=2.0';

let initialized = false;

/**
 * Plugin feature names `autoaudiosrc`/`autoaudiosink` must never select,
 * because their `open()` does not fail fast the way the ordinary candidates
 * (pipewiresrc/pulsesrc/alsasrc and their sink counterparts) do.
 *
 * The capture chain's source probe (`getUserMedia({ audio: true })` in `@gjsify/webrtc`) already has cause to
 * distrust `openalsrc` on this exact CI image: `ghcr.io/gjsify/ci-fedora:44`
 * has no reachable PipeWire/Pulse, so `chooseSource()` in
 * `capture-source.ts` falls through to `autoaudiosrc`, which GStreamer's
 * autodetect resolves to `openalsrc` there (see that file's `sourceChoice`
 * comment for the earlier, separately-measured incident: ten probes leaked
 * 12 threads/878 MB each, and a 125-iteration loop wedged the process at 409
 * threads with the main thread parked in `futex_do_wait`). The SAME `openal`
 * plugin backs the sink side, and it is not simply slow: OpenAL Soft runs
 * its OWN nested device-backend probe (PipeWire, then others) SYNCHRONOUSLY
 * inside `gst_element_set_state()`. `GstAutoDetect` (what `autoaudiosrc` and
 * `autoaudiosink` both are) runs a child's state change on the CALLING
 * thread, so on GJS's single JS thread a stall in that probe freezes the
 * whole process — measured directly in a `Multi-PC fan-out` test that moves
 * a getUserMedia track's source between pipelines (closing and reopening
 * it): `[ALSOFT] Failed to connect PipeWire` logged, then 31s of silence
 * until the heartbeat guard killed the job.
 *
 * Deranking both features keeps them out of the autodetect candidate list
 * entirely. `autoaudiosrc`/`autoaudiosink` already fall back gracefully when
 * no real candidate opens (verified: a host with no reachable audio server
 * still resolves to a `GstAudioTestSrc`/`GstFakeSink` child in well under
 * 100ms) — openal was defeating that fallback, not providing a needed one.
 *
 * `GJSIFY_GST_KEEP_OPENAL=1` skips this — for the rare host where OpenAL
 * Soft genuinely is the only working "Source/Audio" or "Sink/Audio"
 * candidate GStreamer has, and for A/B-testing this fix itself. Read once,
 * like every other `GJSIFY_*` boolean escape hatch in this workspace (e.g.
 * `GJSIFY_ALLOW_REFS_DRIFT`, `scripts/check-refs-pin.mjs`).
 *
 * `keepOpenal` is a parameter, not just an inline `GLib.getenv()` read, so a
 * test can exercise BOTH branches directly: `ensureGstInit()`'s bring-up
 * runs at most once per process (memoized in `initialized` below), so
 * flipping the env var afterward would prove nothing.
 */
const UNBOUNDED_AUTODETECT_CANDIDATES = ['openalsrc', 'openalsink'];

/** TEST SEAM (exported) — see the `keepOpenal` parameter doc above. */
export function excludeUnboundedAutodetectCandidates(
    keepOpenal: boolean = GLib.getenv('GJSIFY_GST_KEEP_OPENAL') === '1',
): void {
    if (keepOpenal) return;
    const registry = Gst.Registry.get();
    for (const name of UNBOUNDED_AUTODETECT_CANDIDATES) {
        registry.lookup_feature(name)?.set_rank(Gst.Rank.NONE);
    }
}

export function ensureGstInit(): void {
    if (initialized) return;
    Gst.init(null);
    excludeUnboundedAutodetectCandidates();
    initialized = true;
}

export { Gst };
