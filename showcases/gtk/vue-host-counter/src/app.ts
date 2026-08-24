// SPDX-License-Identifier: MIT
//
// The `adw-host-counter` window a third time — now as a Vue single-file component
// compiled by `@gjsify/rolldown-plugin-vue`, so the three showcases are a
// deliberate A/B/C: same widgets, same assertions, one imperative through the host
// ops, one through Solid's JSX compiler, one through `@vue/compiler-sfc`.
//
// WHAT ONLY THIS SHOWCASE CAN PROVE. The Vue adapter was complete and tested
// before any of this existed — but it was tested through `h(...)` calls, i.e.
// through the renderer calls an SFC template compiles TO. Nothing in the
// repository compiled a `.vue` file, so the whole compile step was unmeasured, and
// its failure mode is silent in both directions:
//
//   · without `compilerOptions.isCustomElement`, every GTK tag compiles to
//     `resolveComponent("gtk-box")`. Vue's resolver misses, warns once per tag —
//     and the warning is `__DEV__`-only, which the production defines this bundle
//     REQUIRES strip. Nothing throws.
//   · `.vue` is not an extension rolldown knows, so it parses the transform's
//     output with the JS parser: a `lang="ts"` SFC dies on
//     `[PARSE_ERROR] Missing initializer in const declaration` pointing into the
//     `.vue` file. That one at least is loud.
//
// SELF-VERIFYING ON EVERY LAUNCH, like both siblings. `GJSIFY_HOST_PROBE=1` runs
// the assertions headlessly and exits; the GUI path runs the SAME assertions from
// `activate` before the window is shown, so `scripts/showcase-smoke.mjs` — which
// only launches and waits — carries them. A throw inside a GLib callback prints
// `JS ERROR` and lets the process exit 0, and that marker is what the smoke gate
// greps for.

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

/**
 * Every GLib/GTK diagnostic this process emits, captured rather than merely
 * printed — GTK's failure mode is exit 0, so a mis-parented tree has to be read
 * out of the log rather than out of the exit code. Identical mechanism to both
 * siblings; see `adw-host-counter/src/app.ts` for why the writer forwards instead
 * of swallowing.
 */
const diagnostics: string[] = [];
const decoder = new TextDecoder();
const verboseLogging = GLib.getenv('G_MESSAGES_DEBUG') !== null;

GLib.log_set_writer_func((level, fields) => {
    try {
        const raw = (fields as unknown as { MESSAGE?: unknown } | null)?.MESSAGE;
        const message = raw instanceof Uint8Array ? decoder.decode(raw) : String(raw ?? '');
        // MASK the level: `g_logv` ORs in `G_LOG_FLAG_FATAL`, so `WARNING|FATAL`
        // is 18 and an unmasked `<= 16` misses it under `--g-fatal-warnings`.
        const severity = level & GLib.LogLevelFlags.LEVEL_MASK;
        if (severity <= GLib.LogLevelFlags.LEVEL_WARNING) diagnostics.push(message);
        if (verboseLogging || severity <= GLib.LogLevelFlags.LEVEL_MESSAGE) printerr(message);
    } catch {
        printerr('<vue-host probe: a log message could not be decoded>');
    }
    return GLib.LogWriterOutput.HANDLED;
});

import { nextTick } from '@vue/runtime-core';

import { registerBuiltinWidgets } from '@gjsify/gtk-host';
import { dumpTree, gtkChildren } from '@gjsify/gtk-host/conformance';
import { mount } from '@gjsify/gtk-host/vue';

import App from './App.vue';

registerBuiltinWidgets();

/**
 * The window is the APPLICATION's, the content is Vue's.
 *
 * This is the one structural difference from the two siblings, and it is Vue's
 * mount model rather than a choice: `app.mount(container)` renders INTO a widget,
 * and a toplevel window is not a child of anything — an `adw-application-window`
 * at the root of the template would ask GTK to parent a toplevel and earn a
 * `Gtk-WARNING` at exit 0. `mount(rootComponent, container)` from the adapter
 * `adopt`s the window and the SFC's `adw-toolbar-view` lands through
 * `Adw.ApplicationWindow.set_content()`, the `single` placement policy the
 * descriptor table declares for it.
 */
