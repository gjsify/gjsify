import { describe, expect, it } from '@gjsify/unit';
import {
    DEFAULT_MAX_LINES,
    ENTRY_PADDING,
    LINE_HEIGHT,
    clampLines,
    entryHeightRange,
    entryKeyAction,
    linesToHeight,
    submittableText,
} from './chat-entry-rules.js';

const none = { shift: false, ctrl: false };

export default async () => {
    await describe('entryKeyAction', async () => {
        await it('submits on a plain Enter', async () => {
            expect(entryKeyAction(true, none)).toBe('submit');
        });
        await it('breaks the line on Shift+Enter and Ctrl+Enter', async () => {
            expect(entryKeyAction(true, { shift: true, ctrl: false })).toBe('newline');
            expect(entryKeyAction(true, { shift: false, ctrl: true })).toBe('newline');
            expect(entryKeyAction(true, { shift: true, ctrl: true })).toBe('newline');
        });
        await it('leaves Alt+Enter and Super+Enter to the window', async () => {
            expect(entryKeyAction(true, { ...none, alt: true })).toBe('pass');
            expect(entryKeyAction(true, { ...none, meta: true })).toBe('pass');
        });
        await it('passes every other key', async () => {
            expect(entryKeyAction(false, none)).toBe('pass');
            expect(entryKeyAction(false, { shift: true, ctrl: true })).toBe('pass');
        });
    });

    await describe('submittableText', async () => {
        await it('refuses empty and whitespace-only text', async () => {
            expect(submittableText('')).toBe(null);
            expect(submittableText(' \n\t ')).toBe(null);
        });
        await it('returns the text untouched otherwise', async () => {
            expect(submittableText(' hi\n')).toBe(' hi\n');
        });
    });

    await describe('height range', async () => {
        await it('turns lines into px', async () => {
            expect(linesToHeight(1)).toBe(LINE_HEIGHT + ENTRY_PADDING);
            expect(linesToHeight(5)).toBe(5 * LINE_HEIGHT + ENTRY_PADDING);
        });
        await it('clamps garbage line counts', async () => {
            expect(clampLines(0, 3)).toBe(1);
            expect(clampLines(2.9, 3)).toBe(2);
            expect(clampLines(Number.NaN, 3)).toBe(3);
        });
        await it('never lets max fall below min', async () => {
            const range = entryHeightRange(4, 2);
            expect(range.max).toBe(range.min);
        });
        await it('defaults to the documented growth', async () => {
            expect(entryHeightRange(1, DEFAULT_MAX_LINES).max).toBe(linesToHeight(DEFAULT_MAX_LINES));
        });
    });
};
