// Which CSS properties GTK4 actually accepts — measured, not read.
//
// The whole style partition rests on one question: does this property become GTK
// CSS text, or must it become a widget property? Getting it wrong in the CSS
// direction is silent — GTK's parser drops the declaration and paints the widget
// without it, and nothing in a test run says so.
//
// So the answer is a MEASUREMENT. `gtk-css.spec.ts` loads every name below into a
// real `Gtk.CssProvider` and asserts it parses, and loads every name in
// `NOT_GTK_CSS` and asserts it does NOT. The table cannot claim something GTK
// disagrees with, and it cannot go stale against a GTK upgrade without a test going
// red first.
//
// Measured on GTK 4.22.4. Three results are worth carrying, because all three look
// like mistakes:
//
//   1. `text-align` IS NOT GTK CSS. It reads like a paint property and belongs in
//      the layout half, where it becomes `Gtk.Label:xalign`. A class compiler that
//      groups it with the other `text-*` utilities emits a declaration GTK silently
//      drops, and the text stays left-aligned with no diagnostic anywhere.
//   2. `margin` and `padding` ARE accepted, so spacing has TWO possible routes on
//      GTK — a CSS declaration or the widget's own `margin-top`… properties. They
//      are not equivalent (CSS margin sits outside the border, the widget property
//      does not compose with it), and choosing between them is the layout half's
//      decision, not this file's.
//   3. GTK CSS margins and paddings are PHYSICAL ONLY: `margin-start`, `margin-end`,
//      `padding-start` and `padding-end` are all refused. The widget's own margins
//      are the exact opposite — `margin-start`/`margin-end` and no
//      `margin-left`/`margin-right` (`gtk-props.ts`). So the two mechanisms of
//      result 2 are not two routes to one place: each is the ONLY route to one half
//      of the vocabulary, which is why `ml-*`/`mr-*` and `ms-*`/`me-*` land in
//      different channels in `layout.ts`, and why the layout half refuses an element
//      that spells both.
//
// Every entry carries a value that parses, because "is this a property" and "does
// this value parse" are different questions and only the pair is testable.
//
// EVERY SIDE AND EVERY CORNER IS LISTED SEPARATELY, and that is not padding. The
// first version of this table probed `border-top-left-radius` and `border-top-width`
// and left the other three corners and three sides to the shorthand — while the
// partition mapped all eight. The invariant spec caught it on its first run: a
// mapping is only proven for the exact name it emits, and a shorthand parsing says
// nothing about the longhand a class like `rounded-br` produces.

/**
 * Property names GTK4 accepts in a stylesheet, with a value that parses.
 *
 * The value matters: `border-radius: 8px` and `border-radius: 9999px` both parse,
 * but a property is only provably present when some value for it is accepted.
 */
export const GTK_CSS_PROBES: ReadonlyArray<readonly [property: string, value: string]> = [
    ['background-color', 'rgb(255 0 0)'],
    ['color', '#112233'],
    ['opacity', '0.7'],
    ['border-radius', '8px'],
    ['border-top-left-radius', '8px'],
    ['border-top-right-radius', '8px'],
    ['border-bottom-left-radius', '8px'],
    ['border-bottom-right-radius', '8px'],
    ['border-width', '1px'],
    ['border-top-width', '1px'],
    ['border-right-width', '1px'],
    ['border-bottom-width', '1px'],
    ['border-left-width', '1px'],
    ['border-style', 'solid'],
    ['border-color', '#abcdef'],
    ['border', '1px solid #abcdef'],
    ['border-bottom', '1px solid #abcdef'],
    ['box-shadow', '0 1px 2px rgba(0,0,0,0.2)'],
    ['font-size', '14px'],
    ['font-weight', '700'],
    ['font-family', 'Cantarell'],
    ['font-style', 'italic'],
    ['letter-spacing', '1px'],
    ['line-height', '1.4'],
    ['text-decoration-line', 'underline'],
    ['text-transform', 'uppercase'],
    ['margin', '8px'],
    ['margin-top', '8px'],
    ['margin-right', '8px'],
    ['margin-bottom', '8px'],
    ['margin-left', '8px'],
    ['padding', '8px'],
    ['padding-top', '8px'],
    ['padding-right', '8px'],
    ['padding-bottom', '8px'],
    ['padding-left', '8px'],
    ['min-width', '10px'],
    ['min-height', '10px'],
    ['transform', 'scale(1.1)'],
    ['transition', 'all 100ms'],
    ['caret-color', '#ff0000'],
    ['outline-style', 'solid'],
];

/**
 * Property names GTK4 REFUSES, and the reason each one is here.
 *
 * Most of them are the layout model the web has and GTK does not — there is no
 * `display: flex`, no absolute positioning, no intrinsic `width`. They must become
 * widget selection and widget properties, which is the layout half.
 *
 * Two groups are not that, and both are here because a reader would assume the
 * opposite. `text-align` is not about layout at all: it is the property most likely
 * to be grouped with `color` and `font-size` by anyone reading a Tailwind `text-*`
 * vocabulary, and GTK drops it in silence. The four logical spacings ARE spacing,
 * whose physical spellings sit in the accepted table three lines up — the refusal
 * is per NAME, not per concept, and that is the asymmetry `layout.ts` is built on.
 */
export const NOT_GTK_CSS: ReadonlyArray<readonly [property: string, value: string]> = [
    ['text-align', 'center'],
    ['display', 'flex'],
    ['flex-direction', 'row'],
    ['gap', '8px'],
    ['position', 'absolute'],
    ['width', '100px'],
    ['height', '100px'],
    ['justify-content', 'center'],
    ['align-items', 'center'],
    ['overflow', 'hidden'],
    ['z-index', '1'],
    ['top', '0'],
    ['right', '0'],
    ['bottom', '0'],
    ['left', '0'],
    ['margin-start', '8px'],
    ['margin-end', '8px'],
    ['padding-start', '8px'],
    ['padding-end', '8px'],
];

/** The property names of {@link GTK_CSS_PROBES}, for a membership test. */
export const GTK_CSS_PROPERTIES: ReadonlySet<string> = new Set(GTK_CSS_PROBES.map(([property]) => property));
