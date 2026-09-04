# `@gjsify/react-native` — the GTK measurements behind the layer's shape

The facts about GTK 4 that a re-read of `packages/framework/react-native` would
otherwise re-learn the hard way. Measured on **gjs 1.88.1 / GTK 4.22.4 /
libadwaita 1.9.3**. Moved out of [packages/framework/AGENTS.md](../packages/framework/AGENTS.md)
when that file reached its size cap; the rule there links here rather than restating
them, because a rule without its reason gets "simplified" back into the bug.

Design decisions: [ADR 0032](adr/0032-react-native-on-the-gtk-host.md),
[ADR 0036](adr/0036-third-party-react-native-surfaces.md),
[ADR 0039](adr/0039-react-native-prop-surface.md).

1. **`box.append(AdwDialog)` calls `g_error()`** → SIGABRT and a core dump (exit 134),
   not an exception a host can catch and not a warning a diagnostics gate can count.
   Measure it with the box ROOTED IN A WINDOW — a detached box accepts the append in
   silence at exit 0, so a re-test on a bare box "disproves" this. So `<Modal>` is a
   PORTAL: an element whose host node is not its parent node. It is `partial` since
   [ADR 0045](adr/0045-portal-placement-in-the-gtk-host.md) gave `@gjsify/gtk-host` a
   placement axis, and three more measurements shape that seam, all on libadwaita
   1.9.3 / GTK 4.22.4:

   - **presenting against a parent that is in NO window opens a separate `GtkWindow`,
     at exit 0.** `adw_dialog_present` finds no `AdwDialogHost` among the parent's
     ancestors and takes its documented `present_as_window` branch;
     `window.visibleDialog` stays null and nothing is logged. Every framework builds
     bottom-up, so this is the ORDINARY case at insert time, not an edge one. The host
     waits on `notify::root`, which fires on a grandchild box when the toplevel takes
     the subtree, and again on unroot.
   - **the close a host calls is `force_close`, never `close`.** With
     `can-close: false` — which is how `onRequestClose` is honoured, and what makes
     `visible` the only thing that dismisses a modal — `close()` returns FALSE, emits
     `close-attempt` and leaves the dialog on screen. `force_close()` closes it and
     emits `closed`. And `close()` on a dialog that was never presented is
     `Adwaita-CRITICAL **: Trying to close … that's not presented` where `force_close()`
     is silent, so the forced one also needs no "is it up?" probe.
   - **re-presenting an already-presented dialog for a different host is a CRITICAL,
     and the move does not happen.** `Cannot present … as it's already presented for
     …` plus `Gtk-WARNING **: Can't set new parent …`; the dialog stays in the first
     window. Close-then-present is the sequence that works, which is what the host does
     when a subtree moves between toplevels — measured, unrooting the parent leaves the
     dialog in the OLD window's host with `visibleDialog` still set. GTK never takes it
     down by itself, so the host closes the dialog when its anchor loses a toplevel: a
     subtree that is detached and never re-rooted would otherwise keep its sheet on
     screen in the window it left.
   - **`Gtk.Widget::map` on the dialog is the SHOWN moment, not the presented one**, and
     it fires once. `present()` against a window that has not been shown yet emits
     nothing; the emission arrives on the window's own `present()`. That is `onShow`.

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
