// Shared, renderer-agnostic metadata for the View Switcher Sidebar story. Imported by
// both the GTK renderer (view-switcher-sidebar.story.ts) and the browser renderer
// (browser/view-switching/view-switcher-sidebar.web.ts) so the two expose identical
// controls.
//
// The pages are the story's content, so they live here: both renderers must build the
// same stack — the same sections, the same badge and the same unread dot — or the two
// panes are not comparable.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/** One page of the story's stack. */
export interface ViewSwitcherSidebarPage {
    name: string;
    title: string;
    icon: string;
    /** Section heading, and a flag only on the page that OPENS it. */
    sectionTitle?: string;
    /** `AdwViewStackPage:badge-number`. */
    badgeNumber?: number;
    /** `AdwViewStackPage:needs-attention`. */
    needsAttention?: boolean;
}

export const VIEW_SWITCHER_SIDEBAR_PAGES: readonly ViewSwitcherSidebarPage[] = [
    { name: 'inbox', title: 'Inbox', icon: 'mail-unread-symbolic', sectionTitle: 'Mail', badgeNumber: 3 },
    { name: 'starred', title: 'Starred', icon: 'starred-symbolic' },
    { name: 'drafts', title: 'Drafts', icon: 'document-edit-symbolic' },
    // One line per page, deliberately: `check-storybook-category-order` reads every line
    // that STARTS with `title:` as a story title, and a wrapped page entry puts one
    // there. `name` first keeps the key off the start of the line.
    { name: 'sent', title: 'Sent', icon: 'mail-send-symbolic', sectionTitle: 'Older', needsAttention: true },
    { name: 'archive', title: 'Archive', icon: 'folder-symbolic' },
    { name: 'trash', title: 'Trash', icon: 'user-trash-symbolic' },
];

export const viewSwitcherSidebarMeta: StoryMeta = {
    title: 'View Switching/View Switcher Sidebar',
    description:
        'Adw.ViewSwitcherSidebar — an Adw.Sidebar driven by an Adw.ViewStack, which is the one Adw switcher whose rows can be grouped into sections and carry an unread dot or a badge. `page` collapses it into a page of boxed lists.',
    controls: [{ name: 'mode', label: 'Page mode', type: ControlType.BOOLEAN, defaultValue: false }],
};
