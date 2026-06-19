// Unit tests for the raw-mode line-editor key handler (`applyKey`) used by
// `gjsify login` / `gjsify trust` prompts. This is the logic whose absence let
// the prompt drop Enter (showing `name^M`) and mishandle masking/Ctrl-C.

import { describe, expect, it } from '@gjsify/unit';
import { applyKey } from './prompt.js';

/** Feed a whole string char-by-char; return the final outcome + echoed text. */
function typeAll(input: string, mask = false): { line: string; echo: string; done: boolean; interrupt: boolean } {
    let buf = '';
    let echo = '';
    for (const ch of input) {
        const r = applyKey(buf, ch, mask);
        buf = r.buf;
        echo += r.echo;
        if (r.interrupt) return { line: buf, echo, done: false, interrupt: true };
        if (r.done) return { line: buf, echo, done: true, interrupt: false };
    }
    return { line: buf, echo, done: false, interrupt: false };
}

export default async () => {
    await describe('applyKey — line termination', async () => {
        await it('submits on carriage return (\\r) — the bug that hung the prompt', async () => {
            const r = applyKey('user', '\r', false);
            expect(r.done).toBeTruthy();
            expect(r.buf).toBe('user');
            expect(r.echo).toBe('\n');
        });
        await it('submits on line feed (\\n) too', async () => {
            const r = applyKey('user', '\n', false);
            expect(r.done).toBeTruthy();
            expect(r.buf).toBe('user');
        });
        await it('typing a name then Enter yields the full line', async () => {
            const r = typeAll('testuser\r');
            expect(r.done).toBeTruthy();
            expect(r.line).toBe('testuser');
        });
    });

    await describe('applyKey — echo + masking', async () => {
        await it('echoes typed characters when not masked (visible username)', async () => {
            const r = typeAll('abc');
            expect(r.line).toBe('abc');
            expect(r.echo).toBe('abc');
        });
        await it('masks each character with * when masked (password)', async () => {
            const r = typeAll('secret', true);
            expect(r.line).toBe('secret');
            expect(r.echo).toBe('******');
            expect(r.echo.includes('secret')).toBeFalsy();
        });
    });

    await describe('applyKey — editing', async () => {
        await it('backspace removes the last char and erases it on screen', async () => {
            const r = typeAll('abx\x7fc');
            expect(r.line).toBe('abc');
            expect(r.echo).toBe('abx\b \bc');
        });
        await it('backspace handles \\b as well as DEL', async () => {
            const r = typeAll('ab\x08');
            expect(r.line).toBe('a');
        });
        await it('backspace on an empty buffer is a no-op (no erase echo)', async () => {
            const r = applyKey('', '\x7f', false);
            expect(r.buf).toBe('');
            expect(r.echo).toBe('');
        });
        await it('ignores other control chars (e.g. ESC, Tab)', async () => {
            const r = applyKey('ab', '\x1b', false);
            expect(r.buf).toBe('ab');
            expect(r.echo).toBe('');
        });
    });

    await describe('applyKey — interrupt', async () => {
        await it('flags Ctrl-C as an interrupt (not text)', async () => {
            const r = applyKey('partial', '\x03', false);
            expect(r.interrupt).toBeTruthy();
            expect(r.done).toBeFalsy();
        });
        await it('Ctrl-C mid-input stops and reports interrupt', async () => {
            const r = typeAll('abc\x03', true);
            expect(r.interrupt).toBeTruthy();
        });
    });
};
