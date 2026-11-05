/**
 * Try the backends in order against a wall-clock budget and take the first that fits
 * (ADR 0127 decisions 11 and 12).
 *
 * THIS PACKAGE KNOWS HOW TO PROBE, NEVER WHAT. The candidates, their order and the budget come
 * from the caller: a speech package owns its engine list, an app owns how long it is willing to
 * wait. The probe is the only evidence that counts for speed — a static memory check
 * ({@link checkFit}) can rule a backend out, never in.
 *
 * WHEN IT RUNS is the caller's call too, and it should be when the work starts, not at install:
 * a GPU that was idle at install time can be busy later. Cache a result only while it is fresh.
 */

import { onBattery as machineOnBattery } from './power.js';

export interface BackendCandidate {
    readonly id: string;
    /**
     * Do one short, representative piece of the real work (load and run a tiny input). Throwing
     * means "does not work here". Stop when `signal` aborts: the probe has moved on by then.
     */
    run(signal: AbortSignal): Promise<unknown>;
}

export type ProbeAttemptOutcome = 'fits' | 'too-slow' | 'failed';

export interface ProbeAttempt {
    readonly id: string;
    readonly outcome: ProbeAttemptOutcome;
    /** Wall-clock time of the attempt; the budget for one cut short. */
    readonly ms: number;
    readonly error?: unknown;
}

/**
 * Why {@link ProbeResult.chosen} is what it is — the recommendation ADR 0127 decision 11 asks for:
 *
 *   • `fits`       — measured within budget; use it.
 *   • `setting`    — the user or app chose it explicitly; nothing was measured.
 *   • `none-fit`   — every candidate failed or was too slow; the feature should stay off by default.
 *   • `on-battery` — not measured, because a probe must not drain a battery; keep what you had.
 */
export type ProbeReason = 'fits' | 'setting' | 'none-fit' | 'on-battery';

export interface ProbeResult {
    readonly chosen: string | undefined;
    readonly reason: ProbeReason;
    readonly attempts: readonly ProbeAttempt[];
}

export interface ProbeOptions {
    /** An explicit choice (a setting, an environment variable). It always wins over a probe. */
    readonly setting?: string;
    /** Defaults to this machine's {@link onBattery}. */
    readonly onBattery?: () => boolean;
    /** Milliseconds; injected so a test controls time. */
    readonly now?: () => number;
    readonly setTimer?: (callback: () => void, ms: number) => unknown;
    readonly clearTimer?: (handle: unknown) => void;
}

const TOO_SLOW = Symbol('too-slow');

/**
 * Run `candidates` one after another, each against `budgetMs`, and return the first that finishes
 * within it.
 *
 * A candidate still running at the budget is aborted and counted `too-slow`; the probe does not
 * wait for it. One that ignores its signal keeps running in the background, so a GPU candidate
 * should honour it — and be wrapped in a {@link GpuGuard} by the caller.
 */
export async function probeBackends(
    candidates: readonly BackendCandidate[],
    budgetMs: number,
    options: ProbeOptions = {},
): Promise<ProbeResult> {
    if (options.setting !== undefined) {
        if (!candidates.some((candidate) => candidate.id === options.setting)) {
            const known = candidates.map((candidate) => candidate.id).join(', ');
            throw new RangeError(`unknown backend "${options.setting}"; expected one of: ${known}`);
        }
        return { chosen: options.setting, reason: 'setting', attempts: [] };
    }
    if ((options.onBattery ?? (() => machineOnBattery()))()) {
        return { chosen: undefined, reason: 'on-battery', attempts: [] };
    }

    const now = options.now ?? (() => Date.now());
    const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const attempts: ProbeAttempt[] = [];

    for (const candidate of candidates) {
        const controller = new AbortController();
        let handle: unknown;
        const deadline = new Promise<typeof TOO_SLOW>((resolve) => {
            handle = setTimer(() => resolve(TOO_SLOW), budgetMs);
        });
        const started = now();
        try {
            const work = candidate.run(controller.signal);
            // A candidate cut short rejects after the probe has moved on, usually with its abort.
            work.catch(() => undefined);
            const outcome = await Promise.race([work, deadline]);
            const ms = now() - started;
            if (outcome === TOO_SLOW || ms > budgetMs) {
                controller.abort();
                attempts.push({ id: candidate.id, outcome: 'too-slow', ms: Math.max(ms, budgetMs) });
                continue;
            }
            attempts.push({ id: candidate.id, outcome: 'fits', ms });
            return { chosen: candidate.id, reason: 'fits', attempts };
        } catch (error) {
            attempts.push({ id: candidate.id, outcome: 'failed', ms: now() - started, error });
        } finally {
            clearTimer(handle);
        }
    }
    return { chosen: undefined, reason: 'none-fit', attempts };
}
