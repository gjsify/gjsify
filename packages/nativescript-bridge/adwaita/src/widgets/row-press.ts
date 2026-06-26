// Adwaita activatable-row press feedback for NativeScript.
//
// NativeScript only auto-applies the `:highlighted` visual state to `Button` (its
// `button/index.android` sets it on touch-down → which the Adwaita button CSS keys
// the `:active` darken off). Adwaita's activatable boxed-list rows — `AdwButtonRow`,
// `AdwComboRow`, and the sidebar nav rows — are plain `GridLayout`s, so the same
// press-darken has to be wired by hand: a `touch` gesture listener adds the
// `highlighted` pseudo-class on `down` and removes it on `up`/`cancel`.
//
// The platform's touch-slop drives the cancel: when a row inside a `ScrollView`
// starts scrolling, Android dispatches `ACTION_CANCEL` to the child (surfaced as
// the `'cancel'` action), so a press-then-scroll clears the highlight instead of
// leaving it stuck — no manual move-threshold bookkeeping needed. The matching
// `*:highlighted` CSS lives in `theme/adwaita.css` (the Adwaita `:active` row shade,
// `$view_active_color` = currentColor 8%).
//
// This module imports only TYPES from `@nativescript/core`, so (unlike the widget
// classes that `extends GridLayout`) it carries no runtime `@nativescript/core`
// value import — it loads, and is unit-testable, off-device.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss (row.activatable:active)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { TouchGestureEventData, View } from '@nativescript/core';

/** The NS visual-state pseudo-class Adwaita keys its row `:active` shade off. */
const HIGHLIGHTED = 'highlighted';

/**
 * Wire Adwaita press-darken onto an activatable row: add the `highlighted`
 * pseudo-class while the row is held, clear it on release / scroll-cancel, so the
 * theme's `*:highlighted` rules apply. Call once per view (e.g. in the row's
 * constructor, or per generated sidebar row).
 */
export function attachRowPressFeedback(view: View): void {
    view.addEventListener('touch', (args: TouchGestureEventData) => {
        switch (args.action) {
            case 'down':
                view.addPseudoClass(HIGHLIGHTED);
                break;
            case 'up':
            case 'cancel':
                view.deletePseudoClass(HIGHLIGHTED);
                break;
            // 'move' — no state change; touch-slop + ScrollView interception drive
            // the eventual 'cancel' when the gesture turns into a scroll.
        }
    });
}
