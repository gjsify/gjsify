// GtkRevealer — shows or hides its child, for NativeScript.
//
// `reveal-child` is the whole behaviour: false collapses the child out of the layout (zero
// size, as GTK's revealer allocates nothing for an unrevealed child), true shows it. GTK
// animates the change by `transition-type`; NativeScript's CSS subset has no transform or
// animation, so the change is INSTANT, the compromise `AdwViewStack` and the bottom sheet
// already document. `transition-type` and `transition-duration` are therefore accepted,
// validated and read back — a `.blp` writes `transition-type: slide_up;` on every revealer —
// and drive nothing (`transition-type.ts`).
//
// THE CHILD'S `visibility` IS THE LEVER, not the revealer's own: `visibility` is also what
// a parent toggles to hide the whole widget, and a revealer that overwrote it would fight
// whoever hid it.
//
// Reference: refs/gtk gtk/gtkrevealer.c (GtkRevealer)
// Copyright (c) The GTK Team. LGPLv2.1+.

import type { View } from '@nativescript/core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { builderSlotsOf } from './builder-slots.js';
import { revealerChildVisibility } from './revealer-state.js';
import { AdwSingleChildBase } from './single-child-base.js';
import {
    DEFAULT_REVEALER_TRANSITION_DURATION,
    GTK_REVEALER_TRANSITIONS,
    transitionNick,
    type GtkRevealerTransitionNick,
} from './transition-type.js';
import { xmlBoolean, xmlNumber } from './xml-values.js';

/** Event name emitted when `reveal-child` changes. Mirrors GObject `notify::reveal-child`. */
export const NOTIFY_REVEAL_CHILD = 'notify::reveal-child';

export class GtkRevealer extends AdwSingleChildBase {
    /** `Gtk.Revealer:child` is the one destination, so it is also the fallback. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(['child'], 'child');

    private _revealChild = false;
    private _transitionType: GtkRevealerTransitionNick = 'slide-down';
    private _transitionDuration = DEFAULT_REVEALER_TRANSITION_DURATION;

    constructor(props?: ConstructProps<GtkRevealer>) {
        super();
        applyConstructProps(this, props);
    }

    /** `Gtk.Revealer:reveal-child` — whether the child is shown. Defaults to `false`, as in C. */
    get revealChild(): boolean {
        return this._revealChild;
    }

    set revealChild(raw: boolean | string) {
        const next = xmlBoolean(raw, this._revealChild);
        if (next === this._revealChild) return;
        this._revealChild = next;
        this._applyReveal();
        this.notify({ eventName: NOTIFY_REVEAL_CHILD, object: this });
    }

    /**
     * `Gtk.Revealer:child-revealed` — whether the child is FULLY shown. With no animation
     * there is no in-between, so it answers {@link revealChild} at once.
     */
    get childRevealed(): boolean {
        return this._revealChild;
    }

    /** `Gtk.Revealer:transition-type` — held and validated, never rendered (see the header). */
    get transitionType(): GtkRevealerTransitionNick {
        return this._transitionType;
    }

    set transitionType(value: GtkRevealerTransitionNick) {
        this._transitionType = transitionNick(value, GTK_REVEALER_TRANSITIONS, 'Gtk.RevealerTransitionType');
    }

    /** `Gtk.Revealer:transition-duration`, in ms — held, never rendered. */
    get transitionDuration(): number {
        return this._transitionDuration;
    }

    set transitionDuration(raw: number | string) {
        this._transitionDuration = Math.max(0, xmlNumber(raw, this._transitionDuration));
    }

    protected _adopt(view: View): void {
        super._adopt(view);
        this._applyReveal();
    }

    private _applyReveal(): void {
        const child = this.child;
        if (child) child.visibility = revealerChildVisibility(this._revealChild);
    }
}
