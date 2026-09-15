// The parent half of `@gjsify/unit`'s hang breadcrumb: a deadline enforced from OUTSIDE the
// process that missed it.
//
// A GJS test bundle that blocks its own main loop — a spin, a nested `GLib.MainLoop.run()`, a
// blocking GI call into GStreamer — cannot fail itself. `@gjsify/unit`'s per-test, per-suite
// and per-run timeouts are all `setTimeout` races, and both halves of a race need the loop, so
// the run simply goes quiet and keeps the job's stdio open until CI's own cap kills it: run
// 34945600666 burned 90 minutes that way and arrived as an unexplained red on an unrelated PR.
// The full measurement is in `packages/gjs/unit/src/heartbeat.ts`.
//
// So the child writes `<deadline-epoch-ms>\t<label>` before each test, and this polls that
// file. Past the deadline plus a grace margin the test is not slow — the harness would have
// failed it itself — so this names it, grabs a native backtrace while the wedge is still
// standing, and kills the child.
//
// Inert by construction: a bundle that is not an `@gjsify/unit` run writes no heartbeat, so
// `parseHeartbeat` returns `null` forever and a GUI launched through `gjsify run` is never
// touched. That is why this needs no flag to be safe.

import { spawnSync } from 'node:child_process';

/** One line of the heartbeat file. */
export interface Heartbeat {
    /** Epoch ms the in-flight work is due by; `0` means the harness set no deadline. */
    deadlineMs: number;
    /** `<suite> › <test>`, or `<test run>` between tests. */
    label: string;
}

/** Grace on top of the harness's own deadline before a late test is called a hung one. */
export const DEFAULT_GRACE_MS = 30_000;

/** How often the file is read. A hang is a minutes-scale event; a second of latency is free. */
export const DEFAULT_POLL_MS = 1_000;

/**
 * Parse one heartbeat line. Returns `null` for anything that is not one — an absent file, a
 * half-written line, a bundle that is not a test run — because every one of those means "no
 * claim was made", and a watchdog that guesses when nobody claimed anything is a watchdog that
 * kills healthy processes.
 */
export function parseHeartbeat(text: string | null | undefined): Heartbeat | null {
    if (!text) return null;
    const line = text.split('\n', 1)[0] ?? '';
    const tab = line.indexOf('\t');
    if (tab < 0) return null;
    const deadlineMs = Number(line.slice(0, tab));
    if (!Number.isFinite(deadlineMs) || deadlineMs < 0) return null;
    const label = line.slice(tab + 1).trim();
    if (label.length === 0) return null;
    return { deadlineMs, label };
}

/**
 * The message a CI reader gets instead of 86 minutes of silence. Names the test, says why the
 * run could not say so itself, and carries whatever the backtrace probe found — the native
 * frame is the part that points at the actual wedge (a `gst_pad_*` call, a `pthread_cond_wait`)
 * and is the one thing no amount of re-running recovers once the process is gone.
 */
export function formatHangReport(input: { label: string; overdueMs: number; pid: number; backtrace?: string }): string {
    const lines = [
        `⏱ hang: "${input.label}" is ${Math.round(input.overdueMs / 1000)}s past its own deadline`,
        `  gjs pid ${input.pid} stopped turning its main loop, so @gjsify/unit's timeout cannot fire`,
        `  (see packages/gjs/unit/src/heartbeat.ts). Killing it rather than holding the job open.`,
    ];
    if (input.backtrace) {
        lines.push('  native backtrace at the moment of the hang:');
        for (const l of input.backtrace.split('\n')) lines.push(`    ${l}`);
    }
    return lines.join('\n');
}

/**
 * Best-effort native backtrace of a wedged process, capped at `maxLines`.
 *
 * `eu-stack` (elfutils) ships in the CI images and needs no debuginfo to name the frames. On
 * the measured webrtc shape it prints the answer outright — `g_main_loop_run` under
 * `ffi_call`, i.e. a GI call that entered a loop it never left — which is what no amount of
 * re-running recovers once the process is gone.
 *
 * WHATEVER it produced is kept, even on a non-zero exit: unwinding a live process is partial
 * by nature (a thread that moves mid-walk fails the walk), and the frames it did get are
 * exactly the ones worth having. Absent, unpermitted (`ptrace_scope`) or slow, this returns
 * `undefined` and the report is printed without it — diagnostics must never be the reason a
 * hang report fails to appear, and 5 s is the most this may add to a report someone is waiting
 * for.
 */
export function captureNativeBacktrace(pid: number, maxLines = 40): string | undefined {
    try {
        const r = spawnSync('eu-stack', ['-p', String(pid)], {
            encoding: 'utf8',
            timeout: 5_000,
            maxBuffer: 4 * 1024 * 1024,
        });
        const out = typeof r.stdout === 'string' ? r.stdout.trim() : '';
        if (out.length === 0) return undefined;
        return out.split('\n').slice(0, maxLines).join('\n');
    } catch (_e) {
        /* no eu-stack, or no permission to attach — the report stands without it */
        return undefined;
    }
}

export interface HangWatchdogDeps {
    /** Read the heartbeat file; `null` when it is absent or unreadable. */
    read: () => string | null;
    /** Injected for the spec, which drives a fake clock rather than waiting 30 s. */
    now?: () => number;
    graceMs?: number;
    /** Called once, with the in-flight breadcrumb and how far past its deadline it is. */
    onHang: (heartbeat: Heartbeat, overdueMs: number) => void;
}

export interface HangWatchdog {
    /** One poll. Exposed so the spec needs neither real timers nor real files. */
    tick: () => void;
    start: (pollMs?: number) => void;
    stop: () => void;
}

/**
 * Poll the heartbeat and fire `onHang` at most once.
 *
 * Latched deliberately: the child is still wedged on the next tick, and a second report would
 * bury the first under repeats of itself.
 */
export function createHangWatchdog(deps: HangWatchdogDeps): HangWatchdog {
    const now = deps.now ?? Date.now;
    const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
    let timer: ReturnType<typeof setInterval> | undefined;
    let fired = false;

    const tick = (): void => {
        if (fired) return;
        const hb = parseHeartbeat(deps.read());
        // `deadlineMs === 0` is the harness saying "no deadline here" (`{ timeout: 0 }`, or
        // the window after the run finished). Enforcing one it declined to set is exactly the
        // false positive that would make this guard get turned off.
        if (!hb || hb.deadlineMs <= 0) return;
        const overdueMs = now() - (hb.deadlineMs + graceMs);
        if (overdueMs < 0) return;
        fired = true;
        stop();
        deps.onHang(hb, now() - hb.deadlineMs);
    };

    const stop = (): void => {
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
    };

    return {
        tick,
        start: (pollMs = DEFAULT_POLL_MS) => {
            if (timer === undefined) timer = setInterval(tick, pollMs);
        },
        stop,
    };
}
