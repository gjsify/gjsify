// The live scheme switch: every view that carries a stale `ns-dark`/`ns-light` copy is swapped,
// and a view that never had one is left alone. Pure — a structural tree, no NativeScript.

import { describe, expect, it } from '@gjsify/unit';

import { type SchemeClassView, syncColorSchemeClasses } from './widgets/color-scheme-classes.js';

class FakeView implements SchemeClassView {
    readonly cssClasses?: Set<string>;
    readonly children: FakeView[] = [];
    restyled = 0;

    constructor(classes?: string[]) {
        if (classes !== undefined) this.cssClasses = new Set(classes);
    }

    eachChild(callback: (child: SchemeClassView) => boolean): void {
        for (const child of this.children) if (!callback(child)) return;
    }

    _onCssStateChange(): void {
        this.restyled++;
    }
}

function tree(scheme: 'ns-dark' | 'ns-light'): { root: FakeView; panel: FakeView; card: FakeView; label: FakeView } {
    const root = new FakeView(['ns-root', scheme]);
    const panel = new FakeView(['ns-android', scheme, 'adw-window']);
    const card = new FakeView([scheme, 'card']);
    const label = new FakeView();
    root.children.push(panel);
    panel.children.push(card, label);
    return { root, panel, card, label };
}

export default async () => {
    await describe('syncColorSchemeClasses', async () => {
        await it('swaps ns-dark for ns-light on the root and every descendant', () => {
            const { root, panel, card } = tree('ns-dark');
            expect(syncColorSchemeClasses(root, 'light')).toBe(3);
            for (const view of [root, panel, card]) {
                expect(view.cssClasses?.has('ns-light')).toBe(true);
                expect(view.cssClasses?.has('ns-dark')).toBe(false);
            }
        });

        await it('swaps ns-light for ns-dark the other way', () => {
            const { root, card } = tree('ns-light');
            syncColorSchemeClasses(root, 'dark');
            expect(card.cssClasses?.has('ns-dark')).toBe(true);
            expect(card.cssClasses?.has('ns-light')).toBe(false);
        });

        await it('keeps every other class', () => {
            const { root, panel } = tree('ns-dark');
            syncColorSchemeClasses(root, 'light');
            expect(panel.cssClasses?.has('ns-android')).toBe(true);
            expect(panel.cssClasses?.has('adw-window')).toBe(true);
            expect(root.cssClasses?.has('ns-root')).toBe(true);
        });

        await it('leaves a view without classes alone', () => {
            const { root, label } = tree('ns-dark');
            syncColorSchemeClasses(root, 'light');
            expect(label.cssClasses).toBe(undefined);
        });

        await it('is a no-op when the tree already follows the scheme', () => {
            const { root } = tree('ns-light');
            expect(syncColorSchemeClasses(root, 'light')).toBe(0);
        });

        await it('re-matches CSS once, on the root', () => {
            const { root, panel } = tree('ns-dark');
            syncColorSchemeClasses(root, 'light');
            expect(root.restyled).toBe(1);
            expect(panel.restyled).toBe(0);
        });
    });
};
