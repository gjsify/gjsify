// Shared, renderer-agnostic metadata for the Grid View story. Imported by the GTK
// renderer (grid-view.story.ts) and the browser renderer
// (browser/presentation/grid-view.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

import { LIST_VIEW_SELECTION_MODES } from './list-view.meta.js';

/** Enough items that a column-count change is visible as a reflow rather than as a resize. */
export const GRID_VIEW_ITEMS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August'] as const;

export const gridViewMeta: StoryMeta = {
    title: 'Presentation/Grid View',
    description:
        'Gtk.GridView — the same model and factory as a list view, reflowed into as many equal columns as ' +
        'the width fits, between min-columns and max-columns.',
    controls: [
        { name: 'maxColumns', label: 'Max columns', type: ControlType.NUMBER, defaultValue: 4 },
        { name: 'minColumns', label: 'Min columns', type: ControlType.NUMBER, defaultValue: 1 },
        {
            name: 'selectionMode',
            label: 'Selection',
            type: ControlType.SELECT,
            options: LIST_VIEW_SELECTION_MODES,
            defaultValue: 'single',
        },
    ],
};
