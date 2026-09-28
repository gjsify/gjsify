// `node --test` reporter that records how long each e2e SUITE FILE took, for the shard
// balancer in `scripts/e2e-shard.mjs`.
//
// `scripts/e2e-shard.mjs` loads it next to `spec` when `E2E_TIMINGS_OUT` names a directory,
// and every `node --test` call writes one JSON object `{ "<repo-relative file>": ms }`.
// `node scripts/e2e-shard.mjs --refresh-timings <dir>` folds those files into the committed
// `scripts/e2e-shard-timings.json`.
//
// A file's weight is the sum of its TOP-LEVEL tests' durations (`nesting === 0`). Tests in
// one file run in sequence, so the sum is the file's own wall time minus process start-up.
// Under `--test-concurrency=4` every figure also carries the contention of whatever ran
// beside it; the balancer only compares suites with each other, so a shared inflation is
// harmless.

import { relative } from 'node:path';

export default async function* e2eTimingReporter(source) {
    /** @type {Record<string, number>} */
    const perFile = {};
    for await (const event of source) {
        if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
        const { nesting, file, details } = event.data;
        if (nesting !== 0 || !file || typeof details?.duration_ms !== 'number') continue;
        const key = relative(process.cwd(), file).split('\\').join('/');
        perFile[key] = (perFile[key] ?? 0) + details.duration_ms;
    }
    const rounded = Object.fromEntries(
        Object.entries(perFile)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([f, ms]) => [f, Math.round(ms)]),
    );
    yield `${JSON.stringify(rounded, null, 4)}\n`;
}
