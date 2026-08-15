// Vectors for the button style-class table.
//
// The table is small enough that both renderers wrote their own and neither noticed
// the difference: `circular` was on the browser side only. These rows are what makes
// "both renderers know the same classes" a test rather than a claim.

/** One style-class resolution. */
export interface ButtonStyleClassVector {
    /** The short names a renderer hands in — attribute names, or a variant. */
    names: readonly string[];
    /** The classes that must come back, in order. */
    classes: readonly string[];
    rule: string;
}

export const BUTTON_STYLE_CLASS_VECTORS: ReadonlyArray<ButtonStyleClassVector> = [
    { names: [], classes: [], rule: 'a plain button carries no style class' },
    { names: ['flat'], classes: ['flat'], rule: '.flat — a button with no frame until hovered' },
    {
        names: ['suggested'],
        classes: ['suggested-action'],
        rule: 'the browser attribute `suggested` is the class `.suggested-action`',
    },
    {
        names: ['suggested-action'],
        classes: ['suggested-action'],
        rule: 'the NativeScript variant spells the class itself — both spellings resolve',
    },
    {
        names: ['destructive'],
        classes: ['destructive-action'],
        rule: '`destructive` → `.destructive-action`, the same short/long pair',
    },
    {
        names: ['circular'],
        classes: ['circular'],
        rule: 'CIRCULAR EXISTS — it was in the browser table and missing from the NativeScript one',
    },
    { names: ['pill'], classes: ['pill'], rule: '.pill — the fully rounded button' },
    {
        names: ['pill', 'suggested'],
        classes: ['suggested-action', 'pill'],
        rule: 'style classes COMPOSE (gtk_widget_add_css_class is a set), and come back in stylesheet order',
    },
    {
        names: ['suggested', 'pill'],
        classes: ['suggested-action', 'pill'],
        rule: "the caller's order does not change the result — two buttons with the same styles read alike",
    },
    {
        names: ['pill', 'pill'],
        classes: ['pill'],
        rule: 'a repeat is not a second class',
    },
    {
        names: ['suggessted'],
        classes: [],
        rule: 'a TYPO is dropped, not passed through — the input is author-written markup',
    },
    {
        names: ['flat', 'not-a-style', 'circular'],
        classes: ['flat', 'circular'],
        rule: 'one bad name does not take the good ones with it',
    },
];
