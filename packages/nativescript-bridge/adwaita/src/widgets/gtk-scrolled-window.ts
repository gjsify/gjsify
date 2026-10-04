// GtkScrolledWindow — a scrolling viewport around one child, for NativeScript.
//
// WRAPS A REAL NativeScript `ScrollView`: a one-cell `GridLayout` whose cell holds the
// `ScrollView`, and the child is the `ScrollView`'s `content`. A `ScrollView` scrolls on one
// axis where GTK scrolls on two, so `hscrollbar-policy` and `vscrollbar-policy` are folded
// into one `orientation` by `scrolled-window-policy.ts`, and the loss — a window scrolling
// both ways scrolls vertically only — is declared in the coverage ledger.
//
// `hscrollbar-policy: never` is what a `.blp` writes to keep a page from growing sideways
// (Learn6502's debugger and message console); on the vertical `ScrollView` that is already
// how the cross axis behaves, so the child wraps to the viewport width.
//
// WHAT IT DOES NOT DO. The scrollbar itself is the platform's, so `always`, `automatic` and
// `external` cannot be told apart — only `never` changes anything. `has-frame` is held but no
// frame is drawn, and the content-size, kinetic and overlay-scrolling knobs have nothing to
// reach; each is a name in `check-nativescript-widget-coverage.mjs`.
//
// Reference: refs/gtk gtk/gtkscrolledwindow.c (GtkScrolledWindow)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { GridLayout, ScrollView, type View } from '@nativescript/core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { builderSlotsOf } from './builder-slots.js';
import {
    DEFAULT_SCROLLBAR_POLICY,
    normalizePolicy,
    scrollOrientationFor,
    type GtkPolicyNick,
} from './scrolled-window-policy.js';
import { AdwSingleChildBase } from './single-child-base.js';
import { xmlBoolean } from './xml-values.js';

export class GtkScrolledWindow extends AdwSingleChildBase {
    /** `Gtk.ScrolledWindow:child` is the one destination, so it is also the fallback. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(['child'], 'child');

    private readonly _scroll = new ScrollView();
    private _hscrollbarPolicy: GtkPolicyNick = DEFAULT_SCROLLBAR_POLICY;
    private _vscrollbarPolicy: GtkPolicyNick = DEFAULT_SCROLLBAR_POLICY;
    private _hasFrame = false;

    constructor(props?: ConstructProps<GtkScrolledWindow>) {
        super();
        GridLayout.setColumn(this._scroll, 0);
        GridLayout.setRow(this._scroll, 0);
        this.addChild(this._scroll);
        this._applyOrientation();
        applyConstructProps(this, props);
    }

    /** `Gtk.ScrolledWindow:hscrollbar-policy` — a `Gtk.PolicyType`; defaults to `automatic`. */
    get hscrollbarPolicy(): GtkPolicyNick {
        return this._hscrollbarPolicy;
    }

    set hscrollbarPolicy(value: GtkPolicyNick) {
        this._hscrollbarPolicy = normalizePolicy(value, 'hscrollbar-policy');
        this._applyOrientation();
    }

    /** `Gtk.ScrolledWindow:vscrollbar-policy` — a `Gtk.PolicyType`; defaults to `automatic`. */
    get vscrollbarPolicy(): GtkPolicyNick {
        return this._vscrollbarPolicy;
    }

    set vscrollbarPolicy(value: GtkPolicyNick) {
        this._vscrollbarPolicy = normalizePolicy(value, 'vscrollbar-policy');
        this._applyOrientation();
    }

    /** `Gtk.ScrolledWindow:has-frame` — held and read back; no frame is drawn (see the header). */
    get hasFrame(): boolean {
        return this._hasFrame;
    }

    set hasFrame(raw: boolean | string) {
        this._hasFrame = xmlBoolean(raw, this._hasFrame);
    }

    protected _adopt(view: View): void {
        this._scroll.content = view;
    }

    protected _release(_view: View): void {
        this._scroll.content = null;
    }

    private _applyOrientation(): void {
        this._scroll.orientation = scrollOrientationFor(this._hscrollbarPolicy, this._vscrollbarPolicy);
    }
}
