// @gjsify/devtools — live CSS dump + hot-swap (the Tier-3 substrate).
// Original implementation.

import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

/** Named CSS providers this devtools session installed on the default display. */
const providers = new Map<string, Gtk.CssProvider>();

/**
 * Install or replace a named `Gtk.CssProvider` on the default display at a
 * priority just above USER, so it overrides the app's baked styles. Re-applying
 * is free (no widget re-registration) — this is what makes live CSS iteration
 * (`gjsify serve` Tier 3) work. Returns false when there is no display.
 */
export function swapCss(name: string, css: string): boolean {
    const display = Gdk.Display.get_default();
    if (!display) return false;
    let provider = providers.get(name);
    if (!provider) {
        provider = new Gtk.CssProvider();
        Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_USER + 1);
        providers.set(name, provider);
    }
    provider.load_from_string(css);
    return true;
}

/** Remove a previously-installed named provider. Returns false if unknown. */
export function removeCss(name: string): boolean {
    const provider = providers.get(name);
    if (!provider) return false;
    const display = Gdk.Display.get_default();
    if (display) Gtk.StyleContext.remove_provider_for_display(display, provider);
    providers.delete(name);
    return true;
}

/** List the devtools-installed CSS provider names. */
export function dumpCss(): { providers: string[] } {
    return { providers: [...providers.keys()] };
}
