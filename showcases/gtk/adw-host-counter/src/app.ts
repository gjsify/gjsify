// SPDX-License-Identifier: MIT
//
// A Libadwaita window built ENTIRELY through `@gjsify/gtk-host` — no `new Gtk.X()`
// anywhere below, only `createElement`/`insert`/`setProp`/`setEventHandler`.
//
// That constraint is the point. This is what a framework adapter emits, so if a
// window can be built this way, Vue's `RendererOptions`, React's `HostConfig` and
// Solid's universal renderer have everything they need — they add reconciliation,
// not GTK knowledge.
//
// SELF-VERIFYING, in BOTH modes, and this file no longer carries the machinery for
// it. `runHostProbeApp` owns the `GJSIFY_HOST_PROBE=1`-vs-`activate` split, the
// diagnostics gate, the `check()` recorder and the `PROBE: PASS|FAIL <json>` line;
// what is left here is the tree and the assertions about it. Seventy of this
// file's lines were that harness, 58 of them byte-identical to the Solid
// showcase's copy — and both copies re-implemented the GLib writer func that
// `@gjsify/gtk-host/conformance` already exports, complete with the missing-MESSAGE
// bug it exists to end.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import {
    createElement,
    insert,
    materialize,
    registerBuiltinWidgets,
    remove,
    runHostProbeApp,
    setEventHandler,
    setProp,
    widgetOf,
    type HostElement,
    type ProbeCheck,
} from '@gjsify/gtk-host';
import { descendants, dumpTree, findDescendant } from '@gjsify/gtk-host/conformance';

registerBuiltinWidgets();

interface Ui {
    window: HostElement;
    buttons: HostElement;
    rows: HostElement[];
    group: HostElement;
    countRow: HostElement;
    /** Exposed so the probe can fire the real `clicked` signal instead of the closure. */
    incrementButton: HostElement;
    addRow: () => void;
    removeFirstRow: () => void;
    increment: () => void;
    readonly count: () => number;
}

/** Build the whole UI through host ops. The app never touches a GTK constructor. */
function buildUi(app: Adw.Application | null): Ui {
    let count = 0;
    let nextRow = 1;

    const window = createElement('AdwApplicationWindow', {
        title: 'gtk-host counter',
        defaultWidth: 480,
        defaultHeight: 520,
        ...(app ? { application: app } : {}),
    });

    const toolbar = createElement('AdwToolbarView');
    const header = createElement('AdwHeaderBar', { slot: 'top' });
    const title = createElement('GtkLabel', { label: 'Built by @gjsify/gtk-host', slot: 'title' });

    const page = createElement('AdwPreferencesPage', { slot: 'content' });
    const group = createElement('AdwPreferencesGroup', { title: 'Rows' });
    const countRow = createElement('AdwActionRow', { title: 'Clicks', subtitle: '0' });

    // `orientation: 'vertical'` as a STRING is the case GObject drops silently —
    // the host resolves the nick against GtkOrientation.
    // `Adw.PreferencesPage.add()` takes AdwPreferencesGroup and nothing else, so the
    // buttons need their own group. The host reports that refusal by tag name.
    const buttonGroup = createElement('AdwPreferencesGroup', { title: 'Actions' });
    const buttons = createElement('GtkBox', { orientation: 'vertical', spacing: 12, marginTop: 12 });
    const incrementButton = createElement('GtkButton', { label: 'Increment', halign: 'center' });
    const addButton = createElement('GtkButton', { label: 'Add row', halign: 'center' });
    const removeButton = createElement('GtkButton', { label: 'Remove first row', halign: 'center' });

    insert(toolbar, window);
    insert(header, toolbar);
    insert(title, header);
    insert(page, toolbar);
    insert(group, page);
    insert(countRow, group);
    insert(buttonGroup, page);
    insert(buttons, buttonGroup);
    insert(incrementButton, buttons);
    insert(addButton, buttons);
    insert(removeButton, buttons);

    const rows: HostElement[] = [];

    const increment = () => {
        count += 1;
        setProp(countRow, 'subtitle', `${count}`);
    };

    const addRow = () => {
        const row = createElement('AdwActionRow', { title: `Row ${nextRow}`, subtitle: 'added at runtime' });
        nextRow += 1;
        // Inserted BEFORE the counter row on purpose: `Adw.PreferencesGroup` has no
        // `insert()`, so the policy declares `reorder: 'remove-all'` and the host
        // re-appends the tail. The probe checks the resulting order.
        insert(row, group, countRow);
        rows.push(row);
    };

    const removeFirstRow = () => {
        const row = rows.shift();
        if (row) remove(row);
    };

    setEventHandler(incrementButton, 'onClicked', increment);
    setEventHandler(addButton, 'onClicked', addRow);
    setEventHandler(removeButton, 'onClicked', removeFirstRow);

    return {
        window,
        buttons,
        rows,
        group,
        countRow,
        incrementButton,
        addRow,
        removeFirstRow,
        increment,
        count: () => count,
    };
}