function buildUi(app: Adw.Application | null) {
    const window = new Adw.ApplicationWindow({
        title: 'vue-host counter',
        default_width: 480,
        default_height: 520,
        ...(app ? { application: app } : {}),
    });
    const vue = mount(App, window);
    return { window, vue };
}

/** First descendant matching `pred`, breadth-first over the REAL widget tree. */
function findDescendant(root: Gtk.Widget, pred: (w: Gtk.Widget) => boolean): Gtk.Widget | null {
    const queue: Gtk.Widget[] = [root];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (widget !== root && pred(widget)) return widget;
        queue.push(...gtkChildren(widget));
    }
    return null;
}

/** Titles of the Adw.ActionRows GTK actually holds, in GTK's own order. */
function rowTitles(root: Gtk.Widget): string[] {
    const found: string[] = [];
    const walk = (widget: Gtk.Widget) => {
        if (widget instanceof Adw.ActionRow) found.push(widget.title);
        for (const child of gtkChildren(widget)) walk(child);
    };
    walk(root);
    return found;
}

/** A button by its label, from the real tree — never from Vue's own bookkeeping. */
function buttonNamed(root: Gtk.Widget, label: string): Gtk.Button | null {
    return findDescendant(root, (w) => w instanceof Gtk.Button && w.label === label) as Gtk.Button | null;
}

/**
 * Click a button the way GTK would and let Vue's scheduler settle.
 *
 * `emit('clicked')` and not calling the handler: calling the closure would prove
 * only that it exists. Vue flushes render jobs on a microtask, so the `await` is
 * what makes the next assertion look at a patched tree rather than the old one.
 */
async function click(button: Gtk.Button | null): Promise<void> {
    button?.emit('clicked');
    await nextTick();
}

async function runProbe(): Promise<number> {
    // Start from zero: in the GUI path this runs from `activate`, after Adw
    // startup, where a portal/theme/a11y warning is routine in a container.
    diagnostics.length = 0;

    const failures: string[] = [];
    const check = (what: string, ok: boolean) => {
        if (!ok) failures.push(what);
    };

    // 0. The four production defines held. `@vue/runtime-core` is DOM-free in fact,
    //    but `--globals auto` is a STATIC scan: without the defines it injects a
    //    polyfill per identifier it sees in a dev-only branch and drags gi://Gdk,
    //    GdkPixbuf, Pango and PangoCairo into a bundle that needs none. If a
    //    `document` exists here, the build recipe was lost.
    const globals = globalThis as unknown as Record<string, unknown>;
    check('no DOM was injected (the production defines held)', typeof globals.document === 'undefined');
    check('no navigator was injected', typeof globals.navigator === 'undefined');

    const ui = buildUi(null);
    const window = ui.window as unknown as Gtk.Widget;

    // 1. The string enum nick reached GTK. GObject would have kept HORIZONTAL, so
    //    read the property back — materialisation always returns something.
    //
    //    The box is reached through the BUTTON and not by searching for the first
    //    Gtk.Box: Adw.ApplicationWindow, Adw.ToolbarView and Adw.PreferencesPage all
    //    nest their own boxes, and the first one found was an internal that happened
    //    to be vertical — this assertion passed for a widget the template never
    //    wrote. `get_parent()` of a widget the template DID write cannot be anything
    //    else.
    const increment = buttonNamed(window, 'Increment');
    check('the increment button was built', increment !== null);
    const box = increment?.get_parent() as Gtk.Box | null;
    check('a GtkBox was built from the SFC template', box instanceof Gtk.Box);
    check("orientation='vertical' reached GTK", box?.orientation === Gtk.Orientation.VERTICAL);

    // 2. Slotted placement authored as a plain `slot` attribute in the template.
    check('AdwToolbarView is in the window', findDescendant(window, (w) => w instanceof Adw.ToolbarView) !== null);
    check('AdwHeaderBar is in the window', findDescendant(window, (w) => w instanceof Adw.HeaderBar) !== null);

    // 3. A CONSTRUCT-ONLY property authored in the template survived. Vue's
    //    `createElement` op RECEIVES the vnode props, so unlike the Solid path this
    //    needs no rebuild — which is the adapter difference ADR 0027 predicts.
    const clicks = findDescendant(
        window,
        (w) => w instanceof Adw.ActionRow && w.title === 'Clicks',
    ) as Adw.ActionRow | null;
    check('the counter row was built', clicks !== null);
    check('construct-only css-name arrived with the constructor', clicks?.cssName === 'row');

    // 4. `v-if` marks its empty branch with a comment, which the host turns into an
    //    anchor that never enters the GTK tree. So while the branch is closed the
    //    box holds three buttons and nothing else.
    const actionLabels = () => gtkChildren(box as Gtk.Widget).map((w) => (w as Gtk.Button | Gtk.Label).label);
    check(
        'a closed v-if branch does not occupy a GTK slot',
        JSON.stringify(actionLabels()) === JSON.stringify(['Increment', 'Add row', 'Remove first row']),
    );

    // 5. A handler the COMPILER bound (`@clicked` -> the `onClicked` prop -> the
    //    host's signal ledger) is connected to the real widget, and the reactive
    //    write reaches GTK. Emitted on GTK's side, not by calling the closure —
    //    calling it would prove only that the closure exists.
    await click(increment);
    check('clicking updated the subtitle through the signal', clicks?.subtitle === '1');
    check(
        'the opened v-if branch lands between its siblings',
        JSON.stringify(actionLabels()) === JSON.stringify(['Increment', 'clicked 1x', 'Add row', 'Remove first row']),
    );

    // 6. `v-for` inserts before the static sibling, through the `remove-all`
    //    degradation of Adw.PreferencesGroup, and removal takes the right row out.
    await click(buttonNamed(window, 'Add row'));
    await click(buttonNamed(window, 'Add row'));
    check(
        'v-for rows land before the counter row',
        JSON.stringify(rowTitles(window)) === JSON.stringify(['Row 1', 'Row 2', 'Clicks']),
    );
    await click(buttonNamed(window, 'Remove first row'));
    check(
        'removing the first row leaves the rest in order',
        JSON.stringify(rowTitles(window)) === JSON.stringify(['Row 2', 'Clicks']),
    );

    // 7. …and none of it may have been reported to GLib.
    check(`no GTK diagnostics (saw ${diagnostics.length})`, diagnostics.length === 0);

    const report = {
        rows: rowTitles(window),
        actions: actionLabels(),
        diagnostics: diagnostics.length,
        tree: dumpTree(window).split('\n').length,
    };
    // Cleanup beside creation: the probe built a real toplevel of its own, and
    // `unmount` only tears down what Vue owns inside it.
    ui.vue.unmount();
    ui.window.destroy();
    if (failures.length > 0) {
        print(`PROBE: FAIL ${JSON.stringify({ failures, ...report })}`);
        return 1;
    }
    print(`PROBE: PASS ${JSON.stringify(report)}`);
    return 0;
}

