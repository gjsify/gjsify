// `AdwApplicationWindow` is a real libadwaita widget (`adw-application-window` is a tag in
// gtk-host's GIR-derived table) that neither renderer ships. Reading it must be a named
// refusal, not `undefined`: the whole defect this stage removes is an `undefined` widget
// class surfacing as `Class extends value undefined` somewhere else entirely.
import Adw from 'gi://Adw?version=1';

export const kind = typeof Adw.ActionRow;

export function reachAbsentMember(): unknown {
    return (Adw as unknown as Record<string, unknown>).ApplicationWindow;
}
