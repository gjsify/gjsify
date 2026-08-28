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
import { act, create, type ReactTestRendererJSON } from 'react-test-renderer';

import { RCT_VIEW, View } from '../testing/react-native.js';
import { AdwBin } from './bin.native.js';

/** React's own opt-in for a test environment; the reason is in `clamp.native.spec.tsx`. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mounted(element: React.ReactElement): ReactTestRendererJSON {
    let renderer!: ReturnType<typeof create>;
    act(() => {
        renderer = create(element);
    });
    return renderer.toJSON() as ReactTestRendererJSON;
}

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
