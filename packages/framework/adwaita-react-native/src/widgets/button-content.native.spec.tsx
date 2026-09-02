/** @jsxImportSource react */
// The React Native half of `AdwButtonContent`, rendered through React's real reconciler.
//
// THE PAIRS WITH `content.gtk.spec.tsx` ARE THE FOUR DERIVATIONS, and two of them are the
// ones a hand-written translation gets wrong. `buttonContentIconExpands` is
// `gtk_widget_set_hexpand (self->icon, !label[0])` — the GTK suite reads `hexpand` off the
// real `GtkImage` (TRUE with no label, FALSE with one) and this file asserts the matching
// `flexGrow`. `buttonContentEllipsize` is `PANGO_ELLIPSIZE_END`, which the GTK suite reads
// back as `3` and this file spells `numberOfLines={1}` plus `ellipsizeMode="tail"`.
//
// THE MNEMONIC IS THE ASYMMETRY, ASSERTED FROM BOTH SIDES. The GTK suite reads `"_Save"`
// back off the property, because the label node carries `use-underline` itself and
// libadwaita resolves the marker at paint. This half has no mnemonic layer, so
// `buttonContentLabelText` strips it and the painted text is "Save". Running the same
// stripper on GTK would delete an underscore libadwaita is still going to interpret.
//
// The harness — `act`, the renderer, the child readers — is `../testing/render.spec.ts`.
//
// THE EMPTY ICON SLOT IS PINNED, NOT ASSERTED AS CORRECT. React Native resolves no icon
// theme, so the slot is in the row with the right `flexGrow` and holds no glyph — where
// GTK draws `folder-download-symbolic`, or `image-missing` for an empty slot. A later edit
// that starts drawing something has to change this file.

import { describe, expect, it } from '@gjsify/unit';
import type { ReactTestRendererJSON } from 'react-test-renderer';

import { RCT_TEXT, RCT_VIEW } from '../testing/react-native.js';
import { at, childrenOf, mounted } from '../testing/render.spec.js';
import { AdwButtonContent } from './button-content.native.js';

/** `[icon slot, label]` — the box is a row of exactly those two, always both. */
function parts(tree: ReactTestRendererJSON): [ReactTestRendererJSON, ReactTestRendererJSON] {
    const children = childrenOf(tree);
    if (children.length !== 2) throw new Error(`expected an icon slot and a label, got ${JSON.stringify(children)}`);
    return [at(children, 0), at(children, 1)];
}

export default async () => {
    await describe('AdwButtonContent on React Native — the box', async () => {
        await it('is a row with libadwaita’s own 6-point gap', async () => {
            // MEASURED on the real widget, not read off a selector: an
            // `AdwButtonContent` with an icon and a label inside a presented `GtkButton`
            // puts the image at x=161 width=16 and the label at x=183. The same widget's
            // `GtkBox:spacing` reads 0, which is why the number is
            // `BUTTON_CONTENT_BOX_SPACING` in the core and not a property read.
            const tree = mounted(<AdwButtonContent iconName="folder-download-symbolic" label="Save" />);
            expect(tree.type).toBe(RCT_VIEW);
            expect((tree.props.style as Record<string, unknown>).flexDirection).toBe('row');
            expect((tree.props.style as Record<string, unknown>).columnGap).toBe(6);
        });

        await it('gives the icon the free space when there is NO label, and not otherwise', async () => {
            // `hexpand` in a row is `flexGrow`. GTK reads TRUE and FALSE for the same two
            // inputs; with no label the icon expands and so centres itself in the button.
            const [bare] = parts(mounted(<AdwButtonContent iconName="folder-download-symbolic" />));
            expect((bare.props.style as Record<string, unknown>).flexGrow).toBe(1);
            const [beside] = parts(mounted(<AdwButtonContent iconName="folder-download-symbolic" label="Save" />));
            expect((beside.props.style as Record<string, unknown>).flexGrow).toBe(0);
        });

        await it('keeps the icon slot EMPTY, which is the divergence', async () => {
            // Pinned. There is no icon theme to resolve `folder-download-symbolic` — or
            // the `image-missing` an empty slot resolves to — against.
            const [icon] = parts(mounted(<AdwButtonContent iconName="folder-download-symbolic" label="Save" />));
            expect(icon.type).toBe(RCT_VIEW);
            expect(icon.children).toBe(null);
        });
    });

    await describe('AdwButtonContent on React Native — the label', async () => {
        await it('hides the node for an empty label rather than dropping it', async () => {
            // `gtk_widget_set_visible (self->label, label[0])` — the GTK suite reads
            // `visible === false` for the same input, and the node stays in the tree.
            const [, label] = parts(mounted(<AdwButtonContent />));
            expect(label.type).toBe(RCT_TEXT);
            expect((label.props.style as Record<string, unknown>).display).toBe('none');
        });

        await it('shows a label of SPACES — a first-character test, not a trim', async () => {
            const [, label] = parts(mounted(<AdwButtonContent label=" " />));
            expect((label.props.style as Record<string, unknown>).display).toBe('flex');
        });

        await it('resolves the mnemonic marker only when use-underline asks', async () => {
            // Default FALSE, the opposite of the banner button's template, so an
            // underscore survives unless the app asked for mnemonics.
            const [, literal] = parts(mounted(<AdwButtonContent label="_Save" />));
            expect(literal.children).toStrictEqual(['_Save']);
            const [, resolved] = parts(mounted(<AdwButtonContent label="_Save" useUnderline={true} />));
            // GTK keeps `"_Save"` in the property for this same input; the two halves
            // differ HERE and the reason is in the file header.
            expect(resolved.children).toStrictEqual(['Save']);
        });

        await it('ellipsizes at the end for can-shrink, and is unlimited without it', async () => {
            const [, unlimited] = parts(mounted(<AdwButtonContent label="Download the thing" />));
            expect(unlimited.props.numberOfLines).toBe(0);
            const [, shrunk] = parts(mounted(<AdwButtonContent label="Download the thing" canShrink={true} />));
            expect(shrunk.props.numberOfLines).toBe(1);
            expect(shrunk.props.ellipsizeMode).toBe('tail');
        });
    });
};
