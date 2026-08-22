// Conformance surface: the checks that keep the widget table honest, and the
// GTK-side readers every vector asserts against.
//
// The rule these enforce is the one this package exists for: the table must
// describe the GTK that is actually installed, and a vector must read the REAL
// widget tree — never our shadow tree, which would happily agree with itself.

import GObject from 'gi://GObject';
import type Gtk from '@girs/gtk-4.0';

import { BUILTIN_DESCRIPTORS } from '../descriptors/index.js';
import { addressOf } from '../policies.js';
import type { ChildPolicy, HostElement, WidgetDescriptor } from '../types.js';

/** Every method name a policy names, so the check does not have to know the shapes. */
export function methodsOf(policy: ChildPolicy): string[] {
    switch (policy.kind) {
        case 'none':
            return [];
        case 'single':
            return [policy.set];
        case 'ordered':
            return policy.after ? [policy.append, policy.after, policy.remove] : [policy.append, policy.remove];
        case 'indexed':
            return [policy.insert, policy.remove];
        case 'slotted':
            return [...Object.values(policy.slots), policy.remove];
        case 'keyed':
            return [policy.add, policy.remove];
        case 'coords':
            return [policy.attach, policy.remove];
    }
}

export interface DescriptorProblem {
    gtype: string;
    problem: string;
}

/**
 * Assert the table against the installed typelib.
 *
 * A descriptor may name a method that does not exist — libadwaita renames, a
 * distro ships an older GTK, a copy/paste survives review. Calling it produces
 * `TypeError: host[policy.append] is not a function` deep inside a render, so
 * the check runs up front and names the widget.
 */
export function descriptorProblems(
    descriptors: readonly WidgetDescriptor[] = BUILTIN_DESCRIPTORS,
): DescriptorProblem[] {
    const problems: DescriptorProblem[] = [];
    for (const d of descriptors) {
        let Klass: { $gtype: GObject.GType; prototype: object };
        try {
            Klass = d.ctor() as unknown as { $gtype: GObject.GType; prototype: object };
        } catch (e) {
            problems.push({ gtype: d.gtype, problem: `ctor() threw: ${(e as Error).message}` });
            continue;
        }
        const actual = GObject.type_name(Klass.$gtype);
        if (actual !== d.gtype) {
            problems.push({ gtype: d.gtype, problem: `ctor() is ${actual}, not ${d.gtype}` });
        }
        for (const method of methodsOf(d.children)) {
            if (typeof (Klass.prototype as Record<string, unknown>)[method] !== 'function') {
                problems.push({
                    gtype: d.gtype,
                    problem: `declares children.${method}(), which ${actual} does not have`,
                });
            }
        }
        if (d.textSink) {
            const specs = (Klass as unknown as { list_properties(): GObject.ParamSpec[] }).list_properties();
            if (!specs.some((s) => s.get_name() === d.textSink)) {
                problems.push({
                    gtype: d.gtype,
                    problem: `declares textSink "${d.textSink}", which ${actual} does not have`,
                });
            }
        }
    }
    return problems;
}

// --- readers over the REAL GTK tree -----------------------------------------

/** Direct GTK children of a widget, in GTK's own order. */
export function gtkChildren(widget: Gtk.Widget): Gtk.Widget[] {
    const out: Gtk.Widget[] = [];
    const w = widget as unknown as { get_first_child?: () => Gtk.Widget | null };
    if (typeof w.get_first_child !== 'function') return out;
    for (
        let c = w.get_first_child();
        c;
        c = (c as unknown as { get_next_sibling(): Gtk.Widget | null }).get_next_sibling()
    ) {
        out.push(c);
    }
    return out;
}

/** GType names of a widget's direct children — the cheap shape assertion. */
export const gtkChildTypes = (widget: Gtk.Widget): string[] =>
    gtkChildren(widget).map((c) =>
        GObject.type_name((c as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype),
    );

/** The addresses a host element's element-children occupy, in shadow order. */
export function addressesOf(el: HostElement): Gtk.Widget[] {
    const out: Gtk.Widget[] = [];
    for (let n = el.first; n; n = n.next) {
        if (n.kind === 'element' && n.widget) out.push(addressOf(n));
    }
    return out;
}

/** Recursive GType dump — what a devtools tree walk would show. */
export function dumpTree(widget: Gtk.Widget, depth = 0): string {
    const name = GObject.type_name(
        (widget as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype,
    );
    const lines = [`${'  '.repeat(depth)}${name}`];
    for (const child of gtkChildren(widget)) lines.push(dumpTree(child, depth + 1));
    return lines.join('\n');
}
