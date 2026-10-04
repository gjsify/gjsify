// System-bar decisions: which edges pay, and what the icons and backdrop look like per scheme.

import { describe, expect, it } from '@gjsify/unit';

import {
    DEFAULT_SYSTEM_BARS,
    SystemBarsConfig,
    insetsForEdges,
    lightBarFlag,
    resolveEdges,
    resolveSystemBars,
    systemBarsAppearance,
    withPageClass,
} from './widgets/system-bars.js';

export default async () => {
    await describe('lightBarFlag', async () => {
        await it('the dark scheme clears the flag, so the icons are light', () => {
            expect(lightBarFlag('auto', 'dark')).toBe(false);
        });
        await it('the light scheme sets the flag, so the icons are dark', () => {
            expect(lightBarFlag('auto', 'light')).toBe(true);
        });
        await it('an explicit choice ignores the scheme; light icons mean a clear flag', () => {
            expect(lightBarFlag('light', 'light')).toBe(false);
            expect(lightBarFlag('dark', 'dark')).toBe(true);
        });
    });

    await describe('systemBarsAppearance', async () => {
        await it('follows the scheme for both bars and paints the window colour', () => {
            const dark = systemBarsAppearance(DEFAULT_SYSTEM_BARS, 'dark');
            expect(dark.lightStatusBars).toBe(false);
            expect(dark.lightNavigationBars).toBe(false);
            expect(dark.background).toBe('#222226');
            expect(systemBarsAppearance(DEFAULT_SYSTEM_BARS, 'light').background).toBe('#fafafb');
        });
        await it('the bars can be overridden independently', () => {
            const bars = resolveSystemBars({ statusBarIcons: 'light', navigationBarIcons: 'auto' });
            const look = systemBarsAppearance(bars, 'light');
            expect(look.lightStatusBars).toBe(false);
            expect(look.lightNavigationBars).toBe(true);
        });
        await it('transparent has no colour and a custom colour passes through', () => {
            expect(systemBarsAppearance(resolveSystemBars({ background: 'transparent' }), 'dark').background).toBe(null);
            expect(systemBarsAppearance(resolveSystemBars({ background: '#123456' }), 'dark').background).toBe('#123456');
        });
    });

    await describe('insets option', async () => {
        await it('a boolean covers both edges, a partial keeps the rest', () => {
            expect(resolveEdges(false)).toStrictEqual({ top: false, bottom: false });
            expect(resolveEdges({ bottom: false })).toStrictEqual({ top: true, bottom: false });
            expect(resolveEdges(null)).toStrictEqual({ top: true, bottom: true });
        });
        await it('switched-off edges are zeroed, sides untouched', () => {
            const out = insetsForEdges({ top: 24, bottom: 48, left: 3, right: 4 }, { top: true, bottom: false });
            expect(out).toStrictEqual({ top: 24, bottom: 0, left: 3, right: 4 });
        });
    });

    await describe('withPageClass', async () => {
        await it('adds the window class once and keeps the others', () => {
            expect(withPageClass('')).toBe('adw-window');
            expect(withPageClass(undefined)).toBe('adw-window');
            expect(withPageClass('a b')).toBe('a b adw-window');
            expect(withPageClass('adw-window x')).toBe('adw-window x');
        });
    });

    await describe('SystemBarsConfig', async () => {
        await it('layers options over the current ones and notifies', () => {
            const config = new SystemBarsConfig();
            let seen = 0;
            config.subscribe(() => seen++);
            config.configure({ statusBarIcons: 'dark' });
            config.configure({ insets: { top: false } });
            expect(config.bars.statusBarIcons).toBe('dark');
            expect(config.bars.insets.top).toBe(false);
            expect(config.bars.insets.bottom).toBe(true);
            config.reset();
            expect(config.bars).toStrictEqual(DEFAULT_SYSTEM_BARS);
            expect(seen).toBe(3);
        });
    });
};
