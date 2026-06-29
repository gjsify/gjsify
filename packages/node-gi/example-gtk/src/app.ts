// SPDX-License-Identifier: MIT
//
// One Adwaita source, two runtimes — the @gjsify/node-gi GTK capstone.
//
// This file is BYTE-IDENTICAL input to both builds:
//   gjsify build src/app.ts --app gjs   → native `gi://` Gtk/Adw under GJS
//   gjsify build src/app.ts --app node  → `@gjsify/node-gi` under Node.js
//
// It is the GTK analog of the headless L3 capstone (../example): an UNCHANGED
// Libadwaita application that builds AND runs identically on GJS (native
// `gi://Gtk` / `gi://Adw`) and on Node (the node-gi engine). The `gi://` imports
// are rewritten by the bundler — kept native for `--app gjs`, routed to the
// node-gi L1 runtime (`requireGi`) for `--app node`. The `print` global is
// ambient under GJS and injected by `--globals auto` (the
// `@gjsify/node-gi/globals` shim) for the node build — NO `/register` import.
//
// It exercises everything the GTK layering milestone landed:
//   - Adw.Application (NON_UNIQUE) driving g_application_run under the libuv↔GLib
//     bridge (the loop co-pumps Node's event loop while run() blocks);
//   - a composite-template Adw.ApplicationWindow subclass (GObject.registerClass
//     with inline UI-XML Template + a bound `Children` child);
//   - Adwaita chrome inside the template: Adw.ToolbarView + Adw.HeaderBar +
//     Adw.WindowTitle over a Gtk.Label content;
//   - a Gtk.CssProvider applied display-wide + a CSS class added to a widget;
//   - a Gio.SimpleAction added to the app and activated programmatically.
//
// Every value printed below is DETERMINISTIC — no hostname, no varying paths, no
// dependence on signal-callback arguments (Node's node-gi omits the emitter as
// the first callback arg, so handlers only ever print closure-captured
// constants). Running either build prints the same fixed sequence of lines — the
// golden output asserted by `dual.e2e.mjs`.
//
// DUAL-SAFETY FINDING (composite-template child naming). A template child id MUST
// NOT collide with a real GObject property of the widget class. A child id
// `title` on this Adw.ApplicationWindow (which has a `title` string property)
// crashes BOTH runtimes — GJS with an uncatchable exception, node-gi with a fatal
// abort — because the bound-child accessor clashes with the property. The child
// here is therefore named `heading` (no GObject property of that name), so the
// bound child resolves cleanly on both. Likewise there is NO dual-safe way to
// read an introspected instance's GType name (`constructor.$gtype` is undefined
// on node-gi, `GObject.type_name_from_instance` is not marshallable,
// `constructor.name` differs), so the bound child is proved via property
// round-trips (`child: <template label>` then `title: <value we set>`), not by
// printing its type.

import GObject from 'gi://GObject?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';

// Inline composite-template UI-XML: an Adw.ApplicationWindow whose content is an
// Adw.ToolbarView carrying an Adw.HeaderBar (with an Adw.WindowTitle) above a
// Gtk.Label content. The label's id is `heading` (Children: ['heading']) so it is
// exposed as `win.heading` — deliberately NOT `title` (see the finding above).
// The <template class=…> MUST match the registered GTypeName.
const TEMPLATE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<interface>
  <template class="NodeGiGtkDualWindow" parent="AdwApplicationWindow">
    <property name="default-width">360</property>
    <property name="default-height">240</property>
    <property name="content">
      <object class="AdwToolbarView">
        <child type="top">
          <object class="AdwHeaderBar">
            <property name="title-widget">
              <object class="AdwWindowTitle">
                <property name="title">node-gi GTK dual</property>
              </object>
            </property>
          </object>
        </child>
        <property name="content">
          <object class="GtkLabel" id="heading">
            <property name="label">template</property>
          </object>
        </property>
      </object>
    </property>
  </template>
</interface>`;

// A composite-template window subclass. registerClass installs the template +
// binds the `heading` child in the new type's class_init; construction runs
// gtk_widget_init_template and exposes the bound child as `win.heading`. The
// class body is empty — the lifecycle is driven from `activate`, sidestepping
// vfunc chain-up. `new TextEncoder().encode(...)` yields the inline UI-XML bytes
// (TextEncoder is native on both GJS and Node).
const DualWindow = GObject.registerClass(
    {
        GTypeName: 'NodeGiGtkDualWindow',
        Template: new TextEncoder().encode(TEMPLATE_XML),
        Children: ['heading'],
    },
    class DualWindow extends Adw.ApplicationWindow {},
);

const app = new Adw.Application({
    application_id: 'eu.jumplink.NodeGiGtkDual',
    flags: Gio.ApplicationFlags.NON_UNIQUE, // no session-bus uniqueness round-trip
});

// A Gio.SimpleAction added to the app; its handler prints a closure-captured
// constant (never the callback args — those differ across runtimes). Activated
// programmatically from `activate` below.
const action = new Gio.SimpleAction({ name: 'hello' });
app.add_action(action);
action.connect('activate', () => {
    print('action: hello');
});

app.connect('activate', () => {
    try {
        print('activated');

        // The composite-template window. `application` is an object-typed
        // (G_TYPE_OBJECT) construct property.
        const win = new DualWindow({ application: app });

        // The bound template child, exposed as `win.heading`. Read its
        // template-defined label first (proves the binding + template parse), then
        // write a new value and read it back (proves a property round-trip on the
        // bound child).
        print(`child: ${win.heading.label}`);
        win.heading.label = 'hello';
        print(`title: ${win.heading.label}`);

        // CSS: a provider applied display-wide, then a class added to a widget,
        // asserted to have taken effect.
        const provider = new Gtk.CssProvider();
        provider.load_from_string('.node-gi-card { padding: 12px; background: #3584e4; }');
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
        win.heading.add_css_class('node-gi-card');
        print(`css: ${win.heading.has_css_class('node-gi-card') ? 'applied' : 'missing'}`);

        // Fire the action; its handler prints `action: hello`.
        action.activate(null);

        win.present();

        // Quit from a GLib timeout running INSIDE the loop → run() returns cleanly.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            print('quit');
            app.quit();
            return GLib.SOURCE_REMOVE;
        });
    } catch (error) {
        // Surface a failure as a deterministic line so the golden mismatch points
        // at the cause instead of hanging the loop.
        print(`activate-error: ${error instanceof Error ? error.message : String(error)}`);
        app.quit();
    }
});

print('gtk-dual: start');
app.run([]); // top-level blocking run (no async wrapper — the #442 caveat)
print('done');
