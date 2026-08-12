// NativeScript port of the Overview story — the widget gallery that used to be
// the standalone `showcases/dom/adwaita-widgets-nativescript` app. Shares metadata
// with the GTK widgets.story.ts and browser widgets.web.ts.

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { StackLayout } from '@nativescript/core';
import {
    AdwActionRow,
    AdwBanner,
    AdwButton,
    AdwComboRow,
    AdwEntryRow,
    AdwExpanderRow,
    AdwPreferencesGroup,
    AdwPreferencesPage,
    AdwShortcutLabel,
    AdwSpinRow,
    AdwSwitchRow,
} from '@gjsify/adwaita-nativescript';
import {
    OVERVIEW_ACCENT_OPTIONS,
    OVERVIEW_ADVANCED_ROWS,
    OVERVIEW_SHORTCUTS,
    overviewWidgetsMeta,
} from '@gjsify/example-gtk-adwaita-storybook/metas';

export class OverviewWidgetsNsStory extends StoryView {
    private _banner: AdwBanner | null = null;

    constructor() {
        super(OverviewWidgetsNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return overviewWidgetsMeta;
    }

    initialize(): void {
        const host = new StackLayout();

        this._banner = new AdwBanner();
        this._banner.title = 'You have unsaved changes';
        this._banner.buttonLabel = 'Save';
        this._syncBanner();
        host.addChild(this._banner);

        const page = new AdwPreferencesPage();

        // --- Appearance: a widget demo only. The storybook's OWN appearance lives
        // in its chrome, and wiring these to it would give one setting two controls
        // that disagree.
        const appearance = new AdwPreferencesGroup();
        appearance.title = 'APPEARANCE';

        const dark = new AdwSwitchRow();
        dark.title = 'Dark mode';
        dark.subtitle = 'Use the dark Adwaita palette';
        dark.active = false;
        appearance.addRow(dark);

        const notifications = new AdwSwitchRow();
        notifications.title = 'Notifications';
        notifications.subtitle = 'Show toasts for events';
        notifications.active = true;
        appearance.addRow(notifications);

        const accent = new AdwComboRow();
        accent.title = 'Accent color';
        accent.options = OVERVIEW_ACCENT_OPTIONS.map((label) => ({ label, value: label.toLowerCase() }));
        accent.selectedIndex = 0;
        appearance.addRow(accent);

        page.addGroup(appearance);

        // --- Account ---
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
        for (const row of OVERVIEW_ADVANCED_ROWS) {
            if (row.kind === 'switch') {
                const child = new AdwSwitchRow();
                child.title = row.title;
                child.active = row.active ?? false;
                advanced.addRow(child);
            } else {
                const child = new AdwActionRow();
                child.title = row.title;
                advanced.addRow(child);
            }
        }
        advanced.expanded = true;
        account.addRow(advanced);

        page.addGroup(account);

        // --- Shortcuts: the newest widget, in context ---
        const shortcuts = new AdwPreferencesGroup();
        shortcuts.title = 'SHORTCUTS';
        for (const shortcut of OVERVIEW_SHORTCUTS) {
            const row = new AdwActionRow();
            row.title = shortcut.title;
            const label = new AdwShortcutLabel();
            label.accelerator = shortcut.accelerator;
            row.setSuffix(label);
            shortcuts.addRow(row);
        }
        page.addGroup(shortcuts);

        // --- Actions ---
        const actions = new AdwPreferencesGroup();
        actions.title = 'ACTIONS';
        const buttons = new StackLayout();
        buttons.orientation = 'horizontal';
        buttons.className = 'adw-action-buttons';

        const save = new AdwButton();
        save.text = 'Save changes';
        save.variant = 'suggested-action';
        buttons.addChild(save);

        const remove = new AdwButton();
        remove.text = 'Delete account';
        remove.variant = 'destructive-action';
        buttons.addChild(remove);

        actions.addRow(buttons);
        page.addGroup(actions);

        host.addChild(page);
        this.addContent(host);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncBanner();
    }

    /** NS has no `revealed`; `visibility` is its spelling of the same idea. */
    private _syncBanner(): void {
        if (this._banner) this._banner.visibility = (this.args.revealed as boolean) ? 'visible' : 'collapse';
    }
}

export const OverviewWidgetsNsStories: NsStoryModule = { stories: [OverviewWidgetsNsStory] };
