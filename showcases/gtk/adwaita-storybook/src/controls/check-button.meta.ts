// Shared, renderer-agnostic metadata for the Check Button story. Imported by the GTK
// renderer (check-button.story.ts) and the browser renderer
// (browser/controls/check-button.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const checkButtonMeta: StoryMeta = {
    title: 'Controls/Check Button',
    description:
        'Gtk.CheckButton — a label beside an indicator, with a third "in between" state for a selection ' +
        'that is only partly made. The browser element spells the two states checked and indeterminate, ' +
        'the words the Adwaita stylesheet selects on; the grouped, single-choice form is Adw.Radio.',
    controls: [
        { name: 'label', label: 'Label', type: ControlType.TEXT, defaultValue: 'Enable networking' },
        { name: 'checked', label: 'Checked', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'indeterminate', label: 'Indeterminate', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'disabled', label: 'Disabled', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
