// Shared, renderer-agnostic metadata for the Popover Menu story. Imported by the GTK
// renderer (popover-menu.story.ts) and the browser renderer
// (browser/layout/popover-menu.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/**
 * The menu both renderings build: a section with a heading, a plain item and a submenu, so
 * the page stack and the decoration are both on show. Written as the PORTABLE model
 * (ADR 0042) — the JSON `<gtk-popover-menu menu-model>` takes and `Gio.Menu` is built from
 * on the GTK side.
 */
export const POPOVER_MENU_ITEMS = [
    { label: 'New Window', accel: '<Control>N' },
    { section: [{ label: 'Cut' }, { label: 'Copy' }, { label: 'Paste' }], label: 'Edit' },
    {
        label: 'Open With',
        submenu: [{ label: 'Text Editor' }, { label: 'Web Browser' }, { label: 'Terminal' }],
    },
] as const;

export const popoverMenuMeta: StoryMeta = {
    title: 'Layout/Popover Menu',
    description:
        'Gtk.PopoverMenu — a Gtk.Popover whose contents are a menu model instead of a child widget. ' +
        'A submenu swaps the page of the ONE surface rather than opening a second popup beside it, ' +
        'which is why the open page is a named one (`visible-submenu`).',
    controls: [
        { name: 'menuTitle', label: 'Heading', type: ControlType.TEXT, defaultValue: 'Document' },
        {
            name: 'position',
            label: 'Position',
            type: ControlType.SELECT,
            options: [
                { label: 'Bottom', value: 'bottom' },
                { label: 'Top', value: 'top' },
                { label: 'Start', value: 'start' },
                { label: 'End', value: 'end' },
            ],
            defaultValue: 'bottom',
        },
        {
            name: 'align',
            label: 'Align',
            type: ControlType.SELECT,
            options: [
                { label: 'Start', value: 'start' },
                { label: 'End', value: 'end' },
            ],
            defaultValue: 'start',
        },
        { name: 'autohide', label: 'Dismiss on outside click', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
