// Browser port of the Toast story. Shares metadata with toast.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { toastMeta } from '../../feedback/toast.meta.js';

/** The <adw-toast-overlay> exposes addToast(title, opts) — see @gjsify/adwaita-web. */
interface ToastOverlayElement extends HTMLElement {
    addToast(title: string, options?: { timeout?: number; buttonLabel?: string; onAction?: () => void }): void;
}

/** Story: an Adw.Toast presented through an adw-toast-overlay on button press. */
export class ToastWebStory extends StoryElement {
    private _overlay: ToastOverlayElement | null = null;

    constructor() {
        super(ToastWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return toastMeta;
    }

    initialize(): void {
        this._overlay = document.createElement('adw-toast-overlay') as ToastOverlayElement;
        // Match the native story's fixed 360×220 viewport so the toast has a
        // bounded overlay area to float over.
        this._overlay.style.width = '360px';
        this._overlay.style.height = '220px';

        const center = document.createElement('div');
        center.style.display = 'flex';
        center.style.alignItems = 'center';
        center.style.justifyContent = 'center';
        center.style.width = '100%';
        center.style.height = '100%';

        const button = document.createElement('gtk-button');
        button.textContent = 'Show toast';
        button.setAttribute('pill', '');
        button.setAttribute('suggested', '');
        button.addEventListener('click', () => this._showToast());
        center.append(button);

        this._overlay.append(center);
        this.addContent(this._overlay);
    }

    private _showToast(): void {
        if (!this._overlay) return;
        const hasButton = this.args.hasButton as boolean;
        this._overlay.addToast(this.args.title as string, {
            timeout: this.args.timeout as number,
            buttonLabel: hasButton ? (this.args.buttonLabel as string) : undefined,
        });
    }

    updateArgs(_args: StoryArgs): void {
        // Toasts are built on demand in _showToast(); nothing to re-apply to the overlay.
    }
}

export const ToastWebStories: WebStoryModule = { stories: [ToastWebStory] };
