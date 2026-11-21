// GTK's input-method hints (`Gtk.InputPurpose`, `Gtk.InputHints`) as the NativeScript `TextField`
// spells them: `keyboardType`, `autocapitalizationType`, `autocorrect`, `secure`.
//
// ONE pure mapping, shared by every entry widget (`GtkEntry`, `AdwEntryRow` and what extends them),
// with no `@nativescript/core` value import so a spec reaches it off-device (package AGENTS.md).
//
// PURPOSE -> keyboard:
//   free-form, alpha, name, password, terminal -> platform default keyboard
//   digits, pin                                -> 'integer'
//   number                                     -> 'number' (decimal)
//   phone -> 'phone', url -> 'url', email -> 'email'
// PURPOSE -> the rest:
//   name                 capitalise words, autocorrect off
//   url, email, terminal capitalisation none, autocorrect off
//   password, pin        `secure` (masked) — except on a password row, which owns `secure`
//                        through its peek toggle
//
// HINTS (explicit hints win over the purpose's defaults):
//   SPELLCHECK, WORD_COMPLETION -> autocorrect on;  NO_SPELLCHECK -> autocorrect off, and it beats
//                                  the two above when both are set
//   UPPERCASE_CHARS > UPPERCASE_WORDS > UPPERCASE_SENTENCES -> 'allcharacters' / 'words' / 'sentences'
//                                  (the most specific wins); LOWERCASE -> 'none'
//
// NO NativeScript EQUIVALENT, so held in the property and deliberately not applied: EMOJI, NO_EMOJI,
// INHIBIT_OSK (a `TextField` has no on-screen-keyboard switch), VERTICAL_WRITING, and PRIVATE
// (incognito keyboard — no NS API; turning autocorrect off instead would be a guess).
//
// Reference: refs/gtk gtk/gtkenums.h (GtkInputPurpose), gtk/gtkimcontext.h (GtkInputHints)
// Copyright (c) The GTK Team. LGPLv2.1+.

import type { DeclaredProperty } from './signals.js';

/** `Gtk.InputPurpose`'s nicks, in enum order — position IS the constant (held by `check-nativescript-xml-doors`). */
export const GTK_INPUT_PURPOSES = [
    'free-form',
    'alpha',
    'digits',
    'number',
    'phone',
    'url',
    'email',
    'name',
    'password',
    'pin',
    'terminal',
] as const;

/** `Gtk.InputHints` bits, measured on GJS 1.88 / GTK 4.22. */
export const GTK_INPUT_HINT_BITS = Object.freeze({
    none: 0,
    spellcheck: 1,
    'no-spellcheck': 2,
    'word-completion': 4,
    lowercase: 8,
    'uppercase-chars': 16,
    'uppercase-words': 32,
    'uppercase-sentences': 64,
    'inhibit-osk': 128,
    'vertical-writing': 256,
    emoji: 512,
    'no-emoji': 1024,
    private: 2048,
} as const);

const ALL_HINT_BITS = Object.values(GTK_INPUT_HINT_BITS).reduce((all, bit) => all | bit, 0);

export type NsKeyboardType = 'datetime' | 'phone' | 'number' | 'url' | 'email' | 'integer';
export type NsAutocapitalization = 'none' | 'words' | 'sentences' | 'allcharacters';

/** What a `TextField` is told. `undefined` means "the platform default". */
export interface TextFieldInputMethod {
    keyboardType: NsKeyboardType | undefined;
    autocapitalizationType: NsAutocapitalization | undefined;
    autocorrect: boolean | undefined;
    secure: boolean;
}

/** The `TextField` members the mapping writes. */
export interface InputMethodField {
    keyboardType: NsKeyboardType | undefined;
    autocapitalizationType: NsAutocapitalization | undefined;
    autocorrect: boolean | undefined;
    secure: boolean;
}

/** `Gtk.InputPurpose` from a constant, a nick, or the numeric string an XML attribute carries. */
export function inputPurposeOf(raw: unknown): number {
    let index = -1;
    if (typeof raw === 'number') index = raw;
    else if (typeof raw === 'string') {
        const text = raw.trim().toLowerCase().replaceAll('_', '-');
        const named = (GTK_INPUT_PURPOSES as readonly string[]).indexOf(text);
        index = named !== -1 ? named : text === '' ? -1 : Number(text);
    }
    if (!Number.isInteger(index) || index < 0 || index >= GTK_INPUT_PURPOSES.length) {
        throw new TypeError(
            `'${String(raw)}' is not a Gtk.InputPurpose, so it cannot be 'input-purpose'. The members are ` +
                `${GTK_INPUT_PURPOSES.join(', ')}, or their values 0 to ${GTK_INPUT_PURPOSES.length - 1}.`,
        );
    }
    return index;
}

