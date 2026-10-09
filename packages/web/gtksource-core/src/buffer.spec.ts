import { describe, expect, it } from '@gjsify/unit';

import { Buffer } from './buffer.js';
import type { TextEdit, TextIter, TextMark } from './buffer.js';

export default async () => {
    await describe('gtksource-core: Buffer', async () => {
        await it('splits lines and maps offsets both ways', () => {
            const buffer = new Buffer('ab\ncde\n\nf');
            expect(buffer.lineCount).toBe(4);
            expect(buffer.length).toBe(9);
            expect(buffer.offsetOfLine(1)).toBe(3);
            expect(buffer.lineOfOffset(2)).toBe(0);
            expect(buffer.lineOfOffset(3)).toBe(1);
            expect(buffer.lineOfOffset(9)).toBe(3);
        });

        await it('reports which lines an edit replaced', () => {
            const buffer = new Buffer('one\ntwo\nthree');
            const edits: TextEdit[] = [];
            buffer.connect('changed', (_self, edit: TextEdit) => edits.push(edit));
            buffer.insert(5, 'X\nY');
            expect(buffer.text).toBe('one\ntX\nYwo\nthree');
            expect(edits.length).toBe(1);
            expect(edits[0].firstLine).toBe(1);
            expect(edits[0].removedLines).toBe(1);
            expect(edits[0].insertedLines).toBe(2);
        });

        await it('deletes across lines', () => {
            const buffer = new Buffer('one\ntwo\nthree');
            const edits: TextEdit[] = [];
            buffer.connect('changed', (_self, edit: TextEdit) => edits.push(edit));
            buffer.delete(2, 9);
            expect(buffer.text).toBe('onhree');
            expect(edits[0].removedText).toBe('e\ntwo\nt');
            expect(edits[0].removedLines).toBe(3);
            expect(edits[0].insertedLines).toBe(1);
        });

        await it('emits nothing for an edit that changes nothing', () => {
            const buffer = new Buffer('abc');
            let count = 0;
            buffer.connect('changed', () => count++);
            buffer.replace(1, 1, '');
            expect(count).toBe(0);
        });

        await it('moves the cursor with edits and signals mark-set', () => {
            const buffer = new Buffer('hello');
            const marks: string[] = [];
            buffer.connect('mark-set', (_self, iter: TextIter, mark: TextMark) =>
                marks.push(`${mark.name}:${iter.get_offset()}`),
            );
            buffer.placeCursor(5);
            buffer.insert(0, '>> ');
            expect(buffer.cursorPosition).toBe(8);
            // An edit shifts the marks silently, as in GTK; only an explicit move reports.
            expect(marks).toStrictEqual(['insert:5', 'selection_bound:5']);
        });

        await it('disconnects a handler by id and rejects an unknown id', () => {
            const buffer = new Buffer();
            let count = 0;
            const id = buffer.connect('changed', () => count++);
            buffer.insert(0, 'a');
            buffer.disconnect(id);
            buffer.insert(0, 'b');
            expect(count).toBe(1);
            expect(() => buffer.disconnect(id)).toThrow();
        });

        await it('rejects an offset outside the text', () => {
            const buffer = new Buffer('abc');
            expect(() => buffer.insert(4, 'x')).toThrow();
            expect(() => buffer.delete(2, 1)).toThrow();
        });

        await it('setting text replaces everything and leaves the cursor at the end', () => {
            const buffer = new Buffer('old');
            buffer.text = 'new\ntext';
            expect(buffer.text).toBe('new\ntext');
            expect(buffer.cursorPosition).toBe(8);
        });
    });
};
