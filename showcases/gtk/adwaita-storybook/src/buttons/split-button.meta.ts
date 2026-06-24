// Shared, renderer-agnostic metadata for the Split Button stories. Imported by
// both the GTK renderer (split-button.story.ts) and the browser renderer
// (browser/buttons/split-button.web.ts) so the two expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const splitButtonMeta: StoryMeta = {
    title: 'Buttons/Split Button',
    description: 'Adw.SplitButton — a primary action button paired with a dropdown menu of related actions.',
    controls: [
        { name: 'label', label: 'Label', type: ControlType.TEXT, defaultValue: 'Save' },
        {
            name: 'iconName',
            label: 'Icon',
            type: ControlType.SELECT,
            options: [
                { label: 'None', value: '' },
                { label: 'Save', value: 'document-save-symbolic' },
                { label: 'Send', value: 'mail-send-symbolic' },
                { label: 'Add', value: 'list-add-symbolic' },
            ],
            defaultValue: 'document-save-symbolic',
        },
    ],
};

export const splitButtonFlatMeta: StoryMeta = {
    title: 'Buttons/Split Button Flat',
    description: 'Adw.SplitButton with the .flat style class, as used inside header bars and toolbars.',
    controls: [
        { name: 'label', label: 'Label', type: ControlType.TEXT, defaultValue: 'Reply' },
        {
            name: 'iconName',
            label: 'Icon',
            type: ControlType.SELECT,
            options: [
                { label: 'None', value: '' },
                { label: 'Reply', value: 'mail-reply-sender-symbolic' },
                { label: 'Edit', value: 'document-edit-symbolic' },
                { label: 'Open', value: 'document-open-symbolic' },
            ],
            defaultValue: 'mail-reply-sender-symbolic',
        },
    ],
};
