// Shared, renderer-agnostic metadata for the Combo Row story.
// The drop-down model is fixed; both renderers use the same option strings.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const COMBO_ROW_OPTIONS = ['Blue', 'Teal', 'Green', 'Orange', 'Purple'] as const;

export const comboRowMeta: StoryMeta = {
    title: 'Boxed Lists/Combo Row',
    description: 'Adw.ComboRow — a preferences row with an inline drop-down backed by a Gtk.StringList.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Accent colour' },
        {
            name: 'subtitle',
            label: 'Subtitle',
            type: ControlType.TEXT,
            defaultValue: 'Used to highlight selected items',
        },
        {
            name: 'selected',
            label: 'Selected',
            type: ControlType.NUMBER,
            min: 0,
            max: 4,
            step: 1,
            defaultValue: 1,
        },
    ],
};
