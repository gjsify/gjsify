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
        button.text = 'Show toast';
        button.variant = 'pill';
        button.horizontalAlignment = 'center';
        button.verticalAlignment = 'middle';
        button.addEventListener('tap', () => this._showToast());

        this._overlay = new Adw.ToastOverlay();
        // Match the native story's fixed 360×220 viewport so the toast has a
        // bounded overlay area to float over.
        this._overlay.width = 360;
        this._overlay.height = 220;
        this._overlay.setContent(button);

        this.addContent(this._overlay);
    }

    private _showToast(): void {
        if (!this._overlay) return;
        const hasButton = this.args.hasButton as boolean;
        this._overlay.showToast(this.args.title as string, {
            // The meta's timeout is in seconds; the NS overlay timer is in ms.
            timeout: (this.args.timeout as number) * 1000,
            buttonLabel: hasButton ? (this.args.buttonLabel as string) : undefined,
        });
    }

    updateArgs(_args: StoryArgs): void {
        // Toasts are built on demand in _showToast(); nothing to re-apply to the overlay.
    }
}

export const ToastNsStories: NsStoryModule = { stories: [ToastNsStory] };
