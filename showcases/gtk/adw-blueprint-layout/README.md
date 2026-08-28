# adw-blueprint-layout

Two Adwaita layout containers — **`Adw.HeaderBar`** and **`Adw.ToolbarView`** — declared entirely
in a `.blp` and loaded by a `.ts` that imports it, on **GJS, Node, Bun and Deno**, from one build
each and one source.

```bash
gjsify run build && gjsify run start:gjs   # the window
gjsify run probe                           # the assertions, on GJS
gjsify run probe:node                      # …the same file, on Node
gjsify run probe:bun                       # …and Bun
gjsify run probe:deno                      # …and Deno
```

## What only this showcase proves

[`canvas2d-fireworks`](../../dom/canvas2d-fireworks) already imports a `.blp` from a `.ts` and
declares all four runtimes, so the SHAPE ships. What it does not do is say anything about a
specific Adwaita layout widget: its template is an application window around a canvas, and its
assertions are about drawing. A documentation block for `Adw.ToolbarView` that promises *this*
tree from *this* `.blp` is a different claim, and the only way to hold it is to build the tree and
read it back.

## Two things that are measured here, not assumed

**Every Adwaita layout container is a FINAL type.** `template $X: Adw.HeaderBar` cannot work —
`GObject.registerClass` on a subclass of one fails with *"Cannot inherit from a final type"*.
Measured on libadwaita 1.9 / gjs 1.88.1: `AdwHeaderBar`, `AdwToolbarView`, `AdwStatusPage`,
`AdwNavigationView` and `AdwClamp` are final; `AdwBin`, `AdwWindow`, `AdwApplicationWindow`,
`AdwPreferencesGroup` and `AdwActionRow` are not. So both templates are rooted at `Adw.Bin` and
the widget the gallery is about is its `child:` — which is what libadwaita provides `Adw.Bin` for.

**A headless program has to call `Adw.init()` itself.** GtkBuilder resolves `Adw.HeaderBar` by
GType *name*, and a type nothing has touched is not registered. Without the call the template
build fails with `Invalid object type 'AdwHeaderBar'`, the internal children come back `null`, and
the only symptom is a null-property throw somewhere else. `Adw.Application` does this at startup,
which is why an application never meets it.

## The probe

`runHostProbeApp` from `@gjsify/gtk-host` owns the harness — the `GJSIFY_HOST_PROBE=1` env gate,
the GTK diagnostics collector, the `check()` recorder, the `PROBE: PASS|FAIL <json>` protocol and
the rule that the GUI path runs the same assertions before presenting. Nothing here touches
gtk-host's *renderer*: these are plain GObject classes built by GtkBuilder from the compiled
templates.

Every slot is asserted as **placement**, never as presence: `[top]` and `[bottom]` both put a bar
somewhere in the subtree, so a template with the two swapped passes a presence check while
rendering the chrome upside down. `pack_start`/`pack_end` and `add_top_bar`/`add_bottom_bar` are
write-only, so the readable counterpart is used instead — the `Gtk.CenterBox` libadwaita builds
inside every header bar, and the `top-bar`/`bottom-bar` style class it puts on the revealer around
each toolbar. Falsified both ways: swapping `[top]` and `[bottom]` fails on
`[bottom] reached add_bottom_bar`, and a one-letter change to the window title fails on
`title-widget: reached set_title_widget`.

Measured, all four runtimes, same bundle for the last three:
`PROBE: PASS {"diagnostics":0,"headerBar":46,"toolbarView":51}`.

## License

MIT
