// `Adw.SwipeTracker` is a real libadwaita class (a gesture helper, not a widget) that neither
// renderer ships. Pick a member that stays unshipped: this fixture once used
// `ApplicationWindow` and went stale when both renderers added it. Reading it must be a named
// refusal, not `undefined`: the whole defect this stage removes is an `undefined` widget
// class surfacing as `Class extends value undefined` somewhere else entirely.
import Adw from 'gi://Adw?version=1';

export const kind = typeof Adw.ActionRow;

export function reachAbsentMember(): unknown {
    return (Adw as unknown as Record<string, unknown>).SwipeTracker;
}
