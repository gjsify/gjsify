# 115. Full-colour icons on the web: one lookup in GThemedIcon order, a separate door

- Status: **Proposed**
- Date: 2026-10-15
- Deciders: Pascal Garber
- Related: [ADR 0034](0034-widget-vocabulary-convergence.md) § Amendment 18 (icons);
  `packages/web/adwaita-web/src/icon-theme.ts`, `src/icon-registry.ts`, `src/elements/gtk-image.ts`

## Context

Every icon in `@gjsify/adwaita-web` is a CSS mask filled with `currentColor`: the right model
for a symbolic icon, and the only one the package had. GTK draws two kinds of icon from the same
`icon-name`. A symbolic icon is recoloured with the foreground colour. A full-colour icon, such as
an application's `hicolor/scalable/apps/<app-id>.svg`, is drawn as it is.

`AdwAboutDialog`'s `application-icon` is the application ID by convention
(`refs/libadwaita/src/adw-about-dialog.c`). On the web that name is not a CSS token, so
`normalizeIconName` returned `''` for it. Even a registered glyph would have been masked to one
flat colour, and `.adw-about-dialog-icon` forced `background-color: currentColor` on the box.
An app that shows its own icon on GNOME showed `image-missing` in the browser.

`GtkImage` builds a `GThemedIcon` for its name without default fallbacks.
`g_themed_icon_update_names` (GLib `gio/gthemedicon.c`, not vendored under `refs/`) turns the name into a candidate list:
`X` becomes `[X, X-symbolic]` and `X-symbolic` becomes `[X-symbolic, X]`. Then
`gtk_icon_theme_lookup_icon` returns the first candidate the theme has, or `image-missing`. It
never returns NULL (`refs/gtk/gtk/gtkicontheme.c`, `choose_icon`).

## Decision

1. **One lookup, `src/icon-theme.ts`, in GThemedIcon order.** `<gtk-image>` and
   `isIconAvailable` both call it, so what is drawn and what is reported cannot drift apart.
   - `X` → registered colour `X`, else symbolic `X`.
   - `X-symbolic` → symbolic `X` if its glyph is in the cascade, else registered colour `X`.
   - Neither → `image-missing`.
   With no colour registration, every lookup ends exactly where it ended before.

2. **A separate door, `registerColorIcon(name, source)`.** `registerIcon(name, svg)` stays
   symbolic-only; it is published, and it already maps an un-suffixed name to the symbolic
   variant.
   - The key is the EXACT name, so reverse-DNS IDs work. It is a Map key, never a CSS class.
   - It throws on an empty or spaced name, and on `-symbolic`, `-symbolic-ltr` or `-symbolic-rtl`
     (GTK treats all three as symbolic files).
   - `source` is SVG source (DOMParser must yield an `<svg>` root) or a URL resolved against the
     document. Only `http:`, `https:`, `blob:`, `file:` and `data:image/` are accepted.
   - A registration notifies every mounted `<gtk-image>` to look up again, as GTK images do on
     the theme's `changed` signal. `registerIcon` notifies too, because a `-symbolic` request
     drawn from a colour fallback has no mask class the CSS could update.

3. **Colour rendering in the same box.** `<gtk-image>` stays the icon box. A colour hit adds the
   `adw-icon-color` class (deliberately outside the `adw-icon--` mask prefix) and an inline
   `background-image`. `_icon.scss` turns the mask and the `currentColor` fill off for that
   class. `.adw-about-dialog-icon` no longer sets `background-color` itself.

4. **Unsupported stays unsupported.** `Gtk.IconTheme.add_resource_path` and `add_search_path`
   remain records only. The web has no GResource and no file system to enumerate, and probing
   URLs asynchronously would draw something other than what GTK draws in the same frame.
   Registration is the only way a colour icon gets in.

## Consequences

- `AdwAboutDialog`, `GtkAboutDialog logo-icon-name` and every other `<gtk-image>` consumer draw a
  registered application icon in colour with no per-widget code.
- Browser specs (`src/icon-theme.spec.ts`) measure the computed style for three things: the colour
  path draws unmasked, a symbolic icon still masks, and an unknown name draws `image-missing`.
- `scripts/check-adwaita-icon-masks.mjs` is unchanged. It holds the compiled SYMBOLIC subset, and
  a colour icon is never compiled; app IDs normalize to `''` there and are ignored as before.
- NativeScript has the same gap: its `Adw.AboutDialog.applicationIcon` paints a text glyph
  (ADR 0034 § Amendment 18), and its icon theme resolves symbolic names only. Closing it is
  separate work.
