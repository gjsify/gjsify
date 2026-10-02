// Shared, renderer-agnostic metadata for the Popover Menu Bar story. Imported by the GTK
// renderer (popover-menu-bar.story.ts) and the browser renderer
// (browser/navigation/popover-menu-bar.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/**
 * A menu bar's model: SUBMENUS ONLY at the top level. `GtkPopoverMenuBar` builds one item
 * per toplevel submenu link and warns "Don't know how to handle this item" for anything
 * else (gtkpopovermenubar.c:422-468) — which is why there is no bare item here.
 */
export const POPOVER_MENU_BAR_ITEMS = [
    {
        label: 'File',
        submenu: [
            { label: 'New Window', accel: '<Control>N' },
            { label: 'New Tab', accel: '<Control><Shift>N' },
            { label: 'Open…', accel: '<Control>O' },
        ],
    },
    {
        label: 'Edit',
        submenu: [
            { label: 'Undo', accel: '<Control>Z' },
            { label: 'Redo', accel: '<Control>Y' },
        ],
    },
    { label: 'View', submenu: [{ label: 'Zoom In', accel: '<Control>plus' }, { label: 'Zoom Out' }] },
    { label: 'Help', submenu: [{ label: 'Keyboard Shortcuts' }, { label: 'About' }] },
] as const;

export const popoverMenuBarMeta: StoryMeta = {
    title: 'Navigation/Popover Menu Bar',
    description:
        'Gtk.PopoverMenuBar — a horizontal bar of items that pop up menus when clicked. Clicking an ' +
        'item OPENS its menu; hovering only SELECTS, and the item lights up (.active) exactly ' +
        'while its menu is up. Left and Right walk the bar and wrap.',
    controls: [
        {
            name: 'position',
            label: 'Menu position',
            type: ControlType.SELECT,
            options: [
                { label: 'Below', value: 'bottom' },
                { label: 'Above', value: 'top' },
            ],
            defaultValue: 'bottom',
        },
        { name: 'showLast', label: 'Include Help', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
