// What each desktop's raw settings mean — pure, so it runs on Node and GJS,
// and so the Windows and macOS answers are asserted from a Linux runner too.

import { describe, expect, it } from '@gjsify/unit';

import {
    appearanceFromGnomeSettings,
    appearanceFromMacDefaults,
    appearanceFromPortal,
    appearanceFromWindowsRegistry,
    isGnomeDesktop,
    MACOS_ACCENT_COLORS,
    mergeAppearance,
    parseRegQuery,
    sameAppearance,
} from './mapping.js';

export default async () => {
    await describe('appearanceFromPortal (org.freedesktop.appearance)', async () => {
        await it('snaps the reported colour and keeps it', () => {
            // What xdg-desktop-portal-gnome sends for "purple": libadwaita's own palette colour.
            expect(
                appearanceFromPortal({ 'accent-color': [0x91 / 255, 0x41 / 255, 0xac / 255], 'color-scheme': 1 }),
            ).toStrictEqual({ accent: 'purple', accentRgb: '#9141ac', colorScheme: 'dark' });
        });

        await it('snaps a KDE accent the way libadwaita does', () => {
            expect(appearanceFromPortal({ 'accent-color': [0x4c / 255, 0xe0 / 255, 0xcd / 255] }).accent).toBe('teal');
        });

        await it('maps the three scheme values and drops anything else', () => {
            expect(appearanceFromPortal({ 'color-scheme': 0 })).toStrictEqual({ colorScheme: 'no-preference' });
            expect(appearanceFromPortal({ 'color-scheme': 2 })).toStrictEqual({ colorScheme: 'light' });
            expect(appearanceFromPortal({ 'color-scheme': 7 })).toStrictEqual({});
        });

        await it('reads an out-of-range accent as "not set", not as a colour', () => {
            // The portal spec's "unset" value; clamping it would report black → slate.
            expect(appearanceFromPortal({ 'accent-color': [-1, -1, -1] })).toStrictEqual({});
            expect(appearanceFromPortal({ 'accent-color': [0.2, 0.4] })).toStrictEqual({});
        });

        await it('answers {} for a portal that has neither key', () => {
            expect(appearanceFromPortal({})).toStrictEqual({});
        });
    });

    await describe('appearanceFromGnomeSettings (org.gnome.desktop.interface)', async () => {
        await it('passes a named accent through without inventing a colour', () => {
            expect(appearanceFromGnomeSettings({ accentColor: 'slate', colorScheme: 'prefer-dark' })).toStrictEqual({
                accent: 'slate',
                colorScheme: 'dark',
            });
        });

        await it('maps default to no-preference and ignores unknown values', () => {
            expect(appearanceFromGnomeSettings({ accentColor: 'magenta', colorScheme: 'default' })).toStrictEqual({
                colorScheme: 'no-preference',
            });
            expect(appearanceFromGnomeSettings({ accentColor: null, colorScheme: null })).toStrictEqual({});
        });
    });

    await describe('isGnomeDesktop (XDG_CURRENT_DESKTOP)', async () => {
        await it('accepts GNOME anywhere in the list and nothing else', () => {
            expect(isGnomeDesktop('GNOME')).toBe(true);
            expect(isGnomeDesktop('ubuntu:GNOME')).toBe(true);
            expect(isGnomeDesktop('GNOME-Classic:GNOME')).toBe(true);
            expect(isGnomeDesktop('KDE')).toBe(false);
            expect(isGnomeDesktop('X-Cinnamon')).toBe(false);
            expect(isGnomeDesktop('')).toBe(false);
            expect(isGnomeDesktop(undefined)).toBe(false);
        });
    });

    await describe('appearanceFromWindowsRegistry', async () => {
        // A default Windows 11 blue palette: light 3/2/1, accent 0078d4, dark 1/2/3, unused.
        const palette = Uint8Array.from([
            0x99, 0xeb, 0xff, 0, 0x4c, 0xc2, 0xff, 0, 0x00, 0x91, 0xf8, 0, 0x00, 0x78, 0xd4, 0, 0x00, 0x5a, 0x9e, 0,
            0x00, 0x42, 0x75, 0, 0x00, 0x26, 0x42, 0, 0xf7, 0x63, 0x0c, 0,
        ]);

        await it('reads the accent from entry 3 of AccentPalette', () => {
            expect(appearanceFromWindowsRegistry({ accentPalette: palette, appsUseLightTheme: 0 })).toStrictEqual({
                accent: 'blue',
                accentRgb: '#0078d4',
                colorScheme: 'dark',
            });
        });

        await it('falls back to DWM AccentColor, stored 0xAABBGGRR', () => {
            // 0xff3a944a is B=3a G=94 R=4a in ABGR order → #4a943a.
            expect(appearanceFromWindowsRegistry({ dwmAccentColor: 0xff3a944a, appsUseLightTheme: 1 })).toStrictEqual({
                accent: 'green',
                accentRgb: '#4a943a',
                colorScheme: 'light',
            });
        });

        await it('leaves everything unknown when nothing exists', () => {
            expect(appearanceFromWindowsRegistry({})).toStrictEqual({});
        });
    });

    await describe('appearanceFromMacDefaults', async () => {
        await it('reads the all-absent default as multicolour blue and light', () => {
            // Measured on macOS 27: a fresh account has none of the three keys.
            expect(appearanceFromMacDefaults({})).toStrictEqual({
                accent: 'blue',
                accentRgb: '#017bff',
                colorScheme: 'light',
            });
        });

        await it('maps every AppleAccentColor index to the accent libadwaita picks for it', () => {
            const expected: Record<string, string> = {
                '-1': 'slate',
                '0': 'red',
                '1': 'orange',
                '2': 'yellow',
                '3': 'green',
                '4': 'blue',
                '5': 'purple',
                '6': 'pink',
            };
            for (const index of Object.keys(MACOS_ACCENT_COLORS)) {
                expect(appearanceFromMacDefaults({ appleAccentColor: index }).accent).toBe(expected[index]);
            }
        });

        await it('drops an index it does not know instead of guessing', () => {
            expect(appearanceFromMacDefaults({ appleAccentColor: '9', appleInterfaceStyle: 'Dark' })).toStrictEqual({
                colorScheme: 'dark',
            });
        });

        await it('leaves the scheme unknown under Auto appearance when the style key is absent', () => {
            // Auto flips by time of day, so absence no longer proves light.
            expect(appearanceFromMacDefaults({ appleInterfaceStyleSwitchesAutomatically: '1' }).colorScheme).toBe(
                undefined,
            );
            expect(
                appearanceFromMacDefaults({
                    appleInterfaceStyle: 'Dark',
                    appleInterfaceStyleSwitchesAutomatically: '1',
                }).colorScheme,
            ).toBe('dark');
        });
    });

    await describe('parseRegQuery', async () => {
        await it('reads REG_DWORD and REG_BINARY out of reg.exe output', () => {
            const dword =
                '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\DWM\r\n    AccentColor    REG_DWORD    0xffd47800\r\n\r\n';
            expect(parseRegQuery(dword, 'AccentColor')).toBe(0xffd47800);
            const binary = 'HKEY_CURRENT_USER\\X\n    AccentPalette    REG_BINARY    99EBFF004CC2FF00\n';
            expect([...(parseRegQuery(binary, 'AccentPalette') as Uint8Array)]).toStrictEqual([
                0x99, 0xeb, 0xff, 0, 0x4c, 0xc2, 0xff, 0,
            ]);
        });

        await it('answers null for a value that is not in the output', () => {
            expect(parseRegQuery('HKEY_CURRENT_USER\\X\n    Other    REG_DWORD    0x1\n', 'AccentColor')).toBe(null);
        });
    });

    await describe('mergeAppearance / sameAppearance', async () => {
        await it('fills only what the primary source left unknown, and keeps the colour with its name', () => {
            expect(
                mergeAppearance(
                    { colorScheme: 'dark' },
                    { accent: 'teal', accentRgb: '#2190a4', colorScheme: 'light' },
                ),
            ).toStrictEqual({ accent: 'teal', accentRgb: '#2190a4', colorScheme: 'dark' });
            // A named accent from the primary must not borrow the fallback's colour.
            expect(mergeAppearance({ accent: 'red' }, { accent: 'teal', accentRgb: '#2190a4' })).toStrictEqual({
                accent: 'red',
            });
        });

        await it('compares every field', () => {
            expect(sameAppearance({ accent: 'red' }, { accent: 'red' })).toBe(true);
            expect(sameAppearance({ accent: 'red' }, { accent: 'red', colorScheme: 'dark' })).toBe(false);
        });
    });
};
