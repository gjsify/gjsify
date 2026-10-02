// Shared, renderer-agnostic metadata for the Tab Overview story. Imported by both
// the GTK renderer (tab-overview.story.ts) and the browser renderer
// (browser/view-switching/tab-overview.web.ts) so the two expose identical controls.
//
// The controls are the overview's own booleans, because everything else about it is
// driven by the tab view underneath: opening it, whether search is available, whether
// the new-tab button is there and whether the thumbnails run inverted.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const tabOverviewMeta: StoryMeta = {
    title: 'View Switching/Tab Overview',
    description:
        'Adw.TabOverview — a grid of tab thumbnails over an Adw.TabView; open it to see every page at once, search them and close or unpin them.',
    controls: [
        { name: 'open', label: 'Open', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'enableSearch', label: 'Enable search', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'enableNewTab', label: 'Enable new tab', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'inverted', label: 'Inverted', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
