// Shared, renderer-agnostic metadata for the Stack Switcher story. Imported by the
// GTK renderer (stack-switcher.story.ts) and the browser renderer
// (browser/view-switching/stack-switcher.web.ts) so the two expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/**
 * The pages both renderers build. `icon` is empty for a text-only page and
 * `attn` marks the page `needs-attention`, which is what the switcher draws a dot
 * for — both are the `rebuild_child` / `update_button` branches of the widget.
 */
// ONE LINE PER PAGE, deliberately: `check-storybook-category-order.mjs` reads the
// categories out of every `^\s*title: '…'` line in a `*.meta.ts`, so a page table
// formatted one field per line reads as a category named after its first page. The
// lines are kept under the print width so the formatter does not wrap them back.
export const STACK_SWITCHER_PAGES = [
    { name: 'inbox', title: 'Inbox', icon: 'mail-unread-symbolic', attn: false, body: 'Three unread conversations.' },
    { name: 'starred', title: 'Starred', icon: 'starred-symbolic', attn: false, body: 'Messages marked important.' },
    { name: 'archive', title: 'Archive', icon: '', attn: false, body: 'Older conversations kept for reference.' },
    { name: 'drafts', title: '', icon: 'document-edit-symbolic', attn: true, body: 'One draft needs your attention.' },
] as const;

export const stackSwitcherMeta: StoryMeta = {
    title: 'View Switching/Stack Switcher',
    description:
        'Gtk.StackSwitcher — a linked row of toggle buttons, one per page of a Gtk.Stack. A page with a title ' +
        'and no icon gets a label button; one with an icon and no title gets an icon button and puts the title on ' +
        'the switcher as a tooltip; a page with NEITHER is left out of the row entirely. `orientation` turns the ' +
        'row vertical, and `needs-attention` on a page puts a dot on its button.',
    controls: [
        {
            name: 'orientation',
            label: 'Orientation',
            type: ControlType.SELECT,
            options: [
                { label: 'Horizontal', value: 'horizontal' },
                { label: 'Vertical', value: 'vertical' },
            ],
            defaultValue: 'horizontal',
        },
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
