/**
 * Rendering a conformance run.
 *
 * Two properties the five originals had and that must not be lost in the move:
 *
 *   1. **Findings name the fix.** Every failure line already carries the exact
 *      command or edit that resolves it. The renderer never truncates or
 *      re-wraps a finding for that reason — it prints what the rule wrote,
 *      indented, and adds nothing.
 *   2. **Notes print on SUCCESS too.** A run that verified 27 prebuild
 *      directories structurally and loaded 11 of them must say so; "OK" alone
 *      would let a reader assume all 27 were loaded. What a check did NOT do is
 *      part of its result, not an apology for it.
 *
 * GitHub annotations (`::error::`) are emitted when `GITHUB_ACTIONS` is set, so
 * a failing rule surfaces on the PR diff rather than only in the log.
 */

const inActions = () => Boolean(process.env.GITHUB_ACTIONS);

/** Prefix a multi-line finding so continuation lines stay visually attached. */
export function formatFindings(findings, { bullet = '  - ', indent = '    ' } = {}) {
    return findings.map((f) => bullet + String(f).split('\n').join(`\n${indent}`)).join('\n');
}

/**
 * Print a full run.
 *
 * @param {{results: Array<{rule: object, result: object}>, failures: string[], notes: string[], ok: boolean}} run
 * @param {{title?: string, out?: (s: string) => void, err?: (s: string) => void}} [options]
 * @returns {boolean} `run.ok`
 */
export function renderReport(run, { title = 'manifest-conformance', out = console.log, err = console.error } = {}) {
    if (run.ok) {
        for (const { rule, result } of run.results) {
            if (result.summary) out(result.summary);
            else out(`${rule.id}: OK.`);
        }
        for (const note of run.notes) err(`  · ${note}`);
        return true;
    }

    err(`${title}: FAILED.\n`);
    for (const { rule, result } of run.results) {
        const failures = result.failures ?? [];
        if (failures.length === 0) continue;
        err(`${rule.id} — ${failures.length} finding(s):`);
        for (const f of failures) {
            const text = String(f);
            err(inActions() ? `::error::${text.split('\n')[0]}` : '');
            err(formatFindings([text]));
        }
        err('');
    }
    if (run.notes.length > 0) {
        err('notes (what this run did NOT verify):');
        for (const note of run.notes) err(`  · ${note}`);
        err('');
    }
    return false;
}
