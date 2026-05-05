// Pure-JS tar parser — ustar + PAX subset, file/directory/symlink entries only.
// Operates on an in-memory Uint8Array. The streaming wrapper for `.tar.gz`
// lives in extract.ts (uses DecompressionStream to gunzip first).
//
// Reference: POSIX 1003.1-2017 ustar format and PAX extended headers
// (https://pubs.opengroup.org/onlinepubs/9699919799/utilities/pax.html).
// Cross-checked against refs/node-tar (when present) and Bun's
// extract_tarball.zig.

export const BLOCK_SIZE = 512;

export type TarEntryType =
    | "file"
    | "directory"
    | "symlink"
    | "hardlink"
    | "pax-header"
    | "pax-global"
    | "gnu-longname"
    | "gnu-longlink"
    | "unknown";

export interface TarEntry {
    name: string;
    /** Optional: link target for symlinks/hardlinks. */
    linkname: string;
    type: TarEntryType;
    /** File mode (decoded from octal). */
    mode: number;
    /** Modification time as Unix epoch seconds. */
    mtime: number;
    /** File body bytes. Empty for non-file entries. */
    body: Uint8Array;
    /** Raw uname/gname for callers that care. */
    uname: string;
    gname: string;
}

/** Parse a tar archive (already-uncompressed) into entries. */
export function parseTar(buf: Uint8Array): TarEntry[] {
    const out: TarEntry[] = [];
    let pendingPaxHeader: Map<string, string> | null = null;
    let pendingLongName: string | null = null;
    let pendingLongLink: string | null = null;

    let offset = 0;
    while (offset + BLOCK_SIZE <= buf.length) {
        const header = buf.subarray(offset, offset + BLOCK_SIZE);
        if (allZeros(header)) {
            // Two consecutive empty blocks mark EOF; tolerate one stray block.
            const next = buf.subarray(offset + BLOCK_SIZE, offset + 2 * BLOCK_SIZE);
            if (next.length === BLOCK_SIZE && allZeros(next)) break;
            offset += BLOCK_SIZE;
            continue;
        }

        if (!validateChecksum(header)) {
            throw new TarParseError(
                `Bad header checksum at offset ${offset} — file is not a valid tar archive`,
            );
        }

        const rawName = readString(header, 0, 100);
        const mode = parseOctal(header, 100, 8);
        const size = parseOctal(header, 124, 12);
        const mtime = parseOctal(header, 136, 12);
        const typeflag = String.fromCharCode(header[156] || 0);
        const linkname = readString(header, 157, 100);
        const magic = readString(header, 257, 6);
        const prefix = readString(header, 345, 155);
        const uname = readString(header, 265, 32);
        const gname = readString(header, 297, 32);

        offset += BLOCK_SIZE;
        const body = buf.subarray(offset, offset + size);
        offset += alignToBlock(size);

        // PAX/GNU placeholder entries describe the *next* real entry. They
        // never produce a TarEntry of their own — fold their info forward and
        // continue the loop.
        if (typeflag === "x") {
            pendingPaxHeader = parsePaxRecords(body);
            continue;
        }
        if (typeflag === "g") {
            // Global PAX — applies to remainder of stream. Not used by npm
            // tarballs in practice; stash but never expose.
            continue;
        }
        if (typeflag === "L") {
            pendingLongName = bytesToString(body).replace(/\0+$/, "");
            continue;
        }
        if (typeflag === "K") {
            pendingLongLink = bytesToString(body).replace(/\0+$/, "");
            continue;
        }

        let name = rawName;
        if (magic === "ustar" && prefix !== "") {
            name = `${prefix}/${rawName}`;
        }
        if (pendingLongName !== null) {
            name = pendingLongName;
            pendingLongName = null;
        }
        let resolvedLink = linkname;
        if (pendingLongLink !== null) {
            resolvedLink = pendingLongLink;
            pendingLongLink = null;
        }
        if (pendingPaxHeader !== null) {
            const paxName = pendingPaxHeader.get("path");
            if (paxName !== undefined) name = paxName;
            const paxLink = pendingPaxHeader.get("linkpath");
            if (paxLink !== undefined) resolvedLink = paxLink;
            const paxSize = pendingPaxHeader.get("size");
            if (paxSize !== undefined) {
                // PAX size override — re-read body with the wider size.
                const overrideSize = Number(paxSize);
                if (Number.isFinite(overrideSize)) {
                    // Body already advanced by ustar size; in practice ustar
                    // size will be 0 when PAX overrides it. Re-slice from the
                    // header start.
                    const realStart = offset - alignToBlock(size);
                    const sliced = buf.subarray(realStart, realStart + overrideSize);
                    offset = realStart + alignToBlock(overrideSize);
                    pendingPaxHeader = null;
                    out.push(buildEntry(name, resolvedLink, typeflag, mode, mtime, uname, gname, sliced));
                    continue;
                }
            }
            pendingPaxHeader = null;
        }

        out.push(buildEntry(name, resolvedLink, typeflag, mode, mtime, uname, gname, body));
    }
    return out;
}

