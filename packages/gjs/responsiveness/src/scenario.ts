// A scenario is an @gjsify/unit test with a budget (ADR 0149 § 9).

import { armStallWatchdog, disarmStallWatchdog, getStallCounters, isStallWatchdogArmed, resetStallCounters } from './watchdog.js';
import { monotonicMs, startLagMonitor } from '@gjsify/utils/main-loop';

export interface ScenarioOptions {
    /** The median of `runs` must stay within this, ms. */
    budgetMs: number;
    /** Measured runs. Default 5. */
    runs?: number;
    /** Runs discarded before measuring. Default 1. */
    warmup?: number;
}

export interface ScenarioResult {
    name: string;
    medianMs: number;
    runsMs: number[];
    stalls: number;
    worstStallMs: number;
    /** The calibrated stall threshold the runs were armed at, ms. */
    thresholdMs: number;
    bySpan: Record<string, number>;
}

const TICK_MS = 10;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function median(values: readonly number[]): number {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values: readonly number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/** The threshold an idle host earns: `max(50, 3 × p99 noise)`, so a loaded runner raises its own bar. */
export function thresholdFromNoise(noiseMs: readonly number[]): number {
    return Math.max(50, 3 * percentile(noiseMs, 99));
}

async function calibrate(): Promise<number> {
    const noise: number[] = [];
    const idle = startLagMonitor({ intervalMs: TICK_MS, thresholdMs: Infinity, onSample: (ms) => noise.push(ms) });
    await sleep(200);
    idle.stop();
    return thresholdFromNoise(noise);
}

/** Drive `fn` and measure it without asserting. {@link scenario} is this plus the budget. */
export async function measureScenario(
    name: string,
    options: ScenarioOptions,
    fn: () => void | Promise<void>,
): Promise<ScenarioResult> {
    const runs = options.runs ?? 5;
    const warmup = options.warmup ?? 1;
    const wasArmed = isStallWatchdogArmed();
    const thresholdMs = await calibrate();
    armStallWatchdog({ thresholdMs });
    try {
        for (let i = 0; i < warmup; i++) {
            await fn();
            await sleep(TICK_MS * 2);
        }
        resetStallCounters();
        const runsMs: number[] = [];
        for (let i = 0; i < runs; i++) {
            const start = monotonicMs();
            await fn();
            runsMs.push(monotonicMs() - start);
            // Yield so the watchdog tick that follows a synchronous block is recorded.
            await sleep(TICK_MS * 2);
        }
        const counters = getStallCounters();
        return {
            name,
            medianMs: median(runsMs),
            runsMs,
            stalls: counters.stalls,
            worstStallMs: counters.worstMs,
            thresholdMs,
            bySpan: counters.bySpan,
        };
    } finally {
        disarmStallWatchdog();
        if (wasArmed) armStallWatchdog();
    }
}
