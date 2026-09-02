// The Overview story on GTK — the widget gallery that used to be
// `examples/gtk/adwaita-reference`. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import {
    OVERVIEW_ACCENT_OPTIONS,
    OVERVIEW_ADVANCED_ROWS,
    OVERVIEW_DEVICES,
    OVERVIEW_GROUP_TITLES,
    OVERVIEW_SHORTCUTS,
    OVERVIEW_TEXT,
    overviewWidgetsMeta,
} from './widgets.meta.js';

/** Story: many widgets at once, composed the way an app composes them. */
export class OverviewWidgetsStory extends StoryWidget {
    private _banner: Adw.Banner | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookOverviewWidgets' }, OverviewWidgetsStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(OverviewWidgetsStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return overviewWidgetsMeta;
    }

    initialize(): void {
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, hexpand: true });

        this._banner = new Adw.Banner({
            title: OVERVIEW_TEXT.bannerTitle,
            button_label: OVERVIEW_TEXT.bannerButton,
            revealed: this.args.revealed as boolean,
        });
        box.append(this._banner);

        const page = new Adw.PreferencesPage({ hexpand: true });

        // --- Appearance: switches and a combo. A widget demo only — the
        // storybook's OWN appearance lives in the header bar's dialog, and wiring
        // these to it would give one setting two controls that disagree.
        const appearance = new Adw.PreferencesGroup({ title: OVERVIEW_GROUP_TITLES.appearance });
        appearance.add(
            new Adw.SwitchRow({
                title: OVERVIEW_TEXT.darkMode,
                subtitle: OVERVIEW_TEXT.darkModeSubtitle,
                active: false,
            }),
        );
        appearance.add(
            new Adw.SwitchRow({
                title: OVERVIEW_TEXT.notifications,
                subtitle: OVERVIEW_TEXT.notificationsSubtitle,
                active: true,
            }),
        );
        appearance.add(
            new Adw.ComboRow({
                title: OVERVIEW_TEXT.accentColor,
                model: Gtk.StringList.new([...OVERVIEW_ACCENT_OPTIONS]),
                selected: 0,
            }),
        );
        page.add(appearance);

        // --- Account: entries, a spin row, and a nested expander ---
        const account = new Adw.PreferencesGroup({ title: OVERVIEW_GROUP_TITLES.account });

        const name = new Adw.EntryRow({ title: OVERVIEW_TEXT.name });
        name.set_text(OVERVIEW_TEXT.nameValue);
        account.add(name);

        const email = new Adw.EntryRow({ title: OVERVIEW_TEXT.email });
        email.set_text(OVERVIEW_TEXT.emailValue);
        account.add(email);

        const devices = new Adw.SpinRow({
            title: OVERVIEW_TEXT.devices,
            adjustment: new Gtk.Adjustment({
                value: OVERVIEW_DEVICES.value,
                lower: OVERVIEW_DEVICES.lower,
                upper: OVERVIEW_DEVICES.upper,
                step_increment: OVERVIEW_DEVICES.step,
                page_increment: OVERVIEW_DEVICES.step,
            }),
        });
        // The displayed value does not always follow the adjustment through
        // property-init ordering, so it is set explicitly.
        devices.set_value(OVERVIEW_DEVICES.value);
        account.add(devices);

        const advanced = new Adw.ExpanderRow({
            title: OVERVIEW_TEXT.advanced,
            subtitle: OVERVIEW_TEXT.advancedSubtitle,
            expanded: true,
        });
        for (const row of OVERVIEW_ADVANCED_ROWS) {
            advanced.add_row(
                row.kind === 'switch'
                    ? new Adw.SwitchRow({ title: row.title, active: row.active ?? false })
                    : new Adw.ActionRow({ title: row.title }),
            );
        }
        account.add(advanced);
        page.add(account);

        // --- Shortcuts: the newest widget, in context ---
        const shortcuts = new Adw.PreferencesGroup({ title: OVERVIEW_GROUP_TITLES.shortcuts });
        for (const shortcut of OVERVIEW_SHORTCUTS) {
            const row = new Adw.ActionRow({ title: shortcut.title });
            row.add_suffix(new Adw.ShortcutLabel({ accelerator: shortcut.accelerator, valign: Gtk.Align.CENTER }));
            shortcuts.add(row);
        }
        page.add(shortcuts);

        // --- Actions: the two button styles side by side ---
        const actions = new Adw.PreferencesGroup({ title: OVERVIEW_GROUP_TITLES.actions });
        const buttons = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            homogeneous: true,
            margin_top: 6,
            margin_bottom: 6,
        });
        const save = new Gtk.Button({ label: OVERVIEW_TEXT.save });
        save.add_css_class('suggested-action');
        buttons.append(save);
        const remove = new Gtk.Button({ label: OVERVIEW_TEXT.delete });
        remove.add_css_class('destructive-action');
        buttons.append(remove);
        actions.add(buttons);
        page.add(actions);

        box.append(page);
        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        this._banner?.set_revealed(this.args.revealed as boolean);
    }
}

GObject.type_ensure(OverviewWidgetsStory.$gtype);

export const OverviewWidgetsStories: StoryModule = { stories: [OverviewWidgetsStory] };
