// The scroll EDGE behind an "end reached" callback — geometry, not a framework.
//
// This sat in `@gjsify/react-native`'s list controller until the extraction, and it had
// no business there: it is `Gtk.Adjustment` arithmetic with no React in it, and the next
// dialect to want an infinite list would have re-measured the same three facts. That is
// the failure `@gjsify/gtk-host/list` exists to prevent, one file over from where it was
// being prevented.
//
// Values through `gi://` — none needed here, since an adjustment arrives from the
// caller; types through `@girs/*`.

import type Gtk from '@girs/gtk-4.0';

/**
 * Call `listener` when the scroller gets within `threshold` page-lengths of the end.
 *
 * `Gtk.Adjustment`, because that is where GTK keeps a scroll position: the scrolled
 * window has no scroll signal of its own, and `notify::value` on the adjustment behind
 * `hadjustment`/`vadjustment` is the only place the position is observable. MEASURED: a
 * `Gtk.ScrolledWindow` hands out its adjustments with no window anywhere, and
 * `set_value` on one raised `notify::value` — so this is drivable, and asserted, in a
 * spec that presents nothing.
 *
 * `upper` and `page-size` are subscribed too, and not for completeness: `upper` grows
 * when rows are added, which is the event that ARMS the next call — a list that grew has
 * a new end.
 *
 * A list with nothing to scroll (`upper <= page-size`) never fires. That is the state
 * every list is in before it has been allocated, and firing there would call the
 * listener on mount for every list in the application.
 *
 * ONCE PER ARRIVAL, and this is the one policy here that came from a framework: it is
 * React Native's `onEndReached` semantics. It is the core's behaviour anyway because
 * every "load more" caller wants it — firing on every frame while the user rests at the
 * bottom would issue a page request per frame. A dialect that wants the raw stream has
 * the adjustment and can subscribe to it directly; this function is the debounced edge.
 */
export function onScrollNearEnd(
    scroller: Gtk.ScrolledWindow,
    axis: 'horizontal' | 'vertical',
    threshold: number,
    listener: (distanceFromEnd: number) => void,
): () => void {
    const adjustment = axis === 'horizontal' ? scroller.get_hadjustment() : scroller.get_vadjustment();
    let armed = true;
    const check = (): void => {
        const page = adjustment.get_page_size();
        const upper = adjustment.get_upper();
        if (upper <= page) {
            armed = true;
            return;
        }
        const distance = upper - page - adjustment.get_value();
        if (distance > threshold * page) {
            armed = true;
            return;
        }
        if (!armed) return;
        armed = false;
        listener(distance);
    };
    const handlers = [
        adjustment.connect('notify::value', check),
        adjustment.connect('notify::upper', check),
        adjustment.connect('notify::page-size', check),
    ];
    check();
    return () => {
        for (const handler of handlers) adjustment.disconnect(handler);
    };
}
