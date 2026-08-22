// Placement vectors — one per policy kind, asserted against the REAL GTK tree.
//
// Every assertion here reads `get_first_child()`/`get_next_sibling()` through
// `conformance/gtkChildTypes`, never our own shadow links. A renderer that
// asserts against its own bookkeeping agrees with itself while the window is
// wrong, which is the failure this package exists to make impossible.

import { afterEach, beforeEach, describe, expect, it, on } from '@gjsify/unit';

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import { gtkChildTypes, gtkChildren, installDiagnosticsGate } from './conformance/index.js';
import { BUILTIN_DESCRIPTORS, registerBuiltinWidgets } from './descriptors/index.js';
import {
    adopt,
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
import { reorderMode } from './policies.js';
import { lookupWidget } from './registry.js';
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

        // Every vector below also asserts that GTK reported nothing. Without this
        // the whole mis-parenting class is invisible: it emits criticals and exits 0.
        const diagnostics = installDiagnosticsGate();
        beforeEach(() => diagnostics.reset());
        afterEach(() => diagnostics.assertQuiet());

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
                // NOT sorted: start/end packing order is the only thing this assertion is for.
                expect(descendantLabels(widget as unknown as Gtk.Widget)).toStrictEqual(['back', 'menu']);
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
                // The positive control. Without it, a `writeDepth` left unbalanced
                // anywhere in the process would silence every notify::, greenly.
                (label.widget as unknown as Gtk.Label).set_property('label', 'written by someone else');
                expect(notified).toBe(1);
            });

            await it('refuses two props that resolve to one signal', async () => {
                // `onClicked` and `on:clicked` are the same GObject signal. The
                // second used to disconnect the first without a word, so the
                // first callback simply stopped firing.
                const btn = createElement('GtkButton');
                materialize(btn);
                setEventHandler(btn, 'onClicked', () => {});
                expect(() => setEventHandler(btn, 'on:clicked', () => {})).toThrow('already binds');
                expect(btn.handlers.size).toBe(1);
                // replacing the SAME prop is still fine
                setEventHandler(btn, 'onClicked', () => {});
                expect(btn.handlers.size).toBe(1);
                // …and clearing it frees the signal for the other spelling
                setEventHandler(btn, 'onClicked', null);
                setEventHandler(btn, 'on:clicked', () => {});
                expect(btn.handlers.size).toBe(1);
            });

            await it('destroy leaves no authored state behind', async () => {
                const box = createElement('GtkBox');
                materialize(box);
                const label = createElement('GtkLabel', { label: 'x', layout: { name: 'n' } });
                insert(label, box);
                destroy(label);
                expect(label.props).toStrictEqual({});
                expect(label.layout).toBe(null);
                expect(label.listeners.size).toBe(0);
                expect(label.widget).toBe(null);
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
                // Both of the obvious assertions are vacuous, measured: a
                // GtkWindow's parent is null BEFORE the destroy too, and
                // `win.widget = null` is set unconditionally outside the guard.
                // The toplevel registry is the reader that can tell.
                const before = Gtk.Window.get_toplevels().get_n_items();
                const win = createElement('GtkWindow');
                materialize(win);
                expect(Gtk.Window.get_toplevels().get_n_items()).toBe(before + 1);
                destroy(win);
                expect(Gtk.Window.get_toplevels().get_n_items()).toBe(before);
                expect(win.widget).toBe(null);
            });
        });

        await describe('regressions from the second review', async () => {
            await it('AdwPreferencesPage inserts natively — it is not the group', async () => {
                // The two have near-identical APIs and opposite capabilities:
                // measured, `Adw.PreferencesPage.insert(group, i)` exists and
                // `Adw.PreferencesGroup.insert` is undefined. Copying the group's
                // declared degradation across cost a tail re-append for nothing,
                // and `descriptorProblems()` cannot see it — it asserts only the
                // methods a policy NAMES, never a cheaper one it missed.
                const page = createElement('AdwPreferencesPage');
                const widget = materialize(page) as unknown as Gtk.Widget;
                const groups = [0, 1, 2].map((i) => createElement('AdwPreferencesGroup', { title: `G${i}` }));
                insert(groups[0], page);
                insert(groups[2], page);
                insert(groups[1], page, groups[2]);
                const titles: string[] = [];
                const walk = (w: Gtk.Widget) => {
                    if (w instanceof Adw.PreferencesGroup) titles.push((w as Adw.PreferencesGroup).title);
                    for (const c of gtkChildren(w)) walk(c);
                };
                walk(widget);
                expect(titles).toStrictEqual(['G0', 'G1', 'G2']);
            });

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

        await describe('a rejected operation writes nothing down', async () => {
            // One class, found three times by review: state committed BEFORE the
            // operation that can reject it. Each of these fails without its fix
            // on a LATER, valid call — which is what makes the class expensive.

            await it('a rejected property does not poison the next rebuild', async () => {
                const btn = createElement('GtkButton', { label: 'ok' });
                materialize(btn);
                expect(() => setProp(btn, 'labell', 'typo')).toThrow('has no property');
                // The typo must not survive as authored intent: `materialize`
                // replays `props` verbatim, so a valid construct-only write later
                // would throw from inside the rebuild and leave the widget null.
                setProp(btn, 'cssName', 'rebuilt');
                expect(btn.widget !== null).toBe(true);
                expect((btn.widget as unknown as Gtk.Button).label).toBe('ok');
            });

            await it('a failed setElementText does not arm the text flag', async () => {
                const box = createElement('GtkBox');
                materialize(box);
                try {
                    setElementText(box, 'x');
                } catch {
                    /* GtkBox has no text sink */
                }
                expect(box.textFromChildren).toBe(false);
                setProp(box, 'cssName', 'rebuilt');
                expect(box.widget !== null).toBe(true);
            });

            await it('a refused MOVE leaves the node where it was', async () => {
                // Detaching first and failing second lost the node from a tree
                // that was perfectly valid.
                const box = createElement('GtkBox');
                const boxWidget = materialize(box) as unknown as Gtk.Widget;
                const page = createElement('AdwPreferencesPage');
                materialize(page);
                const [a] = labels(1);
                insert(a, box);
                expect(gtkChildTypes(boxWidget)).toStrictEqual(['GtkLabel']);

                try {
                    insert(a, page);
                } catch {
                    /* AdwPreferencesPage refuses a GtkLabel */
                }

                expect(gtkChildTypes(boxWidget)).toStrictEqual(['GtkLabel']);
                expect(a.parent === box).toBe(true);
                expect(a.attached).toBe(true);
            });
        });

        await describe('what a real renderer does — reproduced from review', async () => {
            await it('a keyed reversal actually reorders the stack', async () => {
                // Measured: `Gtk.Stack.reorder_child_after` is `undefined`, so a
                // keyed container can only append. Before the tail rotation a full
                // Vue reversal was a complete no-op in GTK while the host's own
                // navigators reported the new order — zero diagnostics, exit 0.
                const stack = createElement('GtkStack');
                const widget = materialize(stack) as unknown as Gtk.Stack;
                const pages = ['a', 'b', 'c'].map((n) =>
                    createElement('GtkLabel', { label: n, layout: { name: n, title: n } }),
                );
                for (const p of pages) insert(p, stack);
                expect(stackOrder(widget)).toStrictEqual(['a', 'b', 'c']);

                // the move sequence Vue's patchKeyedChildren performs for a reversal
                insert(pages[2], stack, pages[0]);
                insert(pages[1], stack, pages[0]);
                expect(stackOrder(widget)).toStrictEqual(['c', 'b', 'a']);
            });

            await it('a slotted insert-before lands in document order', async () => {
                const bar = createElement('AdwHeaderBar');
                const widget = materialize(bar) as unknown as Adw.HeaderBar;
                const [x, y, z] = ['x', 'y', 'z'].map((l) => createElement('GtkButton', { label: l, slot: 'start' }));
                insert(x, bar);
                insert(z, bar);
                insert(y, bar, z);
                expect(descendantLabels(widget as unknown as Gtk.Widget)).toStrictEqual(['x', 'y', 'z']);
            });

            await it('reorderMode tells the truth about what GTK can do', async () => {
                // An adapter asks this to decide whether a move is cheap. Claiming
                // `native` for a container with no reorder API is a wrong answer to
                // a question that has a right one.
                expect(reorderMode(lookupWidget('GtkStack').children)).toBe('remove-all');
                expect(reorderMode(lookupWidget('AdwHeaderBar').children)).toBe('remove-all');
                expect(reorderMode(lookupWidget('GtkBox').children)).toBe('native');
                expect(reorderMode(lookupWidget('GtkListBox').children)).toBe('native');
                expect(reorderMode(lookupWidget('AdwPreferencesGroup').children)).toBe('remove-all');
            });

            await it('an empty text placeholder mounts into a sink-less container', async () => {
                // Vue's processFragment marks every v-for with `hostCreateText('')`
                // — not a comment, so an adapter has no hook to route it — and
                // dom-expressions' cleanChildren does `createTextNode("")`. This
                // used to throw, which made a v-for impossible to mount at all.
                for (const tag of ['GtkBox', 'GtkListBox', 'AdwPreferencesGroup', 'GtkStack']) {
                    const parent = createElement(tag);
                    materialize(parent);
                    insert(createText(''), parent);
                }
                // real text must still be refused
                const box = createElement('GtkBox');
                materialize(box);
                expect(() => insert(createText('hello'), box)).toThrow('has no text sink');
            });

            await it('a refused layout write does not disable the write that fixes it', async () => {
                const stack = createElement('GtkStack');
                const widget = materialize(stack) as unknown as Gtk.Stack;
                const page = createElement('GtkLabel', { label: 'p', layout: { name: 'one', title: 'One' } });
                insert(page, stack);

                // a reactive binding transiently produces a non-string name
                expect(() => setProp(page, 'layout', { name: 5, title: 'One' })).toThrow('refused');
                expect(page.attached).toBe(true);
                expect(page.layout).toStrictEqual({ name: 'one', title: 'One' });

                setProp(page, 'layout', { name: 'two', title: 'Two' });
                expect(widget.get_child_by_name('two') !== null).toBe(true);
            });

            await it('a failed materialize leaves the element retryable', async () => {
                // Bottom-up build with one child the container refuses — how every
                // framework builds. Publishing the widget before the replay froze a
                // half-built element for the life of the process.
                const page = createElement('AdwPreferencesPage');
                const good = createElement('AdwPreferencesGroup', { title: 'First' });
                const bad = createElement('GtkButton', { label: 'oops' });
                for (const el of [good, bad]) materialize(el);
                insert(good, page);
                insert(bad, page);

                expect(() => materialize(page)).toThrow('refused');
                expect(page.widget).toBe(null);
                expect(good.attached).toBe(false);

                remove(bad);
                const widget = materialize(page) as unknown as Gtk.Widget;
                expect(countDescendants(widget, Adw.PreferencesGroup)).toBe(1);
            });

            await it('a bad signal name is caught at the call site, not at insert', async () => {
                const btn = createElement('GtkButton');
                expect(() => setEventHandler(btn, 'onFrobnicate', () => {})).toThrow('emits no signal');
                expect(btn.listeners.size).toBe(0);
                // …and the element still works
                materialize(btn);
                setProp(btn, 'cssName', 'fine');
                expect(btn.widget !== null).toBe(true);
            });

            await it('a refused slot write rolls the slot back and stays attached', async () => {
                const bar = createElement('AdwHeaderBar');
                materialize(bar);
                const btn = createElement('GtkButton', { label: 'b' });
                insert(btn, bar);
                expect(() => setProp(btn, 'slot', 'centre')).toThrow('has no slot "centre"');
                expect(btn.slot).toBe(null);
                expect(btn.attached).toBe(true);
                setProp(btn, 'slot', 'end');
                expect(btn.slot).toBe('end');
            });

            await it('a refused setElementText keeps the children', async () => {
                const box = createElement('GtkBox');
                const widget = materialize(box) as unknown as Gtk.Widget;
                const [a, b] = labels(2);
                insert(a, box);
                insert(b, box);
                expect(() => setElementText(box, 'x')).toThrow('has no text sink');
                expect(gtkChildTypes(widget)).toStrictEqual(['GtkLabel', 'GtkLabel']);
                expect(a.widget !== null).toBe(true);
            });
        });

        await describe('every slotted descriptor survives a round trip through every slot', async () => {
            // A mechanism, not a vector: `descriptorProblems()` can tell that a
            // slot method EXISTS, never that removal through that slot works. The
            // asymmetric cases are the ones that bite — `AdwToolbarView.content`
            // is a setter, its `top` is an adder, and one `remove` serves both.
            for (const d of BUILTIN_DESCRIPTORS) {
                if (d.children.kind !== 'slotted') continue;
                for (const slot of Object.keys(d.children.slots)) {
                    await it(`${d.gtype} slot "${slot}"`, async () => {
                        const parent = createElement(d.gtype);
                        materialize(parent);
                        const child = createElement('GtkButton', { label: slot, slot });
                        insert(child, parent);
                        expect(child.attached).toBe(true);
                        remove(child);
                        expect(child.attached).toBe(false);
                        // the diagnostics gate in afterEach is the real assertion:
                        // a removal through the wrong API is a critical at exit 0
                    });
                }
            }
        });

        await describe('regressions from the fourth review', async () => {
            await it('an insert-before into a setter-backed slot keeps the new child', async () => {
                // The tail rotation is an APPEND loop, and appending to a
                // `set_content` slot is an assignment — so rotating overwrote the
                // child that had just been placed. `single` gets this right only
                // because it has no rotation.
                const view = createElement('AdwToolbarView');
                const widget = materialize(view) as unknown as Adw.ToolbarView;
                const a = createElement('GtkLabel', { label: 'A', slot: 'content' });
                const b = createElement('GtkLabel', { label: 'B', slot: 'content' });
                insert(a, view);
                insert(b, view, a);
                expect((widget.get_content() as Gtk.Label).label).toBe('B');
                remove(a);
                expect((widget.get_content() as Gtk.Label)?.label).toBe('B');
            });

            await it('a failed materialize disconnects what its replay connected', async () => {
                // Handler ids are per-instance. Leaving them kept the callbacks on
                // an orphan for the life of the process, and made the documented
                // retry disconnect an id the new widget never issued.
                const page = createElement('AdwPreferencesPage');
                const bad = createElement('GtkButton', { label: 'oops' });
                materialize(bad);
                insert(bad, page);
                setEventHandler(page, 'onNotifyTitle', () => {});
                expect(() => materialize(page)).toThrow('refused');
                expect(page.handlers.size).toBe(0);
                expect(page.listeners.size).toBe(1); // the intent survives, the binding does not

                remove(bad);
                const widget = materialize(page) as unknown as Gtk.Widget;
                expect(widget !== null).toBe(true);
                expect(page.handlers.size).toBe(1);
            });

            await it('setElementText survives a later rebuild', async () => {
                // Arming `textFromChildren` with no text children left the next
                // rebuild computing an empty concatenation, skipping its own guard
                // and wiping the text.
                const btn = createElement('GtkButton');
                const widget = materialize(btn) as unknown as Gtk.Button;
                setElementText(btn, 'Go');
                expect(widget.label).toBe('Go');
                setProp(btn, 'cssName', 'x');
                expect((btn.widget as unknown as Gtk.Button).label).toBe('Go');
            });

            await it('a rebuild that cannot build puts the element back', async () => {
                const box = createElement('GtkBox');
                const parent = materialize(box) as unknown as Gtk.Widget;
                const label = createElement('GtkLabel', { label: 'keep', cssName: 'before' });
                insert(label, box);
                // an object has no unambiguous string spelling
                expect(() => setProp(label, 'cssName', { nope: true })).toThrow('string property');
                expect(gtkChildTypes(parent)).toStrictEqual(['GtkLabel']);
                expect(label.attached).toBe(true);
                // …and the corrective write still works
                setProp(label, 'cssName', 'after');
                expect(gtkChildTypes(parent)).toStrictEqual(['GtkLabel']);
            });

            await it('a number bound to a string property is stringified', async () => {
                const label = createElement('GtkLabel', { label: 42 });
                expect((materialize(label) as unknown as Gtk.Label).label).toBe('42');
            });
        });

        await describe('an adopted container the application keeps mutating', async () => {
            await it('placement ignores a prior child that has left the container', async () => {
                // `adopt` snapshots the container's children once. An application
                // may remove one afterwards, and `insert_child_after` then asserts
                // on a sibling that is no longer a child — a critical at exit 0,
                // while the shadow tree records the insertion as attached.
                const container = new Gtk.Box();
                const chrome = new Gtk.Label({ label: 'chrome' });
                container.append(chrome);
                const root = adopt(container);
                container.remove(chrome); // the app changes its mind

                const first = createElement('GtkLabel', { label: 'first' });
                insert(first, root);
                expect(gtkChildren(container).map((w) => (w as Gtk.Label).label)).toStrictEqual(['first']);
                expect(first.attached).toBe(true);
                // the diagnostics gate in afterEach is the other half of this
            });

            await it('a destroyed node says so exactly', async () => {
                // The obvious heuristic — no widget, not attached, no props — also
                // describes a brand-new element, and misdiagnosed it.
                const fresh = createElement('GtkBox');
                expect(fresh.destroyed).toBe(false);
                const box = createElement('GtkBox');
                materialize(box);
                const label = createElement('GtkLabel', { label: 'x' });
                insert(label, box);
                destroy(label);
                expect(label.destroyed).toBe(true);
            });
        });

        await describe('a self-anchored insert, and a chain that does not terminate', async () => {
            beforeEach(() => diagnostics.reset());
            afterEach(() => diagnostics.assertQuiet());

            await it('anchoring a node on itself is a no-op, as in the DOM', async () => {
                const box = createElement('GtkBox');
                materialize(box);
                const a = createElement('GtkLabel');
                const b = createElement('GtkLabel');
                setProp(a, 'label', 'a');
                setProp(b, 'label', 'b');
                insert(a, box);
                insert(b, box);

                // What `reconcileArrays` emits for an adjacent swap. The DOM
                // defines it as a no-op; taken literally it wrote `b.next = b`
                // and the next placement walk never terminated.
                insert(b, box, b);

                expect(b.next).toBe(null);
                expect(b.prev).toBe(a);
                expect(box.last).toBe(b);
                expect(gtkChildren(box.widget as Gtk.Widget).map((w) => (w as Gtk.Label).label)).toStrictEqual([
                    'a',
                    'b',
                ]);
            });

            await it('a hand-made cycle is refused by name instead of hanging', async () => {
                const box = createElement('GtkBox');
                materialize(box);
                const a = createElement('GtkLabel');
                const b = createElement('GtkLabel');
                const c = createElement('GtkLabel');
                insert(a, box);
                insert(b, box);
                insert(c, box);

                // No renderer can reach this today — that is the point. The bound
                // exists so the NEXT link bug is a named error instead of a killed
                // CI job, and only a hand-made cycle can prove the bound is there.
                // The loop is kept away from `box.last`, because appending repairs
                // whatever `last.next` held and would quietly undo the setup.
                b.next = a;
                const d = createElement('GtkLabel');
                let code = 'none';
                try {
                    insert(d, box);
                } catch (e) {
                    code = (e as { code?: string }).code ?? 'no-code';
                }
                expect(code).toBe('sibling-cycle');
                // Repair the chain so the gate's own teardown can walk it.
                b.next = c;
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

/** Page names of a Gtk.Stack, in GTK's own order. */
function stackOrder(stack: Gtk.Stack): string[] {
    const out: string[] = [];
    const pages = stack.get_pages();
    for (let i = 0; i < pages.get_n_items(); i += 1) {
        out.push((pages.get_item(i) as unknown as Gtk.StackPage).get_name() ?? '');
    }
    return out;
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
