// A deterministic ZIP writer, in-tree, execing nothing.
//
// SAME ARGUMENT AS THE HAND-WRITTEN `.deb` AND `.rpm` (ADR 0024 § A3): a format
// this tree writes itself needs no tool on the packing host, which is what keeps
// `zipinfo` an INDEPENDENT reader rather than the other half of a round trip.
// `zip(1)` would have been fewer lines and would have made the oracle
// `unzip`-reads-what-`zip`-wrote — two programs from one source distribution,
// which is the shape `oracle.selfReading` exists to confess.
//
// WHY THE MODE MATTERS ENOUGH TO WRITE A ZIP WRITER. The failure mode of a
// distributed `.app` is a launcher that arrives 0644 and will not run, and the
// zip's external-attributes field is the only place in the archive that can
// carry 0755. `actions/upload-artifact` has already proven the class inside this
// repository (`main.yml`'s ship-pack job: "the artifact round-trip does not
// preserve the mode"). So the writer sets the mode, and
// `.github/ship-oracle/verify-app-zip.sh` reads it back with `zipinfo -l` — not
// `unzip -Z1`, which prints names only and is blind to exactly this.
//
// STORE ONLY, no DEFLATE. A `.app` is mostly a JavaScript bundle and would
// compress well, but compression buys size and this milestone buys correctness:
// STORE is ~40 lines with one CRC table, DEFLATE means either a second
// implementation or peeling the 10-byte header and 8-byte trailer off
// `@gjsify/tar`'s gzip, and neither changes what any reader here checks. The
// method field is a per-entry constant so the day that trade flips, it is one
// branch and not a rewrite.
//
// DETERMINISM: every timestamp comes from the caller (the stage manifest's
// `mtime`), never `Date.now()`. Same rule as `buildTimestamp` and
// `gzipDeterministic`, and it is what lets `main.yml` compare two packs of one
// stage byte for byte.

import type { PayloadEntry } from './payload.js';

/** ZIP's own constants, spelled once. */
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
/** Stored, not deflated — see the module header. */
const METHOD_STORE = 0;
/**
 * `version made by`: high byte 3 = Unix, low byte 20 = ZIP spec 2.0.
 *
 * LOAD-BEARING, and the reason the mode survives. `zipinfo` and `unzip` read the
 * external attributes as POSIX bits ONLY when the high byte says the archive was
 * made on Unix; with the DOS value (0) the same 0755 in the same field is read as
 * DOS attribute flags and every file extracts at the umask default. The mode
 * would be in the archive and no reader would ever see it.
 */
const VERSION_MADE_BY = 0x0314;
/** `version needed to extract`: 2.0, the floor for everything this writer emits. */
const VERSION_NEEDED = 20;

/** The CRC-32 table, built once on first use rather than as a 256-entry literal. */
let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
    if (crcTable !== null) return crcTable;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        // The reversed polynomial 0xEDB88320 — ZIP, gzip and PNG all use this one.
        for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    crcTable = table;
    return table;
}

/** CRC-32 of a byte range, in ZIP's spelling (pre- and post-inverted). */
export function crc32(data: Uint8Array): number {
    const table = getCrcTable();
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = (table[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A Unix epoch second as the MS-DOS date and time pair ZIP stores.
 *
 * The format is from 1980 and cannot say anything earlier, and its seconds field
 * holds HALF-seconds, so an odd second is not representable. Neither is refused:
 * the stamp is metadata no reader in this repository asserts on, and failing a
 * build because `SOURCE_DATE_EPOCH` named 1979 would reject an artifact over a
 * display field. Earlier than 1980 is CLAMPED to it; the odd second is floored.
 *
 * UTC deliberately, not local time. A DOS stamp carries no zone, so reading it
 * back as local time is the only convention available — and using the packing
 * host's zone would mean two runners in different regions produce different bytes
 * from one stage, which is exactly the property this module exists to hold.
 */
export function dosDateTime(epochSeconds: number): { date: number; time: number } {
    const stamp = new Date(Math.max(epochSeconds, 315532800) * 1000);
    const date =
        (((stamp.getUTCFullYear() - 1980) & 0x7f) << 9) | ((stamp.getUTCMonth() + 1) << 5) | stamp.getUTCDate();
    const time = (stamp.getUTCHours() << 11) | (stamp.getUTCMinutes() << 5) | Math.floor(stamp.getUTCSeconds() / 2);
    return { date, time };
}

/** One entry to store, addressed by its path INSIDE the archive. */
export interface ZipEntry {
    /** Archive-relative, POSIX-separated. ZIP stores `/` on every platform. */
    path: string;
    /** POSIX mode bits, written into the external attributes' high 16 bits. */
    mode: number;
    data: Uint8Array;
}

/** A little-endian byte sink, so the header layouts below read as tables. */
class Writer {
    private parts: Uint8Array[] = [];
    private length = 0;

    get offset(): number {
        return this.length;
    }

    u16(value: number): void {
        this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
    }

    u32(value: number): void {
        this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]));
    }

    bytes(value: Uint8Array): void {
        this.push(value);
    }

    private push(part: Uint8Array): void {
        this.parts.push(part);
        this.length += part.byteLength;
    }

    finish(): Uint8Array {
        const out = new Uint8Array(this.length);
        let at = 0;
        for (const part of this.parts) {
            out.set(part, at);
            at += part.byteLength;
        }
        return out;
    }
}

