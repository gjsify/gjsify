// The UIKit-free arithmetic of `native-editor.ios.ts`. These run on Node and GJS: the iOS half
// they serve cannot (#1051), so every offset rule the driver depends on is measured here instead.

import { describe, expect, it } from '@gjsify/unit';

import { EditQueue, argbComponents, clampRange, lineAtOffset, lineExtent, lineStartOffsets } from './text-ranges.js';

export const TextRangesTest = async () => {
    await describe('clampRange', async () => {
        await it('answers the range inside the text', () => {
            expect(clampRange(2, 5, 10)).toStrictEqual({ location: 2, length: 3 });
        });

        await it('clamps both ends into the text', () => {
            expect(clampRange(-4, 99, 6)).toStrictEqual({ location: 0, length: 6 });
            expect(clampRange(8, 99, 6)).toEqual(null);
        });

        await it('answers null for an empty or inverted range', () => {
            expect(clampRange(3, 3, 10)).toEqual(null);
            expect(clampRange(5, 2, 10)).toEqual(null);
        });
    });

    await describe('lineExtent', async () => {
        const text = 'one\ntwo\n\nfour';

        await it('covers the line without its newline', () => {
            expect(lineExtent(text, 0)).toStrictEqual({ location: 0, length: 3 });
            expect(lineExtent(text, 4)).toStrictEqual({ location: 4, length: 3 });
        });

        await it('answers null for an empty line, which has nothing to repaint', () => {
            expect(lineExtent(text, 8)).toEqual(null);
        });

        await it('runs the last line to the end of the text', () => {
            expect(lineExtent(text, 9)).toStrictEqual({ location: 9, length: 4 });
        });

        await it('answers null past the end, where a trailing newline leaves the caret', () => {
            expect(lineExtent('a\n', 2)).toEqual(null);
            expect(lineExtent('', 0)).toEqual(null);
        });
    });

    await describe('lineStartOffsets', async () => {
        await it('starts the empty text on one line', () => {
            expect(lineStartOffsets('')).toStrictEqual([0]);
        });

        await it('names the offset after every newline, including a trailing one', () => {
            expect(lineStartOffsets('one\ntwo\n\nfour')).toStrictEqual([0, 4, 8, 9]);
            expect(lineStartOffsets('a\n')).toStrictEqual([0, 2]);
        });
    });

    await describe('lineAtOffset', async () => {
        const starts = lineStartOffsets('one\ntwo\n\nfour');

        await it('finds the line an offset falls on', () => {
            expect(lineAtOffset(starts, 0)).toBe(0);
            expect(lineAtOffset(starts, 3)).toBe(0);
            expect(lineAtOffset(starts, 4)).toBe(1);
            expect(lineAtOffset(starts, 8)).toBe(2);
            expect(lineAtOffset(starts, 9)).toBe(3);
        });

        await it('keeps the last line for anything past the end', () => {
            expect(lineAtOffset(starts, 13)).toBe(3);
            expect(lineAtOffset(starts, 999)).toBe(3);
        });

        await it('reads a caret before the text as the first line', () => {
            expect(lineAtOffset(starts, -1)).toBe(0);
        });
    });

    await describe('argbComponents', async () => {
        await it('splits an unsigned 0xAARRGGBB into UIColor components', () => {
            expect(argbComponents(0xff000000)).toStrictEqual({ red: 0, green: 0, blue: 0, alpha: 1 });
            expect(argbComponents(0xffffffff)).toStrictEqual({ red: 1, green: 1, blue: 1, alpha: 1 });
        });

        await it('splits the SIGNED int a palette carries — the shift is unsigned for that reason', () => {
            // `0xff2e3436 | 0`, the foreground of the light palette: as a signed int it is negative,
            // and a signed `>>` would read its alpha as 255 only by accident of sign extension.
            expect(argbComponents(0xff2e3436 | 0)).toStrictEqual({
                red: 0x2e / 255,
                green: 0x34 / 255,
                blue: 0x36 / 255,
                alpha: 1,
            });
        });
    });

    await describe('EditQueue', async () => {
        await it('reports nothing pending until an edit arrives', () => {
            const queue = new EditQueue();
            expect(queue.pending).toBe(false);
            queue.push({ start: 0, removed: 0, inserted: 'a' });
            expect(queue.pending).toBe(true);
        });

        await it('takes the edits in order and empties itself', () => {
            const queue = new EditQueue();
            queue.push({ start: 0, removed: 0, inserted: 'a' });
            queue.push({ start: 1, removed: 0, inserted: 'b' });
            expect(queue.take()).toStrictEqual([
                { start: 0, removed: 0, inserted: 'a' },
                { start: 1, removed: 0, inserted: 'b' },
            ]);
            expect(queue.pending).toBe(false);
        });

        await it('keeps what is pushed DURING a flush — auto-indent edits from inside one', () => {
            const queue = new EditQueue();
            queue.push({ start: 0, removed: 0, inserted: '\n' });
            const taken = queue.take();
            queue.push({ start: 1, removed: 0, inserted: '    ' });
            expect(taken).toStrictEqual([{ start: 0, removed: 0, inserted: '\n' }]);
            expect(queue.take()).toStrictEqual([{ start: 1, removed: 0, inserted: '    ' }]);
        });

        await it('drops everything on clear, as a detach does', () => {
            const queue = new EditQueue();
            queue.push({ start: 0, removed: 0, inserted: 'a' });
            queue.clear();
            expect(queue.pending).toBe(false);
            expect(queue.take()).toStrictEqual([]);
        });
    });
};
