# `@gjsify/react-native` — the GTK measurements behind the layer's shape

Five facts about GTK 4 that a re-read of `packages/framework/react-native` would
otherwise re-learn the hard way. Measured on **gjs 1.88.1 / GTK 4.22.4 /
libadwaita 1.9.3**. Moved out of [packages/framework/AGENTS.md](../packages/framework/AGENTS.md)
when that file reached its size cap; the rule there links here rather than restating
them, because a rule without its reason gets "simplified" back into the bug.

Design decisions: [ADR 0032](adr/0032-react-native-on-the-gtk-host.md),
[ADR 0036](adr/0036-third-party-react-native-surfaces.md),
[ADR 0039](adr/0039-react-native-prop-surface.md).

1. **`box.append(AdwDialog)` calls `g_error()`** → SIGABRT and a core dump, not an
   exception a host can catch and not a warning a diagnostics gate can count. So
   `<Modal>` is a PORTAL and stays `planned`: a `partial` there kills the process on
   the first render. Measure it with the box ROOTED IN A WINDOW — a detached box
   accepts the append in silence, so a re-test on a bare box "disproves" this and puts
   the primitive back.

2. **`onChangeText` binds `notify::text`, NOT `Gtk.Editable::changed`.**
   `gtk_editable_set_text` is a delete followed by an insert, so ONE write over
   existing text emits `changed` twice — `["", "abc"]`, an intermediate EMPTY string
   that a controlled input reads as the user clearing the field. `notify::text` gives
   `["abc"]`.

3. **Writing `css-classes` CLOBBERS the `.vertical`/`.horizontal` class
   `Gtk.Orientable` set itself**, so any node that writes a class re-adds its
   orientation one. That is ADR 0032 § 5's union rule with GTK as the other author.

4. **`Gtk.UriLauncher.launch` is NOT promisified** — `@girs/gtk-4.0`'s
   `Promise<boolean>` overload is a green type over a red runtime — and it never calls
   back at all for an unhandled scheme. So `openURL` gates on `can_launch` first.

5. **ADR 0032 § 6's `justify-between` → `Gtk.CenterBox` is refused** because the widget
   swap needs a child COUNT this layer lacks — no longer because of the placement
   policy: its three slots are setters, and `slotted.remove` is optional for those.
   `GtkOverlay` IS curated (slotted `set_child` plus `add_overlay`/`remove_overlay`) —
   a `View` becomes one when a CHILD is absolute.
