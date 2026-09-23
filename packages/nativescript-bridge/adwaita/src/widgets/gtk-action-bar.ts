// GtkActionBar — GTK's bottom bar for NativeScript: widgets packed from the start, from
// the end, and one in the centre.
//
// Renders a REAL NativeScript `GridLayout` of three columns — a horizontal start box, the
// centre widget, a horizontal end box — over the headerbar-toned surface libadwaita gives
// `actionbar > revealer > box`. NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034
// clause 1): libadwaita only styles it.
//
// THE PLACEMENT IS GtkBuildable's (gtkactionbar.c:220): `[start]` packs from the start,
// `[end]` from the end, `[center]` is the centre widget, and a child with no type packs
// from the start. There is NO `center-widget` slot: GTK has `set_center_widget` but no
// property of that name, so `Gtk.Builder` refuses a `.blp` writing `center-widget:`
// ("Invalid property: GtkActionBar.center-widget", measured on GTK 4.22). Packing from
// the end PREPENDS (`gtk_box_insert_child_after (end_box, child, NULL)`), so the first
// widget packed sits nearest the edge — the rule `AdwHeaderBar.pack_end` already follows.
//
// Reference: refs/gtk/gtk/gtkactionbar.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_toolbars.scss (GtkActionBar)
// Copyright (c) The GTK Team. LGPLv2.1+.

import type { View } from '@nativescript/core';
import { GridLayout, ItemSpec, StackLayout } from '@nativescript/core';

import { builderSlotsOf, resolveBuilderSlot } from './builder-slots.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';
import { xmlBoolean } from './xml-values.js';

/** The child types GtkBuildable honours (gtkactionbar.c:227-234). */
const ACTION_BAR_SLOTS = ['start', 'center', 'end'] as const;

export class GtkActionBar extends withSignals(GridLayout) {
    /** The names this widget's `_addChildFromBuilder` honours — see `./builder-slots.ts`. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(ACTION_BAR_SLOTS, 'start');

    private readonly _startBox: StackLayout;
    private readonly _endBox: StackLayout;
    private _centerWidget: View | null = null;
    private _revealed = true;

    constructor(props?: ConstructProps<GtkActionBar>) {
        super();

        this.className = 'adw-action-bar';
        // `star, auto, star`: the two boxes share what the centre leaves, so the centre
        // widget stays centred however unequal the two ends are — a `GtkCenterBox`.
        this.addColumn(new ItemSpec(1, 'star'));
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'auto'));

        const startBox = new StackLayout();
        startBox.orientation = 'horizontal';
        startBox.className = 'adw-action-bar-start';
        startBox.horizontalAlignment = 'left';
        GridLayout.setColumn(startBox, 0);
        this.addChild(startBox);
        this._startBox = startBox;

        const endBox = new StackLayout();
        endBox.orientation = 'horizontal';
        endBox.className = 'adw-action-bar-end';
        endBox.horizontalAlignment = 'right';
        GridLayout.setColumn(endBox, 2);
        this.addChild(endBox);
        this._endBox = endBox;

        applyConstructProps(this, props);
    }

    /** Pack a widget from the start — `gtk_action_bar_pack_start`, an append. */
    pack_start(view: View): void {
        this._startBox.addChild(view);
    }

    /** Pack a widget from the end — `gtk_action_bar_pack_end`, a PREPEND. */
    pack_end(view: View): void {
        this._endBox.insertChild(view, 0);
    }

    /** `gtk_action_bar_set_center_widget` — replaces the previous centre; `null` clears it. */
    set_center_widget(view: View | null): void {
        if (this._centerWidget) this.removeChild(this._centerWidget);
        this._centerWidget = view;
        if (view) {
            view.verticalAlignment = 'middle';
            GridLayout.setColumn(view, 1);
            this.addChild(view);
        }
    }

    /** The centre widget, or `null`. */
    get centerWidget(): View | null {
        return this._centerWidget;
    }

    /** The start box — what {@link pack_start} appends to. */
    get startBox(): StackLayout {
        return this._startBox;
    }

    /** The end box — what {@link pack_end} prepends to. */
    get endBox(): StackLayout {
        return this._endBox;
    }

    /** XML inflation — route a template's child through the packing API. */
    _addChildFromBuilder(name: string, view: View): void {
        switch (resolveBuilderSlot(name, ACTION_BAR_SLOTS, 'start')) {
            case 'center':
                this.set_center_widget(view);
                return;
            case 'end':
                this.pack_end(view);
                return;
            default:
                this.pack_start(view);
        }
    }

    /** `GtkActionBar:revealed` — whether the bar shows its contents. Default `true`. */
    get revealed(): boolean {
        return this._revealed;
    }

    set revealed(raw: boolean | string) {
        this._revealed = xmlBoolean(raw, this._revealed);
        this.visibility = this._revealed ? 'visible' : 'collapse';
    }
}
