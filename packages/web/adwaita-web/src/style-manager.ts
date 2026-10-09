// `Adw.StyleManager` on the browser: `dark` is what the page shows — a `.theme-dark` / `.theme-light`
// on the root outranks `prefers-color-scheme` (ADR 0078, `isAdwaitaDark`). The behaviour is the
// core's (`style-manager.ts`); this file is the SOURCE: the root's `class` attribute and the media
// query are the two things that can flip it. Without a `document` (SSR) it is light and never changes.

import { StyleManagerBase, type StyleSource } from '@gjsify/adwaita-core';

import { isAdwaitaDark } from './accent.js';

export const webStyleSource: StyleSource = {
    dark: () => typeof document !== 'undefined' && isAdwaitaDark(document.documentElement),
    subscribe(changed) {
        if (typeof document === 'undefined') return () => {};
        const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
        media?.addEventListener('change', changed);
        const observer = new MutationObserver(changed);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => {
            media?.removeEventListener('change', changed);
            observer.disconnect();
        };
    },
};

export class AdwStyleManager extends StyleManagerBase {
    static override source = webStyleSource;
}
