// The press, when the press has to reach JavaScript — which is the exception.
//
// ADR 0032 § 7 is the rule this file lives beside rather than replaces: press
// styling is the GTK CSS `:active` pseudo-class, `active:opacity-70` costs nothing,
// and GTK animates the state itself with no re-render at all. That path does not come
// through here and must not start to: `pressWatchCount()` exists so a spec can hold
// the two apart, and `widgets.spec.ts` asserts that an element whose pressed
// appearance is purely `active:*` subscribes to NOTHING.
//
// What does come through here is the two cases where a callback is the only answer:
//
// 1. **`<Pressable>{({ pressed }) => …}</Pressable>`** — the P2 promise the support
//    table carried as a named refusal. MEASURED on gtk 4.22.4: `Gtk.Button` installs
//    no `active` property (its only two signals are `activate` and `clicked`), so the
//    press state is not something a prop route can read. It is a widget STATE FLAG:
//    `Gtk.StateFlags.ACTIVE` is 1, `Gtk.Widget::state-flags-changed` is a real signal
//    on every widget, and `set_state_flags(ACTIVE)` emitted it with the OLD flags as
//    its argument (128 → 129) while `get_state_flags()` answered the new ones. So the
//    signal says WHEN and the getter says WHAT — the same split `display.ts` has.
//
// 2. **`<TouchableWithoutFeedback>`** — no chrome, so no button, so no `clicked`.
//    MEASURED: `Gtk.GestureClick` emits `pressed`, `released`, `stopped` and
//    `unpaired-release`, and `Gtk.Widget` has `add_controller`/`remove_controller`.
//    A completed press is `released`.
//
// BOTH DISPOSERS REALLY DISCONNECT, and that is not tidiness. GJS blocks a JS
// callback during the sweeping phase of GC — measured in this milestone's own list
// work and written down in `@gjsify/gtk-host/list`'s controller, where a
// `Gtk.SignalListItemFactory` whose handlers were still connected when its view was
// collected printed six `Gjs-CRITICAL` lines and ran none of the callbacks. A handler
// that is not disconnected stays connected for the life of the process, and the
// diagnostics gate counts what that produces.
//
// Values through `gi://`, types through `@girs/*`.

import Gtk from 'gi://Gtk?version=4.0';

/** Live `state-flags-changed` subscriptions. A spec seam, and the cheap path's guard. */
let watches = 0;

/**
 * How many elements are currently reporting their press state to JavaScript.
 *
 * Exported for the specs, and it is the only way to assert the distinction ADR 0032
 * § 7 rests on: `<Pressable className="active:opacity-70">` must resolve to CSS and
 * subscribe to nothing, while `<Pressable>{({ pressed }) => …}</Pressable>` must
 * subscribe to exactly one thing. Both render, both look right, and only a count
 * tells them apart — which is why the cheap path would otherwise disappear quietly.
 */
export const pressWatchCount = (): number => watches;

/** Is this widget being pressed right now? */
const isPressed = (widget: Gtk.Widget): boolean => (widget.get_state_flags() & Gtk.StateFlags.ACTIVE) !== 0;

/**
 * Report `widget`'s press state to `listener` as it changes; returns the unsubscribe.
 *
 * The listener is called once immediately, because a subscriber that only hears about
 * CHANGES starts out disagreeing with the widget — and the first render of a
 * function child has to know whether the button is already down.
 */
export function onPressStateChange(widget: Gtk.Widget, listener: (pressed: boolean) => void): () => void {
    let last = isPressed(widget);
    const handler = widget.connect('state-flags-changed', () => {
        const pressed = isPressed(widget);
        // `state-flags-changed` fires for every flag — hover, focus, direction — and
        // only one of them is this subscription's business. Filtering here rather
        // than in the caller keeps a mouse moving across a button from re-rendering
        // React on every enter and leave.
        if (pressed === last) return;
        last = pressed;
        listener(pressed);
    });
    watches += 1;
    listener(last);
    return () => {
        widget.disconnect(handler);
        watches -= 1;
    };
}

/**
 * Add a `Gtk.GestureClick` to `widget` and call `listener` on `signal`; returns the removal.
 *
 * The controller is REMOVED and the handler disconnected, in that order: a controller
 * left on a widget outlives every JS reference to it, and its handler is then one of
 * the callbacks GJS blocks during GC.
 */
export function onGesture(widget: Gtk.Widget, signal: string, listener: () => void): () => void {
    const gesture = new Gtk.GestureClick();
    const handler = gesture.connect(signal, () => listener());
    widget.add_controller(gesture);
    return () => {
        widget.remove_controller(gesture);
        gesture.disconnect(handler);
    };
}
