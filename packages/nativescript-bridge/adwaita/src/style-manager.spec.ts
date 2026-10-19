// The `Adw.StyleManager` door of adwaita-nativescript, held to the shared vectors (real GJS is their
// oracle, in adwaita-core's `style-manager.gjs.spec.ts`). The scheme is the app's: `setAdwaitaColorScheme`.

import { STYLE_MANAGER_VECTORS, driveStyleManagerVectors, type AdwStyleLike } from '@gjsify/adwaita-core/conformance';
import { ColorScheme, setAdwaitaColorScheme, type AdwColorScheme } from '@gjsify/adwaita-core';
import { describe, expect, it } from '@gjsify/unit';

import { AdwStyleManager, setSystemAppearance } from './widgets/style-manager.js';

// `namespace/adw.ts` pulls in `@nativescript/core`, which a Node run has not got; the namespace only
// re-exports this class as `StyleManager` (the e2e `gi://Adw` arm holds that line).
const Adw = { StyleManager: AdwStyleManager, ColorScheme };

export default async () => {
    try {
        await driveStyleManagerVectors(
            {
                name: 'adwaita-nativescript',
                isOracle: false,
                Adw: Adw as unknown as AdwStyleLike,
                setDark: (dark) => setAdwaitaColorScheme(dark ? 'dark' : 'light'),
                settle: async () => {},
            },
            { describe, it, expect },
        );
        await describe('adwaita-nativescript: Adw.StyleManager door', async () => {
            await it('has a vector row for every vector', () => {
                expect(STYLE_MANAGER_VECTORS.length > 0).toBe(true);
            });
        });
        await describe('adwaita-nativescript: Adw.StyleManager follows the system', async () => {
            const manager = AdwStyleManager.get_default();
            let now: AdwColorScheme | null = null;
            let changed: ((scheme: AdwColorScheme) => void) | null = null;
            const flip = (scheme: AdwColorScheme) => {
                now = scheme;
                changed?.(scheme);
            };

            await it('cannot tell without a system, and can once the system reports one', () => {
                manager.set_color_scheme(ColorScheme.DEFAULT);
                expect(manager.get_system_supports_color_schemes()).toBe(false);
                setSystemAppearance({
                    current: () => now,
                    subscribe(next) {
                        changed = next;
                        return () => (changed = null);
                    },
                });
                expect(manager.get_system_supports_color_schemes()).toBe(false);
                flip('dark');
                expect(manager.get_system_supports_color_schemes()).toBe(true);
                expect(manager.get_dark()).toBe(true);
            });

            await it('ignores the system while a scheme is forced, and returns to it on DEFAULT', () => {
                manager.set_color_scheme(ColorScheme.FORCE_LIGHT);
                flip('light');
                flip('dark');
                expect(manager.get_dark()).toBe(false);
                manager.set_color_scheme(ColorScheme.DEFAULT);
                expect(manager.get_dark()).toBe(true);
                flip('light');
                expect(manager.get_dark()).toBe(false);
            });

            await it('stops following once the system is taken away', () => {
                setSystemAppearance(null);
                expect(changed).toBe(null);
                expect(manager.get_system_supports_color_schemes()).toBe(false);
            });
        });
    } finally {
        setSystemAppearance(null);
        setAdwaitaColorScheme('light');
    }
};
