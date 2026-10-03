// GJS-only tests for the Gdk keyval → DOM KeyboardEvent mapping.
//
// Two contracts this file holds, each from a measured incident on the GTK 4.24 macOS
// backend (`gdk_macos`, Homebrew gtk4 4.24.0, gjs 1.88.1):
//
//   1. A keyval Gdk could not name must NOT reach a consumer as its numeric Gdk spelling.
//      That backend's keymap has no entry for the arrow/navigation cluster, so a key press
//      arrives as `GDK_KEY_VoidSymbol` and `Gdk.keyval_name` answers the string `"0xffffff"`.
//      Publishing that as `key`/`code` invents a key value, and since EVERY unnamed key spells
//      the same string it also folds distinct dead keys into one held-key entry.
//   2. `code` is the key's physical position, so it must not move when Shift does. Gdk names a
//      shifted keyval after the shifted CHARACTER (`less`, `exclam`), which made Shift+Comma and
//      Comma two different codes for one key.
//
// Requires a GTK display (the CI workflow wraps tests in `xvfb-run`).

import { describe, it, expect } from '@gjsify/unit';

import Gdk from 'gi://Gdk?version=4.0';

import { gdkKeyvalToKey, gdkKeyvalToCode, gdkKeyvalToLocation } from './key-map.js';

/** A keyval in the `0x01000000` private range Gdk parks a key no keymap entry produced in. */
const UNNAMED_PRIVATE_RANGE = 0x01000010;

function keyvalFor(name: string): number {
    return Gdk.keyval_from_name(name);
}

export default async () => {
    await describe('gdkKeyvalToKey', async () => {
        await it('maps the navigation cluster to its DOM key', async () => {
            expect(gdkKeyvalToKey(keyvalFor('Left'))).toBe('ArrowLeft');
            expect(gdkKeyvalToKey(keyvalFor('Right'))).toBe('ArrowRight');
            expect(gdkKeyvalToKey(keyvalFor('Up'))).toBe('ArrowUp');
            expect(gdkKeyvalToKey(keyvalFor('Down'))).toBe('ArrowDown');
            expect(gdkKeyvalToKey(keyvalFor('Home'))).toBe('Home');
            expect(gdkKeyvalToKey(keyvalFor('End'))).toBe('End');
            expect(gdkKeyvalToKey(keyvalFor('Page_Up'))).toBe('PageUp');
            expect(gdkKeyvalToKey(keyvalFor('Page_Down'))).toBe('PageDown');
        });

        await it('reports a keyval Gdk could not name as Unidentified, not its numeric spelling', async () => {
            // The macOS backend answers "0xffffff" for VoidSymbol; Linux answers "VoidSymbol".
            // Neither may leave the mapping.
            expect(gdkKeyvalToKey(Gdk.KEY_VoidSymbol)).toBe('Unidentified');
            expect(gdkKeyvalToKey(UNNAMED_PRIVATE_RANGE)).toBe('Unidentified');
        });

        await it('reports printable keys by their character', async () => {
            expect(gdkKeyvalToKey(keyvalFor('a'))).toBe('a');
            expect(gdkKeyvalToKey(keyvalFor('A'))).toBe('A');
            expect(gdkKeyvalToKey(keyvalFor('1'))).toBe('1');
            expect(gdkKeyvalToKey(keyvalFor('space'))).toBe(' ');
        });
    });

    await describe('gdkKeyvalToCode', async () => {
        await it('maps the navigation cluster to its DOM code', async () => {
            expect(gdkKeyvalToCode(keyvalFor('Left'))).toBe('ArrowLeft');
            expect(gdkKeyvalToCode(keyvalFor('Right'))).toBe('ArrowRight');
            expect(gdkKeyvalToCode(keyvalFor('Up'))).toBe('ArrowUp');
            expect(gdkKeyvalToCode(keyvalFor('Down'))).toBe('ArrowDown');
        });

        await it('reports a keyval Gdk could not name as the empty string', async () => {
            expect(gdkKeyvalToCode(Gdk.KEY_VoidSymbol)).toBe('');
            expect(gdkKeyvalToCode(UNNAMED_PRIVATE_RANGE)).toBe('');
        });

        await it('keeps the same code for a key with and without Shift', async () => {
            // Gdk names the shifted keyval after the shifted character, so this pair used to be
            // 'Comma' and 'less' — two entries in a consumer's held-key list for one key.
            expect(gdkKeyvalToCode(keyvalFor('comma'))).toBe('Comma');
            expect(gdkKeyvalToCode(keyvalFor('less'))).toBe('Comma');
            expect(gdkKeyvalToCode(keyvalFor('period'))).toBe('Period');
            expect(gdkKeyvalToCode(keyvalFor('greater'))).toBe('Period');
            expect(gdkKeyvalToCode(keyvalFor('slash'))).toBe('Slash');
            expect(gdkKeyvalToCode(keyvalFor('question'))).toBe('Slash');
            expect(gdkKeyvalToCode(keyvalFor('minus'))).toBe('Minus');
            expect(gdkKeyvalToCode(keyvalFor('grave'))).toBe('Backquote');
            expect(gdkKeyvalToCode(keyvalFor('asciitilde'))).toBe('Backquote');
            expect(gdkKeyvalToCode(keyvalFor('apostrophe'))).toBe('Quote');
            expect(gdkKeyvalToCode(keyvalFor('quotedbl'))).toBe('Quote');
        });

        await it('gives letters and digits their positional code in either case', async () => {
            expect(gdkKeyvalToCode(keyvalFor('a'))).toBe('KeyA');
            expect(gdkKeyvalToCode(keyvalFor('A'))).toBe('KeyA');
            expect(gdkKeyvalToCode(keyvalFor('q'))).toBe('KeyQ');
            expect(gdkKeyvalToCode(keyvalFor('Q'))).toBe('KeyQ');
            expect(gdkKeyvalToCode(keyvalFor('1'))).toBe('Digit1');
            expect(gdkKeyvalToCode(keyvalFor('exclam'))).toBe('Digit1');
        });

        await it('maps the remaining named specials', async () => {
            expect(gdkKeyvalToCode(keyvalFor('space'))).toBe('Space');
            expect(gdkKeyvalToCode(keyvalFor('Return'))).toBe('Enter');
            expect(gdkKeyvalToCode(keyvalFor('Escape'))).toBe('Escape');
            expect(gdkKeyvalToCode(keyvalFor('F1'))).toBe('F1');
            expect(gdkKeyvalToCode(keyvalFor('KP_Left'))).toBe('Numpad4');
            expect(gdkKeyvalToCode(keyvalFor('Shift_L'))).toBe('ShiftLeft');
        });
    });

    await describe('gdkKeyvalToLocation', async () => {
        await it('separates the keypad, the left side and the right side', async () => {
            expect(gdkKeyvalToLocation(keyvalFor('KP_Left'))).toBe(3);
            expect(gdkKeyvalToLocation(keyvalFor('Shift_L'))).toBe(1);
            expect(gdkKeyvalToLocation(keyvalFor('Shift_R'))).toBe(2);
            expect(gdkKeyvalToLocation(keyvalFor('Left'))).toBe(0);
            expect(gdkKeyvalToLocation(keyvalFor('a'))).toBe(0);
        });
    });
};
