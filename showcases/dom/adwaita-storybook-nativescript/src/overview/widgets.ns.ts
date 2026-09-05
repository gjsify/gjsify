// NativeScript port of the Overview story — the widget gallery that used to be
// the standalone `showcases/dom/adwaita-widgets-nativescript` app. Shares metadata
// with the GTK widgets.story.ts and browser widgets.web.ts.

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { StackLayout } from '@nativescript/core';
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';
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
    private _banner: Adw.Banner | null = null;

    constructor() {
        super(OverviewWidgetsNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return overviewWidgetsMeta;
    }

    initialize(): void {
        const host = new StackLayout();

        this._banner = new Adw.Banner();
        this._banner.title = OVERVIEW_TEXT.bannerTitle;
        this._banner.buttonLabel = OVERVIEW_TEXT.bannerButton;
        this._syncBanner();
        host.addChild(this._banner);

        const page = new Adw.PreferencesPage();

        // --- Appearance: a widget demo only. The storybook's OWN appearance lives
        // in its chrome, and wiring these to it would give one setting two controls
        // that disagree.
        const appearance = new Adw.PreferencesGroup();
        appearance.title = OVERVIEW_GROUP_TITLES.appearance;

        const dark = new Adw.SwitchRow();
        dark.title = OVERVIEW_TEXT.darkMode;
        dark.subtitle = OVERVIEW_TEXT.darkModeSubtitle;
        dark.active = false;
        appearance.addRow(dark);

        const notifications = new Adw.SwitchRow();
        notifications.title = OVERVIEW_TEXT.notifications;
        notifications.subtitle = OVERVIEW_TEXT.notificationsSubtitle;
        notifications.active = true;
        appearance.addRow(notifications);

        const accent = new Adw.ComboRow();
        accent.title = OVERVIEW_TEXT.accentColor;
        accent.model = OVERVIEW_ACCENT_OPTIONS.map((label) => ({ label, value: label.toLowerCase() }));
        accent.selected = 0;
        appearance.addRow(accent);

        page.addGroup(appearance);

        // --- Account ---
        const account = new Adw.PreferencesGroup();
        account.title = OVERVIEW_GROUP_TITLES.account;

        const name = new Adw.EntryRow();
        name.title = OVERVIEW_TEXT.name;
        name.text = OVERVIEW_TEXT.nameValue;
        account.addRow(name);

        const email = new Adw.EntryRow();
        email.title = OVERVIEW_TEXT.email;
        email.text = OVERVIEW_TEXT.emailValue;
        account.addRow(email);

        const devices = new Adw.SpinRow();
        devices.title = OVERVIEW_TEXT.devices;
        // The same three numbers the GTK story hands `new Gtk.Adjustment`, now under the
        // same key on both renderers (ADR 0047).
        devices.adjustment = {
            lower: OVERVIEW_DEVICES.lower,
            upper: OVERVIEW_DEVICES.upper,
            stepIncrement: OVERVIEW_DEVICES.step,
        };
        devices.value = OVERVIEW_DEVICES.value;
        account.addRow(devices);

        const advanced = new Adw.ExpanderRow();
        advanced.title = OVERVIEW_TEXT.advanced;
        advanced.subtitle = OVERVIEW_TEXT.advancedSubtitle;
        for (const row of OVERVIEW_ADVANCED_ROWS) {
            if (row.kind === 'switch') {
                const child = new Adw.SwitchRow();
                child.title = row.title;
                child.active = row.active ?? false;
                advanced.addRow(child);
            } else {
                const child = new Adw.ActionRow();
                child.title = row.title;
                advanced.addRow(child);
            }
        }
        advanced.expanded = true;
        account.addRow(advanced);

        page.addGroup(account);

        // --- Shortcuts: the newest widget, in context ---
        const shortcuts = new Adw.PreferencesGroup();
        shortcuts.title = OVERVIEW_GROUP_TITLES.shortcuts;
        for (const shortcut of OVERVIEW_SHORTCUTS) {
            const row = new Adw.ActionRow();
            row.title = shortcut.title;
            const label = new Adw.ShortcutLabel();
            label.accelerator = shortcut.accelerator;
            row.setSuffix(label);
            shortcuts.addRow(row);
        }
        page.addGroup(shortcuts);

        // --- Actions ---
        const actions = new Adw.PreferencesGroup();
        actions.title = OVERVIEW_GROUP_TITLES.actions;
        const buttons = new StackLayout();
        buttons.orientation = 'horizontal';
        buttons.className = 'adw-action-buttons';

        const save = new Gtk.Button();
        save.text = OVERVIEW_TEXT.save;
        save.variant = 'suggested-action';
        buttons.addChild(save);

        const remove = new Gtk.Button();
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
