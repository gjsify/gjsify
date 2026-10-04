// Gtk.DrawingArea — a blank widget you paint on.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { drawingAreaMeta } from './drawing-area.meta.js';

/** Story: a Gtk.DrawingArea with a draw function and the size properties bound to args. */
export class DrawingAreaStory extends StoryWidget {
    private _box: Gtk.Box | null = null;
    private _area: Gtk.DrawingArea | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookDrawingArea' }, DrawingAreaStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(DrawingAreaStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...drawingAreaMeta, component: Gtk.DrawingArea.$gtype };
    }

    initialize(): void {
        this._area = new Gtk.DrawingArea();
        // The area paints itself: the draw function reads the widget's colour rather than a
        // hard-coded one, so the shape follows the theme in either renderer.
        this._area.set_draw_func((area, cr, width, height) => {
            // `get_color` is the function GTK's own documented draw_function reads
            // (gtkdrawingarea.c:88-104), so the shape follows the widget's own colour.
            const color = area.get_color();
            cr.setSourceRGBA(color.red, color.green, color.blue, color.alpha);
            cr.rectangle(0, 0, width, height);
            cr.fill();
            cr.setSourceRGBA(1 - color.red, 1 - color.green, 1 - color.blue, color.alpha);
            switch (this.args.shape) {
                case 'grid':
                    for (let x = 0; x < width; x += 16) {
                        cr.rectangle(x, 0, 8, height);
                        cr.fill();
                    }
                    break;
                case 'crosshair':
                    cr.rectangle(width / 2 - 1, 0, 2, height);
                    cr.rectangle(0, height / 2 - 1, width, 2);
                    cr.fill();
                    break;
                default:
                    cr.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, 2 * Math.PI);
                    cr.fill();
                    break;
            }
        });
        this._box = new Gtk.Box({ halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER });
        this._box.append(this._area);
        this._apply();
        this.addContent(this._box);
    }

    updateArgs(_args: StoryArgs): void {
        // A new size invalidates the picture GTK has of the area, and `queue_draw` is the
        // documented way to ask for the draw function again (gtkdrawingarea.c:127-129).
        this._area?.queue_draw();
        this._apply();
    }

    private _apply(): void {
        if (!this._area) return;
        this._area.content_width = this.args.contentWidth as number;
        this._area.content_height = this.args.contentHeight as number;
    }
}

GObject.type_ensure(DrawingAreaStory.$gtype);

export const DrawingAreaStories: StoryModule = { stories: [DrawingAreaStory] };
