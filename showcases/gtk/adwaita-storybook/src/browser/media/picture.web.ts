// Browser port of the Picture story. Shares metadata with picture.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { pictureMeta } from '../../media/picture.meta.js';

export class PictureWebStory extends StoryElement {
    private _picture: HTMLElement | null = null;

    constructor() {
        super(PictureWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return pictureMeta;
    }

    initialize(): void {
        this._picture = document.createElement('gtk-picture');
        // The light DOM carries the content, because `GdkPaintable` is not a thing a document
        // has and `<gtk-picture>` is defined as the box that FITS one. A 320×180 inline SVG
        // gives the same non-square intrinsic ratio the GTK story's memory texture does.
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 320 180');
        svg.setAttribute('width', '320');
        svg.setAttribute('height', '180');
        svg.innerHTML =
            '<rect width="320" height="90" fill="rgb(48 64 160)"/><rect y="90" width="320" height="90" fill="rgb(144 192 160)"/>';
        this._picture.appendChild(svg);
        this._apply();
        this.addContent(this._picture);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._picture) return;
        const width = String(this.args.width as number);
        // 3:2 round a 16:9 child, matching the GTK story, so `cover` crops and `contain` bars.
        this._picture.style.width = `${width}px`;
        this._picture.style.height = `${Math.round((Number(width) * 2) / 3)}px`;
        // The ORDER is the C's: `keep-aspect-ratio` MAPS onto `content-fit`
        // (gtkpicture.c:1017-1021), so writing it afterwards would undo the control the reader
        // just moved. It goes first, and only when it is on.
        if (this.args.keepAspectRatio as boolean) this._picture.toggleAttribute('keep-aspect-ratio', true);
        this._picture.setAttribute('content-fit', this.args.contentFit as string);
        // A TRUE-defaulted boolean needs the STRING, not the presence: `can-shrink="false"` is
        // the only spelling of FALSE, and `canShrink` reads absent as TRUE (gtkpicture.c:554).
        this._picture.setAttribute('can-shrink', String(this.args.canShrink as boolean));
        this._picture.setAttribute('isolate-contents', String(this.args.isolateContents as boolean));
        this._picture.setAttribute('alternative-text', this.args.alternativeText as string);
    }
}

export const PictureWebStories: WebStoryModule = { stories: [PictureWebStory] };
