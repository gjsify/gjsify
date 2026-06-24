// Shared, renderer-agnostic metadata for the Button Content story. Imported by
// both the GTK renderer (button-content.story.ts) and the browser renderer
// (browser/buttons/button-content.web.ts) so the two expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const buttonContentMeta: StoryMeta = {
    title: 'Buttons/Button Content',
    description: 'Adw.ButtonContent — pairs a symbolic icon with a label inside a Gtk.Button.',
    controls: [
        { name: 'label', label: 'Label', type: ControlType.TEXT, defaultValue: 'Download' },
        {
            name: 'iconName',
            label: 'Icon',
            type: ControlType.SELECT,
            options: [
                { label: 'Download', value: 'folder-download-symbolic' },
                { label: 'Add', value: 'list-add-symbolic' },
                { label: 'Send', value: 'mail-send-symbolic' },
                { label: 'Star', value: 'starred-symbolic' },
            ],
            defaultValue: 'folder-download-symbolic',
        },
        { name: 'canShrink', label: 'Can shrink', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
