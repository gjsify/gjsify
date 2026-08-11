// The Overview story on GTK — the widget gallery that used to be
// `examples/gtk/adwaita-reference`. original implementation.

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import GObject from '@girs/gobject-2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import {
    OVERVIEW_ACCENT_OPTIONS,
    OVERVIEW_ADVANCED_ROWS,
    OVERVIEW_SHORTCUTS,
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
            title: 'You have unsaved changes',
            button_label: 'Save',
            revealed: this.args.revealed as boolean,
        });
        box.append(this._banner);

        const page = new Adw.PreferencesPage({ hexpand: true });

        // --- Appearance: switches and a combo. A widget demo only — the
        // storybook's OWN appearance lives in the header bar's dialog, and wiring
        // these to it would give one setting two controls that disagree.
        const appearance = new Adw.PreferencesGroup({ title: 'Appearance' });
        appearance.add(
            new Adw.SwitchRow({ title: 'Dark mode', subtitle: 'Use the dark Adwaita palette', active: false }),
        );
        appearance.add(new Adw.SwitchRow({ title: 'Notifications', subtitle: 'Show toasts for events', active: true }));
        appearance.add(
            new Adw.ComboRow({
                title: 'Accent color',
                model: Gtk.StringList.new([...OVERVIEW_ACCENT_OPTIONS]),
                selected: 0,
            }),
        );
        page.add(appearance);

        // --- Account: entries, a spin row, and a nested expander ---
        const account = new Adw.PreferencesGroup({ title: 'Account' });

        const name = new Adw.EntryRow({ title: 'Name' });
        name.set_text('Ada Lovelace');
        account.add(name);

        const email = new Adw.EntryRow({ title: 'Email' });
        email.set_text('ada@example.com');
        account.add(email);

        const devices = new Adw.SpinRow({
            title: 'Devices',
            adjustment: new Gtk.Adjustment({ value: 3, lower: 1, upper: 10, step_increment: 1, page_increment: 1 }),
        });
        // The displayed value does not always follow the adjustment through
        // property-init ordering, so it is set explicitly.
        devices.set_value(3);
        account.add(devices);

        const advanced = new Adw.ExpanderRow({ title: 'Advanced', subtitle: 'More options', expanded: true });
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
        const shortcuts = new Adw.PreferencesGroup({ title: 'Shortcuts' });
        for (const shortcut of OVERVIEW_SHORTCUTS) {
            const row = new Adw.ActionRow({ title: shortcut.title });
            row.add_suffix(new Adw.ShortcutLabel({ accelerator: shortcut.accelerator, valign: Gtk.Align.CENTER }));
            shortcuts.add(row);
        }
        page.add(shortcuts);

        // --- Actions: the two button styles side by side ---
        const actions = new Adw.PreferencesGroup({ title: 'Actions' });
        const buttons = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            homogeneous: true,
            margin_top: 6,
            margin_bottom: 6,
        });
        const save = new Gtk.Button({ label: 'Save changes' });
        save.add_css_class('suggested-action');
        buttons.append(save);
        const remove = new Gtk.Button({ label: 'Delete account' });
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
