// Guaranteed NULL-state teardown for every GStreamer pipeline this package
// creates.
//
// GStreamer requires a pipeline to reach `GST_STATE_NULL` before its last
// reference goes away. Drop a PLAYING one and it prints, per element:
//
//   GStreamer-CRITICAL **: Trying to dispose element src, but it is in PLAYING
//   instead of the NULL state. You need to explicitly set elements to the NULL
//   state before dropping the final reference, to allow them to clean up.
//
// Two ways that happened here, and a per-call-site `set_state(NULL)` fixes
// neither:
//
//  1. `GstPlayer` defers its NULL transition to a LOW-priority GLib idle on
//     purpose — `autoaudiosink` teardown flushes the audio device, which costs
//     several ms and drops frames when SFX fire during gameplay. An idle that
//     the main loop never reaches (the app quit first) simply never runs.
//  2. A pipeline still PLAYING at exit was never handed to a cleanup path at
//     all — the ordinary case of quitting a game while a sound plays.
//
// Both are the same shape: teardown that depends on the process living long
// enough. So ownership moves here — every pipeline is REGISTERED on creation and
// removed only once it has actually reached NULL, and `stopAllPipelines()`
// drains whatever is left. It is wired to `GApplication::shutdown`, which fires
// while the main loop is still alive, so the deferred transitions can complete.
//
// A GTK app is not the only host, though: a plain script or a unit-test bundle
// has no `GApplication` at all, and its pipelines were disposed in PLAYING for
// exactly the same reason (the webaudio spec suite printed one on every run).
// So BOTH exits are covered — `GApplication::shutdown` for an app, and
// `process.on('exit')` for everything else — each registered at most once, and
// both harmless together because `stopPipeline()` is idempotent.
//
// Registration is opportunistic and retried: `Gio.Application.get_default()` is
// null until the app is constructed, and `globalThis.process` only exists once
// the `@gjsify/process` polyfill is registered. Callers that own a lifecycle of
// their own — `AudioContext.close()` — call `stopAllPipelines()` directly and
// do not depend on either hook.

import Gio from 'gi://Gio?version=2.0';
import { Gst } from './gst-init.js';
import type Gst1 from '@girs/gst-1.0';

/** Pipelines created by this package that have not reached NULL yet. */
const LIVE_PIPELINES = new Set<Gst1.Element>();

let appHookInstalled = false;
let processHookInstalled = false;

/** The `process.on('exit', …)` slice this module uses, when one is registered. */
interface _ProcessExitHost {
    process?: { on?: (event: string, listener: () => void) => unknown };
}

/**
 * Connect `stopAllPipelines()` to whichever exit this host actually has — the
 * default `GApplication`'s `shutdown` signal and/or `process`'s `exit` event.
 * Each is installed at most once and skipped (retried by the next caller) while
 * the corresponding host object does not exist yet.
 */
function ensureShutdownHook(): void {
    if (!appHookInstalled) {
        const app = Gio.Application.get_default();
        if (app) {
            app.connect('shutdown', () => stopAllPipelines());
            appHookInstalled = true;
        }
    }

    if (!processHookInstalled) {
        const proc = (globalThis as unknown as _ProcessExitHost).process;
        if (typeof proc?.on === 'function') {
            proc.on('exit', () => stopAllPipelines());
            processHookInstalled = true;
        }
    }
}

/** Register a pipeline as live. Call right after it is created. */
export function trackPipeline(pipeline: Gst1.Element): void {
    LIVE_PIPELINES.add(pipeline);
    ensureShutdownHook();
}

/**
 * Bring one tracked pipeline to NULL and forget it. Idempotent, and a no-op for
 * a pipeline that some other path already tore down — which is what makes the
 * deferred idle in `GstPlayer` safe to race against shutdown.
 */
export function stopPipeline(pipeline: Gst1.Element): void {
    if (!LIVE_PIPELINES.delete(pipeline)) return;
    pipeline.set_state(Gst.State.NULL);
}

/** Bring every still-live pipeline to NULL. Safe to call more than once. */
export function stopAllPipelines(): void {
    // oxlint-disable-next-line unicorn/no-useless-spread -- the COPY is the point: a Set iterator is live, and `set_state(NULL)` can dispatch a bus message that re-enters `stopPipeline` for a DIFFERENT pipeline mid-iteration
    for (const pipeline of [...LIVE_PIPELINES]) stopPipeline(pipeline);
}

/** How many pipelines are currently tracked — for tests. */
export function livePipelineCount(): number {
    return LIVE_PIPELINES.size;
}
