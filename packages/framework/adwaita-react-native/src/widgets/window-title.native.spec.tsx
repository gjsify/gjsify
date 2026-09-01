/** @jsxImportSource react */
// The React Native half of `AdwWindowTitle`, rendered through React's real reconciler.
//
// THIS SUITE ASSERTS THE SAME FOUR ROWS `window-title.gtk.spec.tsx` READS OFF THE LIVE
// GTK LABELS. There, libadwaita evaluates `string_is_not_empty` in C and the test reads
// each label's `visible`; here `@gjsify/adwaita-core`'s `deriveRowLabels` evaluates it in
// TypeScript and the test reads each `Text`'s `display`. Same four inputs, same four
// answers — including the row a `trim()` would get wrong, where a title of three SPACES
// is a VISIBLE title.
//
// BOTH LABELS STAY IN THE TREE. That is upstream's shape (`adw-window-title.ui` builds
// both and binds `visible`), and asserting the collapsed node's STYLE is a sharper test
// than asserting an absence: a half that stopped rendering the empty label would pass an
// absence assertion for the wrong reason.
//
// The harness — `act`, the renderer, the child readers — is `../testing/render.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';

import { RCT_TEXT, RCT_VIEW } from '../testing/react-native.js';
import { childrenOf, mounted, textOf, type Style } from '../testing/render.spec.js';
import { AdwWindowTitle } from './window-title.native.js';

/** `[title, subtitle]` as `[text, style]` pairs. */
function labels(element: React.ReactElement): Array<[string, Style]> {
    const tree = mounted(element);
    expect(tree.type).toBe(RCT_VIEW);
    return childrenOf(tree).map((child) => {
        expect(child.type).toBe(RCT_TEXT);
        return [textOf(child), child.props.style as Style];
    });
}

/** `visible=False` on a label, as React Native spells "not in layout". */
const COLLAPSED = { display: 'none' };

export default async () => {
    await describe('AdwWindowTitle on React Native — the tree it emits', async () => {
        await it('is two Texts in a centring View, always both of them', async () => {
            const tree = mounted(<AdwWindowTitle title="Document" subtitle="Edited" />);
            expect(tree.type).toBe(RCT_VIEW);
            expect(tree.props.style as Style).toStrictEqual({ alignItems: 'center' });
            expect(childrenOf(tree).map((child) => child.type)).toStrictEqual([RCT_TEXT, RCT_TEXT]);
        });
    });

    await describe('AdwWindowTitle on React Native — the visibility rule', async () => {
        await it('shows both labels when both are set', async () => {
            expect(labels(<AdwWindowTitle title="Document" subtitle="Edited" />)).toStrictEqual([
                ['Document', undefined],
                ['Edited', undefined],
            ]);
        });

        await it('collapses the TITLE label when the title is empty', async () => {
            // The rule neither other renderer had before it was lifted into the core:
            // only the subtitle was ever hidden, so a header bar with a subtitle and no
            // title reserved a blank line above it. GTK reads `visible=false` on the
            // same input.
            expect(labels(<AdwWindowTitle title="" subtitle="Edited" />)).toStrictEqual([
                ['', COLLAPSED],
                ['Edited', undefined],
            ]);
        });

        await it('collapses the subtitle label when the subtitle is empty', async () => {
            expect(labels(<AdwWindowTitle title="Document" subtitle="" />)).toStrictEqual([
                ['Document', undefined],
                ['', COLLAPSED],
            ]);
        });

        await it('treats an omitted property exactly as an empty one', async () => {
            expect(labels(<AdwWindowTitle />)).toStrictEqual([
                ['', COLLAPSED],
                ['', COLLAPSED],
            ]);
        });

        await it('keeps a title of three SPACES visible — the closure never trims', async () => {
            // `string_is_not_empty` is `string && string[0]`: one byte. GTK reads
            // `visible=true` for the same input, asserted in `window-title.gtk.spec.tsx`.
            expect(labels(<AdwWindowTitle title="   " />)).toStrictEqual([
                ['   ', undefined],
                ['', COLLAPSED],
            ]);
        });
    });
};
