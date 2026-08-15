// Shared, renderer-agnostic metadata for the Drop Down story. Imported by the GTK
// renderer (drop-down.story.ts), the browser renderer
// (browser/controls/drop-down.web.ts) and the NativeScript one.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/** The one option list all three renderings drive, so a pick means the same thing everywhere. */
export const DROP_DOWN_OPTIONS = ['Automatic', 'Always', 'Never', 'When busy'] as const;

export const dropDownMeta: StoryMeta = {
    title: 'Controls/Drop Down',
    description:
        'Gtk.DropDown — pick one value from a list. The button shows the selection; the list opens in a ' +
        'popover. Adw.ComboRow is the same choice presented as a boxed-list row.',
    controls: [
        {
            name: 'selected',
            label: 'Selected',
            type: ControlType.SELECT,
            options: DROP_DOWN_OPTIONS.map((label, index) => ({ label, value: index })),
            defaultValue: 0,
        },
        { name: 'enableSearch', label: 'Search field', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
