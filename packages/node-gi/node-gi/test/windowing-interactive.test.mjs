// SPDX-License-Identifier: MIT
// @gjsify/node-gi — INTERACTIVE-window proof (GTK-GUI-on-node-gi, increment 2).
//
// The step BEYOND the static construct+render proof (windowing.test.mjs): a real
// Adw.ApplicationWindow RESPONDS TO INPUT through the full GTK signal/action/event
// chain via node-gi. Two tiers, robust on a runner whose surface may or may not
// realize:
//
//   MINIMUM (always asserted) — the interactivity chain. A `Gio.SimpleAction` added
//   to the WINDOW (`win.add_action`) and a `Gtk.Button::clicked` signal both dispatch
//   into JS, mutate a counter, and the OBSERVABLE widget state changes: the window
//   title, the `Adw.WindowTitle` subtitle and an `Adw.ActionRow` subtitle. This holds
//   even if the platform surface never realizes — GAction activation + a synchronous
//   `emit('clicked')` are display-independent. It exercises the exact path the
//   `@gjsify/devtools` `ActivateAction` DBus method drives (`win.activate_action`):
//   GTK signal/action → node-gi signal dispatch → JS handler → widget setter.
//
//   STRONGER (asserted WHEN the surface realizes) — the window realizes + RENDERS a
//   surface through the GSK renderer (the same in-process capture @gjsify/devtools'
//   Screenshot uses), so a non-empty PNG proves the interactive UI rasterised.
//
// PLATFORM-AWARE DISPLAY GATE (identical to windowing.test.mjs): win32/darwin have an
// implicit display; Linux keys off DISPLAY/WAYLAND_DISPLAY (real session or Xvfb).
// On Windows CI the action-activate + state-assert path works headless (no visible
// desktop needed) — same as the render-to-texture screenshot.
//
// run() is called at the TOP LEVEL of a synchronous test body so the node-gtk #442
// nested-microtask-checkpoint caveat does not bite; the drive + capture + quit run
// INSIDE the loop, from the activate handler / a GLib timeout.
//
// Reference: refs/gjs (g_application_run, Gio.SimpleAction / GActionMap), refs/
// libadwaita (ToolbarView / HeaderBar / WindowTitle / PreferencesGroup / ActionRow),
// @gjsify/devtools screenshot.ts. Copyright (c) GNOME contributors, MIT/LGPL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';
import { haveDisplay } from './display-gate.mjs';

let Adw;
let Gtk;
let Gdk;
let Gio;
let GLib;
let Graphene;
let loadError = null;
if (haveDisplay) {
    try {
        GLib = requireGi('GLib', '2.0');
        Gio = requireGi('Gio', '2.0');
        Gdk = requireGi('Gdk', '4.0');
        Gtk = requireGi('Gtk', '4.0');
        Adw = requireGi('Adw', '1');
        Graphene = requireGi('Graphene', '1.0');
    } catch (err) {
        loadError = err;
    }
}

const skip = !haveDisplay
    ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)'
    : loadError
      ? `Gtk-4.0 / Adw-1 / Graphene-1.0 typelib unavailable: ${loadError.message}`
      : false;

// The @gjsify/devtools GSK capture path, inline (see windowing.test.mjs).
function captureWidgetPng(widget) {
    const native = widget.get_native();
    const renderer = native ? native.get_renderer() : null;
    if (!renderer) return null;
    const width = widget.get_width();
    const height = widget.get_height();
    if (width <= 0 || height <= 0) return null;
    const paintable = Gtk.WidgetPaintable.new(widget);
    const snapshot = Gtk.Snapshot.new();
    paintable.snapshot(snapshot, width, height);
    const node = snapshot.to_node();
    if (!node) return null;
    const viewport = new Graphene.Rect();
    viewport.init(0, 0, width, height);
    const texture = renderer.render_texture(node, viewport);
    const bytes = texture.save_to_png_bytes();
    const data = bytes ? bytes.get_data() : null;
    return data && data.length > 0 ? data : null;
}

// DumpTree primitive: every widget TYPE in the tree (structural — no realized filter).
function collectTypes(widget, out) {
    out.push(widget.get_name());
    let child = widget.get_first_child();
    while (child) {
        collectTypes(child, out);
        child = child.get_next_sibling();
    }
}

