// SPDX-License-Identifier: MIT
// @gjsify/node-gi — Gtk.Template `<signal>` dispatch + CssName PARITY program.
//
// ONE unchanged GJS/gi:// source, run byte-identically on BOTH gjs (`gjs -m`) and
// node-gi (the gi://→requireGi twin the sibling test generates) — the GTK analog of
// the conformance golden-diff harness. Proves a composite-template
// `<signal name="clicked" handler="on_click"/>` dispatches to the registered
// instance's `on_click` method with `this` === the template widget, that the handler
// receives the emitter (arg 0, GJS signal convention), that a bound child is reachable
// via `this.<name>`, and that `CssName` is installed (gtk_widget_class_set_css_name →
// get_css_name()). Emits ONE deterministic JSON line to STDOUT (fixed key order) after
// the loop returns; the test asserts the parsed values AND gjs↔node-gi stdout parity.
//
// Reference: refs/gjs/modules/core/overrides/Gtk.js (TemplateBuilderScope /
// _createClosure semantics). Copyright (c) GNOME contributors, MIT/LGPLv2+.
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<interface>
  <template class="NodeGiSignalsBox" parent="GtkBox">
    <property name="orientation">vertical</property>
    <child>
      <object class="GtkLabel" id="title">
        <property name="label">Hello from a template</property>
      </object>
    </child>
    <child>
      <object class="GtkButton" id="btn">
        <property name="label">Click me</property>
        <signal name="clicked" handler="on_click"/>
      </object>
    </child>
  </template>
</interface>`;

let clickCount = 0;
let handlerThis = null;
let handlerArgCount = -1;
let handlerSawTitle = null;

const SignalsBox = GObject.registerClass(
    {
        GTypeName: 'NodeGiSignalsBox',
        Template: new TextEncoder().encode(XML),
        Children: ['title'],
        InternalChildren: ['btn'],
        CssName: 'nodegisignalsbox',
    },
    class SignalsBox extends Gtk.Box {
        on_click(...args) {
            clickCount += 1;
            handlerThis = this; // must be the template widget instance
            handlerArgCount = args.length; // emitter (GtkButton), then the signal's own params (none)
            handlerSawTitle = this.title ? this.title.label : null; // bound child reachable via `this`
        }
    },
);

const app = new Gtk.Application({
    application_id: 'eu.jumplink.NodeGiTemplateSignalsParity',
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});

const out = {};
app.connect('activate', () => {
    const widget = new SignalsBox();
    // Fire the button's `clicked` twice — the template-wired handler runs synchronously
    // inside emit; a second emit confirms the connection persists (not one-shot).
    widget._btn.emit('clicked');
    widget._btn.emit('clicked');
    out.clickCount = clickCount;
    out.thisIsWidget = handlerThis === widget;
    out.argCount = handlerArgCount;
    out.titleLabel = handlerSawTitle;
    out.cssName = widget.get_css_name();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        app.quit();
        return GLib.SOURCE_REMOVE;
    });
});

app.run([]); // top-level blocking run (no async wrapper — node-gtk #442 caveat)

// ONE deterministic JSON line, fixed key order → byte-identical on gjs and node-gi.
print(
    JSON.stringify({
        argCount: out.argCount,
        clickCount: out.clickCount,
        cssName: out.cssName,
        thisIsWidget: out.thisIsWidget,
        titleLabel: out.titleLabel,
    }),
);
