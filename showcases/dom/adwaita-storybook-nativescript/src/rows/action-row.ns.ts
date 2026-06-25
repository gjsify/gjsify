// NativeScript port of the Action Row story. Shares metadata with the GTK
// action-row.story.ts and browser action-row.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwActionRow, AdwButton, AdwClamp, AdwPreferencesGroup } from '@gjsify/adwaita-nativescript';
import { Label, StackLayout } from '@nativescript/core';
import { actionRowMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

/** GTK symbolic name (e.g. "folder-symbolic") → a leading glyph (NS has no icon-theme lookup). */
function iconGlyph(gtkName: string): string {
    const base = gtkName.replace(/-symbolic$/, '');
    switch (base) {
        case 'network-wireless':
            return '📶';
        case 'folder':
            return '📁';
        case 'starred':
            return '⭐';
        default:
            return '•';
    }
}

export class ActionRowNsStory extends StoryView {
    private _row: AdwActionRow | null = null;
    private _icon: Label | null = null;

    constructor() {
        super(ActionRowNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return actionRowMeta;
    }

    initialize(): void {
        this._row = new AdwActionRow();

        // AdwActionRow (NS) exposes only a single suffix slot (no prefix). Pack the
        // leading glyph + the trailing go-next button into one horizontal suffix
        // stack — the closest the widget allows to the browser twin's prefix-icon +
        // suffix-button pair.
        const suffix = new StackLayout();
        suffix.orientation = 'horizontal';

        this._icon = new Label();
        this._icon.text = iconGlyph(this.args.iconName as string);
        suffix.addChild(this._icon);

        const button = new AdwButton();
        button.variant = 'flat';
        button.text = '›';
        suffix.addChild(button);

        this._row.setSuffix(suffix);
        this._syncRow();

        const group = new AdwPreferencesGroup();
        group.addRow(this._row);

        const clamp = new AdwClamp();
        clamp.maximumSize = 400;
        clamp.setChild(group);

        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncRow();
        if (this._icon) this._icon.text = iconGlyph(this.args.iconName as string);
    }

    private _syncRow(): void {
        if (!this._row) return;
        this._row.title = this.args.title as string;
        this._row.subtitle = this.args.subtitle as string;
        // `activatable` has no NS equivalent on AdwActionRow (no row-press chrome in
        // the CSS subset); the arg stays bound but drives no visible change.
        void (this.args.activatable as boolean);
    }
}

export const ActionRowNsStories: NsStoryModule = { stories: [ActionRowNsStory] };