function buildEntry(
    name: string,
    linkname: string,
    typeflag: string,
    mode: number,
    mtime: number,
    uname: string,
    gname: string,
    body: Uint8Array,
): TarEntry {
    return {
        name,
        linkname,
        type: typeflagToType(typeflag, name),
        mode,
        mtime,
        body,
        uname,
        gname,
    };
}

function typeflagToType(typeflag: string, name: string): TarEntryType {
    switch (typeflag) {
        case "0":
        case "\0":
        case "":
            // Some implementations encode trailing slash on dirs as type 0.
            return name.endsWith("/") ? "directory" : "file";
        case "1":
            return "hardlink";
        case "2":
            return "symlink";
        case "5":
            return "directory";
        case "x":
            return "pax-header";
        case "g":
            return "pax-global";
        case "L":
            return "gnu-longname";
        case "K":
            return "gnu-longlink";
        default:
            return "unknown";
    }
}

function parsePaxRecords(body: Uint8Array): Map<string, string> {
    // Each record is `<len> <key>=<value>\n`, where <len> is decimal-ascii of
    // the entire record (including the digits + space + newline). Records can
    // be NUL-padded; iterate until we exhaust the actual length of the
    // payload.
    const out = new Map<string, string>();
    let i = 0;
    while (i < body.length) {
        let space = i;
        while (space < body.length && body[space] !== 0x20) space++;
        if (space >= body.length) break;
        const lenStr = bytesToString(body.subarray(i, space));
        const len = Number(lenStr);
        if (!Number.isFinite(len) || len <= 0) break;
        const recordEnd = i + len;
        if (recordEnd > body.length) break;
        const recBytes = body.subarray(space + 1, recordEnd - 1); // -1 for trailing \n
        const recText = bytesToString(recBytes);
        const eq = recText.indexOf("=");
        if (eq > 0) {
            const key = recText.slice(0, eq);
            const value = recText.slice(eq + 1);
            out.set(key, value);
        }
        i = recordEnd;
    }
    return out;
}

function readString(buf: Uint8Array, start: number, len: number): string {
    let end = start;
    const limit = start + len;
    while (end < limit && buf[end] !== 0) end++;
    return bytesToString(buf.subarray(start, end));
}

function bytesToString(buf: Uint8Array): string {
    // Tar headers are 7-bit ASCII. PAX values are UTF-8.
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

function parseOctal(buf: Uint8Array, start: number, len: number): number {
    // Strip NUL/space padding common in headers, and accept GNU base-256
    // numeric extensions (high bit set on first byte).
    if (len > 0 && (buf[start] & 0x80) !== 0) {
        let n = buf[start] & 0x7f;
        for (let i = 1; i < len; i++) n = n * 256 + buf[start + i];
        return n;
    }
    let s = "";
    for (let i = 0; i < len; i++) {
        const c = buf[start + i];
        if (c === 0 || c === 0x20) continue;
        s += String.fromCharCode(c);
    }
    if (s === "") return 0;
    return parseInt(s, 8);
}

function alignToBlock(n: number): number {
    return Math.ceil(n / BLOCK_SIZE) * BLOCK_SIZE;
}

function allZeros(buf: Uint8Array): boolean {
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== 0) return false;
    }
    return true;
}

function validateChecksum(header: Uint8Array): boolean {
    const stored = parseOctal(header, 148, 8);
    let unsigned = 0;
    let signed = 0;
    for (let i = 0; i < BLOCK_SIZE; i++) {
        const byte = i >= 148 && i < 156 ? 0x20 : header[i];
        unsigned += byte;
        signed += byte > 127 ? byte - 256 : byte;
    }
    return stored === unsigned || stored === signed;
}

export class TarParseError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = "TarParseError";
    }
}
