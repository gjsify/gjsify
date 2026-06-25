// NativeScript port of the Button Content story. Shares metadata with the GTK
// button-content.story.ts and browser button-content.web.ts (imported from the
// GTK showcase's renderer-agnostic *.meta.ts barrel).
//
// The native/browser twins place an AdwButtonContent (icon + label) inside a
// suggested-action pill button. NS AdwButton extends a text-only Button and
// cannot host a child content widget, so — like the browser twin, which uses a
// plain element carrying the `adw-button suggested-action pill` classes — the
// content is wrapped in a StackLayout styled with those same classes.

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwButtonContent } from '@gjsify/adwaita-nativescript';
import { StackLayout } from '@nativescript/core';
import { buttonContentMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// GTK symbolic name (e.g. "folder-download-symbolic") → NS glyph. The NS CSS
// subset has no icon-theme lookup, so AdwButtonContent renders `iconName` as a
// glyph Label; map each symbolic option to its closest emoji glyph.
const ICON_GLYPHS: Record<string, string> = {
    'folder-download-symbolic': '\u{2B07}', // ⬇
    'list-add-symbolic': '\u{2795}', // ➕
    'mail-send-symbolic': '\u{2709}', // ✉
    'starred-symbolic': '\u{2B50}', // ⭐
};

function iconGlyph(symbolic: string): string {
    return ICON_GLYPHS[symbolic] ?? '';
}

export class ButtonContentNsStory extends StoryView {
    private _content: AdwButtonContent | null = null;

    constructor() {
        super(ButtonContentNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return buttonContentMeta;
    }

    initialize(): void {
        this._content = new AdwButtonContent();
        this._syncContent();

        // Mirror the suggested-action pill button the native/browser twins wrap
        // the content in. AdwButton is text-only, so style a wrapping layout.
        const button = new StackLayout();
        button.orientation = 'horizontal';
        button.horizontalAlignment = 'center';
        button.className = 'adw-button suggested-action pill';
        button.addChild(this._content);

        this.addContent(button);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncContent();
    }

    private _syncContent(): void {
        if (!this._content) return;
        this._content.label = this.args.label as string;
        this._content.iconName = iconGlyph(this.args.iconName as string);
        // `canShrink` has no NS equivalent (no ellipsize in the CSS subset);
        // the control is presented but does not alter the static layout.
    }
}

export const ButtonContentNsStories: NsStoryModule = { stories: [ButtonContentNsStory] };
