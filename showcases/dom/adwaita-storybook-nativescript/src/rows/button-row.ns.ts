// NativeScript port of the Button Row story. Shares metadata with the GTK
// button-row.story.ts and browser button-row.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwButtonRow, AdwClamp, AdwPreferencesGroup } from '@gjsify/adwaita-nativescript';
import { buttonRowMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

/** The Adwaita style classes this story can toggle on the row. */
const STYLE_CLASSES = ['suggested-action', 'destructive-action'];

/** The base class string AdwButtonRow sets on itself in its constructor. */
const BASE_CLASS = 'adw-row adw-action-row adw-button-row';

/** GTK symbolic name (e.g. "list-add-symbolic") → a leading glyph (NS has no icon-theme lookup). */
function iconGlyph(gtkName: string): string {
    const base = gtkName.replace(/-symbolic$/, '');
    switch (base) {
        case 'list-add':
            return '＋';
        case 'document-save':
            return '💾';
        case 'edit-delete':
            return '🗑';
        case '':
            return '';
        default:
            return '•';
    }
}

export class ButtonRowNsStory extends StoryView {
    private _row: AdwButtonRow | null = null;

    constructor() {
        super(ButtonRowNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return buttonRowMeta;
    }

    initialize(): void {
        this._row = new AdwButtonRow();
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
    }

    private _syncRow(): void {
        if (!this._row) return;
        this._row.title = this.args.title as string;
        this._row.startIcon = iconGlyph(this.args.startIconName as string);
        this._applyStyle(this.args.style as string);
    }

    private _applyStyle(style: string): void {
        if (!this._row) return;
        const classes = [BASE_CLASS];
        if (STYLE_CLASSES.includes(style)) {
            classes.push(style);
        }
        this._row.className = classes.join(' ');
    }
}

export const ButtonRowNsStories: NsStoryModule = { stories: [ButtonRowNsStory] };
