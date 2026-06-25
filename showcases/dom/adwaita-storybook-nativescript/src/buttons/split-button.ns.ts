// NativeScript port of the Split Button stories. Shares metadata with the GTK
// split-button.story.ts and browser split-button.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel). Two story classes (default +
// flat), mirroring both twins.
//
// NS AdwSplitButton has a text action label + a `menu` (string[]) opened as a
// native action() sheet on the arrow tap. It has no `iconName`; the native/browser
// twins show only the icon when one is set, so here the icon maps to a glyph used
// as the action label (the closest the NS text-button shape allows).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwSplitButton } from '@gjsify/adwaita-nativescript';
import { splitButtonFlatMeta, splitButtonMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// The shared dropdown menu — the NS twin of buildMenu() in the GTK story / the
// MENU model in the browser story. NS AdwSplitButton.menu is a plain label list.
const MENU = ['Save as…', 'Export', 'Print'];

// GTK symbolic icon name → NS glyph (no icon-theme lookup in the NS CSS subset).
const ICON_GLYPHS: Record<string, string> = {
    'document-save-symbolic': '\u{1F4BE}', // 💾
    'mail-send-symbolic': '\u{2709}', // ✉
    'list-add-symbolic': '\u{2795}', // ➕
    'mail-reply-sender-symbolic': '\u{21A9}', // ↩
    'document-edit-symbolic': '\u{270F}', // ✏
    'document-open-symbolic': '\u{1F4C2}', // 📂
};

function iconGlyph(symbolic: string): string {
    return ICON_GLYPHS[symbolic] ?? '';
}

abstract class SplitButtonNsStoryBase extends StoryView {
    protected _widget: AdwSplitButton | null = null;
    protected abstract get flat(): boolean;

    initialize(): void {
        this._widget = new AdwSplitButton();
        this._widget.menu = MENU;
        if (this.flat) {
            this._widget.className = 'adw-split-button flat';
        }
        this._syncWidget();
        this.addContent(this._widget);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncWidget();
    }

    private _syncWidget(): void {
        if (!this._widget) return;
        const glyph = iconGlyph(this.args.iconName as string);
        // Mirror the twins: with an icon set, show only the icon; otherwise the
        // label drives the action half.
        this._widget.label = glyph || (this.args.label as string);
    }
}

/** Story: AdwSplitButton with a primary action and a dropdown menu. */
export class SplitButtonNsStory extends SplitButtonNsStoryBase {
    protected get flat(): boolean {
        return false;
    }

    constructor() {
        super(SplitButtonNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return splitButtonMeta;
    }
}

/** Story: a flat-styled AdwSplitButton, suited to header bars and toolbars. */
export class SplitButtonFlatNsStory extends SplitButtonNsStoryBase {
    protected get flat(): boolean {
        return true;
    }

    constructor() {
        super(SplitButtonFlatNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return splitButtonFlatMeta;
    }
}

export const SplitButtonNsStories: NsStoryModule = { stories: [SplitButtonNsStory, SplitButtonFlatNsStory] };
