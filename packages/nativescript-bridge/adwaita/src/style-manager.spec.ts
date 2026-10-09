// The `Adw.StyleManager` door of adwaita-nativescript, held to the shared vectors (real GJS is their
// oracle, in adwaita-core's `style-manager.gjs.spec.ts`). The scheme is the app's: `setAdwaitaColorScheme`.

import { STYLE_MANAGER_VECTORS, driveStyleManagerVectors, type AdwStyleLike } from '@gjsify/adwaita-core/conformance';
import { setAdwaitaColorScheme } from '@gjsify/adwaita-core';
import { describe, expect, it } from '@gjsify/unit';

import { AdwStyleManager } from './widgets/style-manager.js';

// `namespace/adw.ts` pulls in `@nativescript/core`, which a Node run has not got; the namespace only
// re-exports this class as `StyleManager` (the e2e `gi://Adw` arm holds that line).
const Adw = { StyleManager: AdwStyleManager };

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
    } finally {
        setAdwaitaColorScheme('light');
    }
};
