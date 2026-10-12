// `gtk_accelerator_parse` / `gtk_accelerator_name` and the accelerator table of `Gtk.Application`,
// renderer-free — ADR 0098 § 1.
//
// A TRUE SUBSET of GDK's keysym table: letters, digits, the printable ASCII names, the function keys
// and the editing/navigation keys. A key name outside it is REFUSED (it throws), never ignored: GTK
// ignores an accelerator it cannot parse, and here "cannot parse" would also cover "valid but not in
// this table", which is a shortcut that silently dies.
//
// Reference: gtk/gtkaccelgroup.c (`gtk_accelerator_parse`, `gtk_accelerator_name`),
//            gtk/gtkapplication.c (`gtk_application_set_accels_for_action`)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import { UnsupportedGObjectError } from './gobject.js';

/** `Gdk.ModifierType`, the bits an accelerator uses. */
export const ModifierMask = Object.freeze({
    SHIFT: 1 << 0,
    CONTROL: 1 << 2,
    ALT: 1 << 3,
    SUPER: 1 << 26,
    HYPER: 1 << 27,
    META: 1 << 28,
});

const ALL_MODIFIERS =
    ModifierMask.SHIFT |
    ModifierMask.CONTROL |
    ModifierMask.ALT |
    ModifierMask.SUPER |
    ModifierMask.HYPER |
    ModifierMask.META;

const MODIFIER_NAMES: Readonly<Record<string, number>> = {
    primary: ModifierMask.CONTROL,
    control: ModifierMask.CONTROL,
    ctrl: ModifierMask.CONTROL,
    ctl: ModifierMask.CONTROL,
    shift: ModifierMask.SHIFT,
    shft: ModifierMask.SHIFT,
    alt: ModifierMask.ALT,
    mod1: ModifierMask.ALT,
    meta: ModifierMask.META,
    super: ModifierMask.SUPER,
    hyper: ModifierMask.HYPER,
};

/** `gtk_accelerator_name` writes modifiers in this order. */
const NAME_ORDER: readonly (readonly [number, string])[] = [
    [ModifierMask.SHIFT, '<Shift>'],
    [ModifierMask.CONTROL, '<Control>'],
    [ModifierMask.ALT, '<Alt>'],
    [ModifierMask.META, '<Meta>'],
    [ModifierMask.SUPER, '<Super>'],
    [ModifierMask.HYPER, '<Hyper>'],
];

/** X11 keysym names that are not a single letter or digit; the numbers are GDK's. */
export const KEYSYM_NAMES: Readonly<Record<string, number>> = Object.freeze({
    space: 0x20,
    exclam: 0x21,
    quotedbl: 0x22,
    numbersign: 0x23,
    dollar: 0x24,
    percent: 0x25,
    ampersand: 0x26,
    apostrophe: 0x27,
    parenleft: 0x28,
    parenright: 0x29,
    asterisk: 0x2a,
    plus: 0x2b,
    comma: 0x2c,
    minus: 0x2d,
    period: 0x2e,
    slash: 0x2f,
    colon: 0x3a,
    semicolon: 0x3b,
    less: 0x3c,
    equal: 0x3d,
    greater: 0x3e,
    question: 0x3f,
    at: 0x40,
    bracketleft: 0x5b,
    backslash: 0x5c,
    bracketright: 0x5d,
    asciicircum: 0x5e,
    underscore: 0x5f,
    grave: 0x60,
    braceleft: 0x7b,
    bar: 0x7c,
    braceright: 0x7d,
    asciitilde: 0x7e,
    BackSpace: 0xff08,
    Tab: 0xff09,
    Return: 0xff0d,
    Escape: 0xff1b,
    Home: 0xff50,
    Left: 0xff51,
    Up: 0xff52,
    Right: 0xff53,
    Down: 0xff54,
    Page_Up: 0xff55,
    Page_Down: 0xff56,
    End: 0xff57,
    Insert: 0xff63,
    KP_Enter: 0xff8d,
    KP_Multiply: 0xffaa,
    KP_Add: 0xffab,
    KP_Subtract: 0xffad,
    KP_Divide: 0xffaf,
    ISO_Left_Tab: 0xfe20,
    Delete: 0xffff,
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 0xffbe + i])),
});

const NAME_OF = new Map<number, string>(Object.entries(KEYSYM_NAMES).map(([name, keyval]) => [keyval, name]));

/** `gdk_keyval_from_name`, over the subset; `null` for a name outside it. */
function keyvalFromName(name: string): number | null {
    if (/^[A-Za-z0-9]$/.test(name)) return name.toLowerCase().charCodeAt(0);
    return KEYSYM_NAMES[name] ?? null;
}

/** `gdk_keyval_name` of a lowercase keyval. */
function keyvalName(keyval: number): string {
    if (keyval === 0) return '';
    if ((keyval >= 0x30 && keyval <= 0x39) || (keyval >= 0x61 && keyval <= 0x7a)) return String.fromCharCode(keyval);
    return NAME_OF.get(keyval) ?? '';
}

