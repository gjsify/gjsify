// SPDX-License-Identifier: MIT
//
// TWO Adwaita layout containers, each declared entirely in a `.blp` and loaded by
// a `.ts` that imports it — the shape the documentation gallery's "Vanilla
// TypeScript" window claims, made executable.
//
// WHAT ONLY THIS SHOWCASE CAN PROVE. `showcases/dom/canvas2d-fireworks` already
// imports a `.blp` from a `.ts` and declares `runtimes: [gjs, node, bun, deno]`,
// so the SHAPE ships. What it does not do is say anything about a specific
// Adwaita layout widget: its template is an application window with a split view,
// and its assertions are about a canvas. A gallery block for `Adw.ToolbarView`
// promising "this exact tree, from this exact `.blp`" is a different claim, and
// the only way to hold it is to build that tree and read it back.
//
// The assertions are PLACEMENT assertions wherever the widget has a slot, because
// presence proves nothing about a slot: `[top]` and `[bottom]` both put a bar
// somewhere in the subtree, and a template that swapped them would pass a
// presence check while rendering the chrome upside down.
//
// SELF-VERIFYING ON EVERY LAUNCH, through `runHostProbeApp` from
// `@gjsify/gtk-host` — the same harness the four host-counter showcases use. It
// owns the `GJSIFY_HOST_PROBE=1` env gate, the GTK diagnostics collector, the
// `check()` recorder, the `PROBE: PASS|FAIL <json>` protocol and the rule that
// the GUI path runs the same assertions before presenting. Nothing in this file
// touches `@gjsify/gtk-host`'s RENDERER: the widgets here are plain GObject
// classes built by GtkBuilder from the compiled templates.

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { runHostProbeApp, type ProbeCheck } from '@gjsify/gtk-host';
import { dumpTree, findDescendant } from '@gjsify/gtk-host/conformance';

import { GalleryHeaderBar } from './header-bar.js';
import { GalleryToolbarView } from './toolbar-view.js';

// BEFORE the templates are instantiated. GtkBuilder resolves `Adw.HeaderBar` by
// GType NAME, and a type nothing has touched is not registered yet: without this
// the template build fails with `Invalid object type 'AdwHeaderBar'` and the
// internal children come back null. `Adw.Application` does this itself at
// startup, which is why an app never sees it — a headless probe does.
Adw.init();

interface Ui {
    readonly bin: GalleryHeaderBar;
    readonly headerBar: Adw.HeaderBar;
    readonly toolbarBin: GalleryToolbarView;
    readonly toolbarView: Adw.ToolbarView;
    readonly window: Adw.ApplicationWindow | null;
}

function buildUi(app: Adw.Application | null): Ui {
    // The template's class is an `Adw.Bin`; the widget the gallery block is about
    // is its child, so every assertion below reads the CHILD and not the wrapper.
    const bin = new GalleryHeaderBar();
    const headerBar = bin.get_child() as Adw.HeaderBar;
    const toolbarBin = new GalleryToolbarView();
    const toolbarView = toolbarBin.get_child() as Adw.ToolbarView;

    // The GUI path needs somewhere to put them; the headless path must NOT build a
    // window, because a toplevel with no application is a diagnostic of its own.
    if (app === null) return { bin, headerBar, toolbarBin, toolbarView, window: null };

    const window = new Adw.ApplicationWindow({
        application: app,
        title: 'Adwaita layout, from Blueprint',
        defaultWidth: 720,
        defaultHeight: 520,
    });
    const stack = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    stack.append(bin);
    toolbarBin.vexpand = true;
    stack.append(toolbarBin);
    window.set_content(stack);
    return { bin, headerBar, toolbarBin, toolbarView, window };
}

/**
 * Which side of an `Adw.HeaderBar` a widget was packed into.
 *
 * `Adw.HeaderBar` has an exact getter for `title-widget` and NONE for the two
 * packing sides — `pack_start`/`pack_end` are write-only. What is readable is the
 * `Gtk.CenterBox` libadwaita builds inside every header bar: the start pack lands
 * in its start widget's subtree and the end pack in its end widget's. Walking that
 * separates the two slots, which no subtree search can.
 */
function packedSide(headerBar: Adw.HeaderBar, widget: Gtk.Widget | null): 'start' | 'end' | 'neither' {
    const centerBox = findDescendant(headerBar, (w) => w instanceof Gtk.CenterBox) as Gtk.CenterBox | null;
    if (centerBox === null || widget === null) return 'neither';
    const within = (root: Gtk.Widget | null): boolean => {
        if (root === null) return false;
        for (let w: Gtk.Widget | null = widget; w !== null; w = w.get_parent()) {
            if (w === root) return true;
        }
        return false;
    };
    if (within(centerBox.get_start_widget())) return 'start';
    if (within(centerBox.get_end_widget())) return 'end';
    return 'neither';
}

