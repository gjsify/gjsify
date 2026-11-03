// SPDX-License-Identifier: MIT
// The framing contract `Worker` relies on and `fork` will: one JSON text per
// line, a read loop that ends only on EOF or a corrupt line, and a handler
// throw that does not end it.

import { describe, it, expect } from '@gjsify/unit';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';

import { LineChannel } from './line-channel.ts';

function inputOf(text: string): Gio.InputStream {
    return Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(new TextEncoder().encode(text)));
}

function writtenText(output: Gio.MemoryOutputStream): string {
    const bytes = output.steal_as_bytes().toArray();
    return new TextDecoder().decode(bytes);
}

/** Read every message until the loop ends. */
function readAll(text: string, onMessage?: (message: unknown) => void): Promise<unknown[]> {
    return new Promise((resolve) => {
        const seen: unknown[] = [];
        const channel = new LineChannel(null, inputOf(text));
        channel.startReading(
            (message) => {
                seen.push(message);
                onMessage?.(message);
            },
            () => resolve(seen),
        );
    });
}

export default async () => {
    await describe('LineChannel', async () => {
        await it('frames send() as one JSON text and a newline', async () => {
            const output = Gio.MemoryOutputStream.new_resizable();
            const channel = new LineChannel(output);
            channel.send({ type: 'message', data: [1, 'two'] });
            channel.writeLine('{"raw":true}\n');
            output.close(null);
            expect(writtenText(output)).toBe('{"type":"message","data":[1,"two"]}\n{"raw":true}\n');
        });

        await it('delivers parsed lines in order and ends on EOF', async () => {
            const seen = await readAll('{"n":1}\n{"n":2}\n[3]\n');
            expect(JSON.stringify(seen)).toBe('[{"n":1},{"n":2},[3]]');
        });

        await it('keeps reading when the handler throws', async () => {
            const seen = await readAll('{"n":1}\n{"n":2}\n', () => {
                throw new Error('listener bug');
            });
            expect(seen.length).toBe(2);
        });

        await it('ends on a line that is not JSON', async () => {
            const seen = await readAll('{"n":1}\nnot json\n{"n":3}\n');
            expect(JSON.stringify(seen)).toBe('[{"n":1}]');
        });

        await it('refuses writes after closeOutput()', async () => {
            const channel = new LineChannel(Gio.MemoryOutputStream.new_resizable());
            channel.closeOutput();
            expect(channel.writable).toBe(false);
            expect(() => channel.writeLine('{}\n')).toThrow();
            channel.closeOutput();
        });
    });
};
