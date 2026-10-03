// Browser port of the Dialog story. Shares metadata with dialog.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { dialogMeta } from '../../feedback/dialog.meta.js';

/**
 * Story: adw-dialog presented from a button, holding a preferences page as its
 * child — a 1:1 port of the GTK DialogStory.
 */
export class DialogWebStory extends StoryElement {
    constructor() {
        super(DialogWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return dialogMeta;
    }

    initialize(): void {
        const button = document.createElement('gtk-button');
        button.textContent = 'Show dialog';
        button.setAttribute('pill', '');
        button.setAttribute('suggested', '');
        button.addEventListener('click', () => this._present());

        // Centre the trigger button so the preview matches the GTK story's
        // centred halign/valign placement.
        const center = document.createElement('div');
        center.style.display = 'flex';
        center.style.alignItems = 'center';
        center.style.justifyContent = 'center';
        center.style.minHeight = '160px';
        center.append(button);

        this.addContent(center);
    }

    /** Build + present a fresh dialog, reading the latest args (as the GTK story does). */
    private _present(): void {
        const dialog = document.createElement('adw-dialog');
        dialog.setAttribute('title', this.args.title as string);
        // The NICK, not the enum member: `presentation-mode` is the string the GIR
        // enum resolves to on the other two renderers (ADR 0034 § 4).
        dialog.setAttribute('presentation-mode', this.args.presentation as string);

        // ONE child, and it is the `Adw.Dialog:child` property — the element moves
        // every child into its content area, so this is a declaration, not a pack.
        const group = document.createElement('adw-preferences-group');
        group.setAttribute('title', 'Appearance');
        const row = document.createElement('adw-switch-row');
        row.setAttribute('title', 'Dark style');
        row.setAttribute('subtitle', 'Use a dark colour scheme');
        row.setAttribute('active', '');
        group.appendChild(row);

        const page = document.createElement('adw-preferences-page');
        page.setAttribute('title', 'General');
        page.appendChild(group);

        dialog.appendChild(page);

        // A DISCONNECTED element is attached to `document.body` on present, the
        // `Adw.Dialog.present(parent)` idiom; one already in the DOM is revealed in
        // place and stays reusable.
        dialog.present();

        // Close it from the story, the way the GTK story's dialog is destroyed on close.
        dialog.addEventListener('closed', () => dialog.remove(), { once: true });
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }
}

export const DialogWebStories: WebStoryModule = { stories: [DialogWebStory] };
