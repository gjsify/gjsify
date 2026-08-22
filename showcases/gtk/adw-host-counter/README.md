# adw-host-counter

A Libadwaita window built **entirely** through [`@gjsify/gtk-host`](../../../packages/framework/gtk-host) —
`createElement`, `insert`, `setProp`, `setEventHandler`. There is no `new Gtk.X()`
in the app source, on purpose: this is the shape a framework adapter emits, so a
window that can be built this way is a host a renderer can bind to.

```bash
gjsify run build:gjs && gjsify run start:gjs   # the window
gjsify run probe                               # the assertion
```

## The probe

`GJSIFY_HOST_PROBE=1` builds the same tree, asserts it against the **real** widget
tree (`get_first_child`/`get_next_sibling` — never the host's own bookkeeping),
prints `PROBE: PASS <json>` — including the GLib diagnostic count — and exits 0,
or `PROBE: FAIL <json>` and exits 1.

The same assertions also run on `activate`, before the window is shown, so the
existing `showcase-smoke` CI leg — which launches the app and waits — carries
them. Otherwise the probe would be a developer-only tool and the CI leg would
prove nothing beyond "it started".

It covers the seven things that are easy to get silently wrong:

1. a string enum nick (`orientation: 'vertical'`) reaches GTK — GObject drops it
   silently through both `set_property` and the JS setter;
2. slotted placement puts the header in the top bar and the page in the content;
3. an insert into `Adw.PreferencesGroup` lands in document order even though that
   container has no `insert()` and can only append;
4. removing a row takes out the right one and leaves the others in order;
5. a signal bound through the host fires and its property write lands;
6. a subtree materialised BEFORE it is inserted — what every framework does —
   replays into an append-only parent without detaching non-children or re-adding
   already-parented ones. Reproduced by review: this emitted four Adwaita
   criticals, at exit 0;
7. none of the above was reported to GLib. The probe installs its own writer func
   and counts every warning-or-worse, because `showcase-smoke`'s fatal patterns
   deliberately exclude GTK criticals — so a process that floods
   `Adwaita-CRITICAL` at exit 0 fails here and nowhere else.
