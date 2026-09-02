// NativeScript port of the Overview story — the widget gallery that used to be
// the standalone `showcases/dom/adwaita-widgets-nativescript` app. Shares metadata
// with the GTK widgets.story.ts and browser widgets.web.ts.

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { StackLayout } from '@nativescript/core';
import {
    AdwActionRow,
    AdwBanner,
    GtkButton,
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
    OVERVIEW_DEVICES,
    OVERVIEW_GROUP_TITLES,
    OVERVIEW_SHORTCUTS,
    OVERVIEW_TEXT,
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
        this._banner.title = OVERVIEW_TEXT.bannerTitle;
        this._banner.buttonLabel = OVERVIEW_TEXT.bannerButton;
        this._syncBanner();
        host.addChild(this._banner);

        const page = new AdwPreferencesPage();

        // --- Appearance: a widget demo only. The storybook's OWN appearance lives
        // in its chrome, and wiring these to it would give one setting two controls
        // that disagree.
        const appearance = new AdwPreferencesGroup();
        appearance.title = OVERVIEW_GROUP_TITLES.appearance;

        const dark = new AdwSwitchRow();
        dark.title = OVERVIEW_TEXT.darkMode;
        dark.subtitle = OVERVIEW_TEXT.darkModeSubtitle;
        dark.active = false;
        appearance.addRow(dark);

        const notifications = new AdwSwitchRow();
        notifications.title = OVERVIEW_TEXT.notifications;
        notifications.subtitle = OVERVIEW_TEXT.notificationsSubtitle;
        notifications.active = true;
        appearance.addRow(notifications);

        const accent = new AdwComboRow();
        accent.title = OVERVIEW_TEXT.accentColor;
        accent.options = OVERVIEW_ACCENT_OPTIONS.map((label) => ({ label, value: label.toLowerCase() }));
        accent.selected = 0;
        appearance.addRow(accent);

        page.addGroup(appearance);

        // --- Account ---
        const account = new AdwPreferencesGroup();
        account.title = OVERVIEW_GROUP_TITLES.account;

        const name = new AdwEntryRow();
        name.title = OVERVIEW_TEXT.name;
        name.text = OVERVIEW_TEXT.nameValue;
        account.addRow(name);

        const email = new AdwEntryRow();
        email.title = OVERVIEW_TEXT.email;
        email.text = OVERVIEW_TEXT.emailValue;
        account.addRow(email);

        const devices = new AdwSpinRow();
        devices.title = OVERVIEW_TEXT.devices;
        devices.min = OVERVIEW_DEVICES.lower;
        devices.max = OVERVIEW_DEVICES.upper;
        devices.step = OVERVIEW_DEVICES.step;
        devices.value = OVERVIEW_DEVICES.value;
        account.addRow(devices);

        const advanced = new AdwExpanderRow();
        advanced.title = OVERVIEW_TEXT.advanced;
        advanced.subtitle = OVERVIEW_TEXT.advancedSubtitle;
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
        shortcuts.title = OVERVIEW_GROUP_TITLES.shortcuts;
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
        actions.title = OVERVIEW_GROUP_TITLES.actions;
        const buttons = new StackLayout();
        buttons.orientation = 'horizontal';
        buttons.className = 'adw-action-buttons';

        const save = new GtkButton();
        save.text = OVERVIEW_TEXT.save;
        save.variant = 'suggested-action';
        buttons.addChild(save);

        const remove = new GtkButton();
        remove.text = OVERVIEW_TEXT.delete;
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
