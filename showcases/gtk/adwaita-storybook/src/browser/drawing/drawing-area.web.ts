// Browser port of the Drawing Area story. Shares metadata with drawing-area.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
// TYPE-ONLY: the draw function is installed imperatively, exactly as the GTK story
// installs its callback, so the element type is what the story needs to say — not a
// hand-written interface that would be a second copy of the API. The import erases.
import type { Gtk } from '@gjsify/adwaita-web';
import { drawingAreaMeta } from '../../drawing/drawing-area.meta.js';

export class DrawingAreaWebStory extends StoryElement {
    private _area: Gtk.DrawingArea | null = null;

    constructor() {
        super(DrawingAreaWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return drawingAreaMeta;
    }

    initialize(): void {
        this._area = document.createElement('gtk-drawing-area') as Gtk.DrawingArea;
        // The same three shapes the GTK draw function draws, on the same 2D context: the
        // element scales it by the device pixel ratio, so the numbers here are logical
        // pixels on both surfaces.
        const area = this._area;
        area.setDrawFunc((_area, cr, width, height) => {
            // The area paints itself in the widget's own colour, which is what
            // `gtk_widget_get_color` is for (gtkdrawingarea.c:98-101) — `currentColor` is
            // the browser's spelling of the same question.
            cr.fillStyle = 'currentColor';
            cr.globalCompositeOperation = 'source-over';
            cr.fillRect(0, 0, width, height);
            cr.globalCompositeOperation = 'difference';
            switch (this.args.shape) {
                case 'grid':
                    for (let x = 0; x < width; x += 16) cr.fillRect(x, 0, 8, height);
                    break;
                case 'crosshair':
                    cr.fillRect(width / 2 - 1, 0, 2, height);
                    cr.fillRect(0, height / 2 - 1, width, 2);
                    break;
                default:
                    cr.beginPath();
                    cr.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, 2 * Math.PI);
                    cr.fill();
                    break;
            }
            cr.globalCompositeOperation = 'source-over';
        });
        this._apply();
        this.addContent(this._area);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._area) return;
        this._area.setAttribute('content-width', String(this.args.contentWidth as number));
        this._area.setAttribute('content-height', String(this.args.contentHeight as number));
    }
}

export const DrawingAreaWebStories: WebStoryModule = { stories: [DrawingAreaWebStory] };
