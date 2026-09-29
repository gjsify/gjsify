// `node --test` reporter that turns a failing e2e SUITE FILE into ONE GitHub Actions
// check-run annotation: the suite path plus its FIRST error — mirroring
// `scripts/e2e-timing-reporter.mjs`'s shape (same event source, same "one thing
// per top-level test" grouping), but for readability instead of shard balancing.
//
// `scripts/e2e-shard.mjs` loads it on every `node --test` invocation, next to
// whichever human reporter is running (`spec`/`tap`) — it is a NO-OP off CI
// (`reportFailure` gates on `GITHUB_ACTIONS`), so a local `test:e2e` run sees
// nothing extra.
//
// FIRST error only, not every failing test in the file: an e2e suite is "one
// suite per directory" (tests/AGENTS.md), so the file-level annotation is the
// unit `ci-why` (docs/ci-selective.md) needs to name WHICH suite broke; every
// later failure in the same file is usually a symptom of the first (a fixture
// that failed to stage, a server that never started) and would only spend the
// shared 10-per-process annotation budget faster.

import { relative } from 'node:path';
import { reportFailure } from './lib/ci-report.mjs';

// oxlint-disable-next-line eslint/require-yield -- a `node --test` custom reporter is shaped as a generator regardless of whether it produces output chunks; this one's whole job is the reportFailure() side effect below, never its own destination file (see e2e-shard.mjs's reporterArgs)
export default async function* e2eAnnotateReporter(source) {
    const reported = new Set();
    for await (const event of source) {
        if (event.type !== 'test:fail') continue;
        const { name, nesting, file, details } = event.data;
        if (nesting !== 0 || !file) continue;
        const key = relative(process.cwd(), file).split('\\').join('/');
        if (reported.has(key)) continue;
        reported.add(key);
        const error = details?.error;
        const rawMessage = error?.cause?.message ?? error?.message ?? String(error ?? 'unknown failure');
        const message = `${name}: ${rawMessage.trim().split('\n')[0]}`;
        reportFailure({ title: `e2e: ${key}`, file: key, message });
    }
    // Nothing to write — this reporter exists for its `reportFailure` side effect,
    // never for its own destination file (see e2e-shard.mjs's reporterArgs).
}
