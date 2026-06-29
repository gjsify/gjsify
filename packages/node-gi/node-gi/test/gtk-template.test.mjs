// SPDX-License-Identifier: MIT
// @gjsify/node-gi — Gtk.Template composite-template smoke test (GTK milestone PR4).
//
// Proves an UNCHANGED GJS composite-template widget runs on Node via the engine:
// `GObject.registerClass({ GTypeName, Template, Children, InternalChildren,
// CssName }, class extends Gtk.Box {})` installs the template + binds children in
// the new type's class_init, the constructor runs gtk_widget_init_template, and
// the declared children are exposed on the instance (public `this.<name>`,
// internal `this._<name>`) as wrapped child widgets.
//
// What it exercises (the engine lift behind PR4):
//   - registerClass meta Template (inline UI-XML bytes) → gtk_widget_class_set_template
//   - Children/InternalChildren → gtk_widget_class_bind_template_child_full
//   - CssName → gtk_widget_class_set_css_name
//   - construction → gtk_widget_init_template (template tree instantiated)
//   - this.title / this._btn → gtk_widget_get_template_child, toggle-ref wrapped,
//     each a usable child widget (property get/set round-trips through the proxy)
//
// SELF-SKIPPING: needs a display (DISPLAY / WAYLAND_DISPLAY) and the Gtk-4.0
// typelib, so the fast headless `npm test` / `test:gc` legs skip it cleanly; the
// dedicated `gtk-smoke` CI job (Xvfb + GTK stack) runs it.
//
// Templates need GTK initialised (a display) — so the widget is CONSTRUCTED inside
// the app's `activate` (after gtk_init has run in startup). registerClass at the
// top of the body only registers the type; class_init (the set_template step)
// fires on first construction, inside activate. run() is called at the TOP LEVEL
// of the synchronous test body (the node-gtk #442 nested-checkpoint caveat) and
// the quit is driven from a GLib timeout running INSIDE the loop.
//
// Reference: refs/gjs/modules/core/overrides/Gtk.js (the Gtk.Template semantics
// mirrored here), /usr/include/gtk-4.0/gtk/gtkwidget.h (the class template API).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi, unwrap } from '../gi.js';
import native from '../index.js';

const haveDisplay = !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

let GObject;
let Gtk;
let Gio;
let GLib;
let loadError = null;
if (haveDisplay) {
  try {
    GLib = requireGi('GLib', '2.0');
    Gio = requireGi('Gio', '2.0');
    GObject = requireGi('GObject', '2.0');
    Gtk = requireGi('Gtk', '4.0');
  } catch (err) {
    loadError = err;
  }
}

const skip = !haveDisplay
  ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)'
  : loadError
    ? `Gtk-4.0 typelib unavailable: ${loadError.message}`
    : false;

// Inline composite-template UI-XML: a vertical GtkBox subclass carrying a labelled
// child (id "title", public) and a button child (id "btn", internal). The
// <template class=…> MUST match the registered GTypeName.
const TEMPLATE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<interface>
  <template class="NodeGiTemplateBox" parent="GtkBox">
    <property name="orientation">vertical</property>
    <property name="spacing">6</property>
    <child>
      <object class="GtkLabel" id="title">
        <property name="label">Hello from a template</property>
      </object>
    </child>
    <child>
      <object class="GtkButton" id="btn">
        <property name="label">Click me</property>
      </object>
    </child>
  </template>
</interface>`;

test('Gtk.Template composite template works on Node', { skip }, () => {
  // Register the templated subclass. class_init (set_template + bind children)
  // fires on first construction, below in activate.
  const TemplateBox = GObject.registerClass(
    {
      GTypeName: 'NodeGiTemplateBox',
      Template: new TextEncoder().encode(TEMPLATE_XML), // inline UI-XML bytes
      Children: ['title'],
      InternalChildren: ['btn'],
      CssName: 'nodegitemplatebox',
    },
    class TemplateBox extends Gtk.Box {
      // A user method to confirm the user prototype still composes with templates.
      titleText() {
        return this.title.label;
      }
    },
  );

  const app = new Gtk.Application({
    application_id: 'eu.jumplink.NodeGiGtkTemplate',
    flags: Gio.ApplicationFlags.NON_UNIQUE, // no session-bus uniqueness round-trip
  });

  const results = {};
  let activateError = null;

  app.connect('activate', () => {
    try {
      const widget = new TemplateBox();

      // The instance is the registered templated type.
      results.widgetType = native.getTypeName(unwrap(widget));

      // Public child: this.title is the bound GtkLabel, with its template label.
      results.title = widget.title;
      results.titleType = widget.title != null ? native.getTypeName(unwrap(widget.title)) : null;
      results.titleLabel = widget.title != null ? widget.title.label : null;
      results.titleViaUserMethod = widget.titleText();

      // Property round-trip through the wrapped child.
      widget.title.label = 'Updated from JS';
      results.titleLabelAfterSet = widget.title.label;

      // Internal child: this._btn is the bound GtkButton, with its template label.
      results.btn = widget._btn;
      results.btnType = widget._btn != null ? native.getTypeName(unwrap(widget._btn)) : null;
      results.btnLabel = widget._btn != null ? widget._btn.label : null;

      // CssName installed on the type via gtk_widget_class_set_css_name.
      results.cssName = widget.get_css_name();

      // Put the widget in a window + present, then quit from inside the loop.
      const win = new Gtk.ApplicationWindow({ application: app });
      win.set_child(widget);
      win.present();

      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
        app.quit();
        return GLib.SOURCE_REMOVE;
      });
    } catch (err) {
      activateError = err;
      app.quit();
    }
  });

  const status = app.run([]); // top-level blocking run (no async wrapper)

  assert.equal(activateError, null, `activate handler threw: ${activateError && activateError.stack}`);
  assert.equal(status, 0, 'app.run([]) should exit 0');

  assert.equal(results.widgetType, 'NodeGiTemplateBox', 'the instance is the registered type');

  // Public child exposed as this.title, a real GtkLabel with its template label.
  assert.notEqual(results.title, undefined, 'this.title should be defined');
  assert.notEqual(results.title, null, 'this.title should be a bound child, not null');
  assert.equal(results.titleType, 'GtkLabel', 'this.title is a Gtk.Label');
  assert.equal(results.titleLabel, 'Hello from a template', 'this.title carries its template label');
  assert.equal(results.titleViaUserMethod, 'Hello from a template', 'user method reads this.title');
  assert.equal(results.titleLabelAfterSet, 'Updated from JS', 'child property set/get round-trips');

  // Internal child exposed as this._btn, a real GtkButton with its template label.
  assert.notEqual(results.btn, null, 'this._btn should be a bound internal child, not null');
  assert.equal(results.btnType, 'GtkButton', 'this._btn is a Gtk.Button');
  assert.equal(results.btnLabel, 'Click me', 'this._btn carries its template label');

  // CssName took effect.
  assert.equal(results.cssName, 'nodegitemplatebox', 'CssName installed via set_css_name');
});
