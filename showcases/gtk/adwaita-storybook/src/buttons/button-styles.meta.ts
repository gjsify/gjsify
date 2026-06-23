// Shared, renderer-agnostic metadata for the Button Styles story. Imported by
// both the GTK renderer (button-styles.story.ts) and the browser renderer
// (browser/buttons/button-styles.web.ts) so the two expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const buttonStylesMeta: StoryMeta = {
    title: 'Buttons/Button Styles',
    description: 'Buttons with Adwaita style classes: .pill, .circular, .suggested-action, .destructive-action, .flat.',
    controls: [
        { name: 'label', label: 'Demo label', type: ControlType.TEXT, defaultValue: 'Click me' },
        {
            name: 'style',
            label: 'Demo style',
            type: ControlType.SELECT,
            options: [
                { label: 'Pill', value: 'pill' },
                { label: 'Circular (icon)', value: 'circular' },
                { label: 'Suggested', value: 'suggested-action' },
                { label: 'Destructive', value: 'destructive-action' },
                { label: 'Flat', value: 'flat' },
            ],
            defaultValue: 'suggested-action',
        },
    ],
};
