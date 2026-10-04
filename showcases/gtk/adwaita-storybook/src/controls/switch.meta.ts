// Shared, renderer-agnostic metadata for the Switch story. Imported by the GTK renderer
// (switch.story.ts) and the browser renderer (browser/controls/switch.web.ts), so both
// expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const switchMeta: StoryMeta = {
    title: 'Controls/Switch',
    description:
        'Gtk.Switch — a light switch with two states that are NOT the same thing: active is where the ' +
        'user put it, state is what the switched thing currently is, which is how a change that takes a ' +
        'while looks like a pending one. Adw.SwitchRow is the same control with a title beside it.',
    controls: [
        { name: 'active', label: 'Active', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'state', label: 'State (the backend)', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'disabled', label: 'Disabled', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
