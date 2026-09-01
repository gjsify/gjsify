// DOM-level tests for <gtk-entry>'s length arithmetic.
//
// The element had NO max length and no text length, while its NativeScript twin has
// composed `@gjsify/adwaita-core`'s since it shipped — so the same consumer got a
// limit on one renderer and none on the other. These drive the core's own vectors
// against the real element, which is what makes the delegation checkable rather
// than merely claimed: a re-implementation that counts UTF-16 units instead of code
// points fails on the row that names it.

import { describe, expect, it } from '@gjsify/unit';
import { ENTRY_MAX_LENGTH_VECTORS, ENTRY_TEXT_LENGTH_VECTORS } from '@gjsify/adwaita-core/conformance';

import type { GtkEntry } from './elements/gtk-entry.js';

/** Mount an entry with the given attributes. */
function mountEntry(attrs: Record<string, string> = {}): GtkEntry {
    const entry = document.createElement('gtk-entry') as GtkEntry;
    for (const [name, value] of Object.entries(attrs)) entry.setAttribute(name, value);
    document.body.appendChild(entry);
    return entry;
}

function unmountAll(): void {
    for (const entry of Array.from(document.querySelectorAll('gtk-entry'))) entry.remove();
}

export const GtkEntryTest = async () => {
    await describe('<gtk-entry> text length', async () => {
        for (const { text, length, rule } of ENTRY_TEXT_LENGTH_VECTORS) {
            await it(`${JSON.stringify(text)} → ${length} — ${rule}`, () => {
                const entry = mountEntry();
                entry.value = text;
                expect(entry.textLength).toBe(length);
                unmountAll();
            });
        }
    });

    await describe('<gtk-entry> max length', async () => {
        for (const { text, maxLength, clamped, length, rule } of ENTRY_MAX_LENGTH_VECTORS) {
            await it(`${JSON.stringify(text)} @ ${maxLength} — ${rule}`, () => {
                const entry = mountEntry({ maxlength: String(maxLength) });
                entry.value = text;
                expect(entry.value).toBe(clamped);
                expect(entry.textLength).toBe(length);
                unmountAll();
            });
        }

        await it('clamps what the ATTRIBUTE writes, not only the property', () => {
            const entry = mountEntry({ maxlength: '5' });
            entry.setAttribute('value', 'Ada Lovelace');
            expect(entry.value).toBe('Ada L');
            unmountAll();
        });

        await it('re-clamps when the limit is lowered under the current text', () => {
            const entry = mountEntry();
            entry.value = 'Ada Lovelace';
            entry.maxLength = 3;
            expect(entry.value).toBe('Ada');
            unmountAll();
        });

        await it('an unusable limit means unlimited, never "truncate to empty"', () => {
            const entry = mountEntry({ maxlength: 'nonsense' });
            entry.value = 'Ada Lovelace';
            expect(entry.maxLength).toBe(0);
            expect(entry.value).toBe('Ada Lovelace');
            unmountAll();
        });
    });
};
