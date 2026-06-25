// NativeScript port of the Bottom Sheet story. Shares metadata with the GTK
// bottom-sheet.story.ts and browser bottom-sheet.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwActionRow, AdwBottomSheet, AdwButton, AdwPreferencesGroup } from '@gjsify/adwaita-nativescript';
import { Label, StackLayout } from '@nativescript/core';
import { bottomSheetMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class BottomSheetNsStory extends StoryView {
    private _sheet: AdwBottomSheet | null = null;

    constructor() {
        super(BottomSheetNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return bottomSheetMeta;
    }

    /** The persistent content — a centered pill button that toggles the sheet. */
    private _buildContent(): StackLayout {
        const center = new StackLayout();
        center.horizontalAlignment = 'center';
        center.verticalAlignment = 'middle';

        const toggle = new AdwButton();
        toggle.text = 'Toggle sheet';
        toggle.variant = 'pill';
        toggle.addEventListener('tap', () => {
            if (this._sheet) this._sheet.openState = !this._sheet.openState;
        });

        center.addChild(toggle);
        return center;
    }

    /** The sheet — a title above a preferences group of share actions. */
    private _buildSheet(): StackLayout {
        const box = new StackLayout();
        box.orientation = 'vertical';

        // Match the GTK .title-2 typography (bold heading) — NS has no typography
        // utility class, so a plain bold Label stands in.
        const title = new Label();
        title.text = 'Share track';
        title.className = 'title-2';
        box.addChild(title);

        const group = new AdwPreferencesGroup();
        for (const [rowTitle] of [
            ['Copy link', 'edit-copy-symbolic'],
            ['Send to a friend', 'mail-send-symbolic'],
            ['Add to playlist', 'list-add-symbolic'],
        ] as const) {
            const row = new AdwActionRow();
            row.title = rowTitle;
            group.addRow(row);
        }
        box.addChild(group);

        return box;
    }

    initialize(): void {
        this._sheet = new AdwBottomSheet();
        // Match the native story's fixed 480×340 viewport so the sheet has a
        // bounded content area to sit over.
        this._sheet.width = 480;
        this._sheet.height = 340;

        this._sheet.setContent(this._buildContent());
        this._sheet.setSheet(this._buildSheet());

        this._sync();
        this.addContent(this._sheet);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._sheet) return;
        // NS AdwBottomSheet faithfully models `open` (via `openState`). The
        // `modal` / `canClose` args have no NS equivalent — the CSS-subset sheet
        // has no scrim/backdrop and is always dismissable via its drag handle.
        this._sheet.openState = this.args.open as boolean;
    }
}

export const BottomSheetNsStories: NsStoryModule = { stories: [BottomSheetNsStory] };
