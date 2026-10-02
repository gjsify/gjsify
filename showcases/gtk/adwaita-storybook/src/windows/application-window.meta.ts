// Shared, renderer-agnostic metadata for the Application Window story. Imported by the GTK
// renderer (application-window.story.ts) and the browser renderer
// (browser/windows/application-window.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const applicationWindowMeta: StoryMeta = {
    title: 'Windows/Application Window',
    description:
        'Gtk.ApplicationWindow — a Gtk.Window that also handles an application menubar. The ' +
        'bar shows only when `show-menubar` is set AND the application HAS one: GTK builds it ' +
        "from the GtkApplication's menu model, and reads the item count before deciding " +
        '(gtkapplicationwindow.c:400-402). Everything else about the window is the base class.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Editor' },
        { name: 'showMenubar', label: 'Show menubar', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'hasMenubar', label: 'The application has one', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'deletable', label: 'Deletable', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
