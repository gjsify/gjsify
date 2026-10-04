// Shared, renderer-agnostic metadata for the Toggle Button story. Imported by the GTK
// renderer (toggle-button.story.ts) and the browser renderer
// (browser/buttons/toggle-button.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const toggleButtonMeta: StoryMeta = {
    title: 'Buttons/Toggle Button',
    description:
        'Gtk.ToggleButton — a button that stays pressed. It is a Gtk.Button with one more property, active, ' +
        'so every button style class applies; Adw.ToggleGroup is the linked, single-choice form of it.',
    controls: [
        { name: 'label', label: 'Label', type: ControlType.TEXT, defaultValue: 'Mute' },
        { name: 'active', label: 'Active', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'flat', label: 'Flat', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