/**
 * Build a ZIP archive: local headers, then the central directory, then the EOCD.
 *
 * `mtime` is one stamp for every entry, taken from the caller. Per-file mtimes
 * are deliberately not read off disk: an artifact upload does not carry them
 * (`stage-manifest.ts`'s header), so re-stat'ing the stage on the packing host
 * would stamp the archive with "whenever the download finished" and two hosts
 * packing one stage would disagree.
 *
 * ENTRIES ARE SORTED BY PATH, and the caller's order is not trusted for the same
 * reason `plan.ts` sorts: two runs over one payload must produce one byte
 * sequence, and a `readdir` order is a filesystem's opinion.
 *
 * NO DIRECTORY ENTRIES. A ZIP may carry them and `unzip` recreates the tree from
 * the file paths alone, so emitting them would add entries no reader here
 * inspects and one more thing to keep deterministic. The consequence is stated
 * rather than left to be discovered: an EMPTY directory inside a `.app` would not
 * survive the archive — nothing in the payload can produce one, because
 * `writeStage` only ever writes files.
 *
 * ZIP64 is NOT implemented, and the refusal below is what keeps that honest:
 * past 4 GiB or 65535 entries the 32-bit fields silently wrap and the archive
 * that comes out is well-formed and wrong. A loud limit is the better failure —
 * the same argument `assertPayloadMatchesArch` makes one field over, where a
 * label nothing compared to the payload produced an artifact `rpm` confirmed.
 */
export function buildZip(entries: readonly ZipEntry[], mtime: number): Uint8Array {
    const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const { date, time } = dosDateTime(mtime);
    const encoder = new TextEncoder();

    if (sorted.length > 0xffff) {
        throw new Error(
            `gjsify ship: this archive would hold ${sorted.length} entries and a non-ZIP64 central directory ` +
                'records the count in 16 bits, so it would silently wrap. Nothing here writes ZIP64 yet; the ' +
                'payload has to shrink, or this writer has to grow the ZIP64 records.',
        );
    }

    const local = new Writer();
    const central = new Writer();
    let count = 0;

    for (const entry of sorted) {
        const name = encoder.encode(entry.path);
        const crc = crc32(entry.data);
        const size = entry.data.byteLength;
        const offset = local.offset;
        if (offset > 0xffffffff || size > 0xffffffff) {
            throw new Error(
                `gjsify ship: ${entry.path} would push this archive past 4 GiB, which a non-ZIP64 header ` +
                    'records in 32 bits and therefore truncates. Nothing here writes ZIP64 yet.',
            );
        }

        // Local file header (PKWARE APPNOTE § 4.3.7).
        local.u32(LOCAL_HEADER_SIGNATURE);
        local.u16(VERSION_NEEDED);
        // General purpose flags: bit 11 marks the name as UTF-8. Set
        // unconditionally, because the alternative — CP437 — cannot spell the
        // `<App>.app` directory of an app whose display name is not ASCII, and
        // every reader in this decade honours the bit.
        local.u16(0x0800);
        local.u16(METHOD_STORE);
        local.u16(time);
        local.u16(date);
        local.u32(crc);
        local.u32(size);
        local.u32(size);
        local.u16(name.byteLength);
        local.u16(0);
        local.bytes(name);
        local.bytes(entry.data);

        // Central directory header (§ 4.3.12), same fields plus the mode.
        central.u32(CENTRAL_HEADER_SIGNATURE);
        central.u16(VERSION_MADE_BY);
        central.u16(VERSION_NEEDED);
        central.u16(0x0800);
        central.u16(METHOD_STORE);
        central.u16(time);
        central.u16(date);
        central.u32(crc);
        central.u32(size);
        central.u32(size);
        central.u16(name.byteLength);
        central.u16(0);
        central.u16(0);
        central.u16(0);
        central.u16(0);
        // External attributes: POSIX mode in the HIGH 16 bits, DOS attributes in
        // the low ones. `0o100000` is `S_IFREG` — without the file-type bits
        // `zipinfo` prints `?rwxr-xr-x` and some extractors treat the entry as
        // having no type at all.
        central.u32(((0o100000 | (entry.mode & 0o7777)) >>> 0) * 0x10000);
        central.u32(offset);
        central.bytes(name);
        count += 1;
    }

    const centralBytes = central.finish();
    const out = new Writer();
    out.bytes(local.finish());
    const centralOffset = out.offset;
    out.bytes(centralBytes);

    // End of central directory (§ 4.3.16). No comment — a comment would be one
    // more field to keep identical across runs for no reader's benefit.
    out.u32(EOCD_SIGNATURE);
    out.u16(0);
    out.u16(0);
    out.u16(count);
    out.u16(count);
    out.u32(centralBytes.byteLength);
    out.u32(centralOffset);
    out.u16(0);
    return out.finish();
}

/** The payload as zip entries, keeping each file's planned mode. */
export function zipEntriesFromPayload(payload: readonly PayloadEntry[]): ZipEntry[] {
    return payload.map((entry) => ({ path: entry.path, mode: entry.mode, data: entry.data }));
}
