// Browser port of the Link Button story. Shares metadata with link-button.meta.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { linkButtonMeta } from '../../buttons/link-button.meta.js';

export class LinkButtonWebStory extends StoryElement {
    private _button: HTMLElement | null = null;

    constructor() {
        super(LinkButtonWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return linkButtonMeta;
    }

    initialize(): void {
        this._button = document.createElement('gtk-link-button');
        this._apply();
        this.addContent(this._button);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._button) return;
        this._button.setAttribute('label', this.args.label as string);
        // `uri` last, because the element unsets `visited` as its side effect — the other
        // order would never show a visited link, exactly as on GTK.
        this._button.setAttribute('uri', this.args.uri as string);
        this._button.toggleAttribute('visited', this.args.visited as boolean);
    }
}

export const LinkButtonWebStories: WebStoryModule = { stories: [LinkButtonWebStory] };
