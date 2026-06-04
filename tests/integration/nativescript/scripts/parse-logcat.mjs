// Parse the __GJSIFY_NS__ marker grammar out of a logcat dump.
// Returns { runId, passed, failed, total, cases:[{status,suite,name,message}], begun, complete }.
const M = '__GJSIFY_NS__';

export function parseLogcat(text, runId) {
    const lines = text.split('\n');
    const cases = [];
    let summary = null;
    let begun = false;
    let end = null;

    for (const raw of lines) {
        const i = raw.indexOf(M);
        if (i < 0) continue;
        const line = raw.slice(i + M.length).trim();

        if (line.startsWith('BEGIN ')) {
            if (!runId || line.slice(6).trim() === runId) begun = true;
        } else if (line.startsWith('CASE ')) {
            const m = /^CASE (PASS|FAIL) (.+?) :: (.+?)(?: -- ([\s\S]*))?$/.exec(line);
            if (m) cases.push({ status: m[1], suite: m[2], name: m[3], message: m[4] ?? '' });
        } else if (line.startsWith('SUMMARY ')) {
            const m = /passed=(\d+) failed=(\d+) total=(\d+)\s+(\S+)/.exec(line);
            if (m) summary = { passed: +m[1], failed: +m[2], total: +m[3], runId: m[4] };
        } else if (line.startsWith('END ')) {
            const m = /^END (PASS|FAIL) (\S+)/.exec(line);
            if (m) end = { status: m[1], runId: m[2] };
        }
    }

    return {
        runId: summary?.runId ?? end?.runId ?? null,
        passed: summary?.passed ?? cases.filter((c) => c.status === 'PASS').length,
        failed: summary?.failed ?? cases.filter((c) => c.status === 'FAIL').length,
        total: summary?.total ?? cases.length,
        cases,
        begun,
        complete: Boolean(summary && end),
    };
}
