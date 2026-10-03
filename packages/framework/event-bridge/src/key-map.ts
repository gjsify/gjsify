// Gdk keyval → DOM key/code/location mapping
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code/code_values

import Gdk from 'gi://Gdk?version=4.0';

/** What UI Events mandates for a key Gdk could not identify. `code` gets `''`, not this. */
const UNIDENTIFIED = 'Unidentified';

/**
 * Gdk's spelling of a keyval it has no name for is NUMERIC: `GDK_KEY_VoidSymbol` reads as
 * `"0xffffff"` on the GTK 4.24 macOS backend, and a key no keymap entry produced lands in the
 * `0x01000000` private range and reads as `"U+0010"`.
 *
 * Publishing either verbatim invents a DOM key value. It is worse than useless where it is
 * reached: EVERY unnamed key spells the same string, so a consumer keying held keys by `code`
 * (Excalibur's `Keyboard` does, `if (this._keys.indexOf(code) === -1)`) folds the second
 * unidentified key press into the first as a duplicate and the first release clears them all.
 */
function isNumericGdkName(name: string): boolean {
    return /^0x[0-9a-f]+$/.test(name) || /^U\+[0-9a-f]{4,6}$/.test(name);
}

/** Gdk names a key it could not translate at all, by either spelling. */
function isUnidentifiedKeyval(keyval: number, name: string | null): boolean {
    return keyval === Gdk.KEY_VoidSymbol || name === null || isNumericGdkName(name);
}

// Special key name → DOM key string
const SPECIAL_KEYS: Record<string, string> = {
    Return: 'Enter',
    KP_Enter: 'Enter',
    Tab: 'Tab',
    ISO_Left_Tab: 'Tab',
    BackSpace: 'Backspace',
    Escape: 'Escape',
    Delete: 'Delete',
    KP_Delete: 'Delete',
    Insert: 'Insert',
    KP_Insert: 'Insert',
    Home: 'Home',
    KP_Home: 'Home',
    End: 'End',
    KP_End: 'End',
    Page_Up: 'PageUp',
    KP_Page_Up: 'PageUp',
    Page_Down: 'PageDown',
    KP_Page_Down: 'PageDown',
    Left: 'ArrowLeft',
    KP_Left: 'ArrowLeft',
    Up: 'ArrowUp',
    KP_Up: 'ArrowUp',
    Right: 'ArrowRight',
    KP_Right: 'ArrowRight',
    Down: 'ArrowDown',
    KP_Down: 'ArrowDown',
    Shift_L: 'Shift',
    Shift_R: 'Shift',
    Control_L: 'Control',
    Control_R: 'Control',
    Alt_L: 'Alt',
    Alt_R: 'Alt',
    Super_L: 'Meta',
    Super_R: 'Meta',
    Meta_L: 'Meta',
    Meta_R: 'Meta',
    Caps_Lock: 'CapsLock',
    Num_Lock: 'NumLock',
    Scroll_Lock: 'ScrollLock',
    Print: 'PrintScreen',
    Pause: 'Pause',
    Menu: 'ContextMenu',
    space: ' ',
    F1: 'F1',
    F2: 'F2',
    F3: 'F3',
    F4: 'F4',
    F5: 'F5',
    F6: 'F6',
    F7: 'F7',
    F8: 'F8',
    F9: 'F9',
    F10: 'F10',
    F11: 'F11',
    F12: 'F12',
    KP_Add: '+',
    KP_Subtract: '-',
    KP_Multiply: '*',
    KP_Divide: '/',
    KP_Decimal: '.',
    KP_Separator: ',',
    KP_0: '0',
    KP_1: '1',
    KP_2: '2',
    KP_3: '3',
    KP_4: '4',
    KP_5: '5',
    KP_6: '6',
    KP_7: '7',
    KP_8: '8',
    KP_9: '9',
};

// Special key name → DOM code string
const SPECIAL_CODES: Record<string, string> = {
    Return: 'Enter',
    KP_Enter: 'NumpadEnter',
    Tab: 'Tab',
    ISO_Left_Tab: 'Tab',
    BackSpace: 'Backspace',
    Escape: 'Escape',
    Delete: 'Delete',
    KP_Delete: 'NumpadDecimal',
    Insert: 'Insert',
    KP_Insert: 'Numpad0',
    Home: 'Home',
    KP_Home: 'Numpad7',
    End: 'End',
    KP_End: 'Numpad1',
    Page_Up: 'PageUp',
    KP_Page_Up: 'Numpad9',
    Page_Down: 'PageDown',
    KP_Page_Down: 'Numpad3',
    Left: 'ArrowLeft',
    KP_Left: 'Numpad4',
    Up: 'ArrowUp',
    KP_Up: 'Numpad8',
    Right: 'ArrowRight',
    KP_Right: 'Numpad6',
    Down: 'ArrowDown',
    KP_Down: 'Numpad2',
    Shift_L: 'ShiftLeft',
    Shift_R: 'ShiftRight',
    Control_L: 'ControlLeft',
    Control_R: 'ControlRight',
    Alt_L: 'AltLeft',
    Alt_R: 'AltRight',
    Super_L: 'MetaLeft',
    Super_R: 'MetaRight',
    Meta_L: 'MetaLeft',
    Meta_R: 'MetaRight',
    Caps_Lock: 'CapsLock',
    Num_Lock: 'NumLock',
    Scroll_Lock: 'ScrollLock',
    Print: 'PrintScreen',
    Pause: 'Pause',
    Menu: 'ContextMenu',
    space: 'Space',
    F1: 'F1',
    F2: 'F2',
    F3: 'F3',
    F4: 'F4',
    F5: 'F5',
    F6: 'F6',
    F7: 'F7',
    F8: 'F8',
    F9: 'F9',
    F10: 'F10',
    F11: 'F11',
    F12: 'F12',
    KP_Add: 'NumpadAdd',
    KP_Subtract: 'NumpadSubtract',
    KP_Multiply: 'NumpadMultiply',
    KP_Divide: 'NumpadDivide',
    KP_Decimal: 'NumpadDecimal',
    KP_Separator: 'NumpadComma',
    KP_0: 'Numpad0',
    KP_1: 'Numpad1',
    KP_2: 'Numpad2',
    KP_3: 'Numpad3',
    KP_4: 'Numpad4',
    KP_5: 'Numpad5',
    KP_6: 'Numpad6',
    KP_7: 'Numpad7',
    KP_8: 'Numpad8',
    KP_9: 'Numpad9',
};

