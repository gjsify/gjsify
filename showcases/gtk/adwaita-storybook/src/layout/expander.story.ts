// Gtk.Expander — the disclosure, with the label's mnemonic and the toplevel-resize flag.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { expanderMeta } from './expander.meta.js';

/** Story: a Gtk.Expander over a small box of rows. */
export class ExpanderStory extends StoryWidget {
    private _expander: Gtk.Expander | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookExpander' }, ExpanderStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ExpanderStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...expanderMeta, component: Gtk.Expander.$gtype };
    }

    initialize(): void {
        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });
        for (const line of ['Notifications', 'Sound', 'Network']) {
            content.append(new Gtk.Label({ label: line }));
        }

        this._expander = new Gtk.Expander();
        this._expander.set_child(content);
        this._apply();
        this.addContent(this._expander);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._expander) return;
        // `set_label` builds a real GtkLabel out of the string with `use_underline` and
        // `use_markup` forwarded to it (gtkexpander.c:974-979), so the two flags are set
        // BEFORE the text — the order the C's own docs give.
        this._expander.use_underline = this.args.useUnderline as boolean;
        this._expander.label = String(this.args.label);
        this._expander.resize_toplevel = this.args.resizeToplevel as boolean;
        this._expander.expanded = this.args.expanded as boolean;
    }
}

GObject.type_ensure(ExpanderStory.$gtype);

export const ExpanderStories: StoryModule = { stories: [ExpanderStory] };
