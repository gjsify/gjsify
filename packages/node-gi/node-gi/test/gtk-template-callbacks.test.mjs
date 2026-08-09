// SPDX-License-Identifier: MIT
// @gjsify/node-gi — Gtk.Template signal-callback + menu breadth smoke test.
//
// Task A (engine): proves a composite-template `<signal name="clicked"
// handler="on_click"/>` dispatches to the registered instance's `on_click` JS
// method, with `this` === the template widget instance (the canonical toggle-ref
// L1 proxy). The engine installs a generic GtkBuilderScope on the class via
// gtk_widget_class_set_template_scope (mirroring GJS's TemplateBuilderScope): when
// GtkBuilder (run by init_template) hits the `<signal>`, the scope's create_closure
// resolves the handler NAME to the instance's bound JS method and connects a closure
// dispatching to it. No per-name registration — any handler name auto-resolves from
// the class prototype, GJS-style.
//
// Task B (breadth): Gio.Menu (append / append_item+Gio.MenuItem / append_submenu /
// append_section), Gtk.MenuButton.set_menu_model, Gtk.PopoverMenu.new_from_model,
// Gio.SimpleAction + app.add_action, app.set_accels_for_action (GStrv). These are
// GObject methods + constructors the engine already marshals; this validates them
// end-to-end and closes any gap.
//
// SELF-SKIPPING: needs a display (DISPLAY / WAYLAND_DISPLAY) and the Gtk-4.0 /
// libadwaita typelibs, so the fast headless legs skip cleanly; the dedicated
// `gtk-smoke` CI job (Xvfb + GTK stack) runs it.
//
// Reference: refs/gjs/modules/core/overrides/Gtk.js (TemplateBuilderScope /
// _createClosure semantics), /usr/include/gtk-4.0/gtk/gtkbuilderscope.h.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi, unwrap } from '../gi.js';
import native from '../index.js';
import { haveDisplay } from './display-gate.mjs';

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

// A composite-template GtkBox subclass: a label child (id "title", public) and a
// button child (id "btn", internal) whose `clicked` signal is wired to the instance
// method `on_click` purely through the template's `<signal>` element.
const TEMPLATE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<interface>
  <template class="NodeGiCallbackBox" parent="GtkBox">
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

