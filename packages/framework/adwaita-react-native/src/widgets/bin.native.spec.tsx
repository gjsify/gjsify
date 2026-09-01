/** @jsxImportSource react */
// The React Native half of `AdwBin`, rendered through React's real reconciler.
//
// WITHOUT THIS FILE THE WIDGET HAD NO RUNTIME COVERAGE ON THIS PLATFORM AT ALL, and the
// hole was invisible from every angle the package already looked from. `parity.spec.ts`
// holds `bin.native.tsx` to the base module's SURFACE, and a surface is a signature:
// measured, replacing the body with `return null` — a widget that renders nothing —
// left `tsc`, `check-adwaita-rn-platform-split.mjs` and all 19 Node tests green.
// `clamp.gtk.spec.tsx` renders `AdwBin` on GTK, so the asymmetry was one-sided: the
// package's smaller widget was proven on one renderer and asserted on the other.
//
// WHAT THERE IS TO GET WRONG in four lines. `Adw.Bin` is one child and NO layout of its
// own, and the React Native translation of that is a bare `View` — no `onLayout`, no
// style, exactly one host element. Each of those is a thing a later edit can add by
// reflex (the sibling `clamp.native.tsx` needs all three), and each would make `AdwBin`
// a widget that measures, or styles, or nests, where the GTK half does none of it. So
// the assertions are about the SHAPE of the tree, not only that one exists.

import { describe, expect, it } from '@gjsify/unit';
import type { ReactTestRendererJSON } from 'react-test-renderer';

import { RCT_VIEW, View } from '../testing/react-native.js';
import { mounted } from '../testing/render.spec.js';
import { AdwBin } from './bin.native.js';

export default async () => {
    await describe('AdwBin on React Native — the tree it emits', async () => {
        await it('is one view holding the child, and nothing else', async () => {
            const tree = mounted(
                <AdwBin>
                    <View testID="inside" />
                </AdwBin>,
            );
            expect(tree.type).toBe(RCT_VIEW);
            const children = (tree.children ?? []) as ReactTestRendererJSON[];
            expect(children.length).toBe(1);
            expect(children[0]?.type).toBe(RCT_VIEW);
            expect(children[0]?.props.testID).toBe('inside');
        });

        await it('adds no layout of its own — that is what makes it a Bin', async () => {
            // `Adw.Bin` carries no properties beyond the child. A `style` or an
            // `onLayout` here would be this half inventing behaviour the GTK half does
            // not have, which is the divergence class the whole package exists to close.
            const tree = mounted(<AdwBin>{null}</AdwBin>);
            expect(tree.props.style).toBe(undefined);
            expect(tree.props.onLayout).toBe(undefined);
        });

        await it('keeps BOTH children, where GTK keeps only the last', async () => {
            // The package's one silent divergence, pinned from this side too.
            // `clamp.gtk.spec.tsx` measures the same JSX against the real `Adw.Bin`:
            // gtk-host's `single` child policy is `set_child`, so the second child
            // EVICTS the first and the tree keeps "two" — no throw, no GLib message.
            // A `View` has no such limit. Naming it in the README is not enough on its
            // own: without a row on each side, one half can change and the divergence
            // silently becomes a different one.
            const tree = mounted(
                <AdwBin>
                    <View testID="one" />
                    <View testID="two" />
                </AdwBin>,
            );
            const children = (tree.children ?? []) as ReactTestRendererJSON[];
            expect(children.length).toBe(2);
            expect(children.map((child) => child.props.testID)).toStrictEqual(['one', 'two']);
        });

        await it('renders the child even when there is nothing to lay out', async () => {
            // A `null` child still leaves the view — `toJSON()` reports `children: null`
            // rather than an empty array, and reading that as "the widget vanished" is
            // the mistake this row is here to make impossible.
            const tree = mounted(<AdwBin>{null}</AdwBin>);
            expect(tree.type).toBe(RCT_VIEW);
            expect(tree.children).toBe(null);
        });
    });
};
