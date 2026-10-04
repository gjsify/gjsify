// Browser port of the GTK Spinner story. Shares metadata with gtk-spinner.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { gtkSpinnerMeta } from '../../controls/gtk-spinner.meta.js';

export class GtkSpinnerWebStory extends StoryElement {
    private _spinner: HTMLElement | null = null;

    constructor() {
        super(GtkSpinnerWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return gtkSpinnerMeta;
    }

    initialize(): void {
        this._spinner = document.createElement('gtk-spinner');
        this._apply();
        this.addContent(this._spinner);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._spinner) return;
        // `GtkSpinner` has no size property either; a box is what sizes it (gtkspinner.c:110-123).
        const size = String(this.args.size as number);
        this._spinner.style.width = `${size}px`;
        this._spinner.style.height = `${size}px`;
        if (this.args.spinning as boolean) (this._spinner as HTMLElement & { start(): void }).start();
        else (this._spinner as HTMLElement & { stop(): void }).stop();
        this._spinner.toggleAttribute('disabled', this.args.disabled as boolean);
    }
}

export const GtkSpinnerWebStories: WebStoryModule = { stories: [GtkSpinnerWebStory] };
