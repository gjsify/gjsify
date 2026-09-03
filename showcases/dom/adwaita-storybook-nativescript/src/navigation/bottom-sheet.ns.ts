// NativeScript port of the Bottom Sheet story. Shares metadata with the GTK
// bottom-sheet.story.ts and browser bottom-sheet.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';
import { Label, StackLayout } from '@nativescript/core';
import { bottomSheetMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class BottomSheetNsStory extends StoryView {
    private _sheet: Adw.BottomSheet | null = null;

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

        const toggle = new Gtk.Button();
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

        const group = new Adw.PreferencesGroup();
        for (const [rowTitle] of [
            ['Copy link', 'edit-copy-symbolic'],
            ['Send to a friend', 'mail-send-symbolic'],
            ['Add to playlist', 'list-add-symbolic'],
        ] as const) {
            const row = new Adw.ActionRow();
            row.title = rowTitle;
            group.addRow(row);
        }
        box.addChild(group);

        return box;
    }

    initialize(): void {
        this._sheet = new Adw.BottomSheet();
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
        // NS Adw.BottomSheet models `open` (via `openState`) and `can-close`, both
        // out of the shared `@gjsify/adwaita-core` state. `modal` has no NS
        // equivalent: the CSS subset here has no scrim/backdrop.
        //
        // `canClose` is only observable through a dismissal, and this widget has
        // none to offer on its own — the drag handle is decorative
        // (adw-bottom-sheet.c:1197-1198) and NS has no Escape key. A host routes
        // what it has (Android back, an in-sheet button) into
        // `requestClose(source)`.
        this._sheet.canClose = this.args.canClose as boolean;
        this._sheet.openState = this.args.open as boolean;
        // Read so the control stays bound to this rendering too.
        void (this.args.modal as boolean);
    }
}

export const BottomSheetNsStories: NsStoryModule = { stories: [BottomSheetNsStory] };
