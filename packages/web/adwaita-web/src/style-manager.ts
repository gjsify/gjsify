// `Adw.StyleManager` on the browser: `dark` is what the page shows — a `.theme-dark` / `.theme-light`
// on the root outranks `prefers-color-scheme` (ADR 0078, `isAdwaitaDark`). The behaviour is the
// core's (`style-manager.ts`); this file is the SOURCE: the root's `class` attribute and the media
// query are the two things that can flip it. Without a `document` (SSR) it is light and never changes.
// The system supports color schemes when the browser knows `prefers-color-scheme`: then one of its
// two values matches; a browser without the feature matches neither.

import { ColorScheme, StyleManagerBase, type StyleSource } from '@gjsify/adwaita-core';

import { isAdwaitaDark } from './accent.js';

export const webStyleSource: StyleSource = {
    dark: () => typeof document !== 'undefined' && isAdwaitaDark(document.documentElement),
    subscribe(changed) {
        if (typeof document === 'undefined') return () => {};
        const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
        const contrast = globalThis.matchMedia?.('(prefers-contrast: more)');
        media?.addEventListener('change', changed);
        contrast?.addEventListener('change', changed);
        const observer = new MutationObserver(changed);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => {
            media?.removeEventListener('change', changed);
            contrast?.removeEventListener('change', changed);
            observer.disconnect();
        };
    },
    highContrast: () => globalThis.matchMedia?.('(prefers-contrast: more)').matches === true,
    // A page cannot read the desktop's accent (CSS `AccentColor` is uneven, see ADR 0078): no system accent.
    supportsColorSchemes() {
        const matches = (query: string) => globalThis.matchMedia?.(query).matches === true;
        return matches('(prefers-color-scheme: dark)') || matches('(prefers-color-scheme: light)');
    },
};

// FORCE_DARK / FORCE_LIGHT write the same root class an app writes by hand; DEFAULT takes it away.
webStyleSource.force = (dark) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.remove('theme-dark', 'theme-light');
    if (dark !== null) root.classList.add(dark ? 'theme-dark' : 'theme-light');
};

export class AdwStyleManager extends StyleManagerBase {
    static readonly ColorScheme = ColorScheme;
    static override source = webStyleSource;
}
