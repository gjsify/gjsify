// Placement vectors — one per policy kind, asserted against the REAL GTK tree.
//
// Every assertion here reads `get_first_child()`/`get_next_sibling()` through
// `conformance/gtkChildTypes`, never our own shadow links. A renderer that
// asserts against its own bookkeeping agrees with itself while the window is
// wrong, which is the failure this package exists to make impossible.

import { describe, expect, it, on } from '@gjsify/unit';

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import { gtkChildTypes, gtkChildren } from './conformance/index.js';
import { registerBuiltinWidgets } from './descriptors/index.js';
import {
    createAnchor,
    createElement,
    createText,
    destroy,
    insert,
    materialize,
    mountRoot,
    remove,
    setElementText,
    setEventHandler,
    setProp,
} from './host.js';
import type { HostElement } from './types.js';

const widgetOf = (el: HostElement) => materialize(el) as unknown as Gtk.Widget;

/** Build `n` labels, already materialised, so identity can be compared later. */
function labels(n: number): HostElement[] {
    return Array.from({ length: n }, (_, i) => {
        const el = createElement('GtkLabel', { label: `L${i}` });
        materialize(el);
        return el;
    });
}

export default async () => {
    await on('Gjs', async () => {
        Gtk.init();
        registerBuiltinWidgets();

        await describe('ordered — Gtk.Box (native reorder)', async () => {
            await it('appends in document order', async () => {
                const box = createElement('GtkBox');
                const parent = widgetOf(box);
                const [a, b, c] = labels(3);
                insert(a, box);
                insert(b, box);
                insert(c, box);
                expect(gtkChildTypes(parent)).toStrictEqual(['GtkLabel', 'GtkLabel', 'GtkLabel']);
                expect(gtkChildren(parent).map((w) => (w as Gtk.Label).label)).toStrictEqual(['L0', 'L1', 'L2']);
            });

            await it('inserts before an anchor node at the right position', async () => {
                const box = createElement('GtkBox');
                const parent = widgetOf(box);
                const [a, b, c] = labels(3);
                insert(a, box);
                insert(c, box);
                insert(b, box, c);
                expect(gtkChildren(parent).map((w) => (w as Gtk.Label).label)).toStrictEqual(['L0', 'L1', 'L2']);
            });

            await it('keeps widget IDENTITY across a reorder', async () => {
                // Order alone is satisfied by remove-all-and-re-append. Identity is
                // not: a reorder that recreates widgets destroys focus, scroll
                // position and any state the widget owns.
                const box = createElement('GtkBox');
                const parent = widgetOf(box);
                const [a, b] = labels(2);
                insert(a, box);
                insert(b, box);
                const before = gtkChildren(parent);
                remove(b);
                insert(b, box, a);
                const after = gtkChildren(parent);
                expect(after[0] === before[1]).toBe(true);
                expect(after[1] === before[0]).toBe(true);
            });

            await it('removes the middle child without disturbing its siblings', async () => {
                const box = createElement('GtkBox');
                const parent = widgetOf(box);
                const [a, b, c] = labels(3);
                for (const el of [a, b, c]) insert(el, box);
                remove(b);
                expect(gtkChildren(parent).map((w) => (w as Gtk.Label).label)).toStrictEqual(['L0', 'L2']);
            });
        });

        await describe('ordered — Adw.PreferencesGroup (declared remove-all degradation)', async () => {
            await it('still lands a middle insert in the right order', async () => {
                // Measured: this container has add()/remove() and NO insert(), so the
                // policy declares reorder: 'remove-all' and pays a tail re-append.
                const group = createElement('AdwPreferencesGroup');
                materialize(group);
                const rows = [0, 1, 2].map((i) => {
                    const row = createElement('AdwActionRow', { title: `R${i}` });
                    materialize(row);
                    return row;
                });
                insert(rows[0], group);
                insert(rows[2], group);
                insert(rows[1], group, rows[2]);
                const listed = gtkChildren(materialize(group) as unknown as Gtk.Widget);
                const titles = collectTitles(listed);
                expect(titles).toStrictEqual(['R0', 'R1', 'R2']);
            });
        });

        await describe('indexed — Gtk.ListBox (the parent addresses a wrapper row)', async () => {
            await it('wraps each child in a GtkListBoxRow', async () => {
                const list = createElement('GtkListBox');
                const widget = materialize(list) as unknown as Gtk.ListBox;
                const [a] = labels(1);
                insert(a, list);
                expect(gtkChildTypes(widget as unknown as Gtk.Widget)).toStrictEqual(['GtkListBoxRow']);
                expect(widget.get_row_at_index(0) !== null).toBe(true);
            });

            await it('keeps get_row_at_index in step with document order', async () => {
                // The bug this pins: a generic `insert_before` bypasses the wrap,
                // `get_row_at_index(0)` keeps returning the old row, and teardown
                // floods `Gtk-WARNING: Tried to remove non-child` — at exit code 0.
                const list = createElement('GtkListBox');
                const widget = materialize(list) as unknown as Gtk.ListBox;
                const [a, b, c] = labels(3);
                insert(a, list);
                insert(c, list);
                insert(b, list, c);
                const rowLabels = [0, 1, 2].map((i) => (widget.get_row_at_index(i)!.get_child() as Gtk.Label).label);
                expect(rowLabels).toStrictEqual(['L0', 'L1', 'L2']);
            });

            await it('does not wrap a row the author wrote themselves', async () => {
                // `<GtkListBox><GtkListBoxRow>` is how anyone reaching for
                // `activatable`/`selectable` spells it; a second wrap would nest
                // two selectable rows and detach activation from the configured one.
                const list = createElement('GtkListBox');
                const widget = materialize(list) as unknown as Gtk.ListBox;
                const row = createElement('GtkListBoxRow', { activatable: false });
                const inner = createElement('GtkLabel', { label: 'own row' });
                insert(inner, row);
                insert(row, list);
                expect(gtkChildTypes(widget as unknown as Gtk.Widget)).toStrictEqual(['GtkListBoxRow']);
                expect(widget.get_row_at_index(0)!.activatable).toBe(false);
                expect((widget.get_row_at_index(0)!.get_child() as Gtk.Label).label).toBe('own row');
            });

            await it('removes a row by its wrapper, not by the child', async () => {
                const list = createElement('GtkListBox');
                const widget = materialize(list) as unknown as Gtk.ListBox;
                const [a, b] = labels(2);
                insert(a, list);
                insert(b, list);
                remove(a);
                expect(widget.get_row_at_index(1)).toBe(null);
                expect((widget.get_row_at_index(0)!.get_child() as Gtk.Label).label).toBe('L1');
            });
        });

        await describe('single, slotted, keyed, coords', async () => {
            await it('single: set_child replaces, it does not append', async () => {
                const bin = createElement('AdwBin');
                const widget = materialize(bin) as unknown as Adw.Bin;
                const [a, b] = labels(2);
                insert(a, bin);
                expect((widget.get_child() as Gtk.Label).label).toBe('L0');
                remove(a);
                insert(b, bin);
                expect((widget.get_child() as Gtk.Label).label).toBe('L1');
            });

            await it('slotted: the CHILD declares where it lands', async () => {
                const bar = createElement('AdwHeaderBar');
                const widget = materialize(bar) as unknown as Adw.HeaderBar;
                const start = createElement('GtkButton', { label: 'back', slot: 'start' });
                const end = createElement('GtkButton', { label: 'menu', slot: 'end' });
                const title = createElement('GtkLabel', { label: 'Title', slot: 'title' });
                insert(start, bar);
                insert(end, bar);
                insert(title, bar);
                expect((widget.get_title_widget() as Gtk.Label).label).toBe('Title');
                // Packed children are NOT direct children: Adw.HeaderBar nests them
                // in its own centering box, so a direct-child assertion here would
                // fail for the right reason and teach the wrong lesson.
                expect(descendantLabels(widget as unknown as Gtk.Widget).sort()).toStrictEqual(['back', 'menu']);
            });

            await it('slotted: an unknown slot names the known ones', async () => {
                const bar = createElement('AdwHeaderBar');
                materialize(bar);
                const child = createElement('GtkButton', { slot: 'middle' });
                expect(() => insert(child, bar)).toThrow('has no slot "middle"');
            });

            await it('keyed: Gtk.Stack takes the name off the child', async () => {
                const stack = createElement('GtkStack');
                const widget = materialize(stack) as unknown as Gtk.Stack;
                const page = createElement('GtkLabel', { label: 'one', layout: { name: 'first', title: 'First' } });
                insert(page, stack);
                expect(widget.get_child_by_name('first') !== null).toBe(true);
            });

            await it('coords: Gtk.Grid reads the position off the child', async () => {
                const grid = createElement('GtkGrid');
                const widget = materialize(grid) as unknown as Gtk.Grid;
                const cell = createElement('GtkLabel', { label: 'cell', layout: { column: 1, row: 2 } });
                insert(cell, grid);
                expect((widget.get_child_at(1, 2) as Gtk.Label)?.label).toBe('cell');
            });

            await it('none: a childless widget names the three fixes', async () => {
                const image = createElement('GtkImage');
                materialize(image);
                const [a] = labels(1);
                expect(() => insert(a, image)).toThrow('cannot adopt');
            });

            await it('names both tags when GTK itself refuses the child type', async () => {
                // Adw.PreferencesPage.add() takes AdwPreferencesGroup and nothing
                // else. GTK's own message ("Object is of type Gtk.Box - cannot
                // convert to AdwPreferencesGroup") names neither the parent that
                // refused nor where in the tree it happened.
                const page = createElement('AdwPreferencesPage');
                materialize(page);
                const box = createElement('GtkBox');
                materialize(box);
                expect(() => insert(box, page)).toThrow('<AdwPreferencesPage> refused <GtkBox>');
            });

            await it('a refused placement leaves nothing behind in the shadow tree', async () => {
                // Linking before attaching is correct — the policy needs the
                // sibling links to resolve an anchor — so the throw path has to
                // undo it, or the shadow tree and the GTK tree disagree.
                const image = createElement('GtkImage');
                materialize(image);
                const [a] = labels(1);
                try {
                    insert(a, image);
                } catch {
                    /* expected */
                }
                expect(image.first).toBe(null);
                expect(a.parent).toBe(null);
            });
        });

        await describe('anchors never enter the GTK tree', async () => {
            await it('an empty branch does not shift a sibling index', async () => {
                // This is the structural bug that stalled gnome-vue: a comment
                // anchor counted as a child, so every insertion after a `v-if`
                // landed one position off.
                const box = createElement('GtkBox');
                const parent = widgetOf(box);
                const [a, b] = labels(2);
                const anchor = createAnchor('v-if');
                insert(a, box);
                insert(anchor, box);
                insert(b, box);
                expect(gtkChildTypes(parent)).toStrictEqual(['GtkLabel', 'GtkLabel']);
                expect(gtkChildren(parent).map((w) => (w as Gtk.Label).label)).toStrictEqual(['L0', 'L1']);
            });

            await it('resolves forward past an anchor when inserting before it', async () => {
                const box = createElement('GtkBox');
                const parent = widgetOf(box);
                const [a, b, c] = labels(3);
                const anchor = createAnchor();
                insert(a, box);
                insert(anchor, box);
                insert(c, box);
                insert(b, box, anchor);
                expect(gtkChildren(parent).map((w) => (w as Gtk.Label).label)).toStrictEqual(['L0', 'L1', 'L2']);
            });
        });

        await describe('text', async () => {
            await it('writes a text child into the declared sink', async () => {
                const label = createElement('GtkLabel');
                const widget = materialize(label) as unknown as Gtk.Label;
                insert(createText('hello'), label);
                expect(widget.label).toBe('hello');
            });

            await it('concatenates sibling text nodes', async () => {
                const label = createElement('GtkLabel');
                const widget = materialize(label) as unknown as Gtk.Label;
                insert(createText('a'), label);
                insert(createText('b'), label);
                expect(widget.label).toBe('ab');
            });

            await it('setElementText replaces children wholesale', async () => {
                const button = createElement('GtkButton');
                const widget = materialize(button) as unknown as Gtk.Button;
                insert(createText('old'), button);
                setElementText(button, 'new');
                expect(widget.label).toBe('new');
            });

            await it('clears the sink when the last text child goes away', async () => {
                // Without this, deleting text leaves the old string on screen —
                // the widget keeps rendering what nothing describes any more.
                const label = createElement('GtkLabel');
                const widget = materialize(label) as unknown as Gtk.Label;
                const text = createText('here');
                insert(text, label);
                expect(widget.label).toBe('here');
                remove(text);
                expect(widget.label).toBe('');
            });

            await it('does not clear a label that an authored prop set', async () => {
                const label = createElement('GtkLabel', { label: 'authored' });
                const widget = materialize(label) as unknown as Gtk.Label;
                const child = createElement('GtkLabel');
                materialize(child);
                // inserting and removing an ELEMENT must not touch the text sink
                expect(() => insert(child, label)).toThrow('cannot adopt');
                expect(widget.label).toBe('authored');
            });

            await it('refuses text on a widget with no sink, naming the tag', async () => {
                const image = createElement('GtkImage');
                materialize(image);
                expect(() => insert(createText('nope'), image)).toThrow('GtkImage');
            });
        });

        await describe('signals', async () => {
            await it('keeps exactly one native handler per signal name', async () => {
                const button = createElement('GtkButton');
                const widget = materialize(button) as unknown as Gtk.Button;
                let first = 0;
                let second = 0;
                setEventHandler(button, 'onClicked', () => {
                    first += 1;
                });
                setEventHandler(button, 'onClicked', () => {
                    second += 1;
                });
                widget.emit('clicked');
                expect(first).toBe(0);
                expect(second).toBe(1);
                expect(button.handlers.size).toBe(1);
            });

            await it('binds a raw signal name through the escape hatch', async () => {
                const list = createElement('GtkListBox');
                const widget = materialize(list) as unknown as Gtk.ListBox;
                let seen = 0;
                setEventHandler(list, 'on:row-selected', () => {
                    seen += 1;
                });
                widget.emit('row-selected', null);
                expect(seen).toBe(1);
            });

            await it('does not report a notify:: raised by our own write', async () => {
                const label = createElement('GtkLabel');
                materialize(label);
                let notified = 0;
                setEventHandler(label, 'onNotifyLabel', () => {
                    notified += 1;
                });
                setProp(label, 'label', 'written by the host');
                expect(notified).toBe(0);
            });

            await it('destroy disconnects every handler', async () => {
                const button = createElement('GtkButton');
                const widget = materialize(button) as unknown as Gtk.Button;
                let fired = 0;
                setEventHandler(button, 'onClicked', () => {
                    fired += 1;
                });
                const box = createElement('GtkBox');
                materialize(box);
                insert(button, box);
                destroy(button);
                widget.emit('clicked');
                expect(fired).toBe(0);
            });
        });

        await describe('rebuild inside a wrapping parent', async () => {
            await it('replaces the child AND its row, keeping the index', async () => {
                // The wrapper is the parent's address for this child. A rebuild
                // that swapped the widget but kept the old row would leave the
                // ListBox pointing at a row whose child is gone — the same class
                // of mismatch as the generic-insert bug, one level down.
                const list = createElement('GtkListBox');
                const widget = materialize(list) as unknown as Gtk.ListBox;
                const [first] = labels(1);
                const target = createElement('GtkLabel', { label: 'T', cssName: 'before' });
                insert(first, list);
                insert(target, list);
                const oldRow = widget.get_row_at_index(1);

                setProp(target, 'cssName', 'after');

                const newRow = widget.get_row_at_index(1);
                expect(newRow !== null).toBe(true);
                expect(newRow === oldRow).toBe(false);
                expect((newRow!.get_child() as Gtk.Label).label).toBe('T');
                expect(widget.get_row_at_index(2)).toBe(null);
                expect((widget.get_row_at_index(0)!.get_child() as Gtk.Label).label).toBe('L0');
            });
        });

        await describe('regressions from review', async () => {
            await it('rebuild keeps the children — it must not orphan or double-attach them', async () => {
                // GTK refuses to reparent a widget that still has a parent, and it
                // does so with a warning at exit 0. A rebuild that left the old
                // widget holding the children emptied the subtree silently.
                const box = createElement('GtkBox', { cssName: 'before' });
                const parent = createElement('GtkBox');
                const parentWidget = materialize(parent) as unknown as Gtk.Widget;
                insert(box, parent);
                const [a, b] = labels(2);
                insert(a, box);
                insert(b, box);

                setProp(box, 'cssName', 'after');

                const rebuilt = box.widget as unknown as Gtk.Widget;
                expect(gtkChildren(rebuilt).map((w) => (w as Gtk.Label).label)).toStrictEqual(['L0', 'L1']);
                expect(gtkChildren(parentWidget).length).toBe(1);
            });

            await it('a keyed child with a name but no title still lands', async () => {
                // gtk_stack_add_titled takes THREE arguments; calling it with two
                // threw "At least 3 arguments required", which the host then
                // relabelled as a rejected child TYPE.
                const stack = createElement('GtkStack');
                const widget = materialize(stack) as unknown as Gtk.Stack;
                const page = createElement('GtkLabel', { label: 'one', layout: { name: 'solo' } });
                insert(page, stack);
                expect(widget.get_child_by_name('solo') !== null).toBe(true);
            });

            await it('moving a node out of a ListBox leaves its row behind', async () => {
                const list = createElement('GtkListBox');
                const listWidget = materialize(list) as unknown as Gtk.ListBox;
                const box = createElement('GtkBox');
                const boxWidget = materialize(box) as unknown as Gtk.Widget;
                const [a] = labels(1);
                insert(a, list);
                remove(a);
                insert(a, box);
                // The label itself moved; the GtkListBoxRow did not come along.
                expect(gtkChildTypes(boxWidget)).toStrictEqual(['GtkLabel']);
                expect(listWidget.get_row_at_index(0)).toBe(null);
            });

            await it('single: inserting the replacement before removing the old one keeps it', async () => {
                // Solid's runtime and several React paths insert then unmount. An
                // unconditional set_child(null) on removal emptied the container.
                const bin = createElement('AdwBin');
                const widget = materialize(bin) as unknown as Adw.Bin;
                const [a, b] = labels(2);
                insert(a, bin);
                insert(b, bin);
                remove(a);
                expect((widget.get_child() as Gtk.Label).label).toBe('L1');
            });

            await it('removing a prop resets it to the ParamSpec default', async () => {
                // React hands `undefined` for a prop that disappeared, and
                // set_property(name, undefined) throws "Could not guess
                // unspecified GValue type".
                const label = createElement('GtkLabel', { label: 'set' });
                const widget = materialize(label) as unknown as Gtk.Label;
                expect(widget.label).toBe('set');
                setProp(label, 'label', undefined);
                expect(widget.label).toBe('');
            });

            await it('a failed text insert does not arm the text flag', async () => {
                const box = createElement('GtkBox');
                materialize(box);
                try {
                    insert(createText('x'), box);
                } catch {
                    /* expected */
                }
                expect(box.textFromChildren).toBe(false);
                // …so a later rebuild does not try to flush text into it
                setProp(box, 'cssName', 'rebuilt');
                expect(box.widget !== null).toBe(true);
            });

            await it('destroy closes a toplevel, which unparenting cannot reach', async () => {
                const win = createElement('GtkWindow');
                const widget = materialize(win) as unknown as Gtk.Window;
                destroy(win);
                // A destroyed GtkWindow reports no display connection any more.
                expect(widget.get_parent()).toBe(null);
                expect(win.widget).toBe(null);
            });
        });

        await describe('regressions from the second review', async () => {
            await it('a refused insert does not destroy the siblings already rendered', async () => {
                // The remove-all path detached the whole tail BEFORE the append
                // that can throw, and `insert`'s catch can only repair the shadow
                // tree — so a rejected child took valid, rendered siblings with it.
                const page = createElement('AdwPreferencesPage');
                materialize(page);
                const group = createElement('AdwPreferencesGroup', { title: 'keep me' });
                insert(group, page);
                const before = countDescendants(materialize(page) as unknown as Gtk.Widget, Adw.PreferencesGroup);

                const box = createElement('GtkBox');
                materialize(box);
                try {
                    insert(box, page, group);
                } catch {
                    /* Adw.PreferencesPage.add refuses it */
                }

                expect(countDescendants(materialize(page) as unknown as Gtk.Widget, Adw.PreferencesGroup)).toBe(before);
            });

            await it('bottom-up construction into a remove-all parent stays quiet', async () => {
                // A sibling can own a widget and not be in the tree yet — every
                // framework materialises a subtree before inserting it. Deriving
                // "is in the tree" from `widget !== null` made the replay remove
                // non-children and re-add parented ones.
                const group = createElement('AdwPreferencesGroup');
                const rows = [0, 1, 2].map((i) => {
                    const row = createElement('AdwActionRow', { title: `R${i}` });
                    materialize(row); // materialised BEFORE the parent exists
                    return row;
                });
                for (const row of rows) insert(row, group);
                materialize(group); // the parent appears last, and replays
                expect(collectTitles([materialize(group) as unknown as Gtk.Widget])).toStrictEqual(['R0', 'R1', 'R2']);
                // NOTE: order alone does NOT discriminate here — measured. Without
                // the fix the final order still comes out right and this assertion
                // stays green while GTK logs four criticals at exit 0. The check
                // that fails is the diagnostics count in the showcase probe
                // (`showcases/gtk/adw-host-counter`), which owns its own GLib
                // writer func; this vector only pins the structural half.
            });

            await it('slotted: insert-then-unmount keeps the replacement', async () => {
                // `set_content` holds ONE child, exactly like the `single` policy.
                const view = createElement('AdwToolbarView');
                const widget = materialize(view) as unknown as Adw.ToolbarView;
                const a = createElement('GtkLabel', { label: 'A', slot: 'content' });
                const b = createElement('GtkLabel', { label: 'B', slot: 'content' });
                insert(a, view);
                insert(b, view);
                remove(a);
                expect((widget.get_content() as Gtk.Label).label).toBe('B');
            });

            await it('changing layout moves the child instead of doing nothing', async () => {
                const grid = createElement('GtkGrid');
                const widget = materialize(grid) as unknown as Gtk.Grid;
                const cell = createElement('GtkLabel', { label: 'cell', layout: { column: 0, row: 0 } });
                insert(cell, grid);
                setProp(cell, 'layout', { column: 2, row: 3 });
                expect(widget.get_child_at(0, 0)).toBe(null);
                expect((widget.get_child_at(2, 3) as Gtk.Label)?.label).toBe('cell');
            });

            await it('mountRoot appends after what the application already put there', async () => {
                const container = new Gtk.Box();
                const appOwned = new Gtk.Label({ label: 'app-owned' });
                container.append(appOwned);
                const root = createElement('GtkLabel', { label: 'host-root' });
                mountRoot(root, container);
                expect(gtkChildren(container).map((w) => (w as Gtk.Label).label)).toStrictEqual([
                    'app-owned',
                    'host-root',
                ]);
            });
        });

        await describe('mountRoot resolves the container through the table', async () => {
            await it('mounts into an application-owned widget', async () => {
                const container = new Gtk.Box();
                const child = createElement('GtkLabel', { label: 'mounted' });
                mountRoot(child, container);
                expect(gtkChildren(container).map((w) => (w as Gtk.Label).label)).toStrictEqual(['mounted']);
            });

            await it('resolves a subclass through its nearest registered ancestor', async () => {
                // A consumer's own GObject.registerClass subclass is not in the
                // table; it must inherit its ancestor's placement rules rather
                // than fail, which is why dispatch walks the real type hierarchy.
                const MyBox = GObject.registerClass({ GTypeName: 'GtkHostSpecBox' }, class extends Gtk.Box {});
                const container = new MyBox();
                const child = createElement('GtkLabel', { label: 'inherited' });
                mountRoot(child, container as unknown as Gtk.Widget);
                expect(
                    gtkChildren(container as unknown as Gtk.Widget).map((w) => (w as Gtk.Label).label),
                ).toStrictEqual(['inherited']);
            });
        });

        await describe('construct-only properties rebuild instead of lying', async () => {
            await it('replaces the widget and keeps its position', async () => {
                const box = createElement('GtkBox');
                const parent = widgetOf(box);
                const [a, c] = labels(2);
                const b = createElement('GtkLabel', { label: 'B', cssName: 'first' });
                insert(a, box);
                insert(b, box);
                insert(c, box);
                const before = b.widget as unknown as Gtk.Widget;
                setProp(b, 'cssName', 'second');
                expect(b.widget === before).toBe(false);
                expect(gtkChildren(parent).map((w) => (w as Gtk.Label).label)).toStrictEqual(['L0', 'B', 'L1']);
            });
        });
    });
};

