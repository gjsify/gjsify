// Shared, renderer-agnostic metadata for the Column View story. Imported by the GTK
// renderer (column-view.story.ts) and the browser renderer
// (browser/presentation/column-view.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/** Two-field items, which is what makes a two-column table out of the portable list. */
export const COLUMN_VIEW_ITEMS = [
    { value: 'de', label: 'German' },
    { value: 'fr', label: 'French' },
    { value: 'nl', label: 'Dutch' },
    { value: 'pt', label: 'Portuguese' },
];

export const columnViewMeta: StoryMeta = {
    title: 'Presentation/Column View',
    description:
        'Gtk.ColumnView — a list view with a header and one cell per column. Clicking a sortable header ' +
        'sets the sort and inverts it on the next click; the view itself reorders nothing.',
    controls: [
        { name: 'showRowSeparators', label: 'Row separators', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'showColumnSeparators',
            label: 'Column separators',
            type: ControlType.BOOLEAN,
            defaultValue: false,
        },
        { name: 'reorderable', label: 'Drag columns to reorder', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