/**
 * Whether a bar sits in the TOP or the BOTTOM bar of an `Adw.ToolbarView`.
 *
 * `add_top_bar`/`add_bottom_bar` are write-only and the height getters read 0 until
 * the widget is allocated, which a headless probe never does. What IS readable is
 * the style class libadwaita puts on the revealer it wraps each bar in — `top-bar`
 * or `bottom-bar`, measured on libadwaita 1.9 / gjs 1.88.1.
 */
function barSlot(view: Adw.ToolbarView, widget: Gtk.Widget | null): 'top' | 'bottom' | 'neither' {
    for (let w = widget; w !== null && w !== (view as unknown as Gtk.Widget); w = w.get_parent()) {
        const classes = w.get_css_classes();
        if (classes.includes('top-bar')) return 'top';
        if (classes.includes('bottom-bar')) return 'bottom';
    }
    return 'neither';
}

const buttonWithIcon = (root: Gtk.Widget, icon: string): Gtk.Button | null =>
    findDescendant(root, (w) => w instanceof Gtk.Button && w.iconName === icon) as Gtk.Button | null;

function assertUi(ui: Ui, check: ProbeCheck): Record<string, unknown> {
    const { headerBar, toolbarView } = ui;

    // ---------------------------------------------------------------- Adw.HeaderBar
    // `child:` reached `Adw.Bin.set_child()`, and what it holds is the real thing.
    check('the .blp built an Adw.HeaderBar', headerBar instanceof Adw.HeaderBar);

    const title = headerBar.get_title_widget();
    check(
        'title-widget: reached set_title_widget as an Adw.WindowTitle',
        title instanceof Adw.WindowTitle && title.title === 'Text Editor' && title.subtitle === 'notes.md',
    );

    const back = buttonWithIcon(headerBar, 'go-previous-symbolic');
    check('the [start] button was built', back !== null);
    check('[start] reached pack_start', packedSide(headerBar, back) === 'start');
    check('styles ["flat"] reached the button', back?.get_css_classes().includes('flat') === true);

    const menuButton = findDescendant(headerBar, (w) => w instanceof Gtk.MenuButton) as Gtk.MenuButton | null;
    check('the [end] menu button was built', menuButton !== null);
    check('[end] reached pack_end', packedSide(headerBar, menuButton) === 'end');
    // The one thing the template could not declare: the model the .ts attached.
    const model = menuButton?.get_menu_model();
    check(
        'the .ts attached a three-item Gio.Menu to the template child',
        model instanceof Gio.Menu && model.get_n_items() === 3,
    );

    // -------------------------------------------------------------- Adw.ToolbarView
    check('the .blp built an Adw.ToolbarView', toolbarView instanceof Adw.ToolbarView);

    const content = toolbarView.get_content();
    check(
        'content: reached set_content as an Adw.StatusPage',
        content instanceof Adw.StatusPage && content.title === 'Your library',
    );

    const innerHeader = findDescendant(toolbarView, (w) => w instanceof Adw.HeaderBar) as Adw.HeaderBar | null;
    check('the [top] header bar was built', innerHeader !== null);
    check('[top] reached add_top_bar', barSlot(toolbarView, innerHeader) === 'top');
    const innerTitle = innerHeader?.get_title_widget();
    check(
        'the nested Adw.WindowTitle carries both strings',
        innerTitle instanceof Adw.WindowTitle && innerTitle.title === 'Documents' && innerTitle.subtitle === '12 items',
    );

    const actionBar = findDescendant(toolbarView, (w) => w instanceof Gtk.ActionBar) as Gtk.ActionBar | null;
    check('the [bottom] Gtk.ActionBar was built', actionBar !== null);
    check('[bottom] reached add_bottom_bar', barSlot(toolbarView, actionBar) === 'bottom');
    // Gtk.ActionBar HAS an exact getter for its centre slot, so this one is not a walk.
    const centre = actionBar?.get_center_widget();
    check('[center] reached set_center_widget', centre instanceof Gtk.Label && centre.label === 'Selection: none');
    for (const icon of ['list-add-symbolic', 'list-remove-symbolic', 'send-to-symbolic']) {
        check(`the action bar holds ${icon}`, actionBar !== null && buttonWithIcon(actionBar, icon) !== null);
    }

    return {
        headerBar: dumpTree(headerBar).split('\n').length,
        toolbarView: dumpTree(toolbarView).split('\n').length,
    };
}

await runHostProbeApp<Ui>({
    applicationId: 'eu.jumplink.AdwBlueprintLayout',
    build: buildUi,
    assert: assertUi,
    // The headless path builds two unparented widgets; nothing else owns them, so
    // the probe does. Before the diagnostics are counted, because a mis-parented
    // template reports itself at finalize and at exit 0.
    teardown: (ui) => {
        if (ui.window !== null) return;
        ui.bin.run_dispose();
        ui.toolbarBin.run_dispose();
    },
    present: (ui) => ui.window?.present(),
});
