export {
    describeLogRecord,
    installDiagnosticsGate,
    isEnvironmentDiagnostic,
    type DiagnosticsGate,
} from './diagnostics.js';
// Conformance surface: the checks that keep the widget table honest, and the
// GTK-side readers every vector asserts against.
//
// The rule these enforce is the one this package exists for: the table must
// describe the GTK that is actually installed, and a vector must read the REAL
// widget tree — never our shadow tree, which would happily agree with itself.

import GObject from 'gi://GObject';
import type Gtk from '@girs/gtk-4.0';

import { BUILTIN_DESCRIPTORS } from '../descriptors/index.js';
import { addressOf, adderSlots, unhandledPolicy } from '../policies.js';
import type { ChildPolicy, HostElement, WidgetDescriptor } from '../types.js';

/** Every method name a policy names, so the check does not have to know the shapes. */
export function methodsOf(policy: ChildPolicy): string[] {
    switch (policy.kind) {
        case 'none':
        // Names no method, so there is nothing for `descriptorProblems()` to
        // check on the class — which is the whole content of "uncurated".
        case 'uncurated':
            return [];
        case 'single':
            return [policy.set];
        case 'ordered':
            return policy.after ? [policy.append, policy.after, policy.remove] : [policy.append, policy.remove];
        case 'indexed':
            return [policy.insert, policy.remove];
        case 'slotted':
            // `remove` is absent on an all-setter policy, which names no remove
            // method because it needs none — see `ChildPolicy`. The rule that it
            // must be there for an adder-backed slot is `policyProblems()`'s.
            return policy.remove ? [...Object.values(policy.slots), policy.remove] : Object.values(policy.slots);
        case 'keyed':
            return [policy.add, policy.remove];
        case 'coords':
            return [policy.attach, policy.remove];
        default:
            return unhandledPolicy(policy);
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
        let Klass: { $gtype: GObject.GType; prototype: object } | undefined;
        try {
            Klass = d.ctor() as unknown as { $gtype: GObject.GType; prototype: object };
        } catch (e) {
            problems.push({ gtype: d.gtype, problem: `ctor() threw: ${(e as Error).message}` });
            continue;
        }
        // `ctor()` does not throw for a class the installed library lacks — it
        // answers `undefined`, and the next line then dies as `can't access property
        // "$gtype"`, naming nothing. Nothing true can be said about the policy of a
        // class that is not here, so it is skipped; whether the absence itself is
        // acceptable is judged in one place, by `explains every class the installed
        // library does not have` in generated.spec.ts, which weighs it against the
        // library version the surface was generated from.
        if (!Klass) continue;
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
            const spec = specs.find((x) => x.get_name() === d.textSink);
            if (!spec) {
                problems.push({
                    gtype: d.gtype,
                    problem: `declares textSink "${d.textSink}", which ${actual} does not have`,
                });
            } else if ((spec.flags & GObject.ParamFlags.WRITABLE) === 0) {
                problems.push({ gtype: d.gtype, problem: `declares a READ-ONLY textSink "${d.textSink}"` });
            } else if (!GObject.type_is_a(spec.value_type, GObject.TYPE_STRING)) {
                // A non-string sink accepts the write and drops it: measured, an
                // int sink logs `unable to set property … from value of type
                // 'gchararray'` and leaves the value unchanged, at exit 0. Mere
                // existence was never enough of a check.
                problems.push({
                    gtype: d.gtype,
                    problem: `declares textSink "${d.textSink}", which is ${GObject.type_name(spec.value_type)}, not a string`,
                });
            }
        }

        problems.push(...policyProblems(d, Klass as unknown as { prototype: object }, actual));
    }
    return problems;
}

/**
 * The claims a policy makes BEYOND "this method exists".
 *
 * Each of these was a real defect first: a `single` policy whose derived getter is
 * absent degrades the "is this still the child in place?" guard to an
 * unconditional clear; `ordered` claiming `reorder: 'native'` without an `after`
 * method makes `reorderMode()` lie to an adapter; and a `keyed` arity mismatch
 * throws GJS's "At least 3 arguments required", which the host then reports as a
 * rejected child TYPE — a message that names the wrong cause.
 */
