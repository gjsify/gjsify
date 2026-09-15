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
// file. Past the deadline plus a grace margin this names the test, grabs a native backtrace
// while the wedge is still standing, and kills the child.
//
// The grace is a POLICY, not an inference from the harness, and the difference is measured. A
// body that blocks the loop past its own timeout and then RETURNS passes today: `withTimeout`
// arms its timer before calling `fn()`, but the expired timer is cleared in `finally` before
// the loop ever turns again, so the already-resolved body wins the race. A 12 s synchronous
// body under a 5 s timeout exits 0 on `main`; with a 3 s grace this guard kills it. The grace
// is therefore "how long a body may legitimately block the loop beyond its own budget" — at
// the 30 s default, 7x the 5 s test timeout — which is why the report names
// `GJSIFY_HANG_GRACE_MS`: a false positive has to be fixable by whoever hits it.
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
 * Grace on top of the harness's own deadline, read from `GJSIFY_HANG_GRACE_MS`. `0` turns the
 * watchdog off — the escape hatch for a debugger parked on a breakpoint, which looks exactly
 * like a hang from out here.
 *
 * A BLANK value is the DEFAULT, not `0`. `Number('')` is `0`, so a matrix leg that sets the
 * variable to an empty string (the shape every `${{ }}` expansion takes when its input is
 * missing) would have switched the guard off without anyone writing a zero — a guard silently
 * disarmed by an empty string is the failure mode this whole PR exists to stop.
 */
export function hangGraceMs(env: Record<string, string | undefined>): number {
    const raw = env.GJSIFY_HANG_GRACE_MS;
    if (raw === undefined || raw.trim() === '') return DEFAULT_GRACE_MS;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_GRACE_MS;
}

/**
 * The child's environment with `GJSIFY_UNIT_HEARTBEAT` pointing at `path` — or REMOVED when
 * there is none.
 *
 * Removing it is the load-bearing half. The variable is INHERITED, so a spawn that mints no
 * file of its own (`GJSIFY_HANG_GRACE_MS=0`, or a `/tmp` that refused) used to hand the child
 * an OUTER run's heartbeat path. The inner run then wrote its own per-test deadlines into the
 * outer run's file, and the outer watchdog judged them against the outer child's pid: a short
 * inner deadline kills a healthy outer child, and the inner run's closing `0\t<run finished>`
 * disarms the outer guard outright. Measured before the fix — with the variable preset and the
 * grace at 0, the child wrote `0\t<run finished>` into the inherited path.
 */
export function heartbeatEnv(
    base: Record<string, string | undefined>,
    path: string | undefined,
): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...base };
    if (path) env.GJSIFY_UNIT_HEARTBEAT = path;
    else delete env.GJSIFY_UNIT_HEARTBEAT;
    return env;
}

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
export function formatHangReport(input: {
    label: string;
    overdueMs: number;
    pid: number;
    graceMs?: number;
    backtrace?: string;
}): string {
    const lines = [
        `⏱ hang: "${input.label}" is ${Math.round(input.overdueMs / 1000)}s past its own deadline`,
        `  gjs pid ${input.pid} stopped turning its main loop, so @gjsify/unit's timeout cannot fire`,
        `  (see packages/gjs/unit/src/heartbeat.ts). Killing it rather than holding the job open.`,
    ];
    if (input.backtrace) {
        lines.push('  native backtrace at the moment of the hang:');
        for (const l of input.backtrace.split('\n')) lines.push(`    ${l}`);
    } else {
        // Said out loud. Silence here reads as "the guard had nothing to add", when what it
        // means is that the one artefact a dead process cannot be asked for again was missed.
        lines.push('  no native backtrace: eu-stack (elfutils) absent, refused the attach, or found nothing');
    }
    if (input.graceMs !== undefined) {
        // The knob travels WITH the accusation: whoever reads this is the one person who can
        // tell a wedge from a body that legitimately blocks the loop this long.
        lines.push(`  a test that legitimately blocks the loop this long: raise GJSIFY_HANG_GRACE_MS`);
        lines.push(`  (now ${input.graceMs} ms, 0 disables this guard).`);
    }
    return lines.join('\n');
}

/**
 * Best-effort native backtrace of a wedged process, capped at `maxLines`.
 *
 * `eu-stack` (elfutils) needs no debuginfo to name the frames. It is NOT in the base image of
 * every runner — `.docker/ci-fedora.Dockerfile` installs it on purpose, and macOS and Windows
 * runners have no such tool at all, so this returning `undefined` is a normal outcome. On
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
