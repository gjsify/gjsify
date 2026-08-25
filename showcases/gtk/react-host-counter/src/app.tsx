// SPDX-License-Identifier: MIT
//
// The `adw-host-counter` window a FOURTH time — now as React JSX rendered by
// `react-reconciler`, so the four showcases are a deliberate A/B/C/D: same
// widgets, same assertions, one imperative through the host ops, one through
// Solid's JSX compiler, one through `@vue/compiler-sfc`, this one through React's
// automatic JSX runtime and a real `HostConfig`.
//
// WHAT ONLY THIS SHOWCASE CAN PROVE. React was the one adapter with no end-to-end
// evidence: `src/adapters/react.spec.ts` drives the reconciler through
// `createElement` calls and the type gate held the ELEMENT LIST, but nothing
// anywhere compiled a line of React JSX or ran a React tree inside a
// GApplication. Three things only this file reaches:
//
//   · THE AUTOMATIC RUNTIME. Unlike both siblings, this build does NOT preserve
//     JSX for a framework compiler — `jsx: "react-jsx"` +
//     `jsxImportSource: "@gjsify/gtk-host/react"` makes oxc emit
//     `import { jsx } from "@gjsify/gtk-host/react/jsx-runtime"`, and that subpath
//     re-exports React's OWN `jsx`/`jsxs`/`Fragment`. The export NAMES are the
//     framework's contract: TypeScript emits those three literally, so a rename
//     there is a `MISSING_EXPORT` in this bundle rather than a matter of taste.
//   · THE SCHEDULED LANE, under GJS, in an application. `getCurrentEventPriority`
//     returns the DEFAULT lane (a GTK signal is not a DOM event, so there is no
//     ambient event to derive a priority from), which means a `setState` from a
//     `clicked` handler is CONCURRENT: it is handed to `scheduler`, which under
//     GJS lands on a GLib timer source. The probe asserts both halves — the tree
//     is unchanged the instant the signal returns, and it is patched after the
//     main context runs — because "the handler was connected" and "React
//     re-rendered" are two different facts and only the second one is the point.
//   · REACT'S OWN `ref` SPELLING. The React surface types `ref` as `Ref<T>`, i.e. a
//     callback OR a `useRef`/`createRef` OBJECT, which is why it is not the Solid
//     surface's `ref` type. `createRef` is the object form, and the probe asserts
//     the widget it receives is IDENTICAL to the one found by walking the real GTK
//     tree — `getPublicInstance` returning something plausible is not the claim.
//
// SELF-VERIFYING ON EVERY LAUNCH, like all three siblings and through the SAME
// harness: `runHostProbeApp` from `@gjsify/gtk-host` owns the env gate, the
// diagnostics collector, the `check()` recorder, the `PROBE: PASS|FAIL <json>`
// protocol, the `app.hold()` discipline and the rule that the GUI path runs the
// same assertions before presenting. A throw inside a GLib callback prints
// `JS ERROR` and lets the process exit 0, and that marker is what
// `scripts/showcase-smoke.mjs` greps for.

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { createRef, useCallback, useRef, useState, type RefObject } from 'react';

import { registerBuiltinWidgets, runHostProbeApp, type ProbeCheck } from '@gjsify/gtk-host';
import { descendants, dumpTree, findDescendant, gtkChildren } from '@gjsify/gtk-host/conformance';
import { createRoot } from '@gjsify/gtk-host/react';

registerBuiltinWidgets();

interface Row {
    readonly id: number;
    readonly title: string;
}

/**
 * The whole UI as one React component.
 *
 * The window is the APPLICATION's and the content is React's — the same
 * structural split the Vue showcase documents, and for the same reason rather
 * than by imitation: `createRoot(container)` renders INTO a widget, and a toplevel
 * window is not a child of anything. An `adw-application-window` at the root of
 * this tree would ask GTK to parent a toplevel and earn a `Gtk-WARNING` at exit 0.
 */
