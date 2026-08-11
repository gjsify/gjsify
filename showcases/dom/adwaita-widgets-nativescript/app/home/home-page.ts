// NativeScript code-behind: build the full native Adwaita demo page
// programmatically — the same content as the GTK/Libadwaita reference, so the two
// can be compared side by side. Every widget here is a REAL NativeScript view from
// @gjsify/adwaita-nativescript (no webview), styled like Libadwaita via the Adwaita
// CSS theme.

import { type NavigatedData, type Page, ActionItem, GridLayout, Label, StackLayout } from '@nativescript/core';
import {
    AdwPreferencesPage,
    AdwPreferencesGroup,
    AdwActionRow,
    AdwSwitchRow,
    AdwEntryRow,
    AdwComboRow,
    AdwSpinRow,
    AdwExpanderRow,
    AdwButton,
    AdwBanner,
    AdwAvatar,
    AdwShortcutLabel,
    AdwWindowTitle,
    NOTIFY_ACTIVE,
    type NotifyActiveEventData,
} from '@gjsify/adwaita-nativescript';

export function onNavigatingTo(args: NavigatedData): void {
    const page = args.object as Page;
    const root = page.getViewById<GridLayout>('root');
    if (!root) {
        console.log('[adwaita-spike] root GridLayout not found');
        return;
    }

    // --- ActionBar: centered window title + avatar at the end ---
    const bar = page.actionBar;
    if (bar) {
        const title = new AdwWindowTitle();
        title.title = 'Adwaita Widgets';
        bar.titleView = title;

        const avatar = new AdwAvatar();
        avatar.size = 32;
        avatar.text = 'Ada Lovelace';
        const avatarItem = new ActionItem();
        avatarItem.actionView = avatar;
        bar.actionItems.addItem(avatarItem);
    }

    // --- Banner pinned at the top (row 0) ---
    const banner = new AdwBanner();
    banner.title = 'You have unsaved changes';
    banner.buttonLabel = 'Save';
    GridLayout.setRow(banner, 0);
    root.addChild(banner);

    // --- Scrolling preferences page (row 1) ---
    const prefs = new AdwPreferencesPage();
    GridLayout.setRow(prefs, 1);
    root.addChild(prefs);

    // Group: Appearance (switch rows + combo row) ---
    const appearance = new AdwPreferencesGroup();
    appearance.title = 'APPEARANCE';

    const dark = new AdwSwitchRow();
    dark.title = 'Dark mode';
    dark.subtitle = 'Use the dark Adwaita palette';
    dark.active = false;
    dark.addEventListener(NOTIFY_ACTIVE, (e) => {
        const active = (e as NotifyActiveEventData).active;
        page.className = active ? 'adw-window ns-dark' : 'adw-window';
        console.log('[adwaita-spike] dark mode →', active);
    });
    appearance.addRow(dark);

    const notifications = new AdwSwitchRow();
    notifications.title = 'Notifications';
    notifications.subtitle = 'Show toasts for events';
    notifications.active = true;
    appearance.addRow(notifications);

    const accent = new AdwComboRow();
    accent.title = 'Accent color';
    accent.options = [
        { label: 'Blue', value: 'blue' },
        { label: 'Teal', value: 'teal' },
        { label: 'Green', value: 'green' },
        { label: 'Orange', value: 'orange' },
    ];
    accent.selectedIndex = 0;
    appearance.addRow(accent);

    prefs.addGroup(appearance);

    // Group: Account (entry rows + spin row + expander row) ---
    const account = new AdwPreferencesGroup();
    account.title = 'ACCOUNT';

    const name = new AdwEntryRow();
    name.title = 'Name';
    name.text = 'Ada Lovelace';
    account.addRow(name);

    const email = new AdwEntryRow();
    email.title = 'Email';
    email.text = 'ada@example.com';
    account.addRow(email);

    const devices = new AdwSpinRow();
    devices.title = 'Devices';
    devices.min = 1;
    devices.max = 10;
    devices.step = 1;
    devices.value = 3;
    account.addRow(devices);

    const advanced = new AdwExpanderRow();
    advanced.title = 'Advanced';
    advanced.subtitle = 'More options';
    const sync = new AdwSwitchRow();
    sync.title = 'Sync';
    sync.active = true;
    advanced.addRow(sync);
    const exportRow = new AdwActionRow();
    exportRow.title = 'Export';
    advanced.addRow(exportRow);
    advanced.expanded = true;
    account.addRow(advanced);

    prefs.addGroup(account);

    // Group: Actions (suggested + destructive buttons) ---
    const actions = new AdwPreferencesGroup();
    actions.title = 'ACTIONS';
    const buttonBox = new StackLayout();
    buttonBox.orientation = 'horizontal';
    buttonBox.className = 'adw-action-buttons';

    const save = new AdwButton();
    save.text = 'Save changes';
    save.variant = 'suggested-action';
    const remove = new AdwButton();
    remove.text = 'Delete account';
    remove.variant = 'destructive-action';
    buttonBox.addChild(save);
    buttonBox.addChild(remove);
    actions.addRow(buttonBox);

    prefs.addGroup(actions);

    // Group: Shortcuts — one row per grammar level, so the four nesting rules and
    // the keycap look are all on screen at once instead of behind a control.
    const shortcuts = new AdwPreferencesGroup();
    shortcuts.title = 'SHORTCUTS';
    for (const [title, accelerator] of [
        ['Copy', '<Control>C'],
        ['Select all', '<Shift><Control>a'],
        ['Alternatives', '<Shift>A Home'],
        ['Range', '<Alt>1...9'],
        ['In sequence', '<Control>C+<Control>X'],
        ['Together', 'Control_L&Control_R'],
        ['Unset', ''],
    ] as const) {
        const row = new AdwActionRow();
        row.title = title;
        const shortcut = new AdwShortcutLabel();
        shortcut.disabledText = 'Disabled';
        shortcut.accelerator = accelerator;
        row.setSuffix(shortcut);
        shortcuts.addRow(row);
    }
    prefs.addGroup(shortcuts);

    console.log('[adwaita-spike] full demo page built: 4 groups, 15 rows, banner, avatar, 2 buttons');
}
