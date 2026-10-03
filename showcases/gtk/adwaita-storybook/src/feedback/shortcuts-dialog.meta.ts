// Shared, renderer-agnostic metadata for the Shortcuts Dialog story. Imported by
// both the GTK renderer (shortcuts-dialog.story.ts) and the browser renderer
// (browser/feedback/shortcuts-dialog.web.ts) so the two expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const shortcutsDialogMeta: StoryMeta = {
    title: 'Feedback/Shortcuts Dialog',
    description:
        'Adw.ShortcutsDialog — the window that lists an application’s keyboard shortcuts, one titled section at a time.',
    controls: [{ name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Keyboard Shortcuts' }],
};
