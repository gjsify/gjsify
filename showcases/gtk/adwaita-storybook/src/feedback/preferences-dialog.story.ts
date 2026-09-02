// Adw.PreferencesDialog — a multi-page preferences window built from pages,
// groups and rows. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { preferencesDialogMeta } from './preferences-dialog.meta.js';

/** Story: Adw.PreferencesDialog presented from a button, with one page of rows. */
export class PreferencesDialogStory extends StoryWidget {
    private _button: Gtk.Button | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookPreferencesDialog' }, PreferencesDialogStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(PreferencesDialogStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...preferencesDialogMeta, component: Adw.PreferencesDialog.$gtype };
    }

    initialize(): void {
        this._button = new Gtk.Button({
            label: 'Show dialog',
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        this._button.add_css_class('pill');
        this._button.add_css_class('suggested-action');
        this._button.connect('clicked', () => this._present());

        this.addContent(this._button);
    }

    private _present(): void {
        const dialog = new Adw.PreferencesDialog();

        const page = new Adw.PreferencesPage({
            title: this.args.pageTitle as string,
            iconName: 'preferences-system-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: this.args.groupTitle as string,
            description: 'Control how the application looks and behaves.',
        });

        group.add(
            new Adw.SwitchRow({
                title: 'Dark style',
                subtitle: 'Use a dark colour scheme',
                active: true,
            }),
        );
        group.add(
            new Adw.ComboRow({
                title: 'Accent colour',
                model: new Gtk.StringList({ strings: ['Blue', 'Teal', 'Green', 'Orange', 'Purple'] }),
                selected: 0,
            }),
        );
        group.add(
            new Adw.SpinRow({
                title: 'Font size',
                adjustment: new Gtk.Adjustment({
                    lower: 8,
                    upper: 24,
                    value: 12,
                    stepIncrement: 1,
                    pageIncrement: 4,
                }),
            }),
        );

        page.add(group);
        dialog.add(page);

        dialog.present(this);
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog is rebuilt from the latest args each time it is presented.
    }
}

GObject.type_ensure(PreferencesDialogStory.$gtype);

export const PreferencesDialogStories: StoryModule = { stories: [PreferencesDialogStory] };
