// NativeScript port of the Drop Down story. Shares metadata with the GTK
// drop-down.story.ts and browser drop-down.web.ts (imported from the GTK showcase's
// renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Gtk } from '@gjsify/adwaita-nativescript';
import { DROP_DOWN_OPTIONS, dropDownMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class DropDownNsStory extends StoryView {
    private _dropDown: Gtk.DropDown | null = null;

    constructor() {
        super(DropDownNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return dropDownMeta;
    }

    initialize(): void {
        this._dropDown = new Gtk.DropDown();
        this._dropDown.options = DROP_DOWN_OPTIONS.map((label) => ({ value: label, label }));
        this._apply();
        this.addContent(this._dropDown);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._dropDown) return;
        this._dropDown.selected = this.args.selected as number;
        // The list opens as the platform `action()` sheet, which has no search field —
        // so `enableSearch` has no NativeScript equivalent (see the widget's own
        // fidelity note). Read it so the control stays bound to this rendering too.
        void (this.args.enableSearch as boolean);
    }
}

export const DropDownNsStories: NsStoryModule = { stories: [DropDownNsStory] };
