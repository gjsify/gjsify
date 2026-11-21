// The pure `Gtk.InputPurpose` / `Gtk.InputHints` -> `TextField` mapping. No widget is imported
// (it evaluates `@nativescript/core`); the mapping module is NativeScript-free by design.

import { describe, expect, it } from '@gjsify/unit';

import {
    applyInputMethod,
    GTK_INPUT_HINT_BITS as H,
    inputHintsOf,
    inputPurposeOf,
    textFieldInputMethod,
    type InputMethodField,
} from './widgets/input-method.js';

const fresh = (): InputMethodField => ({
    keyboardType: undefined,
    autocapitalizationType: undefined,
    autocorrect: undefined,
    secure: false,
});

export default async () => {
    await describe('input-method: purpose', async () => {
        await it('maps each purpose to a keyboard', async () => {
            const keyboard = (nick: string) => textFieldInputMethod(inputPurposeOf(nick), 0).keyboardType;
            expect(keyboard('free-form')).toBe(undefined);
            expect(keyboard('digits')).toBe('integer');
            expect(keyboard('pin')).toBe('integer');
            expect(keyboard('number')).toBe('number');
            expect(keyboard('phone')).toBe('phone');
            expect(keyboard('url')).toBe('url');
            expect(keyboard('email')).toBe('email');
        });
        await it('turns correction and capitalisation off for url, email and terminal', async () => {
            for (const nick of ['url', 'email', 'terminal']) {
                const method = textFieldInputMethod(inputPurposeOf(nick), 0);
                expect(method.autocapitalizationType).toBe('none');
                expect(method.autocorrect).toBe(false);
            }
        });
        await it('capitalises words for a name', async () => {
            expect(textFieldInputMethod(inputPurposeOf('name'), 0).autocapitalizationType).toBe('words');
        });
        await it('masks password and pin only', async () => {
            expect(textFieldInputMethod(inputPurposeOf('password'), 0).secure).toBe(true);
            expect(textFieldInputMethod(inputPurposeOf('pin'), 0).secure).toBe(true);
            expect(textFieldInputMethod(inputPurposeOf('alpha'), 0).secure).toBe(false);
        });
        await it('reads nick, constant spelling, number and numeric string alike', async () => {
            expect(inputPurposeOf('EMAIL')).toBe(6);
            expect(inputPurposeOf(6)).toBe(6);
            expect(inputPurposeOf('6')).toBe(6);
            expect(inputPurposeOf('free_form')).toBe(0);
        });
        await it('refuses what is no purpose', async () => {
            expect(() => inputPurposeOf('bogus')).toThrow();
            expect(() => inputPurposeOf(11)).toThrow();
            expect(() => inputPurposeOf('')).toThrow();
        });
    });

    await describe('input-method: hints', async () => {
        await it('maps capitalisation, the most specific winning', async () => {
            const cap = (hints: number) => textFieldInputMethod(0, hints).autocapitalizationType;
            expect(cap(0)).toBe(undefined);
            expect(cap(H['uppercase-sentences'])).toBe('sentences');
            expect(cap(H['uppercase-sentences'] | H['uppercase-words'])).toBe('words');
            expect(cap(H['uppercase-sentences'] | H['uppercase-words'] | H['uppercase-chars'])).toBe('allcharacters');
            expect(cap(H.lowercase)).toBe('none');
        });
        await it('maps spelling hints, no-spellcheck winning', async () => {
            const fix = (hints: number) => textFieldInputMethod(0, hints).autocorrect;
            expect(fix(H.spellcheck)).toBe(true);
            expect(fix(H['word-completion'])).toBe(true);
            expect(fix(H['no-spellcheck'])).toBe(false);
            expect(fix(H.spellcheck | H['no-spellcheck'])).toBe(false);
        });
        await it('lets an explicit hint override the purpose default', async () => {
            const method = textFieldInputMethod(inputPurposeOf('email'), H.spellcheck | H['uppercase-words']);
            expect(method.autocorrect).toBe(true);
            expect(method.autocapitalizationType).toBe('words');
            expect(method.keyboardType).toBe('email');
        });
        await it('holds hints with no NativeScript equivalent without changing the result', async () => {
            const held = H['no-emoji'] | H['inhibit-osk'] | H.private | H.emoji | H['vertical-writing'];
            expect(textFieldInputMethod(0, held)).toStrictEqual(textFieldInputMethod(0, 0));
        });
        await it('parses masks and |-joined nicks and refuses unknown bits', async () => {
            expect(inputHintsOf('no-spellcheck | no-emoji')).toBe(H['no-spellcheck'] | H['no-emoji']);
            expect(inputHintsOf('UPPERCASE_WORDS')).toBe(32);
            expect(inputHintsOf(5)).toBe(5);
            expect(inputHintsOf('')).toBe(0);
            expect(() => inputHintsOf('bogus')).toThrow();
            expect(() => inputHintsOf(4096)).toThrow();
            expect(() => inputHintsOf(-1)).toThrow();
        });
    });

    await describe('input-method: applyInputMethod', async () => {
        await it('writes all four members on a field that owns secure', async () => {
            const field = fresh();
            applyInputMethod(field, inputPurposeOf('pin'), 0, true);
            expect(field.keyboardType).toBe('integer');
            expect(field.secure).toBe(true);
        });
        await it('leaves secure alone on a password row, and resets the rest when the purpose goes', async () => {
            const field = fresh();
            field.secure = true;
            applyInputMethod(field, inputPurposeOf('email'), 0, false);
            expect(field.secure).toBe(true);
            expect(field.keyboardType).toBe('email');
            applyInputMethod(field, 0, 0, false);
            expect(field.keyboardType).toBe(undefined);
            expect(field.autocorrect).toBe(undefined);
        });
    });
};
