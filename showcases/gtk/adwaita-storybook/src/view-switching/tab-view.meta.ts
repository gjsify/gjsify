// Shared, renderer-agnostic metadata for the Tab View story. Imported by both
// the GTK renderer (tab-view.story.ts) and the browser renderer
// (browser/view-switching/tab-view.web.ts) so the two expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const tabViewMeta: StoryMeta = {
    title: 'View Switching/Tab View',
    description:
        'Adw.TabView with an Adw.TabBar header — three tabbed pages; the tab bar can auto-hide when only one tab remains.',
    controls: [{ name: 'autohide', label: 'Autohide tab bar', type: ControlType.BOOLEAN, defaultValue: false }],
};
