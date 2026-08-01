// Standard file descriptors (stdin=0, stdout=1, stderr=2) for @gjsify/fs.
//
// Node lets the numeric descriptors 0/1/2 flow through the fd APIs directly:
// `readFileSync(0)` / `readSync(0, …)` slurp stdin, `writeSync(1|2, …)` reach
// stdout/stderr. These descriptors are handed to a process by its parent — no
// `open()` ever created them — so they are NOT in `FileHandle.instances`, and
// the previous code coerced the number to the relative PATH `"0"` and threw
// `ENOENT`. Any bundled npm package doing the Node stdin idiom broke the same
// way, silently and off-target (the CLI worked around it in `utils/stdin.ts`).
//
// Fix at the core: map 0/1/2 onto the process's own Unix streams via GioUnix,
// so the descriptors behave like Node's. `close_fd: false` on every stream —
// closing our own stdin/stdout/stderr underneath the process is never right.

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import GioUnix from '@girs/giounix-2.0';

export const STDIN_FD = 0;
export const STDOUT_FD = 1;
export const STDERR_FD = 2;

/** True for the parent-supplied standard descriptors 0/1/2. */
export function isStdFd(fd: number): boolean {
    return fd === STDIN_FD || fd === STDOUT_FD || fd === STDERR_FD;
}

// One persistent stream per descriptor. readSync(0, …) must ADVANCE through
// stdin across calls (a fresh stream per call would re-read from the start on a
// seekable fd and read nothing useful on a pipe), so the stream is cached.
let stdinStream: GioUnix.InputStream | null = null;
const outStreams: { [fd: number]: GioUnix.OutputStream } = {};

function stdinInput(): GioUnix.InputStream {
    if (!stdinStream) stdinStream = GioUnix.InputStream.new(STDIN_FD, false);
    return stdinStream;
}

function stdOutput(fd: number): GioUnix.OutputStream {
    if (!outStreams[fd]) outStreams[fd] = GioUnix.OutputStream.new(fd, false);
    return outStreams[fd];
}

/**
 * Read the whole of the given standard descriptor to EOF — backs
 * `readFileSync(0)` / `readFile(0)`. Only fd 0 is readable; a read on 1/2
 * surfaces the underlying `EBADF` from GioUnix rather than pretending success.
 *
 * A `/dev/stdin` fallback covers the one host where the GioUnix route was
 * observed unavailable (same defensive second mechanism as the CLI helper this
 * replaces) — `/dev/stdin` is fd 0 by another name and `Gio` is always present.
 */
export function readStdFdAll(fd: number): Uint8Array {
    try {
        const stream = fd === STDIN_FD ? stdinInput() : GioUnix.InputStream.new(fd, false);
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
            const bytes = stream.read_bytes(64 * 1024, null);
            const arr = bytes.get_data();
            if (!arr || arr.length === 0) break;
            chunks.push(arr);
            total += arr.length;
        }
        return concat(chunks, total);
    } catch (err) {
        if (fd !== STDIN_FD) throw err;
        const [ok, contents] = Gio.File.new_for_path('/dev/stdin').load_contents(null);
        if (!ok) throw err;
        return contents;
    }
}

/**
 * Single positional-less read of up to `length` bytes from a standard
 * descriptor into `buffer` at `offset` — backs `readSync(0, …)`. Returns the
 * number of bytes read (0 at EOF). `position` is ignored: stdin is a stream,
 * not a seekable file, which matches Node reading a pipe/TTY.
 */
export function readStdFdSync(fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number): number {
    const stream = fd === STDIN_FD ? stdinInput() : GioUnix.InputStream.new(fd, false);
    const bytes = stream.read_bytes(length, null);
    const arr = bytes.get_data();
    if (arr && arr.length > 0) {
        new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset + offset).set(arr);
        return arr.length;
    }
    return 0;
}

/**
 * Write `data` to a standard descriptor — backs `writeSync(1|2, …)`. Returns
 * the number of bytes written. Writing to fd 0 surfaces GioUnix's `EBADF`.
 */
export function writeStdFdSync(fd: number, data: Uint8Array): number {
    return stdOutput(fd).write_bytes(GLib.Bytes.new(data), null);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
    if (chunks.length === 1) return chunks[0];
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        buf.set(c, offset);
        offset += c.length;
    }
    return buf;
}
