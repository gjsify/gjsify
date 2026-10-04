// Shared, renderer-agnostic metadata for the Password Entry story. Imported by the GTK
// renderer (password-entry.story.ts) and the browser renderer
// (browser/controls/password-entry.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const passwordEntryMeta: StoryMeta = {
    title: 'Controls/Password Entry',
    description:
        'Gtk.PasswordEntry — a field for a secret: masked, no copy, a Caps Lock warning while it has focus, ' +
        'and show-peek-icon for a button that reveals it for one look. Adw.PasswordEntryRow is the ' +
        'boxed-list row built on it. Press the peek button, or Caps Lock on the keyboard, to see both states.',
    controls: [
        { name: 'showPeekIcon', label: 'Show peek icon', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'placeholderText', label: 'Placeholder', type: ControlType.TEXT, defaultValue: 'Password' },
        { name: 'disabled', label: 'Disabled', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
