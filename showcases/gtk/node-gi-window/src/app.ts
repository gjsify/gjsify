// SPDX-License-Identifier: MIT
//
// GTK-GUI-on-node-gi proof — increment 2: an INTERACTIVE Libadwaita application
// whose SINGLE source builds AND runs on both GJS and Node.js, and RESPONDS TO INPUT
// through the full GTK signal/action/event chain via node-gi:
//
//   gjsify build src/app.ts --app gjs   → gjs  -m dist/app.gjs.mjs   (native gi://)
//   gjsify build src/app.ts --app node  → node    dist/app.node.mjs  (@gjsify/node-gi)
//
// Beyond the static-render capstone (increment 1), this proves the reverse bridge
// dispatches a REAL event chain: a `Gtk.Button::clicked` signal AND a
// `Gio.SimpleAction` (added to the WINDOW, `<primary>plus` / `<primary>r`
// accelerators) both route into JS, mutate a counter, and the visible state changes —
// the window title, the `Adw.WindowTitle` subtitle and an `Adw.ActionRow` subtitle all
// update. The button and every accelerator funnel through the SAME action so there is
// ONE state-mutation path (GTK signal → node-gi dispatch → JS handler → widget set).
//
// SELF-VERIFYING over DBus. `installDevtools(app)` embeds the `@gjsify/devtools`
// control plane (`org.gjsify.Devtools`): launch with `GJSIFY_DEVTOOLS=1` and a tool
// can `ActivateAction("win", "increment", "null")` to drive the SAME chain over the
// session bus, then `DumpTree`/`GetProperty`/`Screenshot` the LIVE window to assert
// the counter changed — the interactivity proof on node-gi. `Adw.ApplicationWindow`
// implements `Gio.ActionGroup`, so devtools resolves the `win.*` group off the active
// window (node-gi's `instanceof` now spans the whole GObject hierarchy, matching GJS).
// `installDevtools` is a no-op unless `GJSIFY_DEVTOOLS` is truthy — prod-safe.
//
// runAsync — NOT sync run(). A gjsify GTK/Adwaita app MUST run via
// `Adw.Application.runAsync()`. The `print` global (ambient under GJS, injected by
// `--globals auto` via the `@gjsify/node-gi/globals` shim for the node build) also
// triggers the reverse bridge's `@girs/*`-body resolution so `@gjsify/devtools` keeps
// its real code under `--app node`.
//
// Reference: refs/gjs (g_application_run / adw_init), refs/libadwaita (ToolbarView /
// HeaderBar / WindowTitle / Clamp / PreferencesGroup / ActionRow), refs/gjs
// (Gio.SimpleAction / GActionMap accelerators). Copyright (c) GNOME contributors, MIT/LGPL.

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { installDevtools } from '@gjsify/devtools';

const app = new Adw.Application({ application_id: 'eu.jumplink.NodeGiWindow' });

app.connect('startup', () => {
    // Session bus + object path only exist after the app registers, so wire the
    // devtools control plane from `startup`. No-op returning null unless
    // GJSIFY_DEVTOOLS is truthy — prod-safe.
    installDevtools(app);
});

app.connect('activate', () => {
    let count = 0;

    const win = new Adw.ApplicationWindow({ application: app });
    win.set_default_size(480, 360);

    const windowTitle = new Adw.WindowTitle({ title: 'node-gi', subtitle: '0 clicks' });
    const header = new Adw.HeaderBar();
    header.set_title_widget(windowTitle);

    // The single visible counter row (its subtitle is the live state).
    const countRow = new Adw.ActionRow({ title: 'Clicks', subtitle: '0' });
    const group = new Adw.PreferencesGroup();
    group.add(countRow);

    const incrementButton = new Gtk.Button({ label: 'Increment', halign: Gtk.Align.CENTER });
    incrementButton.add_css_class('suggested-action');
    incrementButton.add_css_class('pill');

    const resetButton = new Gtk.Button({ label: 'Reset', halign: Gtk.Align.CENTER });

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 18,
        margin_top: 24,
        margin_bottom: 24,
        margin_start: 24,
        margin_end: 24,
    });
    box.append(group);
    box.append(incrementButton);
    box.append(resetButton);

    const clamp = new Adw.Clamp({ maximum_size: 360, child: box });
    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(header);
    toolbar.set_content(clamp);
    win.set_content(toolbar);

    // The ONE state-mutation path: every trigger (button, accelerator, devtools
    // ActivateAction) funnels through these actions' `activate` handlers.
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
        print(`node-gi-window: increment → ${count}`);
    });
    win.add_action(increment);

    const reset = new Gio.SimpleAction({ name: 'reset' });
    reset.connect('activate', () => {
        count = 0;
        render();
        print('node-gi-window: reset → 0');
    });
    win.add_action(reset);

    // Keyboard accelerators bound to the WINDOW-scoped actions.
    app.set_accels_for_action('win.increment', ['<primary>plus', '<primary>equal', 'plus']);
    app.set_accels_for_action('win.reset', ['<primary>r']);

    // GTK button `clicked` → drive the SAME window action (one state path).
    incrementButton.connect('clicked', () => win.activate_action('increment', null));
    resetButton.connect('clicked', () => win.activate_action('reset', null));

    render();
    win.present();
    print('node-gi-window: presented');
});

print('node-gi-window: start');
await app.runAsync([]);
print('node-gi-window: done');
