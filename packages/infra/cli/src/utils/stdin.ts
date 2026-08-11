// SPDX-License-Identifier: MIT
// Read ALL of stdin, on Node AND inside the committed GJS bundles.
//
// The Node idiom `readFileSync(0, 'utf-8')` means the same thing under GJS
// because `@gjsify/fs` maps the parent-supplied descriptors 0/1/2 onto the
// process's own Unix streams (`packages/node/fs/src/std-fd.ts`, reached from
// `readFileSync` via `sync.ts`).
//
// Keep this module runtime-agnostic: a GJS branch here would be consumer-side
// repair for a core capability. If stdin misbehaves under GJS the defect is in
// `@gjsify/fs` and belongs there, with a test — `fd-ops.spec.ts` for the fd
// mapping, `tests/e2e/affected-classifier-bundle` for the real pipe.

import { readFileSync } from 'node:fs';

/**
 * Read the whole of stdin as UTF-8.
 *
 * Synchronous on purpose: the callers are CLI argument-parsing paths that run
 * before any main loop exists, and the async `process.stdin` route carries the
 * resume/pause races documented in `utils/prompt.ts`.
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
