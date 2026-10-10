// GtkFrame — a container that draws a border around its child, for NativeScript.
//
// One child, an optional `label`, and the frame look. The frame is a two-row
// `GridLayout`: the label above (collapsed while there is none) and the bordered
// child cell below. `Gtk.Frame`'s own `border` is a CSS name, so the look is the
// port's `.adw-frame` class; `label-widget` replaces the text label, and each of the
// two children is a SLOT (`child`, `label-widget`) the shared-tree builder names.
//
// WHAT IT DOES NOT DO: `label-xalign` and `shadow-type` (GTK 3) are not here; the label
// always sits at the leading edge and the border is one hairline.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss (frame, `.frame`)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, type View } from '@nativescript/core';
import { builderSlotsOf } from './builder-slots.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { AdwStyledLayoutBase } from './styled-layout-base.js';

export class GtkFrame extends AdwStyledLayoutBase {
    static readonly GTypeName: string = 'GtkFrame';

    static readonly builderSlots: readonly string[] = builderSlotsOf(['child', 'labelWidget', 'label-widget'], 'child');

    private readonly _labelCell: Label;
    private _labelWidget: View | null = null;
    private _label: string | null = null;
    private _child: View | null = null;

    constructor(props?: ConstructProps<GtkFrame>) {
        super();
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'auto'));
        this.addRow(new ItemSpec(1, 'star'));

        const label = new Label();
        label.className = 'adw-frame-label';
        label.visibility = 'collapse';
        GridLayout.setRow(label, 0);
        GridLayout.setColumn(label, 0);
        this.addChild(label);
        this._labelCell = label;

        this._restyle();
        applyConstructProps(this, props);
    }

    /** `Gtk.Frame:label` — the text above the border, `null` for none. */
    get label(): string | null {
        return this._label;
    }

    set label(value: string | null) {
        this._label = value ?? null;
        if (this._labelWidget) return;
        this._labelCell.text = this._label ?? '';
        this._labelCell.visibility = this._label ? 'visible' : 'collapse';
    }

    /** `Gtk.Frame:label-widget` — a widget in place of the text label. */
    get labelWidget(): View | null {
        return this._labelWidget;
    }

    set labelWidget(view: View | null) {
        const next = view ?? null;
        if (next === this._labelWidget) return;
        if (this._labelWidget) this.removeChild(this._labelWidget);
        this._labelWidget = next;
        if (next) {
            GridLayout.setRow(next, 0);
            GridLayout.setColumn(next, 0);
            this.addChild(next);
            this._labelCell.visibility = 'collapse';
        } else {
            this._labelCell.visibility = this._label ? 'visible' : 'collapse';
        }
    }

    set_label_widget(view: View | null): void {
        this.labelWidget = view;
    }

    /** `Gtk.Frame:child`. */
    get child(): View | null {
        return this._child;
    }

    set child(view: View | null) {
        const next = view ?? null;
        if (next === this._child) return;
        if (this._child) this.removeChild(this._child);
        this._child = next;
        if (next) {
            GridLayout.setRow(next, 1);
            GridLayout.setColumn(next, 0);
            this.addChild(next);
        }
    }

    set_child(view: View | null): void {
        this.child = view;
    }

    get_child(): View | null {
        return this._child;
    }

    _addChildFromBuilder(name: string, view: View): void {
        if (name === 'labelWidget' || name === 'label-widget') this.labelWidget = view;
        else this.child = view;
    }

    protected get _ownClass(): string {
        return 'adw-frame';
    }
}
