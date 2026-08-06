// SPDX-License-Identifier: MIT
// Read ALL of stdin, on Node AND inside the committed GJS bundles.
//
// `readFileSync(0, 'utf-8')` is the Node idiom for "slurp stdin". It used NOT to
// survive the GJS bundle: `@gjsify/fs` had no numeric-file-descriptor path, so
// the `0` was coerced to a PATH and the call opened the relative file `./0` —
// every GJS caller died with
//
//     Error: ENOENT: … read '0'   (readStdinLines → readFileSync)
//
// which silently disabled the ONE fixture-driven entry point AGENTS.md
// documents for testing the CI classifier (`--changed-from-stdin`).
//
// THE GAP IS CLOSED AT THE CORE, so the workaround is gone: `@gjsify/fs` maps
// the parent-supplied descriptors 0/1/2 onto the process's own Unix streams
// (`packages/node/fs/src/std-fd.ts`, reached from `readFileSync` through
// `sync.ts`), which makes the Node idiom mean the same thing under GJS. This
// module used to carry two GJS-only readers for that gap — a
// `GioUnix.InputStream` chunk loop and a `/dev/stdin` `Gio.File` fallback —
// plus a runtime branch to choose between them. All three were consumer-side
// repair for a missing core capability.
//
// Anything re-adding a GJS branch HERE is re-adding the workaround. If stdin
// misbehaves under GJS the defect is in `@gjsify/fs` and belongs there, with a
// test — that is what made the branch removable in the first place
// (`packages/node/fs/src/fd-ops.spec.ts` + `tests/e2e/fs-std-fd`, which needs a
// real pipe and so cannot live in a unit spec).

import { readFileSync } from 'node:fs';

/**
 * Read the whole of stdin as UTF-8. Works on Node and under the GJS bundle.
 *
 * Synchronous on purpose: the callers are CLI argument-parsing paths that run
 * before any main loop exists, and the async `process.stdin` route carries the
 * documented resume/pause races (see `utils/prompt.ts`).
 */
export function readStdinText(): string {
    return readFileSync(0, 'utf-8');
}

/**
 * Read stdin and split it into trimmed, non-empty lines. Accepts LF and CRLF
 * so a `git diff --name-only` piped from any host works unchanged.
 */
export function readStdinLines(): string[] {
    return splitStdinLines(readStdinText());
}

/** Pure line-splitter behind {@link readStdinLines} — unit-testable without a pipe. */
export function splitStdinLines(text: string): string[] {
    return text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
}
