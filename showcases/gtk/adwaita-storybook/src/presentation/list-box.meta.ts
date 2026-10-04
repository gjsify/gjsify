// Shared, renderer-agnostic metadata for the List Box story. Imported by the GTK renderer
// (list-box.story.ts) and the browser renderer (browser/presentation/list-box.web.ts), so
// both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/** The rows both renderings build, so a selected position means the same thing everywhere. */
export const LIST_BOX_ROWS = ['Documents', 'Downloads', 'Music', 'Pictures', 'Videos'] as const;

/**
 * All four `Gtk.SelectionMode` values, under the same nicks the attribute and the shared
 * selection module use — `browse` included, which is the mode the model-driven views have no
 * word for because they wrap a selection MODEL and this one does not.
 */
export const LIST_BOX_SELECTION_MODES = [
    { label: 'Single', value: 'single' },
    { label: 'Multiple', value: 'multiple' },
    { label: 'Browse', value: 'browse' },
    { label: 'None', value: 'none' },
];

export const listBoxMeta: StoryMeta = {
    title: 'Presentation/List Box',
    description:
        'Gtk.ListBox — one row per child you append, with GTK’s four selection modes. Ctrl toggles and ' +
        'Shift extends from the anchor the last Shift-click left behind; activate-on-single-click defaults ' +
        'to TRUE here, unlike Gtk.ListView’s single-click-activate.',
    controls: [
        {
            name: 'selectionMode',
            label: 'Selection',
            type: ControlType.SELECT,
            options: LIST_BOX_SELECTION_MODES,
            defaultValue: 'single',
        },
        { name: 'showSeparators', label: 'Separators', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'activateOnSingleClick',
            label: 'Activate on single click',
            type: ControlType.BOOLEAN,
            defaultValue: true,
        },
        {
            name: 'tabBehavior',
            label: 'Tab behaviour',
            type: ControlType.SELECT,
            options: [
                { label: 'All', value: 'all' },
                { label: 'Item', value: 'item' },
                { label: 'Cell', value: 'cell' },
            ],
            defaultValue: 'all',
        },
    ],
};