test('Adw window responds to a Gio action + a Gtk.Button::clicked on node-gi', { skip }, () => {
    const app = new Adw.Application({
        application_id: 'eu.jumplink.NodeGiInteractive',
        flags: Gio.ApplicationFlags.NON_UNIQUE,
    });

    let activated = false;
    let activateError = null;
    let pngLength = 0;
    let allocatedWidth = 0;
    let allocatedHeight = 0;

    // OBSERVABLE state snapshots (read from the WIDGETS, not the JS counter) after each
    // trigger — the GetProperty tier. Each is `<title>|<windowTitle subtitle>|<row subtitle>`.
    const states = {};
    const chrome = { windowTitle: false, actionRow: false, button: false, toolbarView: false };

    app.connect('activate', () => {
        try {
            activated = true;

            let count = 0;
            const win = new Adw.ApplicationWindow({ application: app });
            win.set_default_size(480, 360);

            const windowTitle = new Adw.WindowTitle({ title: 'node-gi', subtitle: '0 clicks' });
            const header = new Adw.HeaderBar();
            header.set_title_widget(windowTitle);

            const countRow = new Adw.ActionRow({ title: 'Clicks', subtitle: '0' });
            const group = new Adw.PreferencesGroup();
            group.add(countRow);

            const incrementButton = new Gtk.Button({ label: 'Increment' });
            const resetButton = new Gtk.Button({ label: 'Reset' });

            const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 18 });
            box.append(group);
            box.append(incrementButton);
            box.append(resetButton);

            const toolbar = new Adw.ToolbarView();
            toolbar.add_top_bar(header);
            toolbar.set_content(box);
            win.set_content(toolbar);

            // ONE state-mutation path; every trigger funnels through the action handlers.
            const render = () => {
                const label = count === 1 ? '1 click' : `${count} clicks`;
                windowTitle.set_subtitle(label);
                countRow.set_subtitle(String(count));
                win.set_title(`node-gi — ${label}`);
            };
            const increment = new Gio.SimpleAction({ name: 'increment' });
            increment.connect('activate', () => {
                count += 1;
                render();
            });
            win.add_action(increment);
            const reset = new Gio.SimpleAction({ name: 'reset' });
            reset.connect('activate', () => {
                count = 0;
                render();
            });
            win.add_action(reset);
            incrementButton.connect('clicked', () => win.activate_action('increment', null));
            resetButton.connect('clicked', () => win.activate_action('reset', null));

            render();
            win.present();

            // Read the OBSERVABLE state off the widgets.
            const snapshot = () => `${win.get_title()}|${windowTitle.get_subtitle()}|${countRow.get_subtitle()}`;

            // Drive the chain SYNCHRONOUSLY (GAction activate + button clicked are synchronous
            // dispatch — no main loop / surface needed).
            states.initial = snapshot(); // 0

            // (a) the Gio.SimpleAction on the window — the devtools ActivateAction path.
            win.activate_action('increment', null);
            win.activate_action('increment', null);
            states.afterTwoActions = snapshot(); // 2

            // (b) the Gtk.Button::clicked signal → JS → win.activate_action('increment').
            incrementButton.emit('clicked');
            states.afterButton = snapshot(); // 3

            // (c) a second action resets the state.
            win.activate_action('reset', null);
            states.afterReset = snapshot(); // 0

            // Structural chrome proof (DumpTree).
            const types = [];
            collectTypes(win, types);
            chrome.windowTitle = types.includes('AdwWindowTitle');
            chrome.actionRow = types.includes('AdwActionRow');
            chrome.button = types.includes('GtkButton');
            chrome.toolbarView = types.includes('AdwToolbarView');

            // Strong tier: retry the GSK capture across frames, then quit.
            let waitedMs = 0;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                waitedMs += 50;
                const png = captureWidgetPng(win);
                if (png) {
                    pngLength = png.length;
                    allocatedWidth = win.get_width();
                    allocatedHeight = win.get_height();
                    app.quit();
                    return GLib.SOURCE_REMOVE;
                }
                if (waitedMs >= 5000) {
                    allocatedWidth = win.get_width();
                    allocatedHeight = win.get_height();
                    app.quit();
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
        } catch (err) {
            activateError = err;
            app.quit();
        }
    });

    const status = app.run([]);

    assert.equal(activateError, null, `activate threw: ${activateError && activateError.stack}`);
    assert.ok(activated, 'the app never activated');
    assert.equal(status, 0, `app.run() exit status was ${status}, expected 0`);

    // MINIMUM (always): the interactivity chain drove the OBSERVABLE widget state.
    assert.equal(states.initial, 'node-gi — 0 clicks|0 clicks|0', 'initial widget state');
    assert.equal(
        states.afterTwoActions,
        'node-gi — 2 clicks|2 clicks|2',
        'Gio.SimpleAction activate → ::activate handler → widgets (2×)',
    );
    assert.equal(
        states.afterButton,
        'node-gi — 3 clicks|3 clicks|3',
        'Gtk.Button::clicked → JS → win.activate_action → widgets',
    );
    assert.equal(states.afterReset, 'node-gi — 0 clicks|0 clicks|0', 'reset action → widgets');

    // Structural chrome (DumpTree) — valid even if the surface never realizes.
    assert.ok(chrome.toolbarView, 'AdwToolbarView missing from the widget tree');
    assert.ok(chrome.windowTitle, 'AdwWindowTitle missing from the widget tree');
    assert.ok(chrome.actionRow, 'AdwActionRow missing from the widget tree');
    assert.ok(chrome.button, 'GtkButton missing from the widget tree');

    // STRONGER (when the surface realizes): a non-empty GSK-rendered PNG.
    if (allocatedWidth > 0 && allocatedHeight > 0) {
        assert.ok(
            pngLength > 0,
            `window realized (${allocatedWidth}x${allocatedHeight}) but the GSK capture was empty`,
        );
        console.log(
            `interactive: rendered ${allocatedWidth}x${allocatedHeight} → ${pngLength}-byte PNG (strong proof)`,
        );
    } else {
        console.log('interactive: surface did not realize — interactivity + DumpTree proof only');
    }
});
