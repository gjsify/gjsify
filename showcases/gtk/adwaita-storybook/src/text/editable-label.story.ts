// Gtk.EditableLabel — a label you click and edit in place.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { editableLabelMeta } from './editable-label.meta.js';

/** Story: a Gtk.EditableLabel with its text and both of its booleans bound to args. */
export class EditableLabelStory extends StoryWidget {
    private _label: Gtk.EditableLabel | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookEditableLabel' }, EditableLabelStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(EditableLabelStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...editableLabelMeta, component: Gtk.EditableLabel.$gtype };
    }

    initialize(): void {
        this._label = new Gtk.EditableLabel({ halign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._label);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._label) return;
        // The draft lives in the entry, so the property is written only while nothing is being
        // edited — which is the order the C keeps them in (gtkeditablelabel.c:237-248).
        if (!this._label.editing) this._label.text = this.args.text as string;
        this._label.editable = this.args.editable as boolean;
        this._label.editing = this.args.editing as boolean;
    }
}

GObject.type_ensure(EditableLabelStory.$gtype);

export const EditableLabelStories: StoryModule = { stories: [EditableLabelStory] };
