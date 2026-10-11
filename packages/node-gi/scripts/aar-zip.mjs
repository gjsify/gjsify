// SPDX-License-Identifier: MIT
// A deterministic STORE-only ZIP writer, for the Android runtime bundle's AAR.
//
// AN AAR IS A ZIP, and this tree already owns a deterministic ZIP writer —
// packages/infra/cli/src/utils/ship/zip.ts, whose header makes the argument for writing
// one instead of shelling out to `zip(1)`. That argument holds here and is not repeated.
// What is deliberately NOT shared is the code:
//
//   • `packages/node-gi/*` are not root workspace members, so nothing guarantees
//     @gjsify/cli has been BUILT when this script runs, and its `lib/` is a gitignored
//     build output. Importing the compiled JS would make "build the Android bundle"
//     depend on another package's artifact happening to exist in the checkout.
//   • The source is TypeScript, which a plain `.mjs` build script cannot import.
//
// So this is a second implementation of the same format, kept honest by being SMALLER
// rather than parallel: one method, one caller, no payload mapping. `crc32` comes from
// node:zlib, so not even the checksum is a copy of the other writer's table.
//
// DETERMINISM, the same rule as the ship writer: every timestamp comes from the caller,
// entries are sorted by path, no mtime is read off disk. Two runs over one staged tree
// produce one byte sequence — which is the whole reason the bundle manifest's sha256 of
// the AAR means anything.
import { crc32 } from 'node:zlib';

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
/** Stored, not deflated: AGP reads either, and STORE is the half of the format with no second implementation in it. */
const METHOD_STORE = 0;
/** 2.0 — the version that defines STORE; nothing written here needs a later one. */
const VERSION_NEEDED = 20;
/** Unix (3) in the high byte, so a reader interprets the external attributes as POSIX mode bits. */
const VERSION_MADE_BY = (3 << 8) | VERSION_NEEDED;

/** DOS date/time, UTC. The format cannot represent anything before 1980, so say so rather than wrap. */
export function dosDateTime(epochSeconds) {
    const at = new Date(epochSeconds * 1000);
    const year = at.getUTCFullYear();
    if (year < 1980) {
        throw new Error(`aar-zip: mtime ${at.toISOString()} predates the DOS epoch (1980) and cannot be stored`);
    }
    const date = ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate();
    const time = (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >>> 1);
    return { date, time };
}

/** A little-endian byte sink, so the header layouts below read as tables. */
class Sink {
    #parts = [];
    #length = 0;

    get offset() {
        return this.#length;
    }

    u16(value) {
        const part = Buffer.allocUnsafe(2);
        part.writeUInt16LE(value & 0xffff, 0);
        this.#push(part);
    }

    u32(value) {
        const part = Buffer.allocUnsafe(4);
        part.writeUInt32LE(value >>> 0, 0);
        this.#push(part);
    }

    bytes(value) {
        this.#push(Buffer.from(value));
    }

    #push(part) {
        this.#parts.push(part);
        this.#length += part.length;
    }

    finish() {
        return Buffer.concat(this.#parts);
    }
}

/**
 * Build a ZIP: local headers, then the central directory, then the EOCD.
 *
 * @param {ReadonlyArray<{ path: string, mode?: number, data: Uint8Array }>} entries
 *   Archive-relative POSIX paths. No directory entries are written — a reader recreates
 *   the tree from the file paths, and an AAR has no empty directory in it.
 * @param {number} mtime One stamp for every entry, in epoch seconds, from the caller.
 * @returns {Buffer}
 */
export function buildZip(entries, mtime) {
    const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const { date, time } = dosDateTime(mtime);

    // ZIP64 is not implemented, and these refusals are what keep that honest: past the
    // 32-bit fields the archive that comes out is well-formed and WRONG. A loud limit is
    // the better failure. (An AAR of two ABIs is ~14 MB, so this is a guard, not a bound.)
    if (sorted.length > 0xffff) {
        throw new Error(`aar-zip: ${sorted.length} entries would wrap the 16-bit central-directory count`);
    }

    const local = new Sink();
    const central = new Sink();

    for (const entry of sorted) {
        const name = Buffer.from(entry.path, 'utf8');
        const data = Buffer.from(entry.data);
        const checksum = crc32(data) >>> 0;
        const at = local.offset;
        if (at > 0xffffffff || data.length > 0xffffffff) {
            throw new Error(
                `aar-zip: ${entry.path} would push the archive past the 4 GiB a non-ZIP64 offset can address`,
            );
        }

        local.u32(LOCAL_HEADER_SIGNATURE);
        local.u16(VERSION_NEEDED);
        local.u16(0); // flags: no encryption, no data descriptor
        local.u16(METHOD_STORE);
        local.u16(time);
        local.u16(date);
        local.u32(checksum);
        local.u32(data.length); // compressed == uncompressed under STORE
        local.u32(data.length);
        local.u16(name.length);
        local.u16(0); // extra field
        local.bytes(name);
        local.bytes(data);

        central.u32(CENTRAL_HEADER_SIGNATURE);
        central.u16(VERSION_MADE_BY);
        central.u16(VERSION_NEEDED);
        central.u16(0);
        central.u16(METHOD_STORE);
        central.u16(time);
        central.u16(date);
        central.u32(checksum);
        central.u32(data.length);
        central.u32(data.length);
        central.u16(name.length);
        central.u16(0); // extra field
        central.u16(0); // comment
        central.u16(0); // disk number
        central.u16(0); // internal attributes
        // External attributes: POSIX mode in the HIGH 16 bits. `S_IFREG` has to be ORed in —
        // `zipinfo` and `unzip` only interpret the field as POSIX bits when the file-type bits
        // are set, and without it the mode reads back as `?rw-r--r--` for every entry whatever
        // was written. Multiplied rather than `<< 16`, which would overflow into the sign bit.
        central.u32(((0o100000 | ((entry.mode ?? 0o644) & 0o7777)) >>> 0) * 0x10000);
        central.u32(at);
        central.bytes(name);
    }

    const localBytes = local.finish();
    const centralBytes = central.finish();

    const eocd = new Sink();
    eocd.u32(EOCD_SIGNATURE);
    eocd.u16(0); // this disk
    eocd.u16(0); // disk with the central directory
    eocd.u16(sorted.length);
    eocd.u16(sorted.length);
    eocd.u32(centralBytes.length);
    eocd.u32(localBytes.length);
    eocd.u16(0); // archive comment

    return Buffer.concat([localBytes, centralBytes, eocd.finish()]);
}
