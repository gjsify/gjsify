// Shared, renderer-agnostic metadata for the Stack Sidebar story. Imported by the
// GTK renderer (stack-sidebar.story.ts) and the browser renderer
// (browser/view-switching/stack-sidebar.web.ts) so the two expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/**
 * The pages both renderers build. Two carry a title, one carries ONLY an icon — which
 * is the page the sidebar skips and the switcher shows, the one visible difference
 * between the two widgets' visibility rules (`update_row`, gtkstacksidebar.c:186,
 * against `update_button`, gtkstackswitcher.c:200).
 */
// ONE LINE PER PAGE, deliberately: `check-storybook-category-order.mjs` reads the
// categories out of every `^\s*title: '…'` line in a `*.meta.ts`, so a page table
// formatted one field per line reads as a category named after its first page. The
// lines are kept under the print width so the formatter does not wrap them back.
export const STACK_SIDEBAR_PAGES = [
    { name: 'inbox', title: 'Inbox', icon: 'mail-unread-symbolic', attn: false, body: 'Three unread conversations.' },
    { name: 'starred', title: 'Starred', icon: 'starred-symbolic', attn: false, body: 'Messages marked important.' },
    { name: 'drafts', title: 'Drafts', icon: 'document-edit-symbolic', attn: true, body: 'One draft needs attention.' },
    {
        name: 'settings',
        title: '',
        icon: 'preferences-system-symbolic',
        attn: false,
        body: 'No row: a title is the row.',
    },
] as const;

export const stackSidebarMeta: StoryMeta = {
    title: 'View Switching/Stack Sidebar',
    description:
        "Gtk.StackSidebar — a vertical list of a Gtk.Stack's pages, the sidebar counterpart of the stack " +
        "switcher. A row is made of the page's TITLE alone: `update_row` never reads `icon-name`, so the page " +
        'with only an icon at the end of this story gets no row at all, where the switcher would show an icon ' +
        'button for it. `needs-attention` puts a dot in front of the label.',
    controls: [
        {
            name: 'transitionType',
            label: 'Transition type',
            type: ControlType.SELECT,
            options: [
                { label: 'None', value: 'none' },
                { label: 'Crossfade', value: 'crossfade' },
                { label: 'Slide left / right', value: 'slide-left-right' },
            ],
            defaultValue: 'slide-left-right',
        },
    ],
};
