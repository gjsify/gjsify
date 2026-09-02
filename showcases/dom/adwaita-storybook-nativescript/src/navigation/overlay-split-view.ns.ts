// NativeScript port of the Overlay Split View story. Shares metadata with the GTK
// overlay-split-view.story.ts and browser overlay-split-view.web.ts (imported from
// the GTK showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import {
    AdwActionRow,
    AdwHeaderBar,
    AdwOverlaySplitView,
    AdwPreferencesGroup,
    AdwStatusPage,
    AdwToolbarView,
} from '@gjsify/adwaita-nativescript';
import type { View } from '@nativescript/core';
import { folderMusicSymbolic } from '@gjsify/adwaita-icons/places';
import { overlaySplitViewMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

/**
 * Sidebar rows — the title plus a leading glyph standing in for the GTK symbolic
 * icon (the NS CSS subset has no icon-theme lookup, mirroring the other glyph-based
 * widgets).
 */
const SIDEBAR_ROWS: ReadonlyArray<readonly [string, string]> = [
    ['Home', '⌂'],
    ['Discover', '🔍'],
    ['Library', '🎵'],
    ['Settings', '⚙'],
];

export class OverlaySplitViewNsStory extends StoryView {
    private _view: AdwOverlaySplitView | null = null;

    constructor() {
        super(OverlaySplitViewNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return overlaySplitViewMeta;
    }

    private buildSidebar(): View {
        // A boxed list of rows — the equivalent of the native story's
        // Adw.PreferencesGroup of ActionRows. Each row carries a leading glyph in
        // its title (AdwActionRow has no prefix-icon slot in this surface).
        const group = new AdwPreferencesGroup();
        for (const [title, glyph] of SIDEBAR_ROWS) {
            const row = new AdwActionRow();
            row.title = `${glyph}  ${title}`;
            group.addRow(row);
        }

        // Toolbar view with a flat, title-less header bar framing the boxed list —
        // mirrors the native add_css_class('sidebar') + showTitle:false.
        const header = new AdwHeaderBar();
        header.flat = true;

        const toolbarView = new AdwToolbarView();
        toolbarView.addTopBar(header);
        toolbarView.setContent(group);
        return toolbarView;
    }

    private buildContent(): View {
        const status = new AdwStatusPage();
        status.iconName = folderMusicSymbolic;
        status.title = 'Your Library';
        status.description = 'Toggle the sidebar to browse sections. Collapse it to overlay the content.';

        const header = new AdwHeaderBar();

        const toolbarView = new AdwToolbarView();
        toolbarView.addTopBar(header);
        toolbarView.setContent(status);
        return toolbarView;
    }

    initialize(): void {
        this._view = new AdwOverlaySplitView();
        this._view.width = 480;
        this._view.height = 340;
        this._view.setSidebar(this.buildSidebar());
        this._view.setContent(this.buildContent());

        this._sync();
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._view) return;
        this._view.collapsed = this.args.collapsed as boolean;
        this._view.showSidebar = this.args.showSidebar as boolean;
    }
}

export const OverlaySplitViewNsStories: NsStoryModule = { stories: [OverlaySplitViewNsStory] };
