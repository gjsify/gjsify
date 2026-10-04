// Shared, renderer-agnostic metadata for the Notebook story. Imported by the GTK
// renderer (notebook.story.ts) and the browser renderer
// (browser/view-switching/notebook.web.ts) so the two expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/**
 * The pages both renderers build. The third carries NO `tab-label` on purpose — that is
 * the page `gtk_notebook_update_labels` numbers "Page 3" (gtknotebook.c:4353-4373), the
 * fallback a page gets rather than no tab at all.
 */
export const NOTEBOOK_PAGES = [
    { name: 'overview', label: 'Overview', body: 'A notebook brings its own tab strip.' },
    { name: 'activity', label: 'Activity', body: 'tab-pos says which edge the strip is on.' },
    { name: 'notes', label: '', body: 'No tab-label: the tab reads "Page 3".' },
] as const;

export const notebookMeta: StoryMeta = {
    title: 'View Switching/Notebook',
    description:
        'Gtk.Notebook — the older page container, a stack that brings its own tab bar. `tab-pos` ' +
        'picks the edge (top, bottom, left, right), `show-tabs` takes the strip away, `show-border` ' +
        'is the bevel around the pages — a CSS class in C — and `page` is the current page by INDEX ' +
        'rather than by name. A GtkNotebookPage is a GObject rather than a widget, so its tab-label ' +
        'and friends live on the page itself, and a page without one gets the number "Page N" as ' +
        'its tab text. `enable-popup` puts the pages in a right-click menu.',
    controls: [
        {
            name: 'tabPos',
            label: 'Tab position',
            type: ControlType.SELECT,
            options: [
                { label: 'Top', value: 'top' },
                { label: 'Bottom', value: 'bottom' },
                { label: 'Left', value: 'left' },
                { label: 'Right', value: 'right' },
            ],
            defaultValue: 'top',
        },
        { name: 'showTabs', label: 'Show tabs', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'showBorder', label: 'Show border', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'enablePopup', label: 'Enable popup (right-click)', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
