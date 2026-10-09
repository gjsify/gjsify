// The `GtkSource.View` property defaults slice 2 claims. The ORACLE reads them off the pspecs of real
// `gi://GtkSource` (no display needed); a port reads them off a fresh view.

export interface GtkSourceViewDefaultsVector {
    readonly property: string;
    /** The member a port spells it as. */
    readonly member: string;
    readonly shows: boolean | number;
}

export const GTKSOURCE_VIEW_DEFAULT_VECTORS: readonly GtkSourceViewDefaultsVector[] = [
    { property: 'auto-indent', member: 'autoIndent', shows: false },
    { property: 'indent-width', member: 'indentWidth', shows: -1 },
    { property: 'show-line-numbers', member: 'showLineNumbers', shows: false },
    { property: 'highlight-current-line', member: 'highlightCurrentLine', shows: false },
    { property: 'monospace', member: 'monospace', shows: false },
    { property: 'editable', member: 'editable', shows: true },
    { property: 'left-margin', member: 'leftMargin', shows: 0 },
    { property: 'right-margin', member: 'rightMargin', shows: 0 },
    { property: 'top-margin', member: 'topMargin', shows: 0 },
    { property: 'bottom-margin', member: 'bottomMargin', shows: 0 },
];
