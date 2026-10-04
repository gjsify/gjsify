// Gtk.ActionBar — GTK's bottom bar of packed widgets, with `revealed` and a centre widget.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { actionBarMeta } from './action-bar.meta.js';

/** Story: a Gtk.ActionBar with both ends packed and a centre widget driven by args. */
export class ActionBarStory extends StoryWidget {
    private _bar: Gtk.ActionBar | null = null;
    private _centre: Gtk.Label | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookActionBar' }, ActionBarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ActionBarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...actionBarMeta, component: Gtk.ActionBar.$gtype };
    }

    initialize(): void {
        this._bar = new Gtk.ActionBar();

        // `pack_end` PREPENDS (gtkactionbar.c:262-277), so the button added LAST sits
        // nearest the edge.
        const save = new Gtk.Button({ icon_name: 'document-save-symbolic' });
        save.add_css_class('flat');
        this._bar.pack_end(save);
        const open = new Gtk.Button({ icon_name: 'document-open-symbolic' });
        open.add_css_class('flat');
        this._bar.pack_end(open);
        const print = new Gtk.Button({ icon_name: 'document-print-symbolic' });
        print.add_css_class('flat');
        this._bar.pack_start(print);

        this._centre = new Gtk.Label({ label: 'notes.md' });

        const column = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
        column.append(new Gtk.Label({ label: 'The bar below is Gtk.ActionBar.', css_classes: ['dimmed'] }));
        column.append(this._bar);
        this.addContent(column);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bar) return;
        this._bar.revealed = this.args.revealed as boolean;
        // `gtk_action_bar_set_center_widget` (:306-...) takes a widget or NULL, and NULL
        // clears the centre rather than replacing it with an empty label.
        this._bar.set_center_widget((this.args.center as string) === 'label' ? this._centre : null);
    }
}

GObject.type_ensure(ActionBarStory.$gtype);

export const ActionBarStories: StoryModule = { stories: [ActionBarStory] };
