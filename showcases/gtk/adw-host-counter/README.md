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

`runHostProbeApp` from `@gjsify/gtk-host` owns the harness: the
`GJSIFY_HOST_PROBE`-vs-`activate` split, the diagnostics gate, the `check()`
recorder and the `PROBE: PASS|FAIL <json>` line. This showcase supplies only its
own assertions. Seventy of this file's lines used to be that machinery, 58 of them
byte-identical to `solid-host-counter`'s copy — and both copies re-implemented the
GLib writer func `@gjsify/gtk-host/conformance` already exports, complete with the
missing-`MESSAGE` bug it exists to end.

`GJSIFY_HOST_PROBE=1` builds the same tree, asserts it against the **real** widget
tree (`get_first_child`/`get_next_sibling` — never the host's own bookkeeping),
prints `PROBE: PASS <json>` — including the GLib diagnostic count — and exits 0,
or `PROBE: FAIL <json>` and exits 1.

The same assertions also run on `activate`, before the window is shown, so the
existing `showcase-smoke` CI leg — which launches the app and waits — carries
them. That is structural now rather than a paragraph repeated per showcase:
`runHostProbeApp` is the whole `main`.

It covers the eight things that are easy to get silently wrong:

1. a string enum nick (`orientation: 'vertical'`) reaches GTK — GObject drops it
   silently through both `set_property` and the JS setter;
2. slotted placement puts the header in the top bar and the page in the content —
   read back through Adwaita's own `top-bar` style class, because the presence
   version passed with the header authored into `slot: 'bottom'`;
3. `slot: 'title'` really placed the header label — it was authored and never
   asserted here, exactly as it once was in the Solid sibling, so deleting the
   label left the probe green;
4. an insert into `Adw.PreferencesGroup` lands in document order even though that
   container has no `insert()` and can only append;
5. removing a row takes out the right one and leaves the others in order;
6. a signal bound through the host fires and its property write lands — emitted on GTK's
   side (`button.emit('clicked')`), because the earlier version called the closure and so
   passed with every `setEventHandler` call deleted;
7. a subtree materialised BEFORE it is inserted — what every framework does —
   replays into an append-only parent without detaching non-children or re-adding
   already-parented ones. Reproduced by review: this emitted four Adwaita
   criticals, at exit 0;
8. none of the above was reported to GLib. The harness counts every
   warning-or-worse, because `showcase-smoke`'s fatal patterns deliberately
   exclude GTK criticals — so a process that floods `Adwaita-CRITICAL` at exit 0
   fails here and nowhere else.

Before any of them, the harness asks whether its own `check()` still RECORDS a
failure. Every assertion above speaks through that one closure, so a recorder that
dropped its findings would turn the probe green with nothing to say, and no
assertion here could notice.
