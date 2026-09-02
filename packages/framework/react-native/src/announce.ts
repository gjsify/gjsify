// `accessibilityLiveRegion` → `Gtk.Accessible.announce()`, and the one GTK call it takes.
//
// L2 decided everything (`primitives/table.ts`' `AnnounceRoute`): which primitive can
// answer the prop, which signal reports that the content changed, which property
// carries the message, and which GTK priority each React Native level is. What is
// left here is the call — and it is here rather than in either L3 because BOTH
// bindings make it, and a copy in each is the second truth this layer keeps removing.
//
// WHY IT CONNECTS DIRECTLY AND IS NOT AN `on:<signal>` PROP, which is where this
// started and is a defect the obvious test does not catch. The host SUPPRESSES a
// `notify::` raised inside its own property write — module-wide, deliberately, and it
// is what stops a controlled `<TextInput>` re-entering `onChangeText`
// (`inHostWrite()` in gtk-host's `signals.ts`). A `<Text>`'s content IS a host write:
// the text sink writes `Gtk.Label:label`. So an announcement routed through the host's
// handler map fires on a change made from OUTSIDE React and NEVER on the one the
// application made — which is the only change a live region exists for. Measured:
// `label.label = 'x'` from a spec announced, and `root.render(<Text>x</Text>)` did
// not.
//
// The guard protects the APPLICATION from re-entering its own write. This layer's
// announcement has to fire precisely on that write, so it is subscribed the way
// `press.ts` subscribes a gesture and the list controller subscribes its factory:
// `widget.connect(...)` directly, with a disposer that really disconnects — GJS blocks
// a JS callback during the sweeping phase of GC, so a handler left connected is a
// handler connected for the life of the process.
//
// VALUES through `gi://`, types through `@girs/*`.
//
// MEASURED on gtk 4.22.4 / gjs 1.88.1: `announce` is a method on the `Gtk.Accessible`
// INTERFACE, so every widget has it; `Gtk.AccessibleAnnouncementPriority` is
// LOW/MEDIUM/HIGH; and the call is a no-op with no diagnostic when no screen reader
// is listening, which is what makes it safe to wire unconditionally.

import Gtk from 'gi://Gtk?version=4.0';

import { accessor } from './accessor.js';
import type { ResolvedAnnouncement } from './primitives/resolve.js';

/** L2's nick → the enum member. A record rather than a lookup by name, so a typo is a type error. */
const PRIORITY: Readonly<Record<ResolvedAnnouncement['priority'], Gtk.AccessibleAnnouncementPriority>> = {
    low: Gtk.AccessibleAnnouncementPriority.LOW,
    medium: Gtk.AccessibleAnnouncementPriority.MEDIUM,
    high: Gtk.AccessibleAnnouncementPriority.HIGH,
};

/** Live subscriptions, for the same reason `press.ts` counts its own: a spec seam. */
let watches = 0;

/**
 * How many elements are currently reporting their content changes to a screen reader.
 *
 * `accessibilityLiveRegion="none"` and an absent prop must subscribe to NOTHING, and
 * both render identically to one that does — only a count tells them apart.
 */
export const liveRegionWatchCount = (): number => watches;

/**
 * Announce `widget`'s own text whenever `announcement.signal` says it changed.
 *
 * Returns the unsubscribe. AN EMPTY MESSAGE IS NOT ANNOUNCED: a `Gtk.Label` passes
 * through `''` on its way between two strings when an application rebuilds its text,
 * and "say nothing" is what a screen reader should do with it — announcing it would
 * interrupt the user to say nothing at all.
 */
export function onLiveRegion(widget: Gtk.Widget, announcement: ResolvedAnnouncement): () => void {
    const priority = PRIORITY[announcement.priority];
    const read = accessor(announcement.read);
    const target = widget as Gtk.Widget & Record<string, unknown>;
    const handler = widget.connect(announcement.signal as 'notify', () => {
        const message = target[read];
        if (typeof message !== 'string' || message === '') return;
        widget.announce(message, priority);
    });
    watches += 1;
    return () => {
        widget.disconnect(handler);
        watches -= 1;
    };
}
