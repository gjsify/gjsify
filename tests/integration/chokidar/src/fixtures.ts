// Resolves absolute paths to the per-suite fixture tree relative to the
// bundle. `import.meta.url` of this source file points at `src/fixtures.ts`
// at build time, but after bundling the bundle lives at
// `dist/test.{node,gjs}.mjs` — fixtures/ sits one directory up from there in
// both cases. We resolve via new URL(...) so the path follows the bundle, not
// the source layout.
//
// chokidar's own test suite mutates state heavily (mkdir / write / unlink /
// rename across many subdirs), so each spec gets its own freshly-created
// subdirectory under fixtures/ and is responsible for cleaning it up.

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

let subdirId = 0;
export function makeFreshSubdir(label: string): string {
    // Stable, collision-free path per call. `label` is for human-readable
    // diagnostics if a teardown leaves a directory behind.
    const id = ++subdirId;
    const dir = join(FIXTURES_DIR, `${label}-${id}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    return dir;
}

export function cleanupSubdir(dir: string): void {
    rmSync(dir, { recursive: true, force: true });
}

/** ms-delay helper — chokidar's own tests use a 20 ms baseline. */
export function delay(ms = 50): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve once a spy has been called at least N times, or reject after `timeoutMs`.
 * Mirrors `waitFor([spy])` from chokidar's upstream test.mjs but without sinon
 * — we use a plain `{ callCount }` shape produced by `makeSpy()` below.
 */
export interface Spy<Args extends unknown[]> {
    (...args: Args): void;
    callCount: number;
    calls: Args[];
    calledWith(...needle: unknown[]): boolean;
}

export function makeSpy<Args extends unknown[]>(): Spy<Args> {
    const calls: Args[] = [];
    const fn = ((...args: Args) => {
        calls.push(args);
    }) as Spy<Args>;
    Object.defineProperty(fn, 'callCount', { get: () => calls.length });
    fn.calls = calls;
    fn.calledWith = (...needle: unknown[]) =>
        calls.some((args) => needle.every((n, i) => args[i] === n));
    return fn;
}

export async function waitFor<A extends unknown[]>(
    spy: Spy<A>,
    minCount = 1,
    timeoutMs = 4000,
): Promise<void> {
    const start = Date.now();
    while (spy.callCount < minCount) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`waitFor timeout: expected ${minCount} call(s), got ${spy.callCount}`);
        }
        await delay(20);
    }
}
