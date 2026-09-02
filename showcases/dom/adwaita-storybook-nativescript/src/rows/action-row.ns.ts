// NativeScript port of the Action Row story. Shares metadata with the GTK
// action-row.story.ts and browser action-row.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwActionRow, AdwClamp, AdwIcon, AdwPreferencesGroup } from '@gjsify/adwaita-nativescript';
import { goNextSymbolic } from '@gjsify/adwaita-icons/actions';
import { networkWirelessSymbolic } from '@gjsify/adwaita-icons/devices';
import { folderSymbolic } from '@gjsify/adwaita-icons/places';
import { starredSymbolic } from '@gjsify/adwaita-icons/status';
import { actionRowMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

/** GTK symbolic name (e.g. "folder-symbolic") → a real Adwaita symbolic SVG string. */
function iconSvg(gtkName: string): string {
    const base = (gtkName ?? '').replace(/-symbolic$/, '');
    switch (base) {
        case 'network-wireless':
            return networkWirelessSymbolic;
        case 'folder':
            return folderSymbolic;
        case 'starred':
            return starredSymbolic;
        default:
            return networkWirelessSymbolic;
    }
}

export class ActionRowNsStory extends StoryView {
    private _row: AdwActionRow | null = null;
    private _icon: AdwIcon | null = null;

    constructor() {
        super(ActionRowNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return actionRowMeta;
    }

    initialize(): void {
        this._row = new AdwActionRow();

        // Leading PREFIX: a REAL Adwaita symbolic icon (rasterised natively via
        // PathParser), matching Adw.ActionRow's prefix icon — not an emoji glyph.
        this._icon = new AdwIcon();
        this._icon.iconName = iconSvg(this.args.iconName as string);
        this._row.setPrefix(this._icon);

        // Trailing SUFFIX: the go-next chevron as a symbolic icon (the activatable
        // arrow), matching the browser/GTK twin.
        const chevron = new AdwIcon();
        chevron.iconName = goNextSymbolic;
        this._row.setSuffix(chevron);

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
        if (this._icon) this._icon.iconName = iconSvg(this.args.iconName as string);
    }

    private _syncRow(): void {
        if (!this._row) return;
        this._row.title = this.args.title as string;
        this._row.subtitle = this.args.subtitle as string;
        this._row.activatable = this.args.activatable as boolean;
    }
}

export const ActionRowNsStories: NsStoryModule = { stories: [ActionRowNsStory] };
