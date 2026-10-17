// The accessible name and description of a widget whose ROLE lives on an inner control.
//
// A `.blp`'s `accessibility { label: …; description: …; }` reaches this renderer as the host's
// `aria-label` / `aria-description` (`shared-tree-builder.ts`). Where the host itself carries
// the role that is the whole door. `<gtk-button>` and `<gtk-check-button>` do not: the role is
// on the inner `<button>` / `<input>`, and an `aria-label` on a role-less host is one no
// assistive technology reads. Those elements observe both attributes and copy them onto the
// control here, so `GTK_ACCESSIBLE_PROPERTY_LABEL` lands where GTK's lands: on the widget that
// is announced.
//
// Reference: refs/gtk/gtk/gtkaccessible.c (gtk_accessible_update_property)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

/** The `accessibility { }` names a host forwards: `label` and `description`, as ARIA spells them. */
export const FORWARDED_ARIA = ['aria-label', 'aria-description'] as const;

/**
 * Copies the host's {@link FORWARDED_ARIA} attributes onto `control`, removing what the host
 * no longer has. Returns whether the host named the control, so a caller with a fallback name
 * of its own (an icon-only button) writes that only where the tree wrote none.
 */
export function forwardAccessibleName(host: Element, control: Element): boolean {
    for (const name of FORWARDED_ARIA) {
        const value = host.getAttribute(name);
        if (value === null) control.removeAttribute(name);
        else control.setAttribute(name, value);
    }
    return host.hasAttribute('aria-label');
}
