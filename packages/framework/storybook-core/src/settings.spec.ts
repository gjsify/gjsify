// StorybookSettings — the preference/resolved split and the fan-out rules.

import { describe, expect, it } from '@gjsify/unit';
import { STORYBOOK_COLOR_SCHEMES, StorybookSettings } from './settings.js';

export default async () => {
    await describe('StorybookSettings colour scheme', async () => {
        await it('defaults to following the system, and to light when it cannot see one', () => {
            const settings = new StorybookSettings();
            expect(settings.colorScheme).toBe('system');
            // Not dark: a renderer that cannot read the desktop must not guess
            // dark, or it fights a light desktop on every start.
            expect(settings.resolvedDark).toBe(false);
        });

        await it('keeps the preference when resolving, so `system` stays selectable', () => {
            let dark = true;
            const settings = new StorybookSettings(() => dark);

            expect(settings.colorScheme).toBe('system');
            expect(settings.resolvedDark).toBe(true);

            // The whole point of the split: resolving to dark must NOT rewrite the
            // preference to 'dark', or the UI loses "Follow system".
            dark = false;
            expect(settings.colorScheme).toBe('system');
            expect(settings.resolvedDark).toBe(false);
        });

        await it('pins light and dark against the system', () => {
            const settings = new StorybookSettings(() => true);

            settings.colorScheme = 'light';
            expect(settings.resolvedDark).toBe(false);

            settings.colorScheme = 'dark';
            expect(settings.resolvedDark).toBe(true);
        });

        await it('offers system first — a selector follows this order', () => {
            expect([...STORYBOOK_COLOR_SCHEMES]).toStrictEqual(['system', 'light', 'dark']);
        });

        await it('ignores an unknown scheme instead of storing it', () => {
            const settings = new StorybookSettings();
            settings.colorScheme = 'sepia' as never;
            expect(settings.colorScheme).toBe('system');
        });
    });

    await describe('StorybookSettings accent mode', async () => {
        await it('follows the environment by default and applies nothing', () => {
            // The desktop owns the accent (`StyleManager:accent-color` is
            // read-only), so a storybook that overrode it out of the box would
            // discard the user's choice on every start.
            const settings = new StorybookSettings();
            expect(settings.accentMode).toBe('system');
            expect(settings.resolvedAccent).toBe(null);
        });

        await it('applies the chosen accent only once the mode is custom', () => {
            const settings = new StorybookSettings();

            settings.accent = 'purple';
            // Picking a swatch must NOT switch the mode on: a disabled-but-visible
            // selector still reports its current value, and flipping the mode there
            // would apply an accent nobody enabled.
            expect(settings.resolvedAccent).toBe(null);

            settings.accentMode = 'custom';
            expect(settings.resolvedAccent).toBe('purple');

            settings.accentMode = 'system';
            expect(settings.resolvedAccent).toBe(null);
            // …and the choice survives the round trip, so re-enabling restores it.
            expect(settings.accent).toBe('purple');
        });
    });

    await describe('StorybookSettings notification', async () => {
        await it('notifies on a change and not on a repeat', () => {
            const settings = new StorybookSettings();
            const seen: string[] = [];
            const unsubscribe = settings.subscribe((state) => seen.push(`${state.colorScheme}/${state.accent}`));

            settings.colorScheme = 'dark';
            settings.colorScheme = 'dark';
            settings.accent = 'purple';
            settings.accent = 'purple';

            expect(seen).toStrictEqual(['dark/blue', 'dark/purple']);

            unsubscribe();
            settings.accent = 'red';
            expect(seen.length).toBe(2);
        });

        await it('fans out a system change only while following the system', () => {
            // A renderer wires this to the platform signal unconditionally, so the
            // guard has to live here — otherwise a pinned scheme would rebuild its
            // stylesheet every time the desktop flipped.
            const settings = new StorybookSettings(() => true);
            let notified = 0;
            settings.subscribe(() => notified++);

            settings.systemChanged();
            expect(notified).toBe(1);

            settings.colorScheme = 'light';
            expect(notified).toBe(2);

            settings.systemChanged();
            expect(notified).toBe(2);
        });

        await it('survives a throwing subscriber', () => {
            const settings = new StorybookSettings();
            let reached = false;
            settings.subscribe(() => {
                throw new Error('boom');
            });
            settings.subscribe(() => {
                reached = true;
            });

            settings.accent = 'teal';
            expect(reached).toBe(true);
        });
    });
};
