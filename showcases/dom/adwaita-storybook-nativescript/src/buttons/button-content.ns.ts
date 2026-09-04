// NativeScript port of the Button Content story, sharing its metadata with the GTK and browser twins
// through the renderer-agnostic *.meta.ts barrel.
//
// Those twins put an Adw.ButtonContent inside a pill button. NS GtkButton extends a text-only Button
// and cannot host a child widget, so the content goes in a StackLayout carrying the same classes —
// the same workaround the browser twin uses.

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { listAddSymbolic, mailSendSymbolic } from '@gjsify/adwaita-icons/actions';
import { folderDownloadSymbolic } from '@gjsify/adwaita-icons/places';
import { starredSymbolic } from '@gjsify/adwaita-icons/status';
import { StackLayout } from '@nativescript/core';
import { buttonContentMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// GTK symbolic name → a real Adwaita symbolic SVG, rasterised natively by AdwIcon. NOT an emoji
// glyph, so this matches Adw.ButtonContent.
const ICON_SVGS: Record<string, string> = {
    'folder-download-symbolic': folderDownloadSymbolic,
    'list-add-symbolic': listAddSymbolic,
    'mail-send-symbolic': mailSendSymbolic,
    'starred-symbolic': starredSymbolic,
};

function iconSvg(symbolic: string): string {
    return ICON_SVGS[symbolic] ?? '';
}

export class ButtonContentNsStory extends StoryView {
    private _content: Adw.ButtonContent | null = null;

    constructor() {
        super(ButtonContentNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return buttonContentMeta;
    }

    initialize(): void {
        this._content = new Adw.ButtonContent();
        // The button is suggested-action (blue) → white foreground, so the
        // symbolic icon renders white to match the label.
        this._content.iconColor = '#ffffff';
        this._syncContent();

        // Mirror the suggested-action pill button the native/browser twins wrap
        // the content in. GtkButton is text-only, so style a wrapping layout.
        const button = new StackLayout();
        button.orientation = 'horizontal';
        button.horizontalAlignment = 'center';
        button.className = 'adw-button suggested-action pill';
        button.addChild(this._content);
        // NS has no rooting protocol, so the view playing the GtkButton role is
        // named explicitly. That is what stamps `image-text-button` on it
        // (adw-button-content.c:115) — i.e. the 9px horizontal padding the class
        // carries (_buttons.scss:77-80), which no renderer applied before.
        this._content.hostButton = button;

        this.addContent(button);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncContent();
    }

    private _syncContent(): void {
        if (!this._content) return;
        this._content.label = this.args.label as string;
        this._content.iconName = iconSvg(this.args.iconName as string);
        // `canShrink` round-trips and reports its PangoEllipsizeMode, but the NS
        // CSS subset has no ellipsize — the control reflects the state rather
        // than truncating the label. See Adw.ButtonContent.canShrink.
        this._content.canShrink = this.args.canShrink as boolean;
    }
}

export const ButtonContentNsStories: NsStoryModule = { stories: [ButtonContentNsStory] };
