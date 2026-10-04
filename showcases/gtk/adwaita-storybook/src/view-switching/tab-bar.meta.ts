// Shared, renderer-agnostic metadata for the Tab Bar story. Imported by both the GTK
// renderer (tab-bar.story.ts) and the browser renderer
// (browser/view-switching/tab-bar.web.ts) so the two expose identical controls.
//
// The controls are the bar's own five: the three booleans it carries and the two action
// widgets, which are the only parts of `AdwTabBar` a story can show on its own — everything
// else is read from the tab view underneath it.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const tabBarMeta: StoryMeta = {
    title: 'View Switching/Tab Bar',
    description:
        'Adw.TabBar — the tab bar as a widget of its own, bound to an Adw.TabView through its `view`: one chip per page, an action widget on either side, and a strip that can autohide or expand its chips.',
    controls: [
        { name: 'autohide', label: 'Autohide', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'expandTabs', label: 'Expand tabs', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'inverted', label: 'Inverted', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'startAction', label: 'Start action', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'endAction', label: 'End action', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
