// NativeScript port of the Toast story. Shares metadata with the GTK
// toast.story.ts and browser toast.web.ts (imported from the GTK showcase's
// renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';
import { toastMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

/** Story: an AdwToast presented through an Adw.ToastOverlay on button press. */
export class ToastNsStory extends StoryView {
    private _overlay: Adw.ToastOverlay | null = null;

    constructor() {
        super(ToastNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return toastMeta;
    }

    initialize(): void {
        const button = new Gtk.Button();
        button.label = 'Show toast';
        button.styleClasses = 'pill';
        button.horizontalAlignment = 'center';
        button.verticalAlignment = 'middle';
        button.addEventListener('tap', () => this._showToast());

        this._overlay = new Adw.ToastOverlay();
        // Match the native story's fixed 360×220 viewport so the toast has a
        // bounded overlay area to float over.
        this._overlay.width = 360;
        this._overlay.height = 220;
        this._overlay.set_child(button);

        this.addContent(this._overlay);
    }

    private _showToast(): void {
        if (!this._overlay) return;

        const toast = new Adw.Toast({
            title: this.args.title as string,
            timeout: this.args.timeout as number,
        });

        if (this.args.hasButton as boolean) {
            toast.buttonLabel = this.args.buttonLabel as string;
        }

        this._overlay.add_toast(toast);
    }

    updateArgs(_args: StoryArgs): void {
        // Toasts are built on demand in _showToast(); nothing to re-apply to the overlay.
    }
}

export const ToastNsStories: NsStoryModule = { stories: [ToastNsStory] };
