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
// SELF-VERIFYING: with `GJSIFY_HOST_PROBE=1` the app builds the same tree, asserts
// it against the REAL widget tree (`get_first_child`/`get_next_sibling`, never the
// host's own bookkeeping), prints `PROBE: PASS <json>` and exits 0 — or `PROBE: FAIL`
// and exits 1. That is the machine-checkable proof for this milestone; the
// interactive window is the human one.

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import {
    createElement,
    insert,
    materialize,
    registerBuiltinWidgets,
    remove,
    setEventHandler,
    setProp,
    type HostElement,
} from '@gjsify/gtk-host';
import { dumpTree, gtkChildren } from '@gjsify/gtk-host/conformance';

registerBuiltinWidgets();

interface Ui {
    window: HostElement;
    buttons: HostElement;
    rows: HostElement[];
    group: HostElement;
    countRow: HostElement;
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

    return { window, buttons, rows, group, countRow, addRow, removeFirstRow, increment, count: () => count };
}

/** First descendant matching `pred`, breadth-first over the REAL widget tree. */
function findDescendant(root: Gtk.Widget, pred: (w: Gtk.Widget) => boolean): Gtk.Widget | null {
    const queue: Gtk.Widget[] = [root];
    while (queue.length > 0) {
        const w = queue.shift()!;
        if (w !== root && pred(w)) return w;
        queue.push(...gtkChildren(w));
    }
    return null;
}

/** Titles of the Adw.ActionRows GTK actually holds, in GTK's own order. */
function rowTitles(group: HostElement): string[] {
    const found: string[] = [];
    const walk = (w: Gtk.Widget) => {
        const row = w as unknown as { title?: string };
        if (w instanceof Adw.ActionRow && typeof row.title === 'string') found.push(row.title);
        for (const child of gtkChildren(w)) walk(child);
    };
    walk(materialize(group) as unknown as Gtk.Widget);
    return found;
}

function runProbe(): number {
    const ui = buildUi(null);
    const failures: string[] = [];
    const check = (what: string, ok: boolean) => {
        if (!ok) failures.push(what);
    };

    // 1. The string enum nick reached GTK. GObject would have kept HORIZONTAL —
    //    so read the property back rather than assert that materialisation
    //    returned something, which it always does or throws.
    const box = materialize(ui.window) as unknown as Adw.ApplicationWindow;
    check(
        "orientation: 'vertical' reached GTK",
        (materialize(ui.buttons) as unknown as Gtk.Box).orientation === Gtk.Orientation.VERTICAL,
    );

    // 2. Slotted placement: the header is a top bar, the page is the content.
    //    Searched over DESCENDANTS, not direct children — Adw.ApplicationWindow
    //    and Adw.HeaderBar both nest content behind internal widgets, so a
    //    direct-child assertion would fail for a reason that says nothing.
    check(
        'AdwToolbarView is in the window',
        findDescendant(box as unknown as Gtk.Widget, (w) => w instanceof Adw.ToolbarView) !== null,
    );
    check(
        'AdwHeaderBar is in the window',
        findDescendant(box as unknown as Gtk.Widget, (w) => w instanceof Adw.HeaderBar) !== null,
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

    // 5. A signal bound through the host actually fires, and the property write lands.
    ui.increment();
    check('increment updated the subtitle', (materialize(ui.countRow) as unknown as Adw.ActionRow).subtitle === '1');

    const report = {
        rows: rowTitles(ui.group),
        count: ui.count(),
        tree: dumpTree(box as unknown as Gtk.Widget).split('\n').length,
    };
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
    imports.system.exit(runProbe());
} else {
    const app = new Adw.Application({ application_id: 'eu.jumplink.AdwHostCounter' });
    app.connect('activate', () => {
        // The SAME assertions run before the window is shown, so the existing
        // showcase-smoke leg (which only launches the app and waits) carries them
        // too. Without this the probe would be a developer-only tool and the CI
        // leg would prove nothing beyond "it started" — a green run that checked
        // the interesting part not at all.
        const failed = runProbe();
        if (failed !== 0) imports.system.exit(failed);

        const ui = buildUi(app);
        (materialize(ui.window) as unknown as Adw.ApplicationWindow).present();
    });
    await app.runAsync([]);
}
