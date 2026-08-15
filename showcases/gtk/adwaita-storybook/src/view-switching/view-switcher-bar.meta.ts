// Shared, renderer-agnostic metadata for the View Switcher Bar story. Imported by the
// GTK renderer (view-switcher-bar.story.ts), the browser renderer
// (browser/view-switching/view-switcher-bar.web.ts) and the NativeScript one.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/** The three pages every rendering puts in its stack, so the bar has the same buttons. */
export const VIEW_SWITCHER_BAR_PAGES: ReadonlyArray<{ name: string; title: string; icon: string }> = [
    { name: 'inbox', title: 'Inbox', icon: 'mail-unread-symbolic' },
    { name: 'starred', title: 'Starred', icon: 'starred-symbolic' },
    { name: 'archive', title: 'Archive', icon: 'folder-symbolic' },
];

export const viewSwitcherBarMeta: StoryMeta = {
    title: 'View Switching/View Switcher Bar',
    description:
        'Adw.ViewSwitcherBar — the narrow-window switcher, pinned to the bottom of a toolbar view. `reveal` ' +
        'is a REQUEST, not a state: a stack with fewer than two pages stays collapsed however loudly it is asked.',
    controls: [{ name: 'reveal', label: 'Reveal', type: ControlType.BOOLEAN, defaultValue: true }],
};
