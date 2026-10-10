// GtkDrawingArea — REFUSED where it cannot work, for NativeScript.
//
// `Gtk.DrawingArea` exists to hand a cairo context to `set_draw_func`. NativeScript has
// no 2D drawing surface in core: `@nativescript/canvas` is a separate native plugin this
// package does not depend on, and a cairo `Context` is not something it could be given. So
// the widget is CONSTRUCTIBLE — a template that places a drawing area still builds, with
// its `content-width` / `content-height` as a minimum size — and the one verb that cannot
// be honoured says so by name instead of leaving a blank rectangle nobody can explain.
//
// `set_draw_func` THROWS; `queue_draw` is a no-op because nothing was ever drawn.
//
// Reference: refs/gtk gtk/gtkdrawingarea.c (GtkDrawingArea)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { AdwStyledLayoutBase } from './styled-layout-base.js';
import { xmlNumber } from './xml-values.js';

/** What `set_draw_func` says; exported so a caller (and a spec) can recognise it. */
export const DRAWING_AREA_REFUSAL =
    'Gtk.DrawingArea.set_draw_func is not supported on NativeScript: there is no cairo context to ' +
    'draw into. Render through a NativeScript view (an Image, or @nativescript/canvas) instead.';

export class GtkDrawingArea extends AdwStyledLayoutBase {
    static readonly GTypeName: string = 'GtkDrawingArea';

    private _contentWidth = 0;
    private _contentHeight = 0;

    constructor(props?: ConstructProps<GtkDrawingArea>) {
        super();
        applyConstructProps(this, props);
    }

    /** `Gtk.DrawingArea:content-width` — the requested width, `0` for none. */
    get contentWidth(): number {
        return this._contentWidth;
    }

    set contentWidth(raw: number | string) {
        const value = Math.max(0, Math.trunc(xmlNumber(raw, this._contentWidth)));
        this._contentWidth = value;
        this.minWidth = value;
    }

    /** `Gtk.DrawingArea:content-height` — the requested height, `0` for none. */
    get contentHeight(): number {
        return this._contentHeight;
    }

    set contentHeight(raw: number | string) {
        const value = Math.max(0, Math.trunc(xmlNumber(raw, this._contentHeight)));
        this._contentHeight = value;
        this.minHeight = value;
    }

    /** `gtk_drawing_area_set_draw_func` — refused, see the header. */
    set_draw_func(_drawFunc: unknown): void {
        throw new Error(DRAWING_AREA_REFUSAL);
    }

    /** `gtk_widget_queue_draw` — nothing is ever drawn, so there is nothing to redraw. */
    queue_draw(): void {}
}