/** A parsed accelerator: the keyval is lowercase, as `gtk_accelerator_parse` returns it. */
export interface Accelerator {
    readonly keyval: number;
    readonly modifiers: number;
}

/**
 * `gtk_accelerator_parse`. `null` where GTK's parse fails for a reason that does not need the keysym
 * table (an unterminated or unknown `<modifier>`, `<Release>`); a key name outside the subset throws.
 * `<Primary>` is Control.
 */
export function parseAcceleratorKeyval(accelerator: string): Accelerator | null {
    let modifiers = 0;
    let rest = accelerator.trim();
    while (rest.startsWith('<')) {
        const end = rest.indexOf('>');
        if (end === -1) return null;
        const mask = MODIFIER_NAMES[rest.slice(1, end).toLowerCase()];
        if (mask === undefined) return null;
        modifiers |= mask;
        rest = rest.slice(end + 1);
    }
    if (rest === '') return { keyval: 0, modifiers };
    const keyval = keyvalFromName(rest);
    if (keyval === null) {
        throw new UnsupportedGObjectError(
            `accelerator key '${rest}'`,
            `The key name '${rest}' is outside the keysym subset of the Gtk.Application accelerators (ADR 0098 § 1).`,
        );
    }
    return { keyval, modifiers };
}

/** `gtk_accelerator_name`: `<Shift><Control><Alt><Meta><Super><Hyper>` and the key name. */
export function acceleratorName({ keyval, modifiers }: Accelerator): string {
    let name = '';
    for (const [mask, text] of NAME_ORDER) if (modifiers & mask) name += text;
    return name + keyvalName(keyval);
}

/**
 * A key that carries its shift in the character (`+`, `#`, `3`...): GTK consumes the Shift of such a
 * key when it matches, so `<Control>plus` fires on Ctrl+Shift+= of a layout that needs it.
 */
function consumesShift(keyval: number): boolean {
    return keyval >= 0x20 && keyval <= 0x7e && !(keyval >= 0x61 && keyval <= 0x7a);
}

function significant({ keyval, modifiers }: Accelerator): Accelerator {
    const kept = modifiers & ALL_MODIFIERS;
    return { keyval, modifiers: consumesShift(keyval) ? kept & ~ModifierMask.SHIFT : kept };
}

/**
 * The canonical detailed name `g_action_print_detailed_name` gives: `app.foo::bar` is
 * `app.foo('bar')`, and a `(…)` target stays as written.
 */
export function canonicalDetailedName(detailed: string): string {
    const colons = detailed.indexOf('::');
    if (colons <= 0) return detailed;
    const target = detailed
        .slice(colons + 2)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
    return `${detailed.slice(0, colons)}('${target}')`;
}

interface Entry {
    readonly names: string[];
    readonly parsed: Accelerator[];
}

/** The accelerators of one application, in insertion order of the actions. */
export class AcceleratorMap {
    readonly #entries = new Map<string, Entry>();

    /**
     * `gtk_application_set_accels_for_action`. An empty list removes the action. An accelerator that
     * does not parse logs a critical and changes nothing, as on GTK; a key name outside the subset throws.
     */
    setAccels(detailed: string, accelerators: readonly string[]): void {
        const key = canonicalDetailedName(detailed);
        const parsed: Accelerator[] = [];
        for (const text of accelerators) {
            const accelerator = parseAcceleratorKeyval(text);
            if (accelerator === null) {
                console.error(
                    `Gtk-CRITICAL **: Unable to parse accelerator '${text}': ignored request to install accelerators`,
                );
                return;
            }
            parsed.push(accelerator);
        }
        if (parsed.length === 0) this.#entries.delete(key);
        else this.#entries.set(key, { names: parsed.map(acceleratorName), parsed });
    }

    getAccels(detailed: string): string[] {
        return [...(this.#entries.get(canonicalDetailedName(detailed))?.names ?? [])];
    }

    listActions(): string[] {
        return [...this.#entries.keys()];
    }

    /** `gtk_application_get_actions_for_accel`: an empty array when no action has it, as GJS returns it. */
    actionsFor(accelerator: string): string[] {
        const wanted = parseAcceleratorKeyval(accelerator);
        if (wanted === null) {
            console.error(`Gtk-CRITICAL **: Unable to parse accelerator '${accelerator}'`);
            return [];
        }
        return this.#match(wanted);
    }

    /** The detailed names whose accelerator is the key press `keyval` + `state`. */
    matching(keyval: number, state: number): string[] {
        return this.#match({ keyval, modifiers: state });
    }

    #match(pressed: Accelerator): string[] {
        const want = significant(pressed);
        const found: string[] = [];
        for (const [detailed, { parsed }] of this.#entries) {
            if (parsed.some((a) => a.keyval === want.keyval && significant(a).modifiers === want.modifiers)) {
                found.push(detailed);
            }
        }
        return found;
    }
}
