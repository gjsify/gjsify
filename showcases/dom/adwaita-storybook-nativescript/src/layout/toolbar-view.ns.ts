// NativeScript port of the Toolbar View story. Shares metadata with the GTK
// toolbar-view.story.ts and browser toolbar-view.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import {
    AdwHeaderBar,
    AdwImageButton,
    AdwStatusPage,
    AdwToolbarView,
    AdwWindowTitle,
} from '@gjsify/adwaita-nativescript';
import { listAddSymbolic, listRemoveSymbolic, sendToSymbolic } from '@gjsify/adwaita-icons/actions';
import { folderSymbolic } from '@gjsify/adwaita-icons/places';
import { toolbarViewMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class ToolbarViewNsStory extends StoryView {
    private _topBar: AdwHeaderBar | null = null;
    private _bottomBar: AdwHeaderBar | null = null;

    constructor() {
        super(ToolbarViewNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return toolbarViewMeta;
    }

    initialize(): void {
        const view = new AdwToolbarView();
        view.width = 460;
        view.height = 320;

        // Top header bar with a window title (matches Adw.HeaderBar + WindowTitle).
        const header = new AdwHeaderBar();
        const title = new AdwWindowTitle();
        title.title = 'Documents';
        title.subtitle = '12 items';
        header.setTitleWidget(title);
        view.addTopBar(header);
        this._topBar = header;

        // Content — a status page sits between the toolbars.
        const content = new AdwStatusPage();
        content.iconName = folderSymbolic;
        content.title = 'Your library';
        content.description = 'Content sits between the toolbars and scrolls independently of them.';
        view.setContent(content);

        // Bottom action bar — flat start buttons, a centered label and an end
        // button (mirrors the native Gtk.ActionBar with pack_start / center /
        // pack_end). An AdwHeaderBar is the closest Adwaita primitive with the
        // start / center-title / end packing the bottom action bar needs.
        const bottomBar = new AdwHeaderBar();

        const addButton = new AdwImageButton();
        addButton.iconName = listAddSymbolic;
        bottomBar.packStart(addButton);

        const removeButton = new AdwImageButton();
        removeButton.iconName = listRemoveSymbolic;
        bottomBar.packStart(removeButton);

        const selectionLabel = new AdwWindowTitle();
        selectionLabel.title = 'Selection: none';
        bottomBar.setTitleWidget(selectionLabel);

        const shareButton = new AdwImageButton();
        shareButton.iconName = sendToSymbolic;
        bottomBar.packEnd(shareButton);

        view.addBottomBar(bottomBar);
        this._bottomBar = bottomBar;

        this._sync();
        this.addContent(view);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        // The NS toolbar view has no reveal properties; mirror revealTopBars /
        // revealBottomBars by collapsing the top/bottom bars themselves.
        if (this._topBar) {
            this._topBar.visibility = (this.args.revealTopBars as boolean) ? 'visible' : 'collapse';
        }
        if (this._bottomBar) {
            this._bottomBar.visibility = (this.args.revealBottomBars as boolean) ? 'visible' : 'collapse';
        }
    }
}

export const ToolbarViewNsStories: NsStoryModule = { stories: [ToolbarViewNsStory] };
