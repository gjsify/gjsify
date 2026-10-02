// Shared, renderer-agnostic metadata for the Popover Bin story. Imported by the GTK renderer
// (popover-bin.story.ts) and the browser renderer (browser/layout/popover-bin.web.ts), so
// both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/** The menu a bin builds its popover from — the portable model of ADR 0042. */
export const POPOVER_BIN_ITEMS = [
    { label: 'Cut' },
    { label: 'Copy' },
    { label: 'Paste' },
    { label: 'Delete', accel: '<Shift>Delete' },
] as const;

export const popoverBinMeta: StoryMeta = {
    title: 'Layout/Popover Bin',
    description:
        'Gtk.PopoverBin — GTK 4.22’s one-child container with a popover, for the place where "any ' +
        'part of this window can offer a menu" is the answer. `menu-model` builds the popover for ' +
        'you, and `handle-input` is what turns a right click or a long press into a popup — a ' +
        'plain click still reaches the child.',
    // ONE control, because one is all `GtkPopoverBin` has to switch: whether the container
    // claims a gesture. A "which child" control would be inert on both renderings — a bin
    // holds exactly one child and both stories build the same one — and
    // `check-storybook-control-parity.mjs` fails a control that moves and does nothing.
    controls: [
        { name: 'handleInput', label: 'Right click / long press opens', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
