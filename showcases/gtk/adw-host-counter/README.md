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
prints `PROBE: PASS <json>` and exits 0, or `PROBE: FAIL <json>` and exits 1.

It covers the five things that are easy to get silently wrong:

1. a string enum nick (`orientation: 'vertical'`) reaches GTK — GObject drops it
   silently through both `set_property` and the JS setter;
2. slotted placement puts the header in the top bar and the page in the content;
3. an insert into `Adw.PreferencesGroup` lands in document order even though that
   container has no `insert()` and the policy declares `reorder: 'remove-all'`;
4. removing a row takes out the right one and leaves the others in order;
5. a signal bound through the host fires and its property write lands.