if (GLib.getenv('GJSIFY_HOST_PROBE') === '1') {
    // Headless one-shot: assert and exit, no window, no main loop.
    Gtk.init();
    imports.system.exit(await runProbe());
} else {
    const app = new Adw.Application({ application_id: 'eu.jumplink.VueHostCounter' });
    app.connect('activate', () => {
        // `activate` IS A GLIB CALLBACK AND CANNOT BE AWAITED, and the probe has to
        // await Vue's scheduler. So the async work is started here — and
        // `app.hold()` is what makes that legal.
        //
        // MEASURED, without the hold: `activate` returned having presented nothing,
        // GApplication's hold count hit zero, and `gtk_application_shutdown` ran its
        // own nested main loop. The probe's continuation was then dispatched FROM
        // INSIDE that shutdown, constructed a window with `application: app`, and
        // `gtk_application_window_added` segfaulted — `PROBE: PASS` on stdout, exit
        // 139, and the stack ends in `gtk_application_shutdown ->
        // g_main_loop_run -> PromiseJobDispatcher`. Nothing about the crash names
        // the missing hold.
        app.hold();
        void (async () => {
            try {
                const failed = await runProbe();
                if (failed !== 0) imports.system.exit(failed);

                const ui = buildUi(app);
                ui.window.present();
            } catch (error) {
                // A REAL throw path: the probe calls into GTK and into Vue's
                // scheduler. Caught because a rejected promise would leave the
                // `hold()` above forever un-released, and an application that never
                // exits is what `showcase-smoke` reads as "still up after the dwell"
                // — a failure that reports itself as a pass.
                printerr(`JS ERROR: vue-host-counter probe threw: ${String(error)}`);
                imports.system.exit(1);
            } finally {
                app.release();
            }
        })();
    });
    await app.runAsync([]);
}
