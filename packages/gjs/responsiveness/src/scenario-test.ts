// The assertion half of ADR 0149 § 9. Its own subpath (`@gjsify/responsiveness/scenario`)
// so the root entry stays headless: @gjsify/unit reaches @girs/gjs.

import { expect, it } from '@gjsify/unit';
import { measureScenario, type ScenarioOptions } from './scenario.js';

function perfSoft(): boolean {
    return (
        (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GJSIFY_PERF_SOFT ===
        '1'
    );
}

/**
 * `it(name)` that asserts `median <= budgetMs` and `stalls === 0`.
 * `GJSIFY_PERF_SOFT=1` softens only the duration; a stall stays a failure.
 */
export async function scenario(name: string, options: ScenarioOptions, fn: () => void | Promise<void>): Promise<void> {
    const runs = options.runs ?? 5;
    const warmup = options.warmup ?? 1;
    await it(
        name,
        async () => {
            const result = await measureScenario(name, options, fn);
            if (result.medianMs > options.budgetMs) {
                const message = `${name}: median ${result.medianMs.toFixed(1)} ms over budget ${options.budgetMs} ms`;
                if (perfSoft()) console.warn(`[gjsify-responsiveness] ${message} (GJSIFY_PERF_SOFT)`);
                else expect(result.medianMs <= options.budgetMs).toBe(true);
            }
            if (result.stalls > 0) {
                const where = Object.entries(result.bySpan)
                    .map(([span, n]) => `${span}×${n}`)
                    .join(', ');
                console.warn(
                    `[gjsify-responsiveness] ${name}: ${result.stalls} stall(s), worst ${result.worstStallMs.toFixed(1)} ms over ${result.thresholdMs.toFixed(0)} ms in ${where}`,
                );
            }
            expect(result.stalls).toBe(0);
        },
        { timeout: options.budgetMs * (runs + warmup) + 5000 },
    );
}
