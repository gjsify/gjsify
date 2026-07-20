// SPDX-License-Identifier: MIT
//
// GTK-GUI-on-node-gi proof — increment 3: BROAD Libadwaita widget breadth in an
// INTERACTIVE application whose SINGLE source builds AND runs on both GJS and
// Node.js through the reverse bridge:
//
//   gjsify build src/app.ts --app gjs   → gjs  -m dist/app.gjs.mjs   (native gi://)
//   gjsify build src/app.ts --app node  → node    dist/app.node.mjs  (@gjsify/node-gi)
//
// Two views in an `Adw.ViewStack` (switched by a bottom `Adw.ViewSwitcherBar`),
// the whole thing wrapped in an `Adw.ToastOverlay`:
//
//   • "Counter" (increment 1+2, unchanged) — a click counter driven through ONE
//     state-mutation path: a `Gtk.Button::clicked` signal AND `Gio.SimpleAction`s
//     added to the WINDOW (`<primary>plus` / `<primary>r` accelerators) all route
//     into JS, mutate the counter, and the window title + `Adw.WindowTitle` subtitle
//     + an `Adw.ActionRow` subtitle update.
//   • "Settings" (increment 3) — a representative slice of the REAL Libadwaita
//     widget set proves it constructs + renders + reacts via node-gi: an
//     `Adw.PreferencesPage` / `Adw.PreferencesGroup` with `Adw.ActionRow`,
//     `Adw.SwitchRow`, `Adw.EntryRow`, `Adw.ComboRow` (a `Gtk.StringList` model),
//     `Adw.SpinRow` (a `Gtk.Adjustment`) and `Adw.ExpanderRow`, plus a `Gtk.ListBox`
//     in the boxed-list idiom. Interactions dispatch through the node-gi signal
//     chain — toggling the switch and a `win.toast` action both raise a dismissible
//     `Adw.Toast` via the overlay.
//
// SELF-VERIFYING over DBus. `installDevtools(app)` embeds the `@gjsify/devtools`
// control plane (`org.gjsify.Devtools`): launch with `GJSIFY_DEVTOOLS=1` and a tool
// can `ActivateAction("win", "increment", "null")` (or `"toast"`) to drive the SAME
// chains over the session bus, then `DumpTree`/`GetProperty`/`Screenshot` the LIVE
// window to assert the state changed. `Adw.ApplicationWindow` implements
// `Gio.ActionGroup`, so devtools resolves the `win.*` group off the active window
// (node-gi's `instanceof` spans the whole GObject hierarchy, matching GJS).
// `installDevtools` is a no-op unless `GJSIFY_DEVTOOLS` is truthy — prod-safe.
//
// runAsync — NOT sync run(). A gjsify GTK/Adwaita app MUST run via
// `Adw.Application.runAsync()`. The `print` global (ambient under GJS, injected by
// `--globals auto` via the `@gjsify/node-gi/globals` shim for the node build) also
// triggers the reverse bridge's `@girs/*`-body resolution so `@gjsify/devtools` keeps
// its real code under `--app node`.
//
// Reference: refs/gjs (g_application_run / adw_init, Gio.SimpleAction / GActionMap
// accelerators, GObject property notify), refs/libadwaita (ToolbarView / HeaderBar /
// WindowTitle / ViewStack / ViewSwitcherBar / PreferencesPage / PreferencesGroup /
// ActionRow / SwitchRow / EntryRow / ComboRow / SpinRow / ExpanderRow / ToastOverlay
// / Toast). Copyright (c) GNOME contributors, MIT/LGPL.

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
    win.set_default_size(480, 600);

    const windowTitle = new Adw.WindowTitle({ title: 'node-gi', subtitle: '0 clicks' });
    const header = new Adw.HeaderBar();
    header.set_title_widget(windowTitle);

    // The whole content lives under a ToastOverlay so any view can raise a toast.
    const toastOverlay = new Adw.ToastOverlay();

    const showToast = (text: string) => {
        toastOverlay.add_toast(new Adw.Toast({ title: text, timeout: 2 }));
        print(`node-gi-window: toast → ${text}`);
    };

    // ---- View 1: the counter (increments 1+2, unchanged state path) -----------
    const countRow = new Adw.ActionRow({ title: 'Clicks', subtitle: '0' });
    const counterGroup = new Adw.PreferencesGroup();
    counterGroup.add(countRow);

    const incrementButton = new Gtk.Button({ label: 'Increment', halign: Gtk.Align.CENTER });
    incrementButton.add_css_class('suggested-action');
    incrementButton.add_css_class('pill');
    const resetButton = new Gtk.Button({ label: 'Reset', halign: Gtk.Align.CENTER });

    const counterBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 18,
        margin_top: 24,
        margin_bottom: 24,
        margin_start: 24,
        margin_end: 24,
    });
    counterBox.append(counterGroup);
    counterBox.append(incrementButton);
    counterBox.append(resetButton);
    const counterClamp = new Adw.Clamp({ maximum_size: 360, child: counterBox });

    // ---- View 2: the Adwaita widget-breadth preferences surface ---------------
    const prefsPage = new Adw.PreferencesPage();

    const settingsGroup = new Adw.PreferencesGroup({ title: 'Settings' });
    settingsGroup.add(new Adw.ActionRow({ title: 'Action', subtitle: 'a plain row' }));

    const switchRow = new Adw.SwitchRow({ title: 'Enabled', active: false });
    switchRow.connect('notify::active', () => {
        showToast(switchRow.get_active() ? 'Enabled' : 'Disabled');
    });
    settingsGroup.add(switchRow);

    settingsGroup.add(new Adw.EntryRow({ title: 'Name' }));

    const stringList = new Gtk.StringList({ strings: ['Alpha', 'Beta', 'Gamma'] });
    const comboRow = new Adw.ComboRow({ title: 'Choice', model: stringList });
    settingsGroup.add(comboRow);

    const adjustment = new Gtk.Adjustment({
        lower: 0,
        upper: 10,
        step_increment: 1,
        page_increment: 2,
        value: 3,
    });
    settingsGroup.add(new Adw.SpinRow({ title: 'Amount', adjustment }));

    const expanderRow = new Adw.ExpanderRow({ title: 'More', subtitle: 'expandable' });
    expanderRow.add_row(new Adw.ActionRow({ title: 'Nested', subtitle: 'inside the expander' }));
    settingsGroup.add(expanderRow);
    prefsPage.add(settingsGroup);

    const listGroup = new Adw.PreferencesGroup({ title: 'List' });
    const listBox = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
    listBox.add_css_class('boxed-list');
    for (const label of ['One', 'Two']) {
        const row = new Gtk.ListBoxRow();
        row.set_child(
            new Gtk.Label({
                label,
                halign: Gtk.Align.START,
                margin_top: 12,
                margin_bottom: 12,
                margin_start: 12,
                margin_end: 12,
            }),
        );
        listBox.append(row);
    }
    listGroup.add(listBox);

    const toastButton = new Gtk.Button({ label: 'Show toast', halign: Gtk.Align.CENTER, margin_top: 6 });
    toastButton.add_css_class('pill');
    listGroup.add(toastButton);
    prefsPage.add(listGroup);

    // ---- The ViewStack + bottom switcher, under the ToastOverlay --------------
    const viewStack = new Adw.ViewStack();
    viewStack.add_titled_with_icon(counterClamp, 'counter', 'Counter', 'list-add-symbolic');
    viewStack.add_titled_with_icon(prefsPage, 'settings', 'Settings', 'emblem-system-symbolic');

    const switcherBar = new Adw.ViewSwitcherBar({ stack: viewStack, reveal: true });

    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(header);
    toolbar.set_content(viewStack);
    toolbar.add_bottom_bar(switcherBar);

    toastOverlay.set_child(toolbar);
    win.set_content(toastOverlay);

    // The ONE counter state-mutation path: every trigger (button, accelerator,
    // devtools ActivateAction) funnels through these actions' `activate` handlers.
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

    // A window action that raises a toast — drivable over DBus (ActivateAction) too.
    const toastAction = new Gio.SimpleAction({ name: 'toast' });
    toastAction.connect('activate', () => showToast('Saved'));
    win.add_action(toastAction);

    // Keyboard accelerators bound to the WINDOW-scoped actions.
    app.set_accels_for_action('win.increment', ['<primary>plus', '<primary>equal', 'plus']);
    app.set_accels_for_action('win.reset', ['<primary>r']);

    // GTK button `clicked` → drive the SAME window actions (one state path).
    incrementButton.connect('clicked', () => win.activate_action('increment', null));
    resetButton.connect('clicked', () => win.activate_action('reset', null));
    toastButton.connect('clicked', () => win.activate_action('toast', null));

    render();
    win.present();
    print('node-gi-window: presented');
});

print('node-gi-window: start');
await app.runAsync([]);
print('node-gi-window: done');
