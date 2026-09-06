// NativeScript port of the About Dialog story. Shares metadata with the GTK
// about-dialog.story.ts and browser about-dialog.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';
import { aboutDialogMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';
import { GridLayout, ItemSpec } from '@nativescript/core';

/**
 * Story: Adw.AboutDialog presented from a button, with app metadata + credits.
 *
 * FIDELITY: NS Adw.AboutDialog is an in-page modal overlay card (not a separate
 * OS window) and exposes only the scalar fields — it has no developers/designers
 * arrays, so those credits are folded into the developer-name line. The dialog
 * overlay is stacked over the trigger button in a single GridLayout cell so its
 * dimmed scrim covers the stage when presented.
 */
export class AboutDialogNsStory extends StoryView {
    private _dialog: Adw.AboutDialog | null = null;

    constructor() {
        super(AboutDialogNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return aboutDialogMeta;
    }

    initialize(): void {
        // Single-cell grid: the trigger button sits underneath, the collapsed
        // dialog overlay paints over it when presented (mirrors the web twin
        // mounting the dialog so its scrim covers the content).
        const stack = new GridLayout();
        stack.addColumn(new ItemSpec(1, 'star'));
        stack.addRow(new ItemSpec(1, 'star'));

        const button = new Gtk.Button();
        button.text = 'Show dialog';
        button.styleClasses = 'pill';
        button.horizontalAlignment = 'center';
        button.verticalAlignment = 'middle';
        button.addEventListener('tap', () => this._present());
        GridLayout.setColumn(button, 0);
        GridLayout.setRow(button, 0);
        stack.addChild(button);

        this._dialog = new Adw.AboutDialog();
        GridLayout.setColumn(this._dialog, 0);
        GridLayout.setRow(this._dialog, 0);
        stack.addChild(this._dialog);

        this.addContent(stack);
    }

    private _present(): void {
        if (!this._dialog) return;
        const dialog = this._dialog;
        dialog.applicationName = (this.args.applicationName as string) ?? 'Adwaita Storybook';
        // The native story uses `application-x-executable-symbolic`; the NS subset
        // renders the app icon as a glyph Label, so use a generic app glyph.
        dialog.applicationIcon = '🗔';
        dialog.version = (this.args.version as string) ?? '0.11.0';
        dialog.developerName = 'A GJSify Project — Ada Lovelace, Grace Hopper (design: Margaret Hamilton)';
        dialog.comments = 'A live catalogue of native GTK and Adwaita widgets, rendered under GJS.';
        dialog.website = 'https://github.com/gjsify/gjsify';
        dialog.copyright = '© 2026 The GJSify Project';
        dialog.present();
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }

    teardown(): void {
        this._dialog?.close();
        this._dialog = null;
    }
}

export const AboutDialogNsStories: NsStoryModule = { stories: [AboutDialogNsStory] };
