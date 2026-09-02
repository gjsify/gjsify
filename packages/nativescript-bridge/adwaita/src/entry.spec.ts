// GtkEntry's character arithmetic, against the SAME vectors the entry ROW is
// held to (`@gjsify/adwaita-core/conformance`).
//
// The widget cannot be imported here (`extends GridLayout` evaluates the bare
// `@nativescript/core` specifier at module-eval) and needs no pure sibling, because it
// delegates: everything gettable-wrong about a text entry's length and truncation is
// `clampEntryText` / `entryTextLength` in `@gjsify/adwaita-core`.
//
// The COMPOSITION is what is under test. `_applyText` truncates with `clampEntryText`
// then reports `entryTextLength` of the RESULT, so a port reaching for
// `String.prototype.slice` or `.length` anywhere on that path reports 3 characters for
// `'🔒é'` and cuts a surrogate pair in half; every row below carries both halves.
//
// NOT covered: the re-entrancy guard in `_applyText` (writing the field re-enters
// through `textChange` and the notify must still fire exactly once) needs a real
// `TextField`.

import { describe, expect, it } from '@gjsify/unit';

import { ENTRY_ROW_MAX_LENGTH_LIMIT, clampEntryText, entryTextLength } from '@gjsify/adwaita-core';
import { ENTRY_MAX_LENGTH_VECTORS, ENTRY_TEXT_LENGTH_VECTORS } from '@gjsify/adwaita-core/conformance';

export const AdwEntryNsTest = async () => {
    await describe('GtkEntry text length (characters, not UTF-16 units)', async () => {
        for (const { text, length, rule } of ENTRY_TEXT_LENGTH_VECTORS) {
            await it(`${JSON.stringify(text)} → ${length} — ${rule}`, () => {
                expect(entryTextLength(text)).toBe(length);
            });
        }

        await it('reports 0 for an entry that was never written', () => {
            // `GtkEntry` starts at `''`, and the getter runs before any field
            // event has been seen.
            expect(entryTextLength('')).toBe(0);
        });
    });

    await describe('GtkEntry max-length truncation', async () => {
        for (const { text, maxLength, clamped, length, rule } of ENTRY_MAX_LENGTH_VECTORS) {
            await it(`${JSON.stringify(text)} @ ${maxLength} — ${rule}`, () => {
                const applied = clampEntryText(text, maxLength);
                expect(applied).toBe(clamped);
                // What the widget then reports as `textLength` — the two
                // functions have to agree on the same string.
                expect(entryTextLength(applied)).toBe(length);
            });
        }

        await it('treats every non-positive limit as unlimited', () => {
            // `GtkEntry.maxLength` floors its input at 0, and 0 is the documented
            // "no limit" value — so a caller passing a negative must not end up
            // with an entry that can hold nothing.
            expect(clampEntryText('Ada Lovelace', 0)).toBe('Ada Lovelace');
            expect(clampEntryText('Ada Lovelace', -1)).toBe('Ada Lovelace');
            expect(clampEntryText('Ada Lovelace', Number.NaN)).toBe('Ada Lovelace');
        });

        await it('caps the limit at the 16-bit ceiling, which stays a shared constant', () => {
            // `GtkEntry.maxLength` clamps into `[0, ENTRY_ROW_MAX_LENGTH_LIMIT]`
            // — the bound `Adw.EntryRow` declares (`G_MAXUINT16`,
            // adw-entry-row.c:666-669, :678-682), taken from the core rather than
            // respelt on this port. `Gtk.Entry`'s own range is not vendored here.
            expect(ENTRY_ROW_MAX_LENGTH_LIMIT).toBe(0xffff);
            // A limit at the ceiling still truncates like any other.
            expect(clampEntryText('Ada', ENTRY_ROW_MAX_LENGTH_LIMIT)).toBe('Ada');
            expect(clampEntryText('Ada', 2)).toBe('Ad');
        });
    });
};

export default AdwEntryNsTest;
