// The "new ASCII" cpio archive (magic `070701`) an RPM carries as its payload.
//
// Every field is 8 hex digits, which makes the format trivially writable and —
// more usefully — trivially INSPECTABLE: `rpm2cpio x.rpm | cpio -it` reads what
// this writes, so the e2e suite has an oracle that shares no code with the
// writer. (rpm itself formats them with `%8.8lx`, i.e. LOWERCASE; both parse,
// and this writer emits uppercase.)
//
// Two padding rules, both easy to get subtly wrong and both silent when wrong:
// the filename (including its NUL) is padded so that the DATA starts on a
// 4-byte boundary counted from the start of the header, and the data itself is
// padded so the NEXT header does too.

import { concatBytes, encodeUtf8 } from './bytes.js';

const MAGIC = '070701';
const HEADER_FIELDS = 13;
const HEADER_SIZE = MAGIC.length + HEADER_FIELDS * 8; // 110

export interface CpioEntry {
    /** Archive path. RPM spells these `./usr/bin/foo`. */
    name: string;
    /** Full st_mode, i.e. file type bits OR permission bits. */
    mode: number;
    /** File contents; empty for directories and symlinks. */
    data?: Uint8Array;
    /** Symlink target — stored as the entry's data, per the cpio format. */
    linkTarget?: string;
    /** Unix mtime in seconds. Default 0. */
    mtime?: number;
    /** Inode number. RPM numbers entries from 1. */
    ino?: number;
    /** Hardlink count. Default 1. */
    nlink?: number;
}

/** POSIX `st_mode` file-type bits, spelled out so call sites read as intent. */
export const S_IFREG = 0o100000;
export const S_IFDIR = 0o040000;
export const S_IFLNK = 0o120000;

/** Build a cpio archive, terminated by the mandatory `TRAILER!!!` entry. */
export function createCpioArchive(entries: readonly CpioEntry[]): Uint8Array {
    const chunks: Uint8Array[] = [];
    let offset = 0;

    entries.forEach((entry, index) => {
        const body = entry.linkTarget !== undefined ? encodeUtf8(entry.linkTarget) : (entry.data ?? new Uint8Array(0));
        const nameBytes = encodeUtf8(`${entry.name}\0`);
        const header = buildHeader({
            ino: entry.ino ?? index + 1,
            mode: entry.mode,
            nlink: entry.nlink ?? 1,
            mtime: entry.mtime ?? 0,
            filesize: body.byteLength,
            namesize: nameBytes.byteLength,
        });
        offset = push(chunks, header, offset);
        offset = push(chunks, nameBytes, offset);
        offset = padTo4(chunks, offset);
        offset = push(chunks, body, offset);
        offset = padTo4(chunks, offset);
    });

    // The archive ends at the entry NAMED `TRAILER!!!` — that name is the
    // signal, not any of the numeric fields. rpm writes `nlink = 1` there and
    // zeroes the rest, so this does too.
    const trailerName = encodeUtf8('TRAILER!!!\0');
    offset = push(
        chunks,
        buildHeader({ ino: 0, mode: 0, nlink: 1, mtime: 0, filesize: 0, namesize: trailerName.byteLength }),
        offset,
    );
    offset = push(chunks, trailerName, offset);
    padTo4(chunks, offset);

    return concatBytes(chunks);
}

interface HeaderFields {
    ino: number;
    mode: number;
    nlink: number;
    mtime: number;
    filesize: number;
    namesize: number;
}

function buildHeader(fields: HeaderFields): Uint8Array {
    const header =
        MAGIC +
        hex8(fields.ino) +
        hex8(fields.mode) +
        hex8(0) + // uid — packages install as root
        hex8(0) + // gid
        hex8(fields.nlink) +
        hex8(fields.mtime) +
        hex8(fields.filesize) +
        hex8(0) + // devmajor
        hex8(0) + // devminor
        hex8(0) + // rdevmajor
        hex8(0) + // rdevminor
        hex8(fields.namesize) +
        hex8(0); // check — unused for 070701, but the field is not optional
    if (header.length !== HEADER_SIZE) {
        throw new Error(
            `gjsify ship: internal error — cpio header is ${header.length} bytes, expected ${HEADER_SIZE}.`,
        );
    }
    return encodeUtf8(header);
}

function hex8(value: number): string {
    if (value < 0 || !Number.isInteger(value)) {
        throw new Error(`gjsify ship: cpio header field must be a non-negative integer, got ${value}.`);
    }
    const text = value.toString(16).toUpperCase();
    if (text.length > 8) {
        throw new Error(`gjsify ship: cpio header field ${value} does not fit in 8 hex digits.`);
    }
    return text.padStart(8, '0');
}

function push(chunks: Uint8Array[], bytes: Uint8Array, offset: number): number {
    if (bytes.byteLength > 0) chunks.push(bytes);
    return offset + bytes.byteLength;
}

function padTo4(chunks: Uint8Array[], offset: number): number {
    const remainder = offset % 4;
    if (remainder === 0) return offset;
    const padding = 4 - remainder;
    chunks.push(new Uint8Array(padding));
    return offset + padding;
}
