// NativeScript port of the Preferences Dialog story. Shares metadata with the
// GTK preferences-dialog.story.ts and browser preferences-dialog.web.ts
// (imported from the GTK showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';
import { preferencesDialogMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';
import { GridLayout, ItemSpec } from '@nativescript/core';

/**
 * Story: Adw.PreferencesDialog presented from a button, with one page of rows.
 *
 * FIDELITY: NS Adw.PreferencesDialog is an in-page modal overlay card (not a
 * separate OS window). The dialog overlay is stacked over the trigger button in
 * a single GridLayout cell so its dimmed scrim covers the stage when presented;
 * the page/group/rows are rebuilt from the latest args on each present, like the
 * twins.
 */
export class PreferencesDialogNsStory extends StoryView {
    private _stack: GridLayout | null = null;
    private _dialog: Adw.PreferencesDialog | null = null;

    constructor() {
        super(PreferencesDialogNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return preferencesDialogMeta;
    }

    /** Build the single page of grouped rows, mirroring the native story. */
    private _buildDialog(): Adw.PreferencesDialog {
        const dialog = new Adw.PreferencesDialog();
        dialog.title = 'Preferences';

        const page = new Adw.PreferencesPage();
        // The page title is not painted by the page (GTK shows it in the view
        // switcher, which no port has yet) — it is what a search result's
        // `General → Appearance` subtitle is built from, so the shared
        // `pageTitle` control is no longer inert here.
        page.title = (this.args.pageTitle as string) ?? 'General';
        page.name = 'general';
        page.iconName = 'preferences-system-symbolic';

        const group = new Adw.PreferencesGroup();
        group.title = (this.args.groupTitle as string) ?? 'Appearance';

        // Dark style — a switch row, on by default (matches the native SwitchRow).
        const darkStyle = new Adw.SwitchRow();
        darkStyle.title = 'Dark style';
        darkStyle.subtitle = 'Use a dark colour scheme';
        darkStyle.active = true;
        group.addRow(darkStyle);

        // Accent colour — a combo row over the same five options.
        const accent = new Adw.ComboRow();
        accent.title = 'Accent colour';
        accent.model = ['Blue', 'Teal', 'Green', 'Orange', 'Purple'];
        accent.selected = 0;
        group.addRow(accent);

        // Font size — a spin row bounded 8–24, defaulting to 12.
        const fontSize = new Adw.SpinRow();
        fontSize.title = 'Font size';
        fontSize.min = 8;
        fontSize.max = 24;
        fontSize.step = 1;
        fontSize.value = 12;
        group.addRow(fontSize);

        page.addGroup(group);
        dialog.add(page);
        return dialog;
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
        button.variant = 'pill';
        button.horizontalAlignment = 'center';
        button.verticalAlignment = 'middle';
        button.addEventListener('tap', () => this._present());
        GridLayout.setColumn(button, 0);
        GridLayout.setRow(button, 0);
        stack.addChild(button);

        this._stack = stack;
        this.addContent(stack);
    }

    private _present(): void {
        if (!this._stack) return;
        // Rebuild the dialog from the latest args each time it is presented (the
        // native story does the same), then reveal it.
        if (this._dialog) this._stack.removeChild(this._dialog);
        this._dialog = this._buildDialog();
        GridLayout.setColumn(this._dialog, 0);
        GridLayout.setRow(this._dialog, 0);
        this._stack.addChild(this._dialog);
        this._dialog.present();
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog is rebuilt from the latest args each time it is presented.
    }

    teardown(): void {
        if (this._dialog && this._stack) this._stack.removeChild(this._dialog);
        this._dialog = null;
    }
}

export const PreferencesDialogNsStories: NsStoryModule = { stories: [PreferencesDialogNsStory] };
