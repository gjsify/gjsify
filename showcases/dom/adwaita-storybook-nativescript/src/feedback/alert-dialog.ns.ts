// NativeScript port of the Alert Dialog story. Shares metadata with the GTK
// alert-dialog.story.ts and browser alert-dialog.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';
import { alertDialogMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

/**
 * Story: Adw.AlertDialog presented from a button, with cancel/destructive
 * responses — a 1:1 port of the GTK AlertDialogStory.
 *
 * FIDELITY: NS Adw.AlertDialog uses the platform's native confirm()/action()
 * chrome (not an in-app modal) — same honest on-platform substitution as the
 * widget's design. The destructive emphasis the GTK story applies has no
 * confirm()-level equivalent, so the response labels carry the meaning.
 */
export class AlertDialogNsStory extends StoryView {
    constructor() {
        super(AlertDialogNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return alertDialogMeta;
    }

    initialize(): void {
        const button = new Gtk.Button();
        button.text = 'Show dialog';
        button.styleClasses = 'pill';
        button.horizontalAlignment = 'center';
        button.verticalAlignment = 'middle';
        button.addEventListener('tap', () => void this._present());

        this.addContent(button);
    }

    /** Build + present a fresh dialog, reading the latest args (as the GTK story does). */
    private async _present(): Promise<void> {
        const dialog = new Adw.AlertDialog(this.args.heading as string, this.args.body as string);
        dialog.addResponse('cancel', 'Cancel');
        dialog.addResponse('delete', 'Delete');
        dialog.defaultResponse = 'cancel';
        dialog.closeResponse = 'cancel';
        await dialog.present();
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }
}

export const AlertDialogNsStories: NsStoryModule = { stories: [AlertDialogNsStory] };
