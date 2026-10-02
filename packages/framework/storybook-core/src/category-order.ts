// The sidebar's category order — declared once, for every renderer.
//
// WHY THIS EXISTS. The order used to be a by-product of how each target happened
// to ENUMERATE its stories, and the three targets enumerate differently: the GTK
// and NativeScript storybooks take a path glob (so the order was alphabetical by
// `<category-dir>/<file>`), while the browser target has a hand-written import
// list. Nothing reconciled the two, so the reader met a different first screen
// per target — `Overview` led the browser sidebar and sat FIFTH, below the fold,
// on the GTK one, which reads as "the overview is missing" rather than as an
// ordering difference. That is exactly how it was reported.
//
// A comment in the browser's list asserted the two "mirror" each other while they
// measurably did not, which is the second half of the same defect: the only thing
// holding an invariant across three files was a sentence, and the sentence was
// wrong. So the order moves HERE, where all three renderers already share a
// `StorybookController`, and `scripts/check-storybook-category-order.mjs` holds
// the declaration against the categories the stories actually carry.
//
// The order itself is editorial, not mechanical: the gallery first, then the
// plain presentational widgets, then rows, then the structural widgets that need
// a page around them to make sense. Alphabetical would put Feedback and Layout
// ahead of the boxed lists that make up most of the set.
//
// `Media` sits with the CONTENT-bearing widgets rather than with `Layout`: an icon, a
// fitted picture, an inscription and a video are things a page SHOWS, and they belong
// beside the controls that act on them rather than beside the boxes that arrange them.
// `GtkPicture` sizes itself in characters and lines and `GtkMediaControls` is a pure view of
// a stream, so neither is a layout primitive even though both are measured.

/**
 * The category order every storybook renders its sidebar in.
 *
 * A category NOT listed here still renders — it sorts after every listed one,
 * keeping discovery order among its peers — because a storybook that drops a
 * story on an unrecognised prefix would hide work rather than surface it. The
 * build gate is what makes the omission visible.
 */
export const STORYBOOK_CATEGORY_ORDER: readonly string[] = [
    'Overview',
    'Presentation',
    'Boxed Lists',
    'Controls',
    'Buttons',
    // The widgets whose content is text: the delegate every entry is built on, the
    // multi-line editor, the label you edit in place, and the strip that reveals a search
    // field. It sits with the plain controls because it introduces nothing structural — no
    // page of its own is needed for any of the four to make sense.
    'Text',
    // Beside Layout: the other category whose widgets exist to hold output that no other
    // widget can produce. A canvas with a draw callback, a GL surface, a compositor
    // passthrough.
    'Drawing',
    'Media',
    'Layout',
    'Windows',
    'View Switching',
    'Navigation',
    'Feedback',
];

/**
 * Order `categories` by {@link STORYBOOK_CATEGORY_ORDER}, appending unlisted ones
 * in the order they arrived.
 *
 * Stable by construction: it partitions rather than sorts, so two unlisted
 * categories keep their discovery order instead of depending on a comparator's
 * tie-breaking.
 */
export function orderCategories(categories: readonly string[]): string[] {
    const rank = new Map(STORYBOOK_CATEGORY_ORDER.map((name, index) => [name, index]));
    const listed = [...categories].filter((name) => rank.has(name));
    listed.sort((a, b) => rank.get(a)! - rank.get(b)!);
    const unlisted = categories.filter((name) => !rank.has(name));
    return [...listed, ...unlisted];
}
