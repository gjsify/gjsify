// The StyleManager core against the shared vectors on a fake source, plus what only the core sees.

import { describe, expect, it } from '@gjsify/unit';

import { STYLE_MANAGER_VECTORS, driveStyleManagerVectors } from './conformance/style-manager.js';
import type { AdwStyleLike } from './conformance/style-manager.js';
import { StyleManagerBase, type StyleSource } from './style-manager.js';

function fakeSource(): StyleSource & { set(dark: boolean): void } {
    let dark = false;
    const listeners = new Set<() => void>();
    return {
        dark: () => dark,
        subscribe(changed) {
            listeners.add(changed);
            return () => void listeners.delete(changed);
        },
        set(value) {
            dark = value;
            for (const listener of [...listeners]) listener();
        },
    };
}

export default async () => {
    const source = fakeSource();
    class StyleManager extends StyleManagerBase {
        static override source = source;
    }
    await driveStyleManagerVectors(
        {
            name: 'adwaita-core',
            isOracle: false,
            Adw: { StyleManager } as unknown as AdwStyleLike,
            setDark: (dark) => source.set(dark),
            settle: async () => {},
        },
        { describe, it, expect },
    );

    await describe('adwaita-core: Adw.StyleManager', async () => {
        await it('a class without a source says so', () => {
            class Bare extends StyleManagerBase {}
            let message = '';
            try {
                Bare.get_default();
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes('no StyleSource')).toBe(true);
        });
        await it('has a vector row for every vector', () => {
            expect(STYLE_MANAGER_VECTORS.length > 0).toBe(true);
        });
    });
};