/** How many descendants of a given class a subtree holds. */
function countDescendants(root: Gtk.Widget, klass: unknown): number {
    let n = 0;
    const walk = (w: Gtk.Widget) => {
        if (w instanceof (klass as new () => object)) n += 1;
        for (const child of gtkChildren(w)) walk(child);
    };
    walk(root);
    return n;
}

/** Labels of every GtkButton anywhere under a widget — packed children sit deeper. */
function descendantLabels(root: Gtk.Widget): string[] {
    const out: string[] = [];
    const walk = (w: Gtk.Widget) => {
        const button = w as unknown as { label?: string };
        if (w instanceof Gtk.Button && typeof button.label === 'string') out.push(button.label);
        for (const child of gtkChildren(w)) walk(child);
    };
    walk(root);
    return out;
}

/** Rows of an Adw.PreferencesGroup sit behind its internal box; find them by title. */
function collectTitles(roots: Gtk.Widget[]): string[] {
    const titles: string[] = [];
    const walk = (w: Gtk.Widget) => {
        const row = w as unknown as { title?: string };
        if (typeof row.title === 'string' && /^R\d$/.test(row.title)) titles.push(row.title);
        for (const child of gtkChildren(w)) walk(child);
    };
    for (const r of roots) walk(r);
    return titles;
}