function policyProblems(d: WidgetDescriptor, Klass: { prototype: object }, actual: string): DescriptorProblem[] {
    const out: DescriptorProblem[] = [];
    const proto = Klass.prototype as Record<string, unknown>;
    const policy = d.children;

    const requireGetter = (setter: string, what: string) => {
        const getter = setter.replace(/^set_/, 'get_');
        if (typeof proto[getter] !== 'function') {
            out.push({
                gtype: d.gtype,
                problem: `${what} uses ${setter}() but ${actual} has no ${getter}(), so removal cannot check whether this child is still the one in place`,
            });
        }
    };

    if (policy.kind === 'single') requireGetter(policy.set, 'children.set');
    if (policy.kind === 'slotted') {
        for (const [slot, method] of Object.entries(policy.slots)) {
            if (method.startsWith('set_')) requireGetter(method, `slot "${slot}"`);
        }
        if (!(policy.defaultSlot in policy.slots)) {
            out.push({
                gtype: d.gtype,
                problem: `defaultSlot "${policy.defaultSlot}" is not one of ${Object.keys(policy.slots).join(', ')}`,
            });
        }
        // The other half of making `remove` optional. A setter-backed slot is
        // emptied by writing `null` back through the setter, so an all-setter
        // policy needs no remove method — but an ADDER-backed slot has nothing
        // else that takes a child out, so `detachChild` can only refuse the
        // unmount by name. Refusing is the right runtime answer and a poor
        // shipping one: caught here, the table never carries the shape at all.
        // Named here rather than left to the type, because `remove?: string`
        // cannot express "required when a sibling field's VALUE does not start
        // with set_".
        const adders = adderSlots(policy);
        if (adders.length > 0 && !policy.remove) {
            out.push({
                gtype: d.gtype,
                // QUOTED, and that is not decoration: a slot name is a substring
                // of its own adder (`top` of `add_top_bar`), so an unquoted name
                // cannot be told from the method — measured, a version of this
                // message naming the METHOD and no slot at all left the test that
                // asserts the slot is named green.
                problem: `slot(s) ${adders.map((slot) => `"${slot}"`).join(', ')} are adder-backed, so removal needs a "remove" method and this policy names none`,
            });
        }
    }
    if (policy.kind === 'ordered' && policy.reorder === 'native' && !policy.after) {
        out.push({
            gtype: d.gtype,
            problem: `claims reorder: 'native' with no "after" method — reorderMode() would tell an adapter the wrong thing`,
        });
    }
    if (policy.kind === 'keyed') {
        const add = proto[policy.add];
        const wanted = policy.titled ? 3 : 1;
        if (typeof add === 'function' && add.length !== wanted) {
            out.push({
                gtype: d.gtype,
                problem: `titled: ${policy.titled} implies ${policy.add}() takes ${wanted} argument(s), but ${actual}'s takes ${add.length}`,
            });
        }
    }
    return out;
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

/**
 * First STRICT descendant matching `pred`, breadth-first over the REAL GTK tree.
 *
 * Both showcase probes wrote this, identically. It excludes the root on purpose:
 * every caller is asking "what did the renderer put INSIDE this", and a root that
 * matches its own predicate answers a different question.
 *
 * Breadth-first is not incidental either — `findDescendant(root, w => w instanceof
 * Gtk.Box)` on an Adwaita window finds an INTERNAL box of the header bar before
 * anything the author wrote, which is why a probe that needs a specific widget
 * reaches it through a landmark (a button's `get_parent()`) rather than by type.
 * Measured: with a search-by-type version, authoring `orientation="horizontal"`
 * still printed PROBE: PASS with byte-identical output.
 */
export function findDescendant(root: Gtk.Widget, pred: (widget: Gtk.Widget) => boolean): Gtk.Widget | null {
    const queue: Gtk.Widget[] = [root];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (widget !== root && pred(widget)) return widget;
        queue.push(...gtkChildren(widget));
    }
    return null;
}

/**
 * Every widget in a subtree, ROOT FIRST and depth-first — GTK's own document order.
 *
 * Depth-first and not breadth-first, because the callers that collect (rather than
 * search) are asserting on ORDER: "the rows land before the counter row" is only a
 * claim about the tree if the walk visits it the way the tree reads.
 */
export function descendants(root: Gtk.Widget): Gtk.Widget[] {
    const out: Gtk.Widget[] = [root];
    for (const child of gtkChildren(root)) out.push(...descendants(child));
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