function Counter({ incrementRef }: { readonly incrementRef: RefObject<Gtk.Button> }) {
    const [count, setCount] = useState(0);
    const [rows, setRows] = useState<readonly Row[]>([]);
    const nextRow = useRef(1);

    const increment = useCallback(() => setCount((n) => n + 1), []);
    const addRow = useCallback(() => {
        const id = nextRow.current;
        nextRow.current += 1;
        setRows((current) => [...current, { id, title: `Row ${id}` }]);
    }, []);
    const removeFirstRow = useCallback(() => setRows((current) => current.slice(1)), []);

    return (
        <adw-toolbar-view>
            <adw-header-bar slot="top">
                <gtk-label label="Built by react-reconciler" slot="title" />
            </adw-header-bar>
            <adw-preferences-page slot="content">
                <adw-preferences-group title="Rows">
                    {/* Rendered BEFORE the counter row on purpose: Adw.PreferencesGroup
                        has no `insert()`, so the placement policy degrades to
                        `remove-all` and the host replays the tail. A keyed React list
                        in front of a static sibling is what makes that path run. */}
                    {rows.map((row) => (
                        <adw-action-row key={row.id} title={row.title} subtitle="added at runtime" />
                    ))}
                    {/* `cssName` is CONSTRUCT-ONLY on every GtkWidget. React hands the
                        vnode props to `createInstance`, so it arrives at `g_object_new`
                        time and no rebuild is needed — the same adapter difference the
                        Vue showcase records, and the opposite of the Solid path where
                        the compiler sets every property after construction. */}
                    <adw-action-row title="Clicks" subtitle={String(count)} cssName="row" />
                </adw-preferences-group>
                <adw-preferences-group title="Actions">
                    {/* `orientation="vertical"` as a STRING is the case GObject drops
                        silently; the host resolves the nick against GtkOrientation. */}
                    <gtk-box orientation="vertical" spacing={12} marginTop={12}>
                        <gtk-button label="Increment" halign="center" onClicked={increment} ref={incrementRef} />
                        {/* A conditional in the MIDDLE. React renders `null` as no node
                            at all — it creates no anchor, unlike Solid's and Vue's
                            comment boundaries — so this is the host's `insertBefore`
                            path rather than an anchor resolution. If the label were
                            appended instead, "Add row" would sit one index too early
                            and GTK would say nothing about it. */}
                        {count > 0 ? <gtk-label label={`clicked ${count}x`} /> : null}
                        <gtk-button label="Add row" halign="center" onClicked={addRow} />
                        <gtk-button label="Remove first row" halign="center" onClicked={removeFirstRow} />
                    </gtk-box>
                </adw-preferences-group>
            </adw-preferences-page>
        </adw-toolbar-view>
    );
}

interface Ui {
    readonly window: Adw.ApplicationWindow;
    readonly root: ReturnType<typeof createRoot>;
    readonly incrementRef: RefObject<Gtk.Button>;
}

function buildUi(app: Adw.Application | null): Ui {
    const window = new Adw.ApplicationWindow({
        title: 'react-host counter',
        default_width: 480,
        default_height: 520,
        ...(app ? { application: app } : {}),
    });
    const incrementRef = createRef<Gtk.Button>();
    const root = createRoot(window as unknown as Gtk.Widget);
    // `render` flushes synchronously (see `createRoot`): a ConcurrentRoot's first
    // commit is default-lane, and with no main loop running yet an unflushed render
    // leaves the container empty and says nothing.
    root.render(<Counter incrementRef={incrementRef} />);
    return { window, root, incrementRef };
}

/** Titles of the Adw.ActionRows GTK actually holds, in GTK's own order. */
const rowTitles = (root: Gtk.Widget): string[] =>
    descendants(root)
        .filter((w): w is Adw.ActionRow => w instanceof Adw.ActionRow)
        .map((row) => row.title);

/** A button by its label, from the real tree — never from React's own bookkeeping. */
const buttonNamed = (root: Gtk.Widget, label: string): Gtk.Button | null =>
    findDescendant(root, (w) => w instanceof Gtk.Button && w.label === label) as Gtk.Button | null;

/**
 * Run the default main context until `done()` or the budget is spent.
 *
 * `scheduler`'s host callback is a GLib timer source, so nothing drives it inside a
 * probe — an application has `Gtk.Application.run`, this has the loop below.
 * BOUNDED on purpose: a scheduler that never runs has to fail an assertion rather
 * than hang the process, which is how a probe turns into a `showcase-smoke`
 * timeout that reports as "still up".
 */
function pump(done: () => boolean, budget = 200): boolean {
    const context = GLib.MainContext.default();
    for (let i = 0; i < budget; i++) {
        if (done()) return true;
        context.iteration(false);
    }
    return done();
}

