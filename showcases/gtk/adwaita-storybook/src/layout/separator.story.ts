// Gtk.Separator — the rule between two groups, and the .spacer gap.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { separatorMeta } from './separator.meta.js';

/** Story: a Gtk.Separator between two labels, in the box direction that makes it visible. */
export class SeparatorStory extends StoryWidget {
    private _box: Gtk.Box | null = null;
    private _separator: Gtk.Separator | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookSeparator' }, SeparatorStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(SeparatorStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...separatorMeta, component: Gtk.Separator.$gtype };
    }

    initialize(): void {
        this._separator = new Gtk.Separator();
        this._box = new Gtk.Box({ spacing: 12, halign: Gtk.Align.CENTER });
        this._box.append(new Gtk.Label({ label: 'Above' }));
        this._box.append(this._separator);
        this._box.append(new Gtk.Label({ label: 'Below' }));
        this._apply();
        this.addContent(this._box);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._box || !this._separator) return;
        const vertical = this.args.orientation === 'vertical';
        this._separator.orientation = vertical ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL;
        // A rule runs ACROSS its box, so the box runs the other way.
        this._box.orientation = vertical ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL;
        if (this.args.spacer as boolean) this._separator.add_css_class('spacer');
        else this._separator.remove_css_class('spacer');
    }
}

GObject.type_ensure(SeparatorStory.$gtype);

export const SeparatorStories: StoryModule = { stories: [SeparatorStory] };
