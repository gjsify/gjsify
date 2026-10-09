// The `Adw.StyleManager` door of adwaita-web, held to the shared vectors (real GJS is their oracle, in
// adwaita-core's `style-manager.gjs.spec.ts`). The page is made dark the way an app does it: the
// `.theme-dark` / `.theme-light` class on the root.

import { STYLE_MANAGER_VECTORS, driveStyleManagerVectors, type AdwStyleLike } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';

export const StyleManagerTest = async () => {
    const root = document.documentElement;
    const before = root.className;
    try {
        await driveStyleManagerVectors(
            {
                name: 'adwaita-web',
                isOracle: false,
                Adw: Adw as unknown as AdwStyleLike,
                setDark(dark) {
                    root.classList.remove('theme-dark', 'theme-light');
                    root.classList.add(dark ? 'theme-dark' : 'theme-light');
                },
                // A MutationObserver reports in a microtask; a task later it has been heard.
                settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
            },
            { describe, it, expect },
        );
        await describe('adwaita-web: Adw.StyleManager door', async () => {
            await it('has a vector row for every vector', () => {
                expect(STYLE_MANAGER_VECTORS.length > 0).toBe(true);
            });
        });
    } finally {
        root.className = before;
    }
};
