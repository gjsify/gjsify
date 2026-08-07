// A raw U+0000 in a `--app gjs` bundle truncates the module: GJS hands source to SpiderMonkey
// as a NUL-terminated C string, so the loader reports whatever construct was still open —
// "`` literal not terminated before end of script" — naming neither the NUL nor its location.
//
// Every NUL below is written as an escape (String.fromCharCode(0) / '\u0000'), never as a raw
// byte, so this spec file cannot itself become the thing it tests for.

import { describe, expect, it } from '@gjsify/unit';
import { escapeRawNulForGjs } from './gjs-source-escape.js';

const NUL = String.fromCharCode(0);

export default async () => {
    await describe('gjs-source-escape: escapeRawNulForGjs', async () => {
        await it('leaves code without a NUL completely untouched', () => {
            // The overwhelmingly common case — the caller skips writing the file entirely.
            const code = 'export function f(){return`hello ${x}`}\n';
            const result = escapeRawNulForGjs(code);
            expect(result.replaced).toBe(0);
            expect(result.code).toBe(code);
        });

        await it('escapes a raw NUL inside a template literal', () => {
            // The exact shape the minifier emits when it inlines a '\u0000' constant.
            const result = escapeRawNulForGjs('function p(e){return`' + NUL + '${e}' + NUL + '`}');
            expect(result.replaced).toBe(2);
            expect(result.code).toBe('function p(e){return`\\x00${e}\\x00`}');
            expect(result.code.includes(NUL)).toBe(false);
        });

        await it('escapes a raw NUL inside a plain string', () => {
            const result = escapeRawNulForGjs("const P='" + NUL + "'");
            expect(result.replaced).toBe(1);
            expect(result.code).toBe("const P='\\x00'");
        });

        await it('counts and replaces every occurrence', () => {
            const result = escapeRawNulForGjs(NUL + 'a' + NUL + 'b' + NUL);
            expect(result.replaced).toBe(3);
            expect(result.code).toBe('\\x00a\\x00b\\x00');
        });

        await it('emits \\x00 rather than \\0, which a following digit would break', () => {
            // `\0` is only NUL when NOT followed by a digit; `\01` is a legacy octal escape and a
            // SyntaxError in a template literal and under strict mode. A digit right after the
            // marker is exactly the shape that triggered this (`\0${index}\0` minifies with the
            // index adjacent), so `\0` would trade one unloadable bundle for another.
            const result = escapeRawNulForGjs(NUL + '1');
            expect(result.code).toBe('\\x001');
            // The dangerous output would be `\01`, which a JS parser reads as an octal escape.
            expect(result.code.startsWith('\\0')).toBe(false);
        });

        await it('produces an escape that denotes exactly U+0000', () => {
            // The whole point: the emitted source must still evaluate to the same character, or the
            // marker it stands for silently changes meaning. Decoded the way a JS parser reads a
            // `\xNN` escape — JSON.parse cannot be the oracle here, as JSON has no `\x` form.
            const result = escapeRawNulForGjs(NUL);
            const match = /^\\x([0-9a-fA-F]{2})$/.exec(result.code);
            expect(match === null).toBe(false);
            expect(String.fromCharCode(Number.parseInt(match?.[1] ?? 'ff', 16))).toBe(NUL);
        });

        await it('does not disturb other control characters', () => {
            // Only NUL truncates a C string; tabs and newlines are legal and load fine, so
            // rewriting them would be churn on every bundle for no reason.
            const code = 'a\tb\nc';
            expect(escapeRawNulForGjs(code).code).toBe(code);
            expect(escapeRawNulForGjs(code).replaced).toBe(0);
        });

        await it('handles an empty input', () => {
            expect(escapeRawNulForGjs('').replaced).toBe(0);
            expect(escapeRawNulForGjs('').code).toBe('');
        });
    });
};
