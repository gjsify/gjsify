// SPDX-License-Identifier: MIT
// @gjsify/node-gi — a CUSTOM registerClass'd widget used as a composite-template
// InternalChild has its JS CONSTRUCTOR run when GtkBuilder instantiates it.
//
// The bug this guards against (the Learn6502 app-gnome port wall): node-gi ran a
// registered class's JS constructor ONLY on a JS-side `new Sub()` (the makeClass
// new.target path). A GtkBuilder-built composite-template child (e.g. MainWindow's
// `<object class="GameConsole" id="gameConsole">`) is instantiated from C via
// g_object_new, so its ctor body never ran — `this._simulator = …` never executed,
// and `this._gameConsole.simulator` was `undefined`, crashing MainWindow.
//
// The fix (GJS parity, refs/gjs/gi/gobject.cpp): node-gi overrides the GObjectClass
// `constructor` vfunc (NodeGiConstructor). For a C/GtkBuilder-driven construction it
// runs the child's JS ctor on the canonical wrapper via the L1 construct callback
// (adopt mode). The JS-`new` path is unchanged (a latch skips the extra run).
//
// This asserts, on a real GtkBuilder template:
//   - the custom child's JS ctor RAN (plain-JS fields it set are visible)
//   - it ran EXACTLY ONCE (no double-run), incl. a plain `new Child()` (JS-`new`)
//   - the child carries its user prototype (a `get`/method resolves) — the USER_PROTO
//     that the old getTemplateChild wrapper lacked, now attached by the adopt ctor
//
// SELF-SKIPPING like gtk-template.test.mjs: needs a display + the Gtk-4.0 typelib,
// so the headless `npm test` / `test:gc` legs skip it; the `gtk-smoke` CI job runs it.
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

// The parent template embeds the custom child by its registered GTypeName.
const TEMPLATE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<interface>
  <template class="NodeGiCtorParent" parent="GtkBox">
    <property name="orientation">vertical</property>
    <child>
      <object class="NodeGiCtorChild" id="child"/>
    </child>
  </template>
</interface>`;

test('a custom template child gets its JS constructor run (GtkBuilder path)', { skip }, () => {
    // Count ctor runs to prove exactly-once (no double-run, no skip).
    let childCtorRuns = 0;

    // The custom child: its ctor body sets plain-JS state — the shape that was lost.
    const ChildWidget = GObject.registerClass(
        { GTypeName: 'NodeGiCtorChild' },
        class ChildWidget extends Gtk.Box {
            constructor(params) {
                super(params);
                childCtorRuns++;
                this._marker = 'ctor-ran'; // plain-JS field set IN the constructor body
                this._answer = 42;
            }
            // A user accessor + method — only reachable if the wrapper carries USER_PROTO.
            get marker() {
                return this._marker;
            }
            describe() {
                return `${this._marker}:${this._answer}`;
            }
        },
    );

    const ParentBox = GObject.registerClass(
        {
            GTypeName: 'NodeGiCtorParent',
            Template: new TextEncoder().encode(TEMPLATE_XML),
            InternalChildren: ['child'],
        },
        class ParentBox extends Gtk.Box {},
    );

    const app = new Gtk.Application({
        application_id: 'eu.jumplink.NodeGiCtorChild',
        flags: Gio.ApplicationFlags.NON_UNIQUE,
    });

    const results = {};
    let activateError = null;

    app.connect('activate', () => {
        try {
            const parent = new ParentBox();

            // The GtkBuilder-built internal child.
            const child = parent._child;
            results.childType = child != null ? native.getTypeName(unwrap(child)) : null;

            // THE CORE ASSERTIONS: the child's JS ctor ran, so its plain-JS fields exist.
            results.marker = child != null ? child.marker : undefined; // via get marker()
            results.markerField = child != null ? child._marker : undefined; // the expando
            results.answer = child != null ? child._answer : undefined;
            results.describe = child != null ? child.describe() : undefined; // user method
            results.isInstance = child instanceof ChildWidget;

            // Ctor-run count AFTER the template child was built (GtkBuilder path).
            results.runsAfterTemplate = childCtorRuns;

            // JS-`new` path still runs the ctor EXACTLY ONCE (no double-run via the vfunc).
            const direct = new ChildWidget();
            results.directMarker = direct.marker;
            results.runsAfterDirect = childCtorRuns;

            const win = new Gtk.ApplicationWindow({ application: app });
            win.set_child(parent);
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

    assert.equal(activateError, null, `activate handler threw: ${activateError && activateError.stack}`);
    assert.equal(status, 0, 'app.run([]) should exit 0');

    assert.equal(results.childType, 'NodeGiCtorChild', 'the template child is the registered custom type');

    // The JS constructor ran for the GtkBuilder-created child.
    assert.equal(results.markerField, 'ctor-ran', 'the ctor body ran: this._marker expando is set');
    assert.equal(results.answer, 42, 'the ctor body ran: this._answer expando is set');
    // USER_PROTO reachable: the get accessor + method resolve on the template child.
    assert.equal(results.marker, 'ctor-ran', 'get marker() resolves (USER_PROTO attached)');
    assert.equal(results.describe, 'ctor-ran:42', 'a user method runs against the template child');
    assert.equal(results.isInstance, true, 'the template child is an instanceof the JS class');

    // Exactly once for the template child; the JS-`new` adds exactly one more.
    assert.equal(results.runsAfterTemplate, 1, 'the template-child ctor ran EXACTLY once (no double-run)');
    assert.equal(results.directMarker, 'ctor-ran', 'a plain `new ChildWidget()` still runs its ctor');
    assert.equal(results.runsAfterDirect, 2, 'JS-`new` runs the ctor once more (no double-run on that path)');
});
