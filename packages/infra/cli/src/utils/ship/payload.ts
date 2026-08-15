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

/**
 * Does the payload contain anything architecture-specific?
 *
 * Decided from the file's MAGIC, not from its name. A bundled runtime is just
 * called `node`, a stripped helper may have no extension at all, and an
 * extension list that misses one of them produces `Architecture: all` on an
 * x86-64 payload — which apt and dnf will happily install on arm64, where it
 * does not run.
 */
export function isArchIndependent(payload: readonly PayloadEntry[]): boolean {
    return !payload.some((entry) => isNativeBinary(entry.data));
}

/** ELF, Mach-O (both endiannesses, both widths, and a fat archive) or PE. */
function isNativeBinary(data: Uint8Array): boolean {
    if (data.byteLength < 4) return false;
    const magic = (data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!;
    switch (magic >>> 0) {
        case 0x7f454c46: // \x7fELF
        case 0xfeedface: // Mach-O 32
        case 0xfeedfacf: // Mach-O 64
        case 0xcefaedfe: // Mach-O 32, byte-swapped
        case 0xcffaedfe: // Mach-O 64, byte-swapped
        case 0xcafebabe: // Mach-O universal binary
            return true;
        default:
            return data[0] === 0x4d && data[1] === 0x5a; // MZ — PE/COFF
    }
}
