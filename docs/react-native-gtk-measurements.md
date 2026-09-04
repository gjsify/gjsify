# `@gjsify/react-native` — the GTK measurements behind the layer's shape

The facts about GTK 4 that a re-read of `packages/framework/react-native` would
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

6. **`Gtk.Accessible:accessible-role` is NOT construct-only** — the received wisdom,
   and the reason an application that reaches a finished widget through a ref has to
   drop `accessibilityRole` entirely. Measured on all eight widget classes this layer
   builds: the ParamSpec is `READABLE|WRITABLE` with no `CONSTRUCT_ONLY`, and a
   post-construction write STICKS (`new Gtk.Box()` reads GENERIC, an assignment of
   BUTTON reads back BUTTON). The GIR agrees — `construct-only="1"` appears 69 times
   in `Gtk-4.0.gir` and not on this property — and so does gtk-host's own
   `props.spec.ts`, which asserts `GtkButton`'s construct-only set is exactly
   `['css-name']`. GTK's own docs say "cannot be changed once set"; the flags are what
   GObject enforces. So the role is an ordinary property route, not an imperative call.

7. **Every accessible attribute is read out of ONE GValue type, and the wrong type is
   a critical at exit 0.** `Gtk.Accessible.update_property()`/`update_state()` read
   each attribute with a specific `g_value_get_*`; handed another type GTK emits a
   `GLib-GObject-CRITICAL`, RECORDS THE ATTRIBUTE ANYWAY, and carries on. Measured by
   writing every state through all three candidate types: `checked`/`pressed`/
   `selected`/`expanded` are `G_TYPE_INT` holding a tri-state, `busy`/`disabled`/
   `hidden` are `G_TYPE_BOOLEAN`, `visited` is an int, `invalid` is an int holding a
   `GtkAccessibleInvalidState`, and the string properties are `G_TYPE_STRING`. Two
   contradict the type the documentation reads like: a tri-state written through a
   `GtkAccessibleTristate` GValue raises `g_value_get_int: assertion
   'G_VALUE_HOLDS_INT (value)' failed`, and `visited` is an int among booleans.

8. **There is no way to read an accessible property's VALUE back in-process, so
   presence and quiet are asserted as a PAIR.** `Gtk.test_accessible_has_property()`
   / `has_state()` really do read the widget's `GtkATContext` — not a setter echo —
   but they answer set/not-set, and they answer `true` for a write that raised the
   critical in 7. The value-returning `gtk_test_accessible_check_property` is
   `introspectable="0"` (varargs), `Gtk.ATContext` exposes no reader, and there is no
   public getter. `has_role()` is the exception: it takes the role, so the ROLE is a
   real value check. Everything else is AT-SPI's to report, and every GTK CI leg runs
   with `GTK_A11Y=none`.