/**
 * The unshifted keyval's Gdk name for each shifted one.
 *
 * `code` is the key's physical position and must not move when a modifier does, but Gdk names
 * a shifted keyval after the shifted CHARACTER — Shift+Comma is `less`, Shift+1 is `exclam`.
 * Both used to answer a different `code` than the same key without Shift, which put two
 * entries in a consumer's held-key list for one key. `Gdk.keyval_to_lower` cannot bridge this:
 * measured, it folds letters only and returns `less`/`exclam` unchanged.
 *
 * The pairs are the US layout's. Gdk carries no physical key in a keyval, so on another layout
 * a shifted character that sits on a different key answers that US key's `code` — no worse than
 * the Gdk name this used to hand out as a `code`, which matched no consumer either.
 */
const SHIFTED_KEY_BASENAME: Record<string, string> = {
    exclam: '1',
    at: '2',
    numbersign: '3',
    dollar: '4',
    percent: '5',
    asciicircum: '6',
    ampersand: '7',
    asterisk: '8',
    parenleft: '9',
    parenright: '0',
    underscore: 'minus',
    plus: 'equal',
    braceleft: 'bracketleft',
    bar: 'backslash',
    braceright: 'bracketright',
    colon: 'semicolon',
    quotedbl: 'apostrophe',
    less: 'comma',
    greater: 'period',
    question: 'slash',
    asciitilde: 'grave',
};

/** Gdk's own name for a key → the DOM `code` of the key's PHYSICAL position. */
const PUNCTUATION_CODES: Record<string, string> = {
    minus: 'Minus',
    equal: 'Equal',
    bracketleft: 'BracketLeft',
    bracketright: 'BracketRight',
    backslash: 'Backslash',
    semicolon: 'Semicolon',
    apostrophe: 'Quote',
    grave: 'Backquote',
    comma: 'Comma',
    period: 'Period',
    slash: 'Slash',
};

/** A Gdk key name → the DOM `code` of its physical position, or null when the DOM has none. */
function codeFromGdkName(name: string): string | null {
    if (SPECIAL_CODES[name]) return SPECIAL_CODES[name];
    if (name.length === 1 && name >= 'a' && name <= 'z') return `Key${name.toUpperCase()}`;
    if (name.length === 1 && name >= '0' && name <= '9') return `Digit${name}`;
    if (PUNCTUATION_CODES[name]) return PUNCTUATION_CODES[name];
    const base = SHIFTED_KEY_BASENAME[name];
    return base ? codeFromGdkName(base) : null;
}

/**
 * Convert a Gdk keyval to a DOM `key` string.
 * Uses special-key lookup table, falls back to Gdk.keyval_to_unicode for printable chars.
 */
export function gdkKeyvalToKey(keyval: number): string {
    const name = Gdk.keyval_name(keyval);
    if (isUnidentifiedKeyval(keyval, name)) return UNIDENTIFIED;
    if (name && SPECIAL_KEYS[name]) return SPECIAL_KEYS[name];

    // Printable character via Unicode
    const unicode = Gdk.keyval_to_unicode(keyval);
    if (unicode > 0) return String.fromCodePoint(unicode);

    return name as string;
}

/**
 * Convert a Gdk keyval to a DOM `code` string.
 */
export function gdkKeyvalToCode(keyval: number): string {
    const name = Gdk.keyval_name(keyval);
    if (isUnidentifiedKeyval(keyval, name)) return '';

    const code = codeFromGdkName(name as string);
    if (code) return code;

    // An upper-case letter is the one case Gdk keeps out of reach of the tables above, and
    // `keyval_to_lower` does fold letters (measured: A → a), so it answers the position.
    const lower = Gdk.keyval_to_lower(keyval);
    if (lower !== keyval) {
        const lowerName = Gdk.keyval_name(lower);
        const lowerCode = lowerName === null ? null : codeFromGdkName(lowerName);
        if (lowerCode) return lowerCode;
    }

    // Gdk has a name for keys the DOM has no `code` for (a JIS key, a dead key). Handing that
    // name out as a `code` invents one no consumer can match; UI Events answers `''`.
    return '';
}

/**
 * Determine the DOM KeyboardEvent.location from a Gdk keyval.
 * 0=STANDARD, 1=LEFT, 2=RIGHT, 3=NUMPAD
 */
export function gdkKeyvalToLocation(keyval: number): number {
    const name = Gdk.keyval_name(keyval);
    if (!name) return 0;

    if (name.startsWith('KP_')) return 3; // NUMPAD
    if (name.endsWith('_L')) return 1; // LEFT
    if (name.endsWith('_R')) return 2; // RIGHT
    return 0; // STANDARD
}
