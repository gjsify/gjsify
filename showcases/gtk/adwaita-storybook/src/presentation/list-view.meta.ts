// Shared, renderer-agnostic metadata for the List View story. Imported by the GTK
// renderer (list-view.story.ts) and the browser renderer
// (browser/presentation/list-view.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/** The one model all renderings drive, so a selected position means the same thing everywhere. */
export const LIST_VIEW_ITEMS = ['Documents', 'Downloads', 'Music', 'Pictures', 'Videos'] as const;

/** The three selection models a view may wrap its model in, under their portable nicks. */
export const LIST_VIEW_SELECTION_MODES = [
    { label: 'Single', value: 'single' },
    { label: 'Multiple', value: 'multiple' },
    { label: 'None', value: 'none' },
];

export const listViewMeta: StoryMeta = {
    title: 'Presentation/List View',
    description:
        'Gtk.ListView — one row per item of a list model, each built by a factory. The model is the ' +
        'portable list (ADR 0046); which Gtk.SelectionModel would have wrapped it is the selection mode.',
    controls: [
        {
            name: 'selectionMode',
            label: 'Selection',
            type: ControlType.SELECT,
            options: LIST_VIEW_SELECTION_MODES,
            defaultValue: 'single',
        },
        { name: 'showSeparators', label: 'Separators', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'singleClickActivate',
            label: 'Activate on single click',
            type: ControlType.BOOLEAN,
            defaultValue: false,
        },
    ],
};
