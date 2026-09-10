export {
    describeLogRecord,
    installDiagnosticsGate,
    isEnvironmentDiagnostic,
    type DiagnosticsGate,
} from './diagnostics.js';
export { windowChromeCensus, windowChromeProblems, type WindowChromeCensus } from './window-chrome.js';
// Conformance surface: the checks that keep the widget table honest, and the
// GTK-side readers every vector asserts against.
//
// The rule these enforce is the one this package exists for: the table must
// describe the GTK that is actually installed, and a vector must read the REAL
// widget tree — never our shadow tree, which would happily agree with itself.

import GObject from 'gi://GObject?version=2.0';
import type Gtk from '@girs/gtk-4.0';

import { BUILTIN_DESCRIPTORS } from '../descriptors/index.js';
import {
    addressOf,
    adderSlots,
    classPlacementKind,
    isUnparented,
    placementOf,
    unhandledPlacement,
    unhandledPolicy,
} from '../policies.js';
import type { ChildPolicy, HostElement, NodePlacement, WidgetDescriptor } from '../types.js';

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

/**
 * Every method a PLACEMENT names — the second axis's answer to `methodsOf`.
 *
 * Separate from `methodsOf` rather than folded into it, because the two are
 * checked against different things: a child policy's methods are called on the
 * PARENT and a placement's on the NODE ITSELF, so a single list would make the
 * message name the wrong object.
 */
export function placementMethodsOf(placement: NodePlacement): string[] {
    switch (placement.kind) {
        case 'parented':
            return [];
        case 'portal':
        case 'toplevel':
            return [placement.present, placement.close];
        default:
            return unhandledPlacement(placement);
    }
}

/**
 * How many arguments this placement's `present` must take, or null when it names none.
 *
 * THE ARITY IS THE DISCRIMINATOR between the two non-parented arms, measured on
 * GTK 4.22.4 / libadwaita 1.9.3: `adw_dialog_present` takes 1 and
 * `gtk_window_present` takes 0. A zero-argument `present` called with a widget
 * ignores it silently and opens a window of its own; a one-argument one called
 * with nothing has no host to reach. Both are exit 0, so the check is here.
 */
export function presentArityOf(placement: NodePlacement): number | null {
    switch (placement.kind) {
        case 'parented':
            return null;
        case 'portal':
            return 1;
        case 'toplevel':
            return 0;
        default:
            return unhandledPlacement(placement);
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
        const placement = placementOf(d);
        for (const method of placementMethodsOf(placement)) {
            if (typeof (Klass.prototype as Record<string, unknown>)[method] !== 'function') {
                problems.push({
                    gtype: d.gtype,
                    problem: `declares placement.${method}(), which ${actual} does not have`,
                });
            }
        }
        // A portal's `present` TAKES THE PARENT and a toplevel's takes nothing —
        // measured, `adw_dialog_present` is 1 and `gtk_window_present` is 0 — so
        // the arity is where the two arms are told apart. Swapping them is exit 0
        // twice over: a zero-argument `present` handed a widget ignores it and
        // opens a window of its own, and a one-argument one called with nothing
        // finds no host to reach.
        const wantedArity = presentArityOf(placement);
        if (wantedArity !== null && placement.kind !== 'parented') {
            const present = (Klass.prototype as Record<string, unknown>)[placement.present];
            if (typeof present === 'function' && present.length !== wantedArity) {
                problems.push({
                    gtype: d.gtype,
                    problem: `placement.${placement.present}() takes ${present.length} argument(s) on ${actual}, and a ${placement.kind} is presented with exactly ${wantedArity}`,
                });
            }
        }
        // AND THE DECLARATION HAS TO EXIST AT ALL where the class demands one
        // (ADR 0054). Every check above holds a WRITTEN claim against the installed
        // class; this one holds the class against the ABSENCE of a claim, which is
        // the direction the whole abort class arrived through. The oracle is
        // `policies.ts`'s, so the table check and the runtime refusal cannot drift
        // into two opinions.
        const native = classPlacementKind(Klass.$gtype, (Klass.prototype as Record<string, unknown>).present);
        if (native && placement.kind === 'parented') {
            problems.push({
                gtype: d.gtype,
                problem:
                    native === 'toplevel'
                        ? `implements Gtk.Root and declares no placement, so a parent would take it as an ordinary child — which GTK accepts at exit 0, leaving a root with a parent; it needs placement: { kind: 'toplevel', … }`
                        : `has a present() that takes a parent and declares no placement, so a parent would call its adder on it — which is g_error() and aborts the process; it needs placement: { kind: 'portal', … }`,
            });
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

        if (d.children.kind === 'indexed' && d.children.perLineCap !== undefined) {
            // The same check `textSink` gets, for the same reason: a declared
            // PROPERTY NAME that the class does not carry fails silently. MEASURED —
            // `listBox.set_property('max-children-per-line', 3)` logs
            // `GLib-GObject-CRITICAL: object class 'GtkListBox' has no property named
            // …` and returns, at exit 0, so a typo here would simply stop capping.
            const cap = d.children.perLineCap;
            const specs = (Klass as unknown as { list_properties(): GObject.ParamSpec[] }).list_properties();
            const spec = specs.find((x) => x.get_name() === cap);
            if (!spec) {
                problems.push({
                    gtype: d.gtype,
                    problem: `declares perLineCap "${cap}", which ${actual} does not have`,
                });
            } else if ((spec.flags & GObject.ParamFlags.WRITABLE) === 0) {
                problems.push({ gtype: d.gtype, problem: `declares a READ-ONLY perLineCap "${cap}"` });
            } else if (!GObject.type_is_a(spec.value_type, GObject.TYPE_UINT)) {
                problems.push({
                    gtype: d.gtype,
                    problem: `declares perLineCap "${cap}", which is ${GObject.type_name(spec.value_type)}, not a count`,
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
        // A `wrapSlots` key that names no slot is silent otherwise: `makeWrapper`
        // looks the resolved slot up and a miss reads as "no wrap", so a typo turns
        // the wrap off and gives back the leak it exists to close.
        for (const slot of Object.keys(policy.wrapSlots ?? {})) {
            if (!(slot in policy.slots)) {
                out.push({
                    gtype: d.gtype,
                    problem: `wrapSlots names "${slot}", which is not one of ${Object.keys(policy.slots).join(', ')}`,
                });
            }
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

export { descendants, dumpTree, findDescendant, gtkChildTypes, gtkChildren } from './tree.js';

/**
 * The addresses a host element's element-children occupy, in shadow order.
 *
 * A NON-PARENTED child occupies none — a portal is presented against this element
 * and lives under the toplevel's dialog host, a toplevel is its own root — so
 * including either would make every vector that compares this against the real
 * child list disagree by a node that is not there.
 */
export function addressesOf(el: HostElement): Gtk.Widget[] {
    const out: Gtk.Widget[] = [];
    for (let n = el.first; n; n = n.next) {
        if (n.kind === 'element' && n.widget && !isUnparented(n)) out.push(addressOf(n));
    }
    return out;
}
