// Shared, renderer-agnostic metadata for the Menu Button story. Imported by the GTK
// renderer (menu-button.story.ts), the browser renderer
// (browser/buttons/menu-button.web.ts) and the NativeScript one.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/** The menu all three renderings build, so the popover holds the same items everywhere. */
export const MENU_BUTTON_ITEMS = ['Save as…', 'Export', 'Print'] as const;

export const menuButtonMeta: StoryMeta = {
    title: 'Buttons/Menu Button',
    description:
        'Gtk.MenuButton — a button whose only action is to open a menu. Where a Split Button has a primary ' +
        'action beside its arrow, this one has none: every choice lives in the popover.',
    controls: [
        {
            name: 'iconName',
            label: 'Icon',
            type: ControlType.SELECT,
            options: [
                { label: 'Hamburger', value: 'open-menu-symbolic' },
                { label: 'More', value: 'view-more-symbolic' },
                { label: 'Open', value: 'document-open-symbolic' },
            ],
            defaultValue: 'open-menu-symbolic',
        },
        { name: 'menuTitle', label: 'Menu title', type: ControlType.TEXT, defaultValue: 'Document' },
    ],
};
