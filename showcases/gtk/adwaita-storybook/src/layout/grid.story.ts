// Gtk.Grid — a table of cells filled row by row.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { gridMeta } from './grid.meta.js';

/** Story: a Gtk.Grid of four labels with its spacings, homogeneity and orientation bound to args. */
export class GridStory extends StoryWidget {
    private _grid: Gtk.Grid | null = null;
    private _cells: Gtk.Label[] = [];
    private _orientation: Gtk.Orientation | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookGrid' }, GridStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(GridStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...gridMeta, component: Gtk.Grid.$gtype };
    }

    initialize(): void {
        this._grid = new Gtk.Grid({
            hexpand: true,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });
        for (const text of ['Name', 'Value', 'Unit', 'editable']) {
            const cell = new Gtk.Label({ label: text, hexpand: true });
            cell.set_margin_top(6);
            cell.set_margin_bottom(6);
            cell.set_margin_start(6);
            cell.set_margin_end(6);
            this._cells.push(cell);
        }
        this._attach();
        this._apply();
        this.addContent(this._grid);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    /** `attach(child, -1, -1, 1, 1)` — what `Gtk.Builder` writes for a child with no position. */
    private _attach(): void {
        if (!this._grid) return;
        for (const cell of this._cells) this._grid.attach(cell, -1, -1, 1, 1);
    }

    private _apply(): void {
        if (!this._grid) return;
        const orientation =
            (this.args.orientation as string) === 'vertical' ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL;
        this._grid.columnSpacing = this.args.columnSpacing as number;
        this._grid.rowSpacing = this.args.rowSpacing as number;
        this._grid.columnHomogeneous = this.args.columnHomogeneous as boolean;
        this._grid.rowHomogeneous = this.args.rowHomogeneous as boolean;
        // A child is attached along the ORIENTATION at the moment it is added
        // (gtkgrid.c:493-507), so turning a filled grid around is re-attaching — which is
        // exactly what the browser renderer's `grid-auto-flow` change does for free.
        if (this._orientation !== null && this._orientation !== orientation) {
            for (const cell of this._cells) this._grid.remove(cell);
            this._attach();
        }
        this._grid.orientation = orientation;
        this._orientation = orientation;
    }
}

GObject.type_ensure(GridStory.$gtype);

export const GridStories: StoryModule = { stories: [GridStory] };
