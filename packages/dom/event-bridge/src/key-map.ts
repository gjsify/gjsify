// Gdk keyval → DOM key/code/location mapping
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code/code_values

import Gdk from 'gi://Gdk?version=4.0';

// Special key name → DOM key string
const SPECIAL_KEYS: Record<string, string> = {
    Return: 'Enter', KP_Enter: 'Enter',
    Tab: 'Tab', ISO_Left_Tab: 'Tab',
    BackSpace: 'Backspace',
    Escape: 'Escape',
    Delete: 'Delete', KP_Delete: 'Delete',
    Insert: 'Insert', KP_Insert: 'Insert',
    Home: 'Home', KP_Home: 'Home',
    End: 'End', KP_End: 'End',
    Page_Up: 'PageUp', KP_Page_Up: 'PageUp',
    Page_Down: 'PageDown', KP_Page_Down: 'PageDown',
    Left: 'ArrowLeft', KP_Left: 'ArrowLeft',
    Up: 'ArrowUp', KP_Up: 'ArrowUp',
    Right: 'ArrowRight', KP_Right: 'ArrowRight',
    Down: 'ArrowDown', KP_Down: 'ArrowDown',
    Shift_L: 'Shift', Shift_R: 'Shift',
    Control_L: 'Control', Control_R: 'Control',
    Alt_L: 'Alt', Alt_R: 'Alt',
    Super_L: 'Meta', Super_R: 'Meta',
    Meta_L: 'Meta', Meta_R: 'Meta',
    Caps_Lock: 'CapsLock',
    Num_Lock: 'NumLock',
    Scroll_Lock: 'ScrollLock',
    Print: 'PrintScreen',
    Pause: 'Pause',
    Menu: 'ContextMenu',
    space: ' ',
    F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4',
    F5: 'F5', F6: 'F6', F7: 'F7', F8: 'F8',
    F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
    KP_Add: '+', KP_Subtract: '-', KP_Multiply: '*', KP_Divide: '/',
    KP_Decimal: '.', KP_Separator: ',',
    KP_0: '0', KP_1: '1', KP_2: '2', KP_3: '3', KP_4: '4',
    KP_5: '5', KP_6: '6', KP_7: '7', KP_8: '8', KP_9: '9',
};

// Special key name → DOM code string
const SPECIAL_CODES: Record<string, string> = {
    Return: 'Enter', KP_Enter: 'NumpadEnter',
    Tab: 'Tab', ISO_Left_Tab: 'Tab',
    BackSpace: 'Backspace',
    Escape: 'Escape',
    Delete: 'Delete', KP_Delete: 'NumpadDecimal',
    Insert: 'Insert', KP_Insert: 'Numpad0',
    Home: 'Home', KP_Home: 'Numpad7',
    End: 'End', KP_End: 'Numpad1',
    Page_Up: 'PageUp', KP_Page_Up: 'Numpad9',
    Page_Down: 'PageDown', KP_Page_Down: 'Numpad3',
    Left: 'ArrowLeft', KP_Left: 'Numpad4',
    Up: 'ArrowUp', KP_Up: 'Numpad8',
    Right: 'ArrowRight', KP_Right: 'Numpad6',
    Down: 'ArrowDown', KP_Down: 'Numpad2',
    Shift_L: 'ShiftLeft', Shift_R: 'ShiftRight',
    Control_L: 'ControlLeft', Control_R: 'ControlRight',
    Alt_L: 'AltLeft', Alt_R: 'AltRight',
    Super_L: 'MetaLeft', Super_R: 'MetaRight',
    Meta_L: 'MetaLeft', Meta_R: 'MetaRight',
    Caps_Lock: 'CapsLock',
    Num_Lock: 'NumLock',
    Scroll_Lock: 'ScrollLock',
    Print: 'PrintScreen',
    Pause: 'Pause',
    Menu: 'ContextMenu',
    space: 'Space',
    F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4',
    F5: 'F5', F6: 'F6', F7: 'F7', F8: 'F8',
    F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
    KP_Add: 'NumpadAdd', KP_Subtract: 'NumpadSubtract',
    KP_Multiply: 'NumpadMultiply', KP_Divide: 'NumpadDivide',
    KP_Decimal: 'NumpadDecimal', KP_Separator: 'NumpadComma',
    KP_0: 'Numpad0', KP_1: 'Numpad1', KP_2: 'Numpad2', KP_3: 'Numpad3',
    KP_4: 'Numpad4', KP_5: 'Numpad5', KP_6: 'Numpad6', KP_7: 'Numpad7',
    KP_8: 'Numpad8', KP_9: 'Numpad9',
};

/**
 * Convert a Gdk keyval to a DOM `key` string.
 * Uses special-key lookup table, falls back to Gdk.keyval_to_unicode for printable chars.
 */
export function gdkKeyvalToKey(keyval: number): string {
    const name = Gdk.keyval_name(keyval);
    if (name && SPECIAL_KEYS[name]) return SPECIAL_KEYS[name];

    // Printable character via Unicode
    const unicode = Gdk.keyval_to_unicode(keyval);
    if (unicode > 0) return String.fromCodePoint(unicode);

    // Fallback: use the Gdk name as-is
    return name ?? 'Unidentified';
}

/**
 * Convert a Gdk keyval to a DOM `code` string.
 */
export function gdkKeyvalToCode(keyval: number): string {
    const name = Gdk.keyval_name(keyval);
    if (name && SPECIAL_CODES[name]) return SPECIAL_CODES[name];

    // Letters: a-z → KeyA-KeyZ
    const unicode = Gdk.keyval_to_unicode(keyval);
    if (unicode >= 0x61 && unicode <= 0x7A) return 'Key' + String.fromCodePoint(unicode - 32);
    if (unicode >= 0x41 && unicode <= 0x5A) return 'Key' + String.fromCodePoint(unicode);

    // Digits: 0-9 → Digit0-Digit9
    if (unicode >= 0x30 && unicode <= 0x39) return 'Digit' + String.fromCodePoint(unicode);

    // Punctuation and others: best-effort from Gdk name
    if (name) {
        const punct: Record<string, string> = {
            minus: 'Minus', equal: 'Equal', bracketleft: 'BracketLeft',
            bracketright: 'BracketRight', backslash: 'Backslash',
            semicolon: 'Semicolon', apostrophe: 'Quote',
            grave: 'Backquote', comma: 'Comma', period: 'Period',
            slash: 'Slash',
        };
        if (punct[name]) return punct[name];
    }

    return name ?? 'Unidentified';
}

/**
 * Determine the DOM KeyboardEvent.location from a Gdk keyval.
 * 0=STANDARD, 1=LEFT, 2=RIGHT, 3=NUMPAD
 */
export function gdkKeyvalToLocation(keyval: number): number {
    const name = Gdk.keyval_name(keyval);
    if (!name) return 0;

    if (name.startsWith('KP_')) return 3; // NUMPAD
    if (name.endsWith('_L')) return 1;     // LEFT
    if (name.endsWith('_R')) return 2;     // RIGHT
    return 0;                              // STANDARD
}
