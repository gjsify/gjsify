// Shared helpers for the debug integration suite.
//
// `debug` writes through `process.stderr.write` (its `log()` impl in
// src/node.js). To keep tests hermetic — and avoid depending on the
// real TTY state of the runner — we replace `process.stderr.write`
// with a capturing function for the duration of each test, then
// restore the original. The same pattern works on Node and on GJS:
// on GJS, `process.stderr` is a ProcessWriteStream from
// `@gjsify/process`, but its `write` is a plain own-property
// method we can swap, just like on Node.

export interface Capture {
    /** Restores the original stderr.write. */
    restore(): void;
    /** All chunks written, in write order, decoded to UTF-8 strings. */
    readonly chunks: string[];
    /** Concatenated stdout of all chunks (joined with no separator). */
    readonly output: string;
}

/**
 * Replace process.stderr.write with a capturing stub. Returns a
 * Capture handle exposing the collected chunks plus a restore() fn.
 *
 * Mirrors the sinon-stub pattern in debug's own test.node.js
 * (`sinon.stub(process.stderr, 'write')`) without the sinon dep.
 */
export function captureStderr(): Capture {
    const chunks: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    // Many call signatures: write(buf), write(buf, cb), write(buf, enc), write(buf, enc, cb).
    // We only care about the first arg for our assertions; ignore the rest.
    const stub = function write(this: unknown, chunk: unknown, ..._rest: unknown[]): boolean {
        if (typeof chunk === 'string') {
            chunks.push(chunk);
        } else if (chunk && typeof (chunk as { toString?: () => string }).toString === 'function') {
            chunks.push(String(chunk));
        }
        return true;
    } as typeof process.stderr.write;
    (process.stderr as unknown as { write: typeof process.stderr.write }).write = stub;
    return {
        chunks,
        get output() {
            return chunks.join('');
        },
        restore() {
            (process.stderr as unknown as { write: typeof process.stderr.write }).write = original;
        },
    };
}

/**
 * Force debug's per-instance useColors flag. debug evaluates
 * `createDebug.useColors()` once when an instance is created (and
 * stores the result on `debug.useColors`). For deterministic format
 * tests we just overwrite that field directly — same trick the
 * upstream README documents under "Output streams" -> "useColors".
 */
export function setUseColors(debugInstance: { useColors: boolean }, on: boolean): void {
    debugInstance.useColors = on;
}

/**
 * ANSI CSI escape introducer used by debug when useColors is on
 * (`[3<c>m` / `[3<c>;1m` / `[0m`).
 */
export const ESC = '[';
