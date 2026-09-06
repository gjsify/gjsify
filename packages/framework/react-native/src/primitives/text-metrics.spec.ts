// What `<Text>` gets from Pango, held against what React Native promises.
//
// `<Text>` is `Gtk.Label` with `wrap: true` (`defaults.ts`), which is the right
// normalisation and puts this layer's text on GTK's height-for-width path. That path
// has one property React Native's does not, and it is the reason this file exists: a
// wrapping label's NATURAL width is the width of its text on one line, so a parent that
// gives a label exactly its natural width is giving it exactly enough. Every flex
// container does that for a child that does not expand — which is most text in an
// application.
//
// The vector below asserts that property. It is `it.failing` because GTK does not have
// it once letter-spacing is in play, and the marker retires itself the day GTK does.

import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import { describe, expect, it, on, type Runtime } from '@gjsify/unit';

const GTK_HOSTS: Runtime[] = ['Gjs', 'Node.js', 'Bun', 'Deno'];

/**
 * A label under a window, which is the shape an application has.
 *
 * The rooting is NOT what makes the measurement valid, and it is worth saying so because
 * the opposite is the natural assumption: measured on GTK 4.22.4, an unrooted label
 * resolves the display's CSS and answers the identical natural width, letter-spacing from
 * a stylesheet included (172 plain / 241 under `letter-spacing: 3px`, rooted or not). So a
 * re-measurement of any of this needs no window, and a vector that drops one has not
 * quietly changed what it measures.
 */
function labelled(text: string, letterSpacingPx: number): { label: Gtk.Label; window: Gtk.Window } {
    const window = new Gtk.Window();
    const label = new Gtk.Label({ label: text, wrap: true, xalign: 0, yalign: 0 });
    if (letterSpacingPx > 0) {
        const attributes = Pango.AttrList.new();
        attributes.insert(Pango.attr_letter_spacing_new(Math.round(letterSpacingPx * Pango.SCALE)));
        label.set_attributes(attributes);
    }
    window.set_child(label);
    return { label, window };
}

/** The height a label asks for at `forWidth`, and the height of one line. */
function lines(label: Gtk.Label): { natural: number; atNatural: number; unconstrained: number } {
    const natural = label.measure(Gtk.Orientation.HORIZONTAL, -1)[1];
    return {
        natural,
        atNatural: label.measure(Gtk.Orientation.VERTICAL, natural)[0],
        // The one-line height, taken relative to the natural width rather than at a fixed
        // large number: the shortfall this file is about is one or two pixels, so any
        // width comfortably past the natural one is a line, and a constant would stop
        // being one the day a vector carries a longer string.
        unconstrained: label.measure(Gtk.Orientation.VERTICAL, natural + 200)[0],
    };
}

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();

        await describe('a wrapping label at its own natural width', async () => {
            await it('fits on one line when nothing is letter-spaced', async () => {
                // The control. Without this the vector below could be failing because
                // the harness is wrong, and an expected failure that fails for the
                // wrong reason retires nothing when the real defect is fixed.
                for (const text of [
                    'Ermöglicht durch Unterstützer:innen wie Sie',
                    'Backstage · Früher lesen',
                    'Samstag, 5. September 2026',
                ]) {
                    const { label, window } = labelled(text, 0);
                    const measured = lines(label);
                    expect(measured.atNatural).toBe(measured.unconstrained);
                    window.destroy();
                }
            });

            await it.failing(
                'fits on one line when the text is letter-spaced',
                async () => {
                    for (const text of [
                        'Ermöglicht durch Unterstützer:innen wie Sie',
                        'Backstage · Früher lesen',
                        'Samstag, 5. September 2026',
                    ]) {
                        const { label, window } = labelled(text, 1.5);
                        const measured = lines(label);
                        try {
                            expect(measured.atNatural).toBe(measured.unconstrained);
                        } finally {
                            window.destroy();
                        }
                    }
                },
                // MEASURED on gjs 1.88.1 / GTK 4.22.4 / Pango 1.57, over four strings and
                // six letter-spacings. GTK's natural width is `ceil(logical width)`, and
                // Pango's logical extents EXCLUDE the spacing after the final glyph while
                // its line-breaker COUNTS it — so the breaker needs
                // `ceil(logical + spacing)` and is handed one or two pixels less:
                //
                //   spacing   0.0   0.2   0.5   1.0   1.5   2.0   (px)
                //   short by    0     0   0-1     1   1-2     2   (px)
                //
                // The consequence is a label that wraps onto two lines at its OWN natural
                // width, in a parent that measured its height for one — so the second
                // line is clipped. Reached through CSS `letter-spacing` and through a
                // Pango attribute alike, and unchanged by all three `natural-wrap-mode`
                // values, so there is nothing for this layer to set. Excluding the final
                // character from the attribute lowers the natural width by the same
                // amount and does not help either.
                //
                // Found in a shipped application: four labels of seventy-six, each one
                // an `Overline` or a masthead date, i.e. exactly the letter-spaced kind.
                // No upstream issue found on 2026-09-05; not filed from here because the
                // reproduction wants a C test case rather than a GJS one.
                'GTK 4.22.4: a wrapping label reports a natural width one to two pixels below what Pango needs to lay the text out on one line, when letter-spacing is set. See the table in this vector.',
            );
        });
    });
};
