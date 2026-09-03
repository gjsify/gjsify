// NativeScript port of the Split Button stories. Shares metadata with the GTK
// split-button.story.ts and browser split-button.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel). Two story classes (default +
// flat), mirroring both twins.
//
// NS Adw.SplitButton has an action part (a symbolic icon OR a text label) + a
// `menu` (string[]) opened as a native action() sheet on the arrow tap. The
// native/browser twins show only the icon when one is set, so here the symbolic
// name maps to a REAL Adwaita symbolic SVG set as the action icon.

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import {
    documentEditSymbolic,
    documentOpenSymbolic,
    documentSaveSymbolic,
    listAddSymbolic,
    mailReplySenderSymbolic,
    mailSendSymbolic,
} from '@gjsify/adwaita-icons/actions';
import { splitButtonFlatMeta, splitButtonMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// The shared dropdown menu — the NS twin of buildMenu() in the GTK story / the
// MENU model in the browser story. NS Adw.SplitButton.menu is a plain label list.
const MENU = ['Save as…', 'Export', 'Print'];

// GTK symbolic icon name → a REAL Adwaita symbolic SVG string.
const ICON_SVGS: Record<string, string> = {
    'document-save-symbolic': documentSaveSymbolic,
    'mail-send-symbolic': mailSendSymbolic,
    'list-add-symbolic': listAddSymbolic,
    'mail-reply-sender-symbolic': mailReplySenderSymbolic,
    'document-edit-symbolic': documentEditSymbolic,
    'document-open-symbolic': documentOpenSymbolic,
};

function iconSvg(symbolic: string): string {
    return ICON_SVGS[symbolic] ?? '';
}

abstract class SplitButtonNsStoryBase extends StoryView {
    protected _widget: Adw.SplitButton | null = null;
    protected abstract get flat(): boolean;

    initialize(): void {
        this._widget = new Adw.SplitButton();
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
        const svg = iconSvg(this.args.iconName as string);
        // Mirror the twins: with an icon set, show only the icon; otherwise the
        // label drives the action half.
        this._widget.iconName = svg;
        if (!svg) this._widget.label = this.args.label as string;
    }
}

/** Story: Adw.SplitButton with a primary action and a dropdown menu. */
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

/** Story: a flat-styled Adw.SplitButton, suited to header bars and toolbars. */
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
