/** @jsxImportSource react */
// The React Native half of `AdwBanner`, rendered through React's real reconciler.
//
// THE DEFAULT THIS FILE IS REALLY ABOUT IS `use-markup`. `ADW_BANNER_DEFAULTS.useMarkup`
// is TRUE, faithfully recording a `GParamSpec` that says so — and a freshly constructed
// `Adw.Banner` reads FALSE, because `adw_banner_get_use_markup` delegates to the title
// label and `adw-banner.ui` never sets it there. `content.gtk.spec.tsx` asserts the FALSE
// off the real widget; this file asserts that the same omission paints the title
// literally here. Using the constant would have made this half agree with a number no
// widget produces.
//
// AND THE OTHER PAIR IS THE MNEMONIC, which is asymmetric by design and not by accident:
// the template pins the BUTTON to `use-underline=True` and the TITLE to False, so exactly
// one of the two strings loses its underscore. The GTK half reads `"_Undo"` back off the
// property and paints "Undo"; this half paints "Undo" and leaves the title's underscores
// alone. A renderer that stripped both, or neither, would be wrong in a way no single-sided
// test can see.
//
// The harness — `act`, the renderer, the child readers — is `../testing/render.spec.ts`.
//
// WHAT A PRESS ASSERTION PROVES HERE. The double forwards `onPress` verbatim, where real
// React Native wires it through the press responder — so this suite proves the widget ASKS
// for the press and hands it the caller's callback, never that a tap arrives. Same class
// of gap as Yoga; the README carries both.

import { describe, expect, it } from '@gjsify/unit';
import { act, type ReactTestRendererJSON } from 'react-test-renderer';

import { RCT_TEXT, RCT_VIEW } from '../testing/react-native.js';
import { at, childrenOf, mounted } from '../testing/render.spec.js';
import { AdwBanner } from './banner.native.js';

/** `[title, button]` — the strip is a row of exactly those two, always both. */
function parts(tree: ReactTestRendererJSON): [ReactTestRendererJSON, ReactTestRendererJSON] {
    const children = childrenOf(tree);
    if (children.length !== 2) throw new Error(`expected a title and a button, got ${JSON.stringify(children)}`);
    return [at(children, 0), at(children, 1)];
}

export default async () => {
    await describe('AdwBanner on React Native — the strip it emits', async () => {
        await it('is a row of a title and a button, both always in the tree', async () => {
            const tree = mounted(<AdwBanner title="Metered connection" revealed={true} />);
            expect(tree.type).toBe(RCT_VIEW);
            expect((tree.props.style as Record<string, unknown>).flexDirection).toBe('row');
            const [title, button] = parts(tree);
            expect(title.type).toBe(RCT_TEXT);
            expect(button.type).toBe(RCT_TEXT);
            // The button is HIDDEN, not absent — `gtk_widget_set_visible` keeps the node.
            expect((button.props.style as Record<string, unknown>).display).toBe('none');
        });

        await it('collapses out of layout when revealed is omitted, rather than unmounting', async () => {
            // `Adw.Banner`'s `GtkRevealer` keeps the widget and takes it out of the
            // allocation; `display: 'none'` is Yoga's spelling of that. Returning `null`
            // would rebuild the strip every time it came back.
            const hidden = mounted(<AdwBanner title="Metered connection" />);
            expect((hidden.props.style as Record<string, unknown>).display).toBe('none');
            const shown = mounted(<AdwBanner title="Metered connection" revealed={true} />);
            expect((shown.props.style as Record<string, unknown>).display).toBe('flex');
        });
    });

    await describe('AdwBanner on React Native — the title, and the default that is not declared', async () => {
        await it('paints markup LITERALLY when use-markup is omitted, as the widget does', async () => {
            // GTK reads `use-markup` back as FALSE for this same input, asserted in
            // `content.gtk.spec.tsx`. The pspec says TRUE and never applies it.
            const [title] = parts(mounted(<AdwBanner title="<b>Metered</b> connection" revealed={true} />));
            expect(title.children).toStrictEqual(['<b>Metered</b> connection']);
        });

        await it('reduces markup to its plain text when it is asked for', async () => {
            // React Native has no inline-markup layer, so the honest reduction is the
            // markup's PLAIN TEXT — `stripMarkup`, the same call the NativeScript renderer
            // makes. Painting the tags is further from what GTK draws than dropping them.
            const [title] = parts(
                mounted(<AdwBanner title="<b>Metered</b> connection" useMarkup={true} revealed={true} />),
            );
            expect(title.children).toStrictEqual(['Metered connection']);
        });

        await it('keeps unparseable markup verbatim, which is Pango’s own fallback', async () => {
            const [title] = parts(mounted(<AdwBanner title="5 < 7 & rising" useMarkup={true} revealed={true} />));
            expect(title.children).toStrictEqual(['5 < 7 & rising']);
        });

        await it('leaves the TITLE’s underscores alone — only the button is a mnemonic', async () => {
            const [title] = parts(mounted(<AdwBanner title="_Metered" revealed={true} />));
            expect(title.children).toStrictEqual(['_Metered']);
        });
    });

    await describe('AdwBanner on React Native — the action button', async () => {
        await it('shows for a non-empty label and strips the mnemonic marker', async () => {
            const [, button] = parts(mounted(<AdwBanner title="Metered" buttonLabel="_Undo" revealed={true} />));
            expect((button.props.style as Record<string, unknown>).display).toBe('flex');
            // GTK keeps `"_Undo"` in the property and paints "Undo"; this half has no
            // mnemonic layer, so `bannerButtonText` does the stripping.
            expect(button.children).toStrictEqual(['Undo']);
        });

        await it('shows for a label of SPACES — a first-character test, not a trim', async () => {
            // `gtk_widget_set_visible (button, label && label[0])`. A renderer that
            // trimmed would drop a button GTK draws.
            const [, button] = parts(mounted(<AdwBanner title="Metered" buttonLabel=" " revealed={true} />));
            expect((button.props.style as Record<string, unknown>).display).toBe('flex');
        });

        await it('paints the suggested style with the accent, which is what the class means', async () => {
            // `.suggested-action` has no class system to live in here, but it is not
            // decoration: Adwaita paints it with the accent background and white on top.
            // `#3584e4` is `ADW_ACCENT_BG_COLORS.blue`, libadwaita's default accent.
            const [, plain] = parts(mounted(<AdwBanner title="Metered" buttonLabel="Undo" revealed={true} />));
            expect((plain.props.style as Record<string, unknown>).backgroundColor).toBe(undefined);
            const [, suggested] = parts(
                mounted(<AdwBanner title="Metered" buttonLabel="Undo" buttonStyle="suggested" revealed={true} />),
            );
            expect((suggested.props.style as Record<string, unknown>).backgroundColor).toBe('#3584e4');
            expect((suggested.props.style as Record<string, unknown>).color).toBe('#ffffff');
        });

        await it('hands onButtonClicked to the press, so a tap reaches the caller', async () => {
            let clicked = 0;
            const [, button] = parts(
                mounted(
                    <AdwBanner
                        title="Metered"
                        buttonLabel="Undo"
                        revealed={true}
                        onButtonClicked={() => (clicked += 1)}
                    />,
                ),
            );
            const onPress = button.props.onPress as (() => void) | undefined;
            if (typeof onPress !== 'function') throw new Error('the button carries no onPress');
            act(() => onPress());
            expect(clicked).toBe(1);
        });
    });
};
