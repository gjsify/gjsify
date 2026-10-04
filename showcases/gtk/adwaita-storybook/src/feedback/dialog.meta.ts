// Shared, renderer-agnostic metadata for the Dialog story. Imported by
// both the GTK renderer (dialog.story.ts) and the browser renderer
// (browser/feedback/dialog.web.ts) so the two expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const dialogMeta: StoryMeta = {
    title: 'Feedback/Dialog',
    description:
        'Adw.Dialog — the generic dialog: arbitrary content over a scrim, anchored as a floating card on a wide window and as a bottom sheet on a narrow one.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Preferences' },
        {
            name: 'presentation',
            label: 'Presentation',
            type: ControlType.SELECT,
            options: [
                { label: 'Auto', value: 'auto' },
                { label: 'Floating', value: 'floating' },
                { label: 'Bottom sheet', value: 'bottom-sheet' },
            ],
            defaultValue: 'auto',
        },
    ],
};
