// Shared, renderer-agnostic metadata for the Application Window story. Imported by
// both the GTK renderer (application-window.story.ts) and the browser renderer
// (browser/layout/application-window.web.ts) so the two expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const applicationWindowMeta: StoryMeta = {
    title: 'Layout/Application Window',
    description:
        'Adw.ApplicationWindow — an Adw.Window that belongs to a GtkApplication, plus that application’s menubar.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Text Editor' },
        { name: 'subtitle', label: 'Subtitle', type: ControlType.TEXT, defaultValue: 'notes.md' },
        { name: 'showMenubar', label: 'Show menubar', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
