// Minimal ustar tar archive writer.
//
// Sufficient for npm-style package tarballs:
//   - Regular files (typeflag '0') and directories ('5')
//   - 100-char filename limit (ustar prefix split for paths up to 255 chars
//     when the basename fits in 100 bytes)
//   - Single-stream Uint8Array output (no streaming API yet)
//
// `pax` extended headers and sparse files are NOT supported — npm tarballs
// shouldn't need them, but a file path longer than 100/255 chars will throw
// rather than silently producing a broken archive.

import { BLOCK_SIZE } from "./parser.js";

export interface TarFileEntry {
    /** Path inside the archive, e.g. `package/lib/index.js`. */
    name: string;
    /** File contents (Uint8Array for binary, string is UTF-8 encoded). */
    body: Uint8Array | string;
    /** File mode (octal). Default 0o644 (regular), 0o755 (executable inferred from leading shebang). */
    mode?: number;
    /** Modification time (Unix epoch seconds). Default 0 for deterministic output. */
    mtime?: number;
}

export interface TarDirEntry {
    /** Directory path (trailing slash optional — the writer normalizes). */
    name: string;
    mode?: number;
    mtime?: number;
}

export type TarWriteEntry = TarFileEntry | (TarDirEntry & { directory: true });

/**
 * Build an in-memory tar archive (uncompressed). For `.tar.gz` output, pipe
 * through gzip after — Node has `node:zlib::gzipSync`; under GJS there's
 * `Gio.ZlibCompressor` (use `@gjsify/zlib`'s gzipSync wrapper).
 *
 * Entries are emitted in the given order. Each file body is 512-block-padded
 * with zeros; the archive ends with two zero blocks per the ustar spec.
 */
export function createTarball(entries: readonly TarWriteEntry[]): Uint8Array {
    const chunks: Uint8Array[] = [];
    for (const entry of entries) {
        const isDir = 'directory' in entry && entry.directory === true;
        if (isDir) {
            chunks.push(buildHeader(ensureTrailingSlash(entry.name), 0, '5', entry.mode ?? 0o755, entry.mtime ?? 0));
            continue;
        }
        const file = entry as TarFileEntry;
        const bodyBytes = typeof file.body === 'string'
            ? new TextEncoder().encode(file.body)
            : file.body;
        const mode = file.mode ?? defaultFileMode(bodyBytes);
        chunks.push(buildHeader(file.name, bodyBytes.byteLength, '0', mode, file.mtime ?? 0));
        chunks.push(bodyBytes);
        const pad = padTo512(bodyBytes.byteLength);
        if (pad > 0) chunks.push(new Uint8Array(pad));
    }
    // Two trailing zero blocks
    chunks.push(new Uint8Array(BLOCK_SIZE * 2));
    return concatChunks(chunks);
}

function buildHeader(name: string, size: number, typeflag: '0' | '5', mode: number, mtime: number): Uint8Array {
    const { prefix, basename } = splitPathForUstar(name);
    const buf = new Uint8Array(BLOCK_SIZE);
    writeAscii(buf, basename, 0, 100);
    writeOctal(buf, mode & 0o7777, 100, 7);  buf[107] = 0;
    writeOctal(buf, 0, 108, 7);               buf[115] = 0;  // uid
    writeOctal(buf, 0, 116, 7);               buf[123] = 0;  // gid
    writeOctal(buf, size, 124, 11);           buf[135] = 0;
    writeOctal(buf, mtime, 136, 11);          buf[147] = 0;
    // Checksum placeholder — spaces, recomputed below.
    for (let i = 148; i < 156; i++) buf[i] = 0x20;
    buf[156] = typeflag.charCodeAt(0);
    writeAscii(buf, 'ustar\0', 257, 6);
    writeAscii(buf, '00', 263, 2);
    if (prefix) writeAscii(buf, prefix, 345, 155);
    // Compute checksum
    let sum = 0;
    for (let i = 0; i < BLOCK_SIZE; i++) sum += buf[i]!;
    const sumOctal = sum.toString(8).padStart(6, '0');
    writeAscii(buf, sumOctal, 148, 6);
    buf[154] = 0;
    buf[155] = 0x20;
    return buf;
}

function splitPathForUstar(name: string): { prefix: string; basename: string } {
    if (name.length <= 100) return { prefix: '', basename: name };
    if (name.length > 255) {
        throw new Error(`createTarball: path too long (${name.length} > 255 chars): ${name}`);
    }
    // Split at the last '/' such that basename <= 100 and prefix <= 155
    for (let i = Math.min(name.length - 1, 155); i > 0; i--) {
        if (name[i] === '/' && name.length - i - 1 <= 100) {
            return { prefix: name.slice(0, i), basename: name.slice(i + 1) };
        }
    }
    throw new Error(`createTarball: cannot split path into ustar prefix+basename (basename slot is 100 chars): ${name}`);
}

function writeAscii(buf: Uint8Array, s: string, offset: number, maxLen: number): void {
    const enc = new TextEncoder().encode(s);
    if (enc.length > maxLen) {
        throw new Error(`createTarball: field too long (${enc.length} > ${maxLen}): "${s}"`);
    }
    buf.set(enc, offset);
}

function writeOctal(buf: Uint8Array, value: number, offset: number, len: number): void {
    const s = value.toString(8).padStart(len, '0');
    writeAscii(buf, s, offset, len);
}

function padTo512(size: number): number {
    const r = size % BLOCK_SIZE;
    return r === 0 ? 0 : BLOCK_SIZE - r;
}

function ensureTrailingSlash(name: string): string {
    return name.endsWith('/') ? name : `${name}/`;
}

function defaultFileMode(body: Uint8Array): number {
    // Executable shebangs get 0o755 — npm pack does the same.
    if (body.length >= 2 && body[0] === 0x23 && body[1] === 0x21) return 0o755;
    return 0o644;
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
    let total = 0;
    for (const c of chunks) total += c.byteLength;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    return out;
}
