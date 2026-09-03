// NativeScript port of the Header Bar story. Shares metadata with the GTK
// header-bar.story.ts and browser header-bar.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';
import { headerBarMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class HeaderBarNsStory extends StoryView {
    private _headerBar: Adw.HeaderBar | null = null;
    private _title: Adw.WindowTitle | null = null;

    constructor() {
        super(HeaderBarNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return headerBarMeta;
    }

    initialize(): void {
        // Center title widget — the equivalent of Adw.HeaderBar's title-widget.
        this._title = new Adw.WindowTitle();

        this._headerBar = new Adw.HeaderBar();
        this._headerBar.setTitleWidget(this._title);

        // Start control — a flat back button (glyph label; NS has no icon theme).
        const backButton = new Gtk.Button();
        backButton.text = '‹';
        backButton.variant = 'flat';
        this._headerBar.packStart(backButton);

        // End control — a flat menu button.
        const menuButton = new Gtk.Button();
        menuButton.text = '≡';
        menuButton.variant = 'flat';
        this._headerBar.packEnd(menuButton);

        this._sync();
        this.addContent(this._headerBar);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._title) return;
        this._title.title = this.args.title as string;
        this._title.subtitle = this.args.subtitle as string;
        // Adw.HeaderBar.showTitle toggles visibility of the title widget.
        this._title.visibility = (this.args.showTitle as boolean) ? 'visible' : 'collapse';
    }
}

export const HeaderBarNsStories: NsStoryModule = { stories: [HeaderBarNsStory] };
