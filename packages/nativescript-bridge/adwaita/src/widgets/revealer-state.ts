// What `reveal-child` means for the revealed child — the pure half of `Gtk.Revealer`.
//
// No `@nativescript/core` import, so a spec reaches it off-device (the widget class cannot
// be imported there: its module evaluates the bare specifier).

/** The two `View.visibility` values a revealed child ever takes. */
export type RevealerChildVisibility = 'visible' | 'collapse';

/**
 * The `visibility` a child takes for `reveal-child`. `collapse`, not `hidden`: GTK's
 * unrevealed child contributes zero size, and `hidden` keeps the view's space.
 */
export function revealerChildVisibility(revealChild: boolean): RevealerChildVisibility {
    return revealChild ? 'visible' : 'collapse';
}