test('Gtk.Template <signal> dispatches to the instance JS method', { skip }, () => {
    // Captured from inside the handler to prove `this` identity + that the handler ran.
    let clickCount = 0;
    let handlerThis = null;
    let handlerSawTitle = null;

    const CallbackBox = GObject.registerClass(
        {
            GTypeName: 'NodeGiCallbackBox',
            Template: new TextEncoder().encode(TEMPLATE_XML),
            Children: ['title'],
            InternalChildren: ['btn'],
        },
        class CallbackBox extends Gtk.Box {
            on_click() {
                clickCount += 1;
                handlerThis = this; // must be the template widget instance
                // `this` is the FULL widget: a bound child + a user method are reachable.
                handlerSawTitle = this.title ? this.title.label : null;
                this.clickedExpando = true;
            }
        },
    );

    const app = new Gtk.Application({
        application_id: 'eu.jumplink.NodeGiGtkTemplateCallbacks',
        flags: Gio.ApplicationFlags.NON_UNIQUE,
    });

    let widget = null;
    let activateError = null;
    const results = {};

    app.connect('activate', () => {
        try {
            widget = new CallbackBox();
            results.widgetType = native.getTypeName(unwrap(widget));

            // Fire the button's `clicked` signal — the template-wired handler runs
            // synchronously inside emit.
            widget._btn.emit('clicked');
            // Emit a second time to confirm the connection persists (not one-shot).
            widget._btn.emit('clicked');

            results.clickCount = clickCount;
            results.handlerThisIsWidget = handlerThis === widget;
            results.handlerSawTitle = handlerSawTitle;
            results.expandoOnWidget = widget.clickedExpando === true;

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

    const status = app.run([]);

    assert.equal(activateError, null, `activate threw: ${activateError && activateError.stack}`);
    assert.equal(status, 0, 'app.run([]) should exit 0');
    assert.equal(results.widgetType, 'NodeGiCallbackBox', 'the instance is the registered type');

    // The template <signal> dispatched to on_click — twice, with the right `this`.
    assert.equal(results.clickCount, 2, 'on_click ran once per clicked emit (connection persists)');
    assert.equal(results.handlerThisIsWidget, true, '`this` in the handler IS the template widget');
    assert.equal(results.handlerSawTitle, 'Hello from a template', '`this` reaches the bound child');
    assert.equal(results.expandoOnWidget, true, 'a field set on `this` lands on the widget instance');
});

test('Gio.Menu model + Gtk.MenuButton / PopoverMenu / actions breadth', { skip }, () => {
    const app = new Gtk.Application({
        application_id: 'eu.jumplink.NodeGiGtkMenuBreadth',
        flags: Gio.ApplicationFlags.NON_UNIQUE,
    });

    let activateError = null;
    const results = {};

    app.connect('activate', () => {
        try {
            // Gio.SimpleAction + app.add_action + set_accels_for_action (GStrv).
            const quitAction = new Gio.SimpleAction({ name: 'quit' });
            let actionFired = false;
            quitAction.connect('activate', () => {
                actionFired = true;
            });
            app.add_action(quitAction);
            app.set_accels_for_action('app.quit', ['<Ctrl>q']);
            results.accels = app.get_accels_for_action('app.quit'); // GStrv round-trip
            quitAction.activate(null);
            results.actionFired = actionFired;

            // Gio.Menu: append, append_item (Gio.MenuItem), append_submenu, append_section.
            const menu = new Gio.Menu();
            menu.append('Quit', 'app.quit');

            const item = new Gio.MenuItem(); // Gio.MenuItem.new(label, detailed_action)
            item.set_label('About');
            item.set_detailed_action('app.about');
            menu.append_item(item);

            const submenu = new Gio.Menu();
            submenu.append('Sub A', 'app.subA');
            submenu.append('Sub B', 'app.subB');
            menu.append_submenu('More', submenu);

            const section = new Gio.Menu();
            section.append('Section item', 'app.sect');
            menu.append_section(null, section);

            results.menuItemCount = menu.get_n_items(); // append + append_item + submenu + section = 4
            results.submenuItemCount = submenu.get_n_items();

            // Gtk.MenuButton.set_menu_model — takes a GMenuModel (GObject arg marshalling).
            const menuButton = new Gtk.MenuButton();
            menuButton.set_menu_model(menu);
            const got = menuButton.get_menu_model();
            results.menuButtonModelSet = got != null;
            results.menuButtonModelIsMenu = got != null && unwrap(got) === unwrap(menu);

            // Gtk.PopoverMenu.new_from_model(menu) — static constructor taking the model.
            const popover = Gtk.PopoverMenu.new_from_model(menu);
            results.popoverIsWidget = popover != null && native.isGObjectHandle(unwrap(popover));
            results.popoverType = popover != null ? native.getTypeName(unwrap(popover)) : null;

            const win = new Gtk.ApplicationWindow({ application: app });
            win.set_child(menuButton);
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

    const status = app.run([]);

    assert.equal(activateError, null, `activate threw: ${activateError && activateError.stack}`);
    assert.equal(status, 0, 'app.run([]) should exit 0');

    // GStrv round-trips: we set ['<Ctrl>q'] and read back a one-element GStrv (GTK
    // canonicalises the accel string, e.g. '<Ctrl>q' → '<Control>q' — exact spelling
    // is GTK's, what matters is the array marshalled in AND out).
    assert.ok(
        Array.isArray(results.accels) &&
            results.accels.length === 1 &&
            typeof results.accels[0] === 'string' &&
            results.accels[0].toLowerCase().includes('q'),
        `set/get_accels_for_action round-trips (GStrv): got ${JSON.stringify(results.accels)}`,
    );
    assert.equal(results.actionFired, true, 'Gio.SimpleAction::activate fired via app.add_action');
    assert.equal(results.menuItemCount, 4, 'Gio.Menu append/append_item/append_submenu/append_section');
    assert.equal(results.submenuItemCount, 2, 'submenu carries its two items');
    assert.equal(results.menuButtonModelSet, true, 'Gtk.MenuButton.set_menu_model accepted the model');
    assert.equal(results.menuButtonModelIsMenu, true, 'get_menu_model returns the same Gio.Menu');
    assert.equal(results.popoverIsWidget, true, 'Gtk.PopoverMenu.new_from_model built a widget');
    assert.equal(results.popoverType, 'GtkPopoverMenu', 'new_from_model yields a GtkPopoverMenu');
});
