// SPDX-License-Identifier: MIT
// Newline-framed JSON messages over a Gio stream pair — the frame both a
// `Worker` (child stdin/stdout) and a forked child (an inherited socket) speak.
// One JSON text per line, which is also Node's `serialization: 'json'` wire.
//
// What a message MEANS is the caller's business: this module only frames. The
// read loop separates two kinds of failure on purpose. A closed stream or a line
// that is not JSON means the peer is gone or the wire is corrupt, so the loop
// ends. A throw from the caller's handler is the handler's bug and must not end
// the loop, so the next read is armed in a `finally`.

import type Gio from '@girs/gio-2.0';
import { gio, glib } from './gi.ts';

const _encoder = new TextEncoder();

export class LineChannel {
    private _output: Gio.OutputStream | null;
    private _input: Gio.DataInputStream | null;

    /**
     * @param output where lines are written (a child's stdin pipe, a socket's
     *               output stream); `null` for a read-only channel.
     * @param input  where lines are read from; `null` for a write-only channel.
     */
    constructor(output: Gio.OutputStream | null, input: Gio.InputStream | null = null) {
        this._output = output;
        this._input = input ? gio().DataInputStream.new(input) : null;
    }

    /** Whether lines can still be written. */
    get writable(): boolean {
        return this._output !== null;
    }

    /**
     * Write one already-framed line (it must end in `\n`). Throws when the
     * stream is closed or the write fails; callers that treat a vanished peer
     * as a race catch it themselves.
     */
    writeLine(line: string): void {
        if (!this._output) throw new Error('LineChannel: output is closed');
        this._output.write_all(_encoder.encode(line), null);
    }

    /** Frame `message` as one JSON line and write it. Throws like {@link writeLine}. */
    send(message: unknown): void {
        this.writeLine(JSON.stringify(message) + '\n');
    }

    /**
     * Start the read loop: every line is parsed as JSON and handed to
     * `onMessage`. The loop ends on EOF or on a line that is not JSON, and then
     * calls `onEnd` once.
     */
    startReading<T = unknown>(onMessage: (message: T) => void, onEnd?: () => void): void {
        const input = this._input;
        if (!input) throw new Error('LineChannel: no input stream');
        const readNext = (): void => {
            input.read_line_async(glib().PRIORITY_DEFAULT, null, (_source: unknown, result: Gio.AsyncResult) => {
                let message: unknown;
                try {
                    const [line] = input.read_line_finish_utf8(result);
                    if (line === null) {
                        onEnd?.();
                        return;
                    }
                    message = JSON.parse(line);
                } catch {
                    onEnd?.();
                    return;
                }
                try {
                    onMessage(message as T);
                } catch {
                    // The handler's own failure; see the header.
                } finally {
                    readNext();
                }
            });
        };
        readNext();
    }

    /** Close the output side. The peer reads EOF. Never throws. */
    closeOutput(): void {
        if (!this._output) return;
        try {
            this._output.close(null);
        } catch {
            // Already closed when the peer died first.
        }
        this._output = null;
    }
}
