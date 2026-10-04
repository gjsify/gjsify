// Browser port of the Image story. Shares metadata with image.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { imageMeta } from '../../media/image.meta.js';

export class ImageWebStory extends StoryElement {
    private _image: HTMLElement | null = null;

    constructor() {
        super(ImageWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return imageMeta;
    }

    initialize(): void {
        this._image = document.createElement('gtk-image');
        this._apply();
        this.addContent(this._image);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._image) return;
        // The GTK story casts the pixel count to a `Gtk.IconSize` enum, which does not exist on
        // this renderer — the web's icon box is sized in PIXELS by the same `size` attribute
        // `gtk-image.ts` documents, and the two agree at 16/32/48 because those are the enum's
        // own members in points.
        this._image.setAttribute('size', String(this.args.size as number));
        this._image.setAttribute('icon-name', this.args.iconName as string);
        this._image.toggleAttribute('disabled', this.args.disabled as boolean);
    }
}

export const ImageWebStories: WebStoryModule = { stories: [ImageWebStory] };
