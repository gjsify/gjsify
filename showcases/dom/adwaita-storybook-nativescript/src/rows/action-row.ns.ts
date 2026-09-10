// NativeScript port of the Action Row story. Shares metadata with the GTK
// action-row.story.ts and browser action-row.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

// The story's `iconName` control offers THEME NAMES, and since `icon-theme.ts` the port
// resolves one — so the local name-to-SVG map that used to sit here is gone. Seven of
// these existed across this showcase, each re-implementing the `-symbolic` strip and a
// switch over three or four names, each with its own fallback.

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';
import { actionRowMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class ActionRowNsStory extends StoryView {
    private _row: Adw.ActionRow | null = null;
    private _icon: Gtk.Image | null = null;

    constructor() {
        super(ActionRowNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return actionRowMeta;
    }

    initialize(): void {
        this._row = new Adw.ActionRow();

        // Leading PREFIX: a REAL Adwaita symbolic icon (rasterised natively via
        // PathParser), matching Adw.ActionRow's prefix icon — not an emoji glyph.
        this._icon = new Gtk.Image();
        this._icon.iconName = this.args.iconName as string;
        this._row.add_prefix(this._icon);

        // Trailing SUFFIX: the go-next chevron as a symbolic icon (the activatable
        // arrow), matching the browser/GTK twin.
        const chevron = new Gtk.Image();
        chevron.iconName = 'go-next-symbolic';
        this._row.add_suffix(chevron);

        this._syncRow();

        const group = new Adw.PreferencesGroup();
        group.add(this._row);

        const clamp = new Adw.Clamp();
        clamp.maximumSize = 400;
        clamp.set_child(group);

        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncRow();
        if (this._icon) this._icon.iconName = this.args.iconName as string;
    }

    private _syncRow(): void {
        if (!this._row) return;
        this._row.title = this.args.title as string;
        this._row.subtitle = this.args.subtitle as string;
        this._row.activatable = this.args.activatable as boolean;
    }
}

export const ActionRowNsStories: NsStoryModule = { stories: [ActionRowNsStory] };
