// Vectors for the two case rules — the acronym boundary is what the first version of
// `hostTagOf` got wrong (`GtkGLArea` -> `gtk-glarea` instead of `gtk-gl-area`), so it is
// asserted here rather than trusted from the docstring. `scripts/check-tag-case-rules.mjs`
// holds the `scripts/` restatement of both functions identical to this module; this suite is
// what pins the ALGORITHM itself, on Node as well as GJS.

import { describe, expect, it } from '@gjsify/unit';

import { attributeOf, hostTagOf } from './tags.js';

export default async () => {
    await describe('hostTagOf', async () => {
        await it('lower-cases a plain run and marks each word boundary', () => {
            expect(hostTagOf('AdwPreferencesGroup')).toBe('adw-preferences-group');
            expect(hostTagOf('AdwSwitchRow')).toBe('adw-switch-row');
            expect(hostTagOf('GtkBox')).toBe('gtk-box');
        });

        await it('closes an acronym run at its LAST capital, not its first', () => {
            // The measured regression: a naive `([a-z0-9])([A-Z])` split produces
            // `gtk-glarea`, one word short of `gtk-host`'s own `gtk-gl-area`.
            expect(hostTagOf('GtkGLArea')).toBe('gtk-gl-area');
            expect(hostTagOf('GtkATContext')).toBe('gtk-at-context');
        });

        await it('refuses a name that is not a GIR class', () => {
            expect(() => hostTagOf('preferences-group')).toThrow('is not a GIR class name');
            expect(() => hostTagOf('')).toThrow('is not a GIR class name');
            expect(() => hostTagOf('WkWebView')).toThrow('is not a GIR class name');
        });
    });

    await describe('attributeOf', async () => {
        await it('kebab-cases a camelCase property name', () => {
            expect(attributeOf('buttonLabel')).toBe('button-label');
            expect(attributeOf('showInitials')).toBe('show-initials');
        });

        await it('leaves an already-lowercase name unchanged', () => {
            expect(attributeOf('title')).toBe('title');
            expect(attributeOf('')).toBe('');
        });
    });
};
