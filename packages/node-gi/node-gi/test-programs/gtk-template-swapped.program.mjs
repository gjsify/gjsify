// SPDX-License-Identifier: MIT
// @gjsify/node-gi — Gtk.Template `swapped="true"` PARITY program.
//
// gjs does NOT support the `swapped` template-signal flag: GJS's TemplateBuilderScope
// `_createClosure` rejects it, GtkBuilder logs a non-fatal `Gtk-CRITICAL`
// ("Unsupported template signal flag \"swapped\""), and construction SUCCEEDS (the
// handler is simply not connected). node-gi's NodeGiScopeCreateClosure mirrors this
// exactly — it returns NULL + a GError, so GtkBuilder logs the same non-fatal critical
// and construction succeeds. This program proves that behavioural parity: on BOTH
// runtimes the widget CONSTRUCTS without throwing (threw:false). Only STDOUT is
// compared — the differing Gtk-CRITICAL text lands on STDERR (ignored, as in the
// conformance harness). (The template build aborts at the offending signal, so the
// child binding after it is undefined — the test deliberately does NOT emit, to keep
// this a clean check of the "swapped is rejected but non-fatal" semantics.)
//
// Reference: refs/gjs/modules/core/overrides/Gtk.js (_createClosure SWAPPED guard).
// Copyright (c) GNOME contributors, MIT/LGPLv2+.
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<interface>
  <template class="NodeGiSwappedBox" parent="GtkBox">
    <child>
      <object class="GtkButton" id="btn">
        <signal name="clicked" handler="on_click" swapped="true"/>
      </object>
    </child>
  </template>
</interface>`;

const SwappedBox = GObject.registerClass(
    {
        GTypeName: 'NodeGiSwappedBox',
        Template: new TextEncoder().encode(XML),
        InternalChildren: ['btn'],
    },
    class SwappedBox extends Gtk.Box {
        on_click() {
            // never connected: swapped is rejected, so no closure is created for it
        }
    },
);

const app = new Gtk.Application({
    application_id: 'eu.jumplink.NodeGiTemplateSwappedParity',
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});

const out = {};
app.connect('activate', () => {
    let threw = false;
    try {
        new SwappedBox(); // construction: swapped-rejection is a non-fatal Gtk-CRITICAL
    } catch {
        threw = true; // gjs/node-gi both keep it NON-fatal → this stays false
    }
    out.threw = threw;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        app.quit();
        return GLib.SOURCE_REMOVE;
    });
});

app.run([]);

print(JSON.stringify({ threw: out.threw === true }));
