// The StyleManager core against the shared vectors on a fake source, plus what only the core sees.

import { describe, expect, it } from '@gjsify/unit';

import { STYLE_MANAGER_VECTORS, driveStyleManagerVectors } from './conformance/style-manager.js';
import type { AdwStyleLike } from './conformance/style-manager.js';
import { AccentColor, ColorScheme, StyleManagerBase, type StyleSource } from './style-manager.js';

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
            for (const listener of Array.from(listeners)) listener();
        },
        force(value) {
            if (value !== null) this.set(value);
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
            Adw: { StyleManager, ColorScheme } as unknown as AdwStyleLike,
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
        await it('system_supports_color_schemes is what the source answers, false without an answer', () => {
            const answers: boolean[] = [];
            for (const supports of [true, false, undefined]) {
                class Probe extends StyleManagerBase {
                    static override source: StyleSource = {
                        ...fakeSource(),
                        ...(supports === undefined ? {} : { supportsColorSchemes: () => supports }),
                    };
                }
                answers.push(Probe.get_default().system_supports_color_schemes);
            }
            expect(JSON.stringify(answers)).toBe('[true,false,false]');
        });
        await it('high contrast and accent default to false, blue and unsupported', () => {
            class Plain extends StyleManagerBase {
                static override source: StyleSource = fakeSource();
            }
            const manager = Plain.get_default();
            expect(manager.high_contrast).toBe(false);
            expect(manager.system_supports_accent_colors).toBe(false);
            expect(manager.accent_color).toBe(AccentColor.BLUE);
        });
        await it('notifies high-contrast and accent-color only on change', () => {
            let contrast = false;
            let accent: 'blue' | 'pink' | null = null;
            let fire: () => void = () => {};
            class Live extends StyleManagerBase {
                static override source: StyleSource = {
                    dark: () => false,
                    subscribe(changed) {
                        fire = changed;
                        return () => {};
                    },
                    force() {},
                    highContrast: () => contrast,
                    accentColor: () => accent,
                };
            }
            const manager = Live.get_default();
            const seen: string[] = [];
            manager.connect('notify::high-contrast', () => void seen.push('hc'));
            manager.connect('notify::accent-color', () => void seen.push('accent'));
            fire();
            expect(seen.length).toBe(0);
            contrast = true;
            accent = 'pink';
            fire();
            fire();
            expect(seen.join(',')).toBe('hc,accent');
            expect(manager.accent_color).toBe(AccentColor.PINK);
            expect(manager.accent_color_rgba.to_string().startsWith('rgb(')).toBe(true);
        });
        await it('has a vector row for every vector', () => {
            expect(STYLE_MANAGER_VECTORS.length > 0).toBe(true);
        });
    });
};