/** `Gtk.InputHints` from a bit mask, or a `|`-joined list of nicks (`'no-spellcheck | no-emoji'`). */
export function inputHintsOf(raw: unknown): number {
    const refuse = (): never => {
        throw new TypeError(
            `'${String(raw)}' is not a Gtk.InputHints, so it cannot be 'input-hints'. Use a combination of ` +
                `${Object.keys(GTK_INPUT_HINT_BITS).join(', ')} joined with '|', or a mask of their values.`,
        );
    };
    if (typeof raw === 'number') {
        return Number.isInteger(raw) && raw >= 0 && (raw & ~ALL_HINT_BITS) === 0 ? raw : refuse();
    }
    if (typeof raw !== 'string') return refuse();
    let mask = 0;
    for (const part of raw.split('|')) {
        const token = part.trim().toLowerCase().replaceAll('_', '-');
        if (token === '') continue;
        const bit = (GTK_INPUT_HINT_BITS as Record<string, number>)[token];
        if (bit !== undefined) mask |= bit;
        else mask |= inputHintsOf(Number(token));
    }
    return mask;
}

/** The pure mapping — see the module header for the table. */
export function textFieldInputMethod(purpose: number, hints: number): TextFieldInputMethod {
    const nick = GTK_INPUT_PURPOSES[purpose] ?? 'free-form';

    let keyboardType: NsKeyboardType | undefined;
    let autocapitalizationType: NsAutocapitalization | undefined;
    let autocorrect: boolean | undefined;

    switch (nick) {
        case 'digits':
        case 'pin':
            keyboardType = 'integer';
            break;
        case 'number':
            keyboardType = 'number';
            break;
        case 'phone':
            keyboardType = 'phone';
            break;
        case 'url':
            keyboardType = 'url';
            autocapitalizationType = 'none';
            autocorrect = false;
            break;
        case 'email':
            keyboardType = 'email';
            autocapitalizationType = 'none';
            autocorrect = false;
            break;
        case 'name':
            autocapitalizationType = 'words';
            autocorrect = false;
            break;
        case 'terminal':
            autocapitalizationType = 'none';
            autocorrect = false;
            break;
        default:
            break;
    }

    if (hints & (GTK_INPUT_HINT_BITS.spellcheck | GTK_INPUT_HINT_BITS['word-completion'])) autocorrect = true;
    if (hints & GTK_INPUT_HINT_BITS['no-spellcheck']) autocorrect = false;

    if (hints & GTK_INPUT_HINT_BITS['uppercase-chars']) autocapitalizationType = 'allcharacters';
    else if (hints & GTK_INPUT_HINT_BITS['uppercase-words']) autocapitalizationType = 'words';
    else if (hints & GTK_INPUT_HINT_BITS['uppercase-sentences']) autocapitalizationType = 'sentences';
    else if (hints & GTK_INPUT_HINT_BITS.lowercase) autocapitalizationType = 'none';

    return {
        keyboardType,
        autocapitalizationType,
        autocorrect,
        secure: nick === 'password' || nick === 'pin',
    };
}

/**
 * Write the mapping onto a field. `ownsSecure` is false for a password row, whose `secure` is the
 * peek toggle's answer and must not be overwritten by a purpose.
 */
export function applyInputMethod(field: InputMethodField, purpose: number, hints: number, ownsSecure: boolean): void {
    const method = textFieldInputMethod(purpose, hints);
    field.keyboardType = method.keyboardType;
    field.autocapitalizationType = method.autocapitalizationType;
    field.autocorrect = method.autocorrect;
    if (ownsSecure) field.secure = method.secure;
}

/** What `afterNotify` calls on the widget that declares {@link INPUT_METHOD_PROPERTIES}. */
interface InputMethodOwner {
    _applyInputMethod(): void;
}

/**
 * The two declared properties every entry widget shares. Each widget writes the KEYS itself
 * (`'input-purpose': INPUT_PURPOSE_PROPERTY`) because the property census reads the literal
 * keys of the `Properties` block; the descriptors are shared so they cannot disagree.
 */
export const INPUT_PURPOSE_PROPERTY: DeclaredProperty = {
    kind: 'int',
    default: 0,
    blurb: 'The purpose of the text field',
    normalize: (value) => inputPurposeOf(value),
    afterNotify: (self) => (self as InputMethodOwner)._applyInputMethod(),
};

export const INPUT_HINTS_PROPERTY: DeclaredProperty = {
    kind: 'int',
    default: 0,
    blurb: 'Additional hints that allow input methods to fine-tune their behaviour',
    normalize: (value) => inputHintsOf(value),
    afterNotify: (self) => (self as InputMethodOwner)._applyInputMethod(),
};
