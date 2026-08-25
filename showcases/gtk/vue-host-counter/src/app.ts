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

import { nextTick } from '@vue/runtime-core';

import { registerBuiltinWidgets, runHostProbeApp, type ProbeCheck } from '@gjsify/gtk-host';
import { descendants, dumpTree, findDescendant, gtkChildren } from '@gjsify/gtk-host/conformance';
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

/** Titles of the Adw.ActionRows GTK actually holds, in GTK's own order. */
const rowTitles = (root: Gtk.Widget): string[] =>
    descendants(root)
        .filter((w): w is Adw.ActionRow => w instanceof Adw.ActionRow)
        .map((row) => row.title);

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

type Ui = ReturnType<typeof buildUi>;

/**
 * Everything this showcase claims, read back off the REAL widget tree.
 *
 * ASYNC, and that is why the shared harness grew an async `assert`: Vue flushes
 * render jobs on a microtask, so an assertion after a click has to `await
 * nextTick()` or it reads the tree as it was before the patch. This file used to
 * hand-roll the whole harness for that one reason — the env gate, the diagnostics
 * collector, the `check()` recorder, the `PROBE:` protocol and the `app.hold()`
 * discipline — and the copy carried the pre-`describeLogRecord` collector bug with
 * it, where a log record without a `MESSAGE` was counted and then described as the
 * empty string.
 */
async function assertUi(ui: Ui, check: ProbeCheck): Promise<Record<string, unknown>> {
    // 0. The four production defines held. `@vue/runtime-core` is DOM-free in fact,
    //    but `--globals auto` is a STATIC scan: without the defines it injects a
    //    polyfill per identifier it sees in a dev-only branch and drags gi://Gdk,
    //    GdkPixbuf, Pango and PangoCairo into a bundle that needs none. If a
    //    `document` exists here, the build recipe was lost.
    const globals = globalThis as unknown as Record<string, unknown>;
    check('no DOM was injected (the production defines held)', typeof globals.document === 'undefined');
    check('no navigator was injected', typeof globals.navigator === 'undefined');

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

    return {
        rows: rowTitles(window),
        actions: actionLabels(),
        tree: dumpTree(window).split('\n').length,
    };
}

await runHostProbeApp<Ui>({
    applicationId: 'eu.jumplink.VueHostCounter',
    // Ignores the application on purpose — and so does the harness, which always
    // probes headless. A Vue mount asserts about the widget tree, and building an
    // `Adw.ApplicationWindow` with `application: app` inside `activate` is the
    // neighbourhood of the segfault recorded on `runHostProbeApp`.
    build: () => buildUi(null),
    assert: assertUi,
    // The probe builds a real toplevel of its own. `unmount` releases what Vue
    // owns inside it; `destroy` is what unparenting cannot reach. Run BEFORE the
    // harness counts diagnostics, which is the point of the hook — a finalize-time
    // `still has children left` is exactly the class that only appears here.
    teardown: (ui) => {
        ui.vue.unmount();
        ui.window.destroy();
    },
    present: (ui) => ui.window.present(),
});
