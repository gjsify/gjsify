// Shortcut-label conformance vectors — the spec every renderer is held to.
//
// The vectors encode the GRAMMAR and the keycap ORDER, which are the two things
// a hand-rolled port gets wrong without anyone noticing:
//
//   - the four nesting levels (` ` → `...` → `+` → `&`) are not a split on one
//     separator, and reading them in the wrong order turns `<Alt>1...9 <Alt>0`
//     into one alternative instead of two;
//   - the keycaps come out in GTK's fixed order (Hyper, Super, Ctrl, Alt, Shift,
//     Meta, key), NOT in the order the modifiers were written — so
//     `<Shift><Control>a` renders `Ctrl Shift A`. A port that emits what it read
//     passes every eyeball test on `<Control>C` and is wrong on the next one.
//
// THE COMPACT FORM is what both suites compare. A keycap is `[label]`, a sided
// modifier is `[label (L)]`, the keycaps of one combination touch, separators
// stand alone, and a disabled placeholder is `(disabled: text)`. It exists so
// the renderer suites can serialise their real DOM into the same shape instead
// of each asserting against its own node structure — a table only one consumer
// can drive is a unit test in a costume.
//
// WHAT THE VECTORS DO NOT PIN. `accessibleLabel` follows the C's STRUCTURE (a
// space between alternatives, the arrow between sequence steps, `…` for a range,
// and nothing between `&`-joined accelerators — :419-424, :449, :479, :528) but
// its per-accelerator text is this port's own `label+label` join standing in for
// `gtk_accelerator_get_label`, which is GTK's, not libadwaita's, and is not
// vendored here. It is asserted because the structure is worth pinning; the
// stand-in is called out so nobody reads it as verified upstream behaviour.
//
// Reference: refs/libadwaita/src/adw-shortcut-label.c:115-544
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { ShortcutLabelNode } from '../shortcut-label.js';

/**
 * The compact form of a parse, so the CORE suite compares the same strings the
 * renderer suites serialise their DOM into.
 *
 * It lives here rather than in a spec file for exactly that reason: two
 * serialisers would be two definitions of "the same rendering", and the
 * divergence would show up as a passing test on both sides.
 */
export function formatShortcutLabelNodes(nodes: readonly ShortcutLabelNode[]): string {
    return nodes
        .map((node) => {
            if (node.kind === 'disabled') return `(disabled: ${node.text})`;
            if (node.kind === 'separator') return node.text;
            return node.keys
                .map((key) => `[${key.sideMarker ? `${key.label} (${key.sideMarker})` : key.label}]`)
                .join('');
        })
        .join(' ')
        .trim();
}

/** One accelerator → rendering expectation. */
export interface ShortcutLabelVector {
    /** The `accelerator` property value. */
    accelerator: string;
    /** Compact rendering — see the header. */
    expected: string;
    /** `platform`, when the vector is about the Apple glyph set (:153-182). */
    platform?: 'default' | 'apple';
    /** `direction`, when the vector is about the sequence arrow (:439, :447). */
    direction?: 'ltr' | 'rtl';
    /** `disabled-text`, for the empty-accelerator vector (:513-520). */
    disabledText?: string;
    /** The accessible string — structure pinned, per-accelerator text is ours. */
    accessibleLabel?: string;
    /** The fragment that must fail to parse, if any (:531-534). */
    error?: string;
    /** Why this row exists. */
    rule: string;
}

/**
 * `AdwShortcutLabel`'s parse, across the four grammar levels and the label
 * lookup (adw-shortcut-label.c:115-544).
 */