/** Titles of the Adw.ActionRows GTK actually holds, in GTK's own order. */
const rowTitles = (group: HostElement): string[] =>
    descendants(widgetOf(group))
        .filter((w): w is Adw.ActionRow => w instanceof Adw.ActionRow)
        .map((row) => row.title);

/** Everything this showcase claims, read back off the REAL widget tree. */
function assertUi(ui: Ui, check: ProbeCheck): Record<string, unknown> {
    // 1. The string enum nick reached GTK. GObject would have kept HORIZONTAL —
    //    so read the property back rather than assert that materialisation
    //    returned something, which it always does or throws.
    const root = widgetOf(ui.window);
    check(
        "orientation: 'vertical' reached GTK",
        (widgetOf(ui.buttons) as Gtk.Box).orientation === Gtk.Orientation.VERTICAL,
    );

    // 2. Slotted PLACEMENT, not presence. Searched over descendants rather than
    //    direct children, because Adw.ApplicationWindow and Adw.HeaderBar both nest
    //    behind internal widgets — but "somewhere in the subtree" is what the two
    //    checks here used to assert, and MEASURED that passed with the header bar
    //    moved to `slot: 'bottom'`, i.e. rendered at the foot of the window, output
    //    byte-identical. A slot nothing reads back is a slot nothing proves.
    const toolbarView = findDescendant(root, (w) => w instanceof Adw.ToolbarView) as Adw.ToolbarView | null;
    check('AdwToolbarView is in the window', toolbarView !== null);
    check('the page is the toolbar view CONTENT', toolbarView?.get_content() instanceof Adw.PreferencesPage);

    const headerBar = findDescendant(root, (w) => w instanceof Adw.HeaderBar) as Adw.HeaderBar | null;
    check('AdwHeaderBar is in the window', headerBar !== null);
    //    `add_top_bar` is write-only and the height getters read 0 until the window
    //    is allocated, which a headless probe never does. Adwaita's own style class
    //    on the revealer it wraps each bar in (`top-bar` / `bottom-bar`) is readable
    //    without allocation and separates the two slots.
    let inTopBar = false;
    for (let w: Gtk.Widget | null = headerBar; w !== null && w !== toolbarView; w = w.get_parent()) {
        if (w.get_css_classes().includes('top-bar')) inTopBar = true;
    }
    check('the header bar is in the TOP bar', inTopBar);
    //    `slot: 'title'` has an exact getter, unlike the two bar slots.
    const titleWidget = headerBar?.get_title_widget();
    check(
        "slot: 'title' placed the header label",
        titleWidget instanceof Gtk.Label && titleWidget.label === 'Built by @gjsify/gtk-host',
    );

    // 3. Ordered insert with the declared remove-all degradation lands in order.
    ui.addRow();
    ui.addRow();
    check(
        'rows land before the counter row',
        JSON.stringify(rowTitles(ui.group)) === JSON.stringify(['Row 1', 'Row 2', 'Clicks']),
    );

    // 4. Removal takes the right row out and leaves the rest.
    ui.removeFirstRow();
    check(
        'removing the first row leaves the rest in order',
        JSON.stringify(rowTitles(ui.group)) === JSON.stringify(['Row 2', 'Clicks']),
    );

    // 5. A signal bound through the host actually fires, and the property write
    //    lands. Emitted on GTK's side, NOT by calling `ui.increment()` — that only
    //    proves the closure exists. MEASURED: with the closure call, deleting all
    //    three `setEventHandler` calls still printed PROBE: PASS with byte-identical
    //    output, while this file's README claimed a bound signal was proven.
    (widgetOf(ui.incrementButton) as Gtk.Button).emit('clicked');
    check(
        'clicking updated the subtitle through the signal',
        (widgetOf(ui.countRow) as Adw.ActionRow).subtitle === '1',
    );
    check('the signal ran exactly once', ui.count() === 1);

    // 6. Bottom-up construction into a container that cannot insert.
    //    Every framework materialises a subtree before inserting it, and the
    //    `remove-all` policy has to replay it without touching non-children.
    //    Reproduced by review: this emitted four Adwaita criticals at exit 0.
    const lateGroup = createElement('AdwPreferencesGroup');
    const lateRows = [0, 1, 2].map((i) => {
        const row = createElement('AdwActionRow', { title: `Late ${i}` });
        materialize(row);
        return row;
    });
    for (const row of lateRows) insert(row, lateGroup);
    materialize(lateGroup);
    check(
        'bottom-up rows keep their order',
        JSON.stringify(rowTitles(lateGroup)) === JSON.stringify(['Late 0', 'Late 1', 'Late 2']),
    );

    return { rows: rowTitles(ui.group), count: ui.count(), tree: dumpTree(root).split('\n').length };
}

await runHostProbeApp<Ui>({
    applicationId: 'eu.jumplink.AdwHostCounter',
    build: buildUi,
    assert: assertUi,
    present: (ui) => (widgetOf(ui.window) as Adw.ApplicationWindow).present(),
});
