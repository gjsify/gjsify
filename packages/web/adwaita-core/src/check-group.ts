// `GtkCheckButton:group`, renderer-free: which check buttons share a group, and whether a button
// is drawn as a radio. A port keeps `active` on its own widget and asks this module two things —
// whom to deactivate when one becomes active, and whether a user activation may turn it off.
//
// What C does, and this keeps:
//   · `set_group (self, group)` puts `self` into `group`'s group and makes BOTH radios; `set_group
//     (self, NULL)` takes `self` out and makes only `self` a check again (gtkcheckbutton.c:1088-1144).
//   · Joining changes no `active`: two active buttons stay active until one is set again.
//   · `set_active (self, TRUE)` deactivates every member first, then activates `self` (:955-973).
//   · A user activation of the active member of a group does nothing (:395-396, :617-622).
//
// One divergence, deliberate: C relinks `self` without unlinking it from a group it was already
// in, which leaves the old neighbours pointing at it. Here a button is in one group at a time.
//
// STATE LIVES IN WEAKMAPS keyed by the port's widget, so a dropped widget leaves nothing behind.
//
// Reference: refs/gtk/gtk/gtkcheckbutton.c (gtk_check_button_set_group, set_active, real_activate)
// Copyright (c) The GTK Team. LGPLv2.1+.

const GROUPS = new WeakMap<object, Set<object>>();
const RADIOS = new WeakSet<object>();

/** `gtk_check_button_set_group`: `self` joins `group`'s group, or leaves its own for `null`. */
export function setCheckGroup(self: object, group: object | null): void {
    if (self === group) throw new Error('Gtk.CheckButton: a check button cannot be its own group');
    const current = GROUPS.get(self);
    if (group === null) {
        current?.delete(self);
        GROUPS.delete(self);
        RADIOS.delete(self);
        return;
    }
    let members = GROUPS.get(group);
    if (members !== undefined && members === current) return;
    current?.delete(self);
    if (members === undefined) {
        members = new Set([group]);
        GROUPS.set(group, members);
    }
    members.add(self);
    GROUPS.set(self, members);
    RADIOS.add(self);
    RADIOS.add(group);
}

/** The other members of `self`'s group, in the order they joined; empty when it has none. */
export function checkGroupNeighbours<T extends object>(self: T): T[] {
    return [...(GROUPS.get(self) ?? [])].filter((member) => member !== self) as T[];
}

/** Whether GTK draws `self` as a radio: it joined a group, or a group was joined to it. */
export function isRadioCheck(self: object): boolean {
    return RADIOS.has(self);
}

/** Whether a user activation may flip `self`: never off while it is the active member of a group. */
export function checkActivationFlips(self: object, active: boolean): boolean {
    return !(active && checkGroupNeighbours(self).length > 0);
}
