// Browser port of the Preferences Dialog story. Shares metadata with
// preferences-dialog.story.ts and presents the same single-page dialog from a
// "Show dialog" pill button.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { preferencesDialogMeta } from '../../feedback/preferences-dialog.meta.js';

export class PreferencesDialogWebStory extends StoryElement {
    private _dialog: HTMLElement | null = null;

    constructor() {
        super(PreferencesDialogWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return preferencesDialogMeta;
    }

    /** Build the single page of grouped rows, mirroring the native story. */
    private _buildDialog(): HTMLElement {
        const dialog = document.createElement('adw-preferences-dialog');
        dialog.setAttribute('title', 'Preferences');

        const page = document.createElement('adw-preferences-page');
        page.setAttribute('title', (this.args.pageTitle as string) ?? 'General');
        page.setAttribute('icon-name', 'preferences-system-symbolic');

        const group = document.createElement('adw-preferences-group');
        group.setAttribute('title', (this.args.groupTitle as string) ?? 'Appearance');
        group.setAttribute('description', 'Control how the application looks and behaves.');

        // Dark style — a switch row, on by default (matches the native SwitchRow).
        const darkStyle = document.createElement('adw-switch-row');
        darkStyle.setAttribute('title', 'Dark style');
        darkStyle.setAttribute('subtitle', 'Use a dark colour scheme');
        darkStyle.setAttribute('active', '');
        group.append(darkStyle);

        // Accent colour — a combo row over the same five options.
        const accent = document.createElement('adw-combo-row');
        accent.setAttribute('title', 'Accent colour');
        accent.setAttribute('items', JSON.stringify(['Blue', 'Teal', 'Green', 'Orange', 'Purple']));
        accent.setAttribute('selected', '0');
        group.append(accent);

        // Font size — a spin row bounded 8–24, defaulting to 12.
        const fontSize = document.createElement('adw-spin-row');
        fontSize.setAttribute('title', 'Font size');
        fontSize.setAttribute('min', '8');
        fontSize.setAttribute('max', '24');
        fontSize.setAttribute('step', '1');
        fontSize.setAttribute('value', '12');
        group.append(fontSize);

        page.append(group);
        dialog.append(page);
        return dialog;
    }

    initialize(): void {
        // The persistent story content: a centered pill button that presents the
        // dialog (the native story's "Show dialog" trigger).
        const center = document.createElement('div');
        center.style.display = 'flex';
        center.style.alignItems = 'center';
        center.style.justifyContent = 'center';
        center.style.width = '100%';
        center.style.height = '100%';
        center.style.minHeight = '200px';

        const button = document.createElement('gtk-button');
        button.textContent = 'Show dialog';
        button.setAttribute('pill', '');
        button.setAttribute('suggested', '');
        button.addEventListener('click', () => this._present());

        center.append(button);
        this.addContent(center);
    }

    private _present(): void {
        // Rebuild the dialog from the latest args each time it is presented (the
        // native story does the same), then reveal it. The dialog appends itself
        // to <body> so its fixed scrim covers the whole viewport.
        if (this._dialog) this._dialog.remove();
        this._dialog = this._buildDialog();
        this._dialog.addEventListener('closed', () => {
            this._dialog?.remove();
            this._dialog = null;
        });
        document.body.appendChild(this._dialog);
        // Reveal after connect so the element is upgraded + initialized.
        requestAnimationFrame(() => this._dialog?.setAttribute('open', ''));
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog is rebuilt from the latest args each time it is presented.
    }

    teardown(): void {
        this._dialog?.remove();
        this._dialog = null;
    }
}

export const PreferencesDialogWebStories: WebStoryModule = { stories: [PreferencesDialogWebStory] };