export const SHORTCUT_LABEL_VECTORS: ReadonlyArray<ShortcutLabelVector> = [
    {
        accelerator: '<Control>C',
        expected: '[Ctrl][C]',
        accessibleLabel: 'Ctrl+C',
        rule: 'the documented single shortcut (:42) — one combination, one box of keycaps',
    },
    {
        accelerator: '<Shift><Control>a',
        expected: '[Ctrl][Shift][A]',
        accessibleLabel: 'Ctrl+Shift+A',
        rule: "THE ORDER VECTOR: keycaps follow GTK's fixed order (:215-237), not the written one",
    },
    {
        accelerator: '<Shift>A Home',
        expected: '[Shift][A] / [Home]',
        accessibleLabel: 'Shift+A Home',
        rule: 'alternatives split on a space and are joined by a dimmed `/` (:522-529)',
    },
    {
        accelerator: '<Alt>1...9',
        expected: '[Alt][1] ⋯ [9]',
        accessibleLabel: 'Alt+1…9',
        rule: 'a range splits on the FIRST `...` and draws `⋯`; the END of the range carries NO modifier, because `parse_range` parses the two halves independently (:463-484) — the widget draws `Alt 1 ⋯ 9`',
    },
    {
        accelerator: '<Control>C+<Control>X',
        expected: '[Ctrl][C] → [Ctrl][X]',
        accessibleLabel: 'Ctrl+C→Ctrl+X',
        rule: 'a sequence splits on `+` and is joined by a dimmed arrow (:434-458)',
    },
    {
        accelerator: '<Control>C+<Control>X',
        direction: 'rtl',
        expected: '[Ctrl][C] ← [Ctrl][X]',
        accessibleLabel: 'Ctrl+C←Ctrl+X',
        rule: 'the sequence arrow follows the text direction (:439, :447)',
    },
    {
        accelerator: 'Control_L&Control_R',
        expected: '[Ctrl (L)] [Ctrl (R)]',
        accessibleLabel: 'Ctrl LCtrl R',
        rule: '`&` means pressed together: two BOXES and — alone among the four levels — no separator node between them (:408-427). A sided modifier key draws its side marker (:115-196)',
    },
    {
        accelerator: '<Alt>1...9 <Alt>0',
        expected: '[Alt][1] ⋯ [9] / [Alt][0]',
        accessibleLabel: 'Alt+1…9 Alt+0',
        rule: 'THE NESTING VECTOR: spaces split before `...` does, so this is two alternatives (:522-531)',
    },
    {
        accelerator: '<Control>plus',
        expected: '[Ctrl][+]',
        accessibleLabel: 'Ctrl++',
        rule: 'a keysym NAME whose character is printable draws the character (:249-281)',
    },
    {
        accelerator: '<Control>space',
        expected: '[Ctrl][␣]',
        accessibleLabel: 'Ctrl+␣',
        rule: 'space is NOT printable to `g_unichar_isgraph`, so it takes the glyph branch (:250, :306-308)',
    },
    {
        accelerator: '<Control>backslash',
        expected: '[Ctrl][Backslash]',
        accessibleLabel: 'Ctrl+Backslash',
        rule: 'the one printable character with a WORD instead of a glyph (:267-269)',
    },
    {
        accelerator: 'Left',
        expected: '[←]',
        accessibleLabel: '←',
        rule: 'the four arrow keys draw arrows (:294-305)',
    },
    {
        accelerator: 'KP_5',
        expected: '[KP 5]',
        accessibleLabel: 'KP 5',
        rule: 'a keypad key with a printable character gets the `KP ` prefix (:272-276)',
    },
    {
        accelerator: 'Page_Up',
        expected: '[Page_Up]',
        accessibleLabel: 'Page_Up',
        rule: 'a `GTK_KEY_LABEL` msgid passes through untranslated, exactly as in the C locale (:312-317)',
    },
    {
        accelerator: '<Primary>c',
        expected: '[Ctrl][C]',
        accessibleLabel: 'Ctrl+C',
        rule: '`<Primary>` is Control off Apple',
    },
    {
        accelerator: '<Primary>c',
        platform: 'apple',
        expected: '[⌘][C]',
        accessibleLabel: '⌘+C',
        rule: '`<Primary>` is Command on Apple, and the modifier glyphs replace the words (:216-245)',
    },
    {
        accelerator: 'Escape',
        platform: 'apple',
        expected: '[⎋]',
        accessibleLabel: '⎋',
        rule: 'four keys have Apple-only glyphs behind an `#ifdef` (:318-331)',
    },
    {
        accelerator: 'Escape',
        expected: '[Escape]',
        accessibleLabel: 'Escape',
        rule: "the same key off Apple falls through to its name — the `#ifdef`'s other branch",
    },
    {
        accelerator: '',
        disabledText: 'Disabled',
        expected: '(disabled: Disabled)',
        accessibleLabel: 'Disabled',
        rule: 'an empty accelerator shows `disabled-text`, dimmed, and nothing else (:513-520)',
    },
    {
        accelerator: '<Control>C <Frobnicate>x',
        expected: '[Ctrl][C] /',
        error: '<Frobnicate>x',
        accessibleLabel: 'Ctrl+C ',
        rule: 'an unknown MODIFIER fails the parse; the widget keeps what it built and stops (:531-534)',
    },
];
