// Browser port of the Overlay story. Shares metadata with overlay.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { overlayMeta } from '../../layout/overlay.meta.js';

export class OverlayWebStory extends StoryElement {
    private _overlay: HTMLElement | null = null;
    private _badge: HTMLElement | null = null;

    constructor() {
        super(OverlayWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return overlayMeta;
    }

    initialize(): void {
        this._overlay = document.createElement('gtk-overlay');
        this._overlay.style.width = '260px';
        this._overlay.style.height = '160px';

        const main = document.createElement('gtk-label');
        main.setAttribute('label', 'Main child — its size is the overlay');
        main.classList.add('dimmed');
        this._overlay.appendChild(main);

        this._badge = document.createElement('gtk-label');
        this._badge.setAttribute('slot', 'overlay');
        this._badge.setAttribute('label', '2');
        this._badge.classList.add('osd');
        this._overlay.appendChild(this._badge);

        this._apply();
        this.addContent(this._overlay);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._badge) return;
        // `fill` is `GtkWidget`'s DEFAULT alignment and has no `Gtk.Align` member, so it is
        // spelled as an absent attribute — the same choice the GTK story makes with
        // `unset_property`.
        const align = (value: unknown, name: string) => {
            if (value === 'fill') this._badge?.removeAttribute(name);
            else this._badge?.setAttribute(name, String(value));
        };
        align(this.args.halign, 'halign');
        align(this.args.valign, 'valign');
        this._badge.hidden = !(this.args.showLabel as boolean);
    }
}

export const OverlayWebStories: WebStoryModule = { stories: [OverlayWebStory] };
