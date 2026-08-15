// The payload the packers see.
//
// One shape, read back off the staged tree rather than carried in memory from
// the planner. That is deliberate: it makes `gjsify ship --stage` and
// `gjsify ship --target deb` provably the same payload, because the second
// reads what the first wrote. A packer fed straight from the planner could
// drift from the staged tree and nothing would notice.

import { statSync } from 'node:fs';

/** One file in the payload, with its bytes. */
export interface PayloadEntry {
    /** Prefix-relative path, POSIX-separated, e.g. `bin/learn6502`. */
    path: string;
    /** POSIX mode bits. */
    mode: number;
    data: Uint8Array;
}

/**
 * The build stamp every header gets.
 *
 * `SOURCE_DATE_EPOCH` is the cross-ecosystem convention and wins when it is
 * set. Without it the stamp is the BUNDLE's mtime — never `Date.now()`, which
 * is the one input guaranteeing that packing the same tree twice produces
 * different bytes, and never a fixed 0 either: `Build Date: 1 Jan 1970` is
 * what `rpm -qi` then shows a user, and an artifact that looks broken is a
 * support question. The mtime keeps the property that matters (pack the same
 * build twice, get the same bytes) while saying something true.
 */
export function buildTimestamp(bundlePath: string, env: Record<string, string | undefined> = process.env): number {
    const raw = env.SOURCE_DATE_EPOCH;
    if (raw !== undefined) {
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 0) {
            throw new Error(`gjsify ship: SOURCE_DATE_EPOCH must be a non-negative integer, got "${raw}".`);
        }
        return parsed;
    }
    return Math.floor(statSync(bundlePath).mtimeMs / 1000);
}

/** Does the payload contain anything architecture-specific? */
export function isArchIndependent(payload: readonly PayloadEntry[]): boolean {
    return !payload.some((entry) => /\.(so|node|dylib|dll)(\.\d+)*$/.test(entry.path));
}
