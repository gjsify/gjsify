// Gtk.DropDown — pick one value from a list, shown in a popover.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { DROP_DOWN_OPTIONS, dropDownMeta } from './drop-down.meta.js';

/** Story: a Gtk.DropDown over a Gtk.StringList, with the search field toggled by an arg. */
export class DropDownStory extends StoryWidget {
    private _dropDown: Gtk.DropDown | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookDropDown' }, DropDownStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(DropDownStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...dropDownMeta, component: Gtk.DropDown.$gtype };
    }

    initialize(): void {
        this._dropDown = Gtk.DropDown.new_from_strings([...DROP_DOWN_OPTIONS]);
        // Search needs to know WHICH string to match: a GtkDropDown over a
        // GtkStringList holds GtkStringObjects, and without an expression the
        // search field appears and matches nothing.
        this._dropDown.expression = Gtk.PropertyExpression.new(Gtk.StringObject.$gtype, null, 'string');
        this._dropDown.halign = Gtk.Align.CENTER;
        this._apply();
        this.addContent(this._dropDown);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._dropDown) return;
        this._dropDown.selected = this.args.selected as number;
        this._dropDown.enableSearch = this.args.enableSearch as boolean;
    }
}

GObject.type_ensure(DropDownStory.$gtype);

export const DropDownStories: StoryModule = { stories: [DropDownStory] };
