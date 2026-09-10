// NativeScript port of the Button Row story. Shares metadata with the GTK
// button-row.story.ts and browser button-row.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

// The story's `iconName` control offers THEME NAMES, and since `icon-theme.ts` the port
// resolves one — so the local name-to-SVG map that used to sit here is gone. Seven of
// these existed across this showcase, each re-implementing the `-symbolic` strip and a
// switch over three or four names, each with its own fallback.

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { buttonRowMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

/** The Adwaita style classes this story can toggle on the row. */
const STYLE_CLASSES = ['suggested-action', 'destructive-action'];

/** The base class string Adw.ButtonRow sets on itself in its constructor. */
const BASE_CLASS = 'adw-row adw-action-row adw-button-row';

/** Adwaita accent + destructive colours (the start icon is pre-coloured, not CSS). */
const ADW_ACCENT = '#3584e4';
const ADW_DESTRUCTIVE = '#e01b24';

export class ButtonRowNsStory extends StoryView {
    private _row: Adw.ButtonRow | null = null;

    constructor() {
        super(ButtonRowNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return buttonRowMeta;
    }

    initialize(): void {
        this._row = new Adw.ButtonRow();
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
    }

    private _syncRow(): void {
        if (!this._row) return;
        this._row.title = this.args.title as string;
        this._row.startIconName = this.args.startIconName as string;
        this._applyStyle(this.args.style as string);
    }

    private _applyStyle(style: string): void {
        if (!this._row) return;
        const classes = [BASE_CLASS];
        if (STYLE_CLASSES.includes(style)) {
            classes.push(style);
        }
        this._row.className = classes.join(' ');
        // The start icon is pre-coloured (a bitmap), so recolour it to match the
        // title: destructive red for `destructive-action`, else the accent.
        this._row.startIconColor = style === 'destructive-action' ? ADW_DESTRUCTIVE : ADW_ACCENT;
    }
}

export const ButtonRowNsStories: NsStoryModule = { stories: [ButtonRowNsStory] };