/** Everything this showcase claims, read back off the REAL widget tree. */
function assertUi(ui: Ui, check: ProbeCheck): Record<string, unknown> {
    // 0. The build recipe held. `react-reconciler/index.js` picks its bundle from
    //    `process.env.NODE_ENV`, and the DEVELOPMENT one reaches for `document`,
    //    `HTMLCanvasElement` and `Path2D` — which makes `--globals auto` inject the
    //    GTK-backed DOM registers and pull gi://Gdk, GdkPixbuf, Pango and PangoCairo
    //    into a bundle that needs none of them. Even the production `scheduler`
    //    carries `typeof navigator !== 'undefined'`, hence `--exclude-globals
    //    navigator`. If either global exists here, the recipe was lost.
    const globals = globalThis as unknown as Record<string, unknown>;
    check('no DOM was injected (the production define held)', typeof globals.document === 'undefined');
    check('no navigator was injected (--exclude-globals held)', typeof globals.navigator === 'undefined');

    const window = ui.window as unknown as Gtk.Widget;

    // 1. The string enum nick reached GTK. GObject would have kept HORIZONTAL, so
    //    read the property back — materialisation always returns something.
    //
    //    Reached through the BUTTON, not as "the first Gtk.Box in the window":
    //    Adw.ApplicationWindow, Adw.ToolbarView and Adw.PreferencesPage all nest
    //    boxes of their own, and both siblings recorded the same measurement — the
    //    search-by-type version passed for a box the markup never wrote.
    const increment = buttonNamed(window, 'Increment');
    check('the increment button was built', increment !== null);
    const box = increment?.get_parent() as Gtk.Box | null;
    check('the JSX box is the button parent', box instanceof Gtk.Box);
    check("orientation='vertical' reached GTK", box?.orientation === Gtk.Orientation.VERTICAL);

    // 2. Slotted placement authored as a JSX attribute — asserted as PLACEMENT, not
    //    as presence: a slot that is never read is the whole point of the attribute,
    //    so "it is somewhere in the subtree" asserts nothing (measured on the Solid
    //    sibling, where the presence version passed with the header bar genuinely
    //    rendered at the FOOT of the window).
    const toolbarView = findDescendant(window, (w) => w instanceof Adw.ToolbarView) as Adw.ToolbarView | null;
    check('AdwToolbarView is in the window', toolbarView !== null);
    check('slot="content" placed the page', toolbarView?.get_content() instanceof Adw.PreferencesPage);

    const headerBar = findDescendant(window, (w) => w instanceof Adw.HeaderBar) as Adw.HeaderBar | null;
    check('AdwHeaderBar is in the window', headerBar !== null);
    //    `slot="top"` has no getter — `add_top_bar` is write-only and the height
    //    getters read 0 until the window is allocated, which a headless probe never
    //    does. What IS readable is the style class Adwaita puts on the revealer it
    //    wraps each bar in: `top-bar` or `bottom-bar`. Walking up to the toolbar view
    //    and looking for it separates the two slots, which no subtree search can.
    const topBarClassAbove = (widget: Gtk.Widget | null): boolean => {
        for (let w = widget; w !== null && w !== toolbarView; w = w.get_parent()) {
            if (w.get_css_classes().includes('top-bar')) return true;
        }
        return false;
    };
    check('slot="top" put the header in the TOP bar', topBarClassAbove(headerBar));
    const titleWidget = headerBar?.get_title_widget();
    check(
        'slot="title" placed the header label',
        titleWidget instanceof Gtk.Label && titleWidget.label === 'Built by react-reconciler',
    );

    // 3. A CONSTRUCT-ONLY property authored in JSX reached `g_object_new`. React
    //    hands the vnode props to `createInstance`, so unlike the Solid path the host
    //    never has to rebuild the widget to apply it — the adapter difference
    //    ADR 0027 § Decision 5 predicts, from the other side.
    const clicks = findDescendant(
        window,
        (w) => w instanceof Adw.ActionRow && w.title === 'Clicks',
    ) as Adw.ActionRow | null;
    check('the counter row was built', clicks !== null);
    check('construct-only cssName reached g_object_new', clicks?.cssName === 'row');

    // 4. React's OBJECT `ref` — the spelling the Solid surface's `ref` type cannot
    //    express. Asserted as IDENTITY against the widget found by walking the real
    //    tree, because `getPublicInstance` returning *a* widget proves nothing. The
    //    other half of that op — that a ref never receives the `GtkListBoxRow` the
    //    host wrapped a child in — needs a wrapping container this window does not
    //    have, and is a vector in `adapters/react.spec.ts` instead.
    check('createRef received the author’s own widget', ui.incrementRef.current === increment);

    // 5. The closed conditional occupies no GTK slot. React creates no node for
    //    `null` at all — no anchor to resolve past — so the box holds exactly the
    //    three buttons.
    const actionLabels = () => gtkChildren(box as Gtk.Widget).map((w) => (w as Gtk.Button | Gtk.Label).label);
    check(
        'a closed conditional does not occupy a GTK slot',
        JSON.stringify(actionLabels()) === JSON.stringify(['Increment', 'Add row', 'Remove first row']),
    );

    // 6. The signal is connected to the real widget AND the update is CONCURRENT.
    //    Emitted on GTK's side, not by calling the closure — calling it would prove
    //    only that the closure exists. Both halves are the claim: default-lane work
    //    goes through `scheduler`, so the tree is still the old one the instant the
    //    signal returns, and it is patched once the main context runs. A `render()`
    //    that had quietly become synchronous here would fail the FIRST of these.
    increment?.emit('clicked');
    check('a setState from a GTK handler has not landed yet (default lane)', clicks?.subtitle === '0');
    check(
        'the main context flushed the scheduled render',
        pump(() => clicks?.subtitle === '1'),
    );

    // 7. The opened branch lands BETWEEN its siblings, through `insertBefore`.
    check(
        'the opened conditional lands between its siblings',
        JSON.stringify(actionLabels()) === JSON.stringify(['Increment', 'clicked 1x', 'Add row', 'Remove first row']),
    );

    // 8. A keyed list inserts before the static sibling — through the `remove-all`
    //    degradation of Adw.PreferencesGroup — and removal takes the right row out
    //    while the survivor keeps its IDENTITY. Order alone is satisfied by
    //    remove-all-and-re-append, which destroys focus and scroll position.
    const addButton = buttonNamed(window, 'Add row');
    addButton?.emit('clicked');
    check(
        'the first row arrived',
        pump(() => rowTitles(window).length === 2),
    );
    addButton?.emit('clicked');
    check(
        'the second row arrived',
        pump(() => rowTitles(window).length === 3),
    );
    check(
        'keyed rows land before the counter row',
        JSON.stringify(rowTitles(window)) === JSON.stringify(['Row 1', 'Row 2', 'Clicks']),
    );

    const survivor = findDescendant(window, (w) => w instanceof Adw.ActionRow && w.title === 'Row 2');
    buttonNamed(window, 'Remove first row')?.emit('clicked');
    check(
        'the removal landed',
        pump(() => rowTitles(window).length === 2),
    );
    check(
        'removing the first row leaves the rest in order',
        JSON.stringify(rowTitles(window)) === JSON.stringify(['Row 2', 'Clicks']),
    );
    check(
        'the surviving row is the SAME widget, not a re-created one',
        survivor !== null &&
            findDescendant(window, (w) => w instanceof Adw.ActionRow && w.title === 'Row 2') === survivor,
    );

    return {
        rows: rowTitles(window),
        actions: actionLabels(),
        tree: dumpTree(window).split('\n').length,
    };
}

await runHostProbeApp<Ui>({
    applicationId: 'eu.jumplink.ReactHostCounter',
    // Ignores the application on purpose — and so does the harness, which always
    // probes headless. Building an `Adw.ApplicationWindow` with `application: app`
    // inside `activate` is the neighbourhood of the segfault recorded on
    // `runHostProbeApp`.
    build: () => buildUi(null),
    assert: assertUi,
    // The probe builds a real toplevel of its own. `unmount` tears down what React
    // owns inside it; `destroy` is what unparenting cannot reach. Run BEFORE the
    // harness counts diagnostics, which is the point of the hook — a finalize-time
    // `still has children left` is exactly the class that only appears there.
    teardown: (ui) => {
        ui.root.unmount();
        ui.window.destroy();
    },
    present: (ui) => ui.window.present(),
});
