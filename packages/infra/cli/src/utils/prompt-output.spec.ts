// SPDX-License-Identifier: MIT
// Stdout arbitration between a live prompt and everything else writing to it.
//
// Measured on a real `gjsify onboard` sweep: a rate-limit notice from a
// concurrent worker was written while the OTP prompt was open, and landed inside
// the digits being typed —
//
//     Enter a NEW OTP:   npm rate limit hit. npm sent no Retry-After …
//     228000
//
// The typed code ends up visually split across two lines, and the notice reads
// as part of the question.

import { describe, it, expect } from '@gjsify/unit';
import { beginPrompt, endPrompt, promptDepth, resetPromptOutput, writeAroundPrompt } from './prompt-output.js';

export default async () => {
    await describe('prompt-output', async () => {
        await it('writes straight through when no prompt is open', () => {
            resetPromptOutput();
            const out: string[] = [];
            writeAroundPrompt('a\n', (t) => out.push(t));
            expect(out).toStrictEqual(['a\n']);
        });

        await it('HOLDS output while a prompt is open and flushes it after, in order', () => {
            resetPromptOutput();
            const out: string[] = [];
            const w = (t: string): void => {
                out.push(t);
            };
            beginPrompt();
            writeAroundPrompt('first\n', w);
            writeAroundPrompt('second\n', w);
            // Nothing may reach the terminal while the user is typing.
            expect(out).toStrictEqual([]);
            endPrompt(w);
            expect(out).toStrictEqual(['first\n', 'second\n']);
        });

        await it('holds until the LAST nested prompt closes', () => {
            resetPromptOutput();
            const out: string[] = [];
            const w = (t: string): void => {
                out.push(t);
            };
            beginPrompt();
            beginPrompt();
            writeAroundPrompt('held\n', w);
            endPrompt(w);
            expect(out).toStrictEqual([]);
            expect(promptDepth()).toBe(1);
            endPrompt(w);
            expect(out).toStrictEqual(['held\n']);
        });

        await it('does not DROP the message — the notices held here explain the delay', () => {
            resetPromptOutput();
            const out: string[] = [];
            const w = (t: string): void => {
                out.push(t);
            };
            beginPrompt();
            writeAroundPrompt('npm rate limit hit\n', w);
            endPrompt(w);
            expect(out.join('')).toBe('npm rate limit hit\n');
        });

        await it('an unbalanced close cannot drive the depth negative', () => {
            resetPromptOutput();
            endPrompt(() => {});
            expect(promptDepth()).toBe(0);
            const out: string[] = [];
            writeAroundPrompt('through\n', (t) => out.push(t));
            expect(out).toStrictEqual(['through\n']);
        });
    });
};
