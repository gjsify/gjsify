// Browser port of the Alert Dialog story. Shares metadata with alert-dialog.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { alertDialogMeta } from '../../feedback/alert-dialog.meta.js';

/**
 * Story: adw-alert-dialog presented from a button, with cancel/destructive
 * responses — a 1:1 port of the GTK AlertDialogStory.
 */
export class AlertDialogWebStory extends StoryElement {
    constructor() {
        super(AlertDialogWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return alertDialogMeta;
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
        const dialog = document.createElement('adw-alert-dialog') as HTMLElement & {
            addResponse(id: string, label: string): void;
            setResponseAppearance(id: string, appearance: 'default' | 'suggested' | 'destructive'): void;
            setDefaultResponse(id: string | null): void;
            setCloseResponse(id: string): void;
            present(): void;
        };
        dialog.setAttribute('heading', this.args.heading as string);
        dialog.setAttribute('body', this.args.body as string);

        // The custom element only wires up its responses once connected, so add
        // it to the document before driving the imperative API.
        document.body.appendChild(dialog);

        dialog.addResponse('cancel', 'Cancel');
        dialog.addResponse('delete', 'Delete');
        dialog.setResponseAppearance('delete', 'destructive');
        dialog.setDefaultResponse('cancel');
        dialog.setCloseResponse('cancel');

        // Remove the dialog from the DOM once the user responds — the GTK dialog
        // is likewise destroyed on response.
        dialog.addEventListener('response', () => dialog.remove(), { once: true });

        dialog.present();
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }
}

export const AlertDialogWebStories: WebStoryModule = { stories: [AlertDialogWebStory] };
