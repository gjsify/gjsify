// GTK's ARIA surface — the axis no ParamSpec carries.
//
// WHY THIS IS A FILE OF ITS OWN AND NOT A BRANCH IN `props.ts`. Every other name a
// renderer writes on a widget is a GObject property, and `props.ts` resolves it through
// the ParamSpec of the INSTALLED class: the table travels with the package, the coercion
// travels with the user's GTK. An ARIA slot has no ParamSpec and never can have one.
// `GtkAccessible` installs exactly ONE property, `accessible-role`; the other 53 names
// are members of three ENUMS, written through `gtk_accessible_update_property`,
// `…_update_state` and `…_update_relation`, and the value type of each is stated only in
// that enum member's GIR DOCUMENTATION. So the type has to come off a shipped table —
// `ARIA_SLOTS`, generated from `@girs`' `ARIA_VALUE_TYPES`/`ARIA_VALUE_ENUMS` — and
// building the `GValue` is this module's whole job.
//
// WHAT HAPPENS WITHOUT IT, measured on gjs 1.88.1 / GTK 4.22.5, one process per line.
// GJS guesses a GValue type from the JS value, on the value's INTEGRALITY, and GTK's
// collector then reads it back with a fixed `g_value_get_*`:
//
//     update_property([VALUE_NOW], [3])       g_value_get_double: G_VALUE_HOLDS_DOUBLE failed
//     update_property([LEVEL], [3.5])         g_value_get_int:    G_VALUE_HOLDS_INT failed
//     update_property([SORT], ['ascending'])  g_value_get_int:    G_VALUE_HOLDS_INT failed
//     update_state([CHECKED], [true])         g_value_get_int:    G_VALUE_HOLDS_INT failed
//     update_property([999], ['x'])           gtk_accessible_value_collect_for_property_value:
//                                             assertion 'property <= …HELP_TEXT' failed
//
// Every one is a CRITICAL at exit 0 with the slot left unset. The fourth is the one a DOM
// author writes first, because `checked` is a `GtkAccessibleTristate` and `true` there is
// the nick, not the boolean — which is exactly why the value type comes from GTK's ARIA
// table and not from the widget's properties.

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { err } from './errors.js';
import { ARIA_SLOTS } from './generated/accessibility.js';
import { lookupEnumNick } from './props.js';
import type { AriaSlot, AriaTable } from './types.js';

/** What `accessibility={{ … }}` carries. Keys are ARIA names; `null` clears a slot. */
export type AccessibilityInput = Readonly<Record<string, unknown>>;

interface AriaWrite {
    readonly table: AriaTable;
    readonly member: number;
    readonly value: GObject.Value;
}

interface AriaReset {
    readonly table: AriaTable;
    readonly member: number;
}

/**
 * Everything the three GTK calls need, resolved and refused BEFORE the first one runs.
 *
 * Built whole, then applied, for the same reason `setProp` validates before recording:
 * a refusal half-way through would leave the widget carrying some of the authored
 * accessibility and the element carrying all of it, and the next patch would compute its
 * resets against a state that never existed.
 */
export interface AccessibilityPlan {
    readonly writes: readonly AriaWrite[];
    readonly resets: readonly AriaReset[];
}

/** `GtkAccessibleProperty` -> `property`, the infix of that table's two GTK calls. */
const verbOf = (table: AriaTable): string => table.slice('GtkAccessible'.length).toLowerCase();

/** What a refusal calls the value it got — the kind with its article, so the sentence reads. */
const kindOf = (value: unknown): string =>
    value === null ? 'null' : Array.isArray(value) ? 'an array' : `a ${typeof value}`;

const value = (gtype: GObject.GType, set: (v: GObject.Value) => void): GObject.Value => {
    const boxed = new GObject.Value();
    boxed.init(gtype);
    set(boxed);
    return boxed;
};

/**
 * The `GValue` GTK's collector will accept for this slot, or a named refusal.
 *
 * The coercions mirror `coerce()` in `props.ts` deliberately — a number or a boolean
 * stringifies into a string slot, `'true'`/`'false'` read as booleans, an integer slot
 * truncates — so that one value written to `label` and to `accessibility.label` behaves
 * the same way. What does NOT mirror it is the enum branch: a GObject enum property takes
 * its own GType, while GTK collects EVERY ARIA enum as a plain `int`, which is why the
 * nick is resolved here and the boxed type is `G_TYPE_INT` for all six.
 */
function ariaValue(name: string, slot: AriaSlot, tag: string, raw: unknown): GObject.Value {
    switch (slot.kind) {
        case 'string': {
            if (typeof raw === 'string') return value(GObject.TYPE_STRING, (v) => v.set_string(raw));
            if (typeof raw === 'number' || typeof raw === 'boolean') {
                return value(GObject.TYPE_STRING, (v) => v.set_string(String(raw)));
            }
            throw err.badAriaValue(tag, name, 'string', kindOf(raw));
        }
        case 'boolean': {
            if (typeof raw === 'boolean') return value(GObject.TYPE_BOOLEAN, (v) => v.set_boolean(raw));
            if (raw === 'true' || raw === 'false') {
                return value(GObject.TYPE_BOOLEAN, (v) => v.set_boolean(raw === 'true'));
            }
            throw err.badAriaValue(tag, name, 'boolean', kindOf(raw));
        }
        case 'integer': {
            if (typeof raw !== 'number') throw err.badAriaValue(tag, name, 'integer', kindOf(raw));
            return value(GObject.TYPE_INT, (v) => v.set_int(Math.trunc(raw)));
        }
        case 'double': {
            if (typeof raw !== 'number') throw err.badAriaValue(tag, name, 'double', kindOf(raw));
            return value(GObject.TYPE_DOUBLE, (v) => v.set_double(raw));
        }
        case 'enum': {
            const gtypeName = slot.enumGType as string;
            if (typeof raw === 'number') return value(GObject.TYPE_INT, (v) => v.set_int(raw));
            if (typeof raw !== 'string') throw err.badAriaValue(tag, name, gtypeName, kindOf(raw));
            const resolved = lookupEnumNick(gtypeName, raw);
            if (resolved === undefined) throw err.badAriaEnum(tag, name, raw, gtypeName);
            return value(GObject.TYPE_INT, (v) => v.set_int(resolved));
        }
        // A REFERENCE names another widget, and this host has no way to name one — the
        // gap, refused where it is still reportable. `Gtk.AccessibleList.new_from_list()`
        // builds the value GTK wants, so what is missing is the ADDRESSING and not the
        // marshalling: there is no `id` prop, and `ref` is resolved by the framework
        // AFTER props are applied, so a ref read here is null on the render that authors
        // it. Refused rather than written as null, which GTK takes at exit 0.
        default:
            throw err.ariaReference(tag, name);
    }
}

/**
 * The member number the INSTALLED GTK registers for an ARIA name.
 *
 * Read off the running library rather than committed as a number, exactly as every enum
 * nick in this package is: the shipped table says which names exist in the GTK the types
 * were generated from, and this says which of them the GTK in front of us has. A name it
 * does not have is refused by name — `update_property` with an out-of-range member is two
 * `Gtk-CRITICAL`s and an exit 0 (measured).
 */
function memberOf(name: string, slot: AriaSlot, tag: string): number {
    const member = lookupEnumNick(slot.table, name);
    if (member === undefined) throw err.ariaNotInstalled(tag, name, slot.table);
    return member;
}

function slotOf(tag: string, name: string): AriaSlot {
    const slot = ARIA_SLOTS[name];
    if (!slot) throw err.unknownAria(tag, name);
    return slot;
}

/** A plain authored object — not an array, not a widget, not a string. */
const isInput = (v: unknown): v is AccessibilityInput =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof GObject.Object);

/**
 * Resolve an authored accessibility object against the one it replaces.
 *
 * Total: every name is looked up, every value is built, and anything GTK would take
 * silently and wrongly throws here instead. Nothing touches a widget.
 */
export function planAccessibility(
    tag: string,
    previous: AccessibilityInput | null,
    next: AccessibilityInput | null,
): AccessibilityPlan {
    if (next !== null && !isInput(next)) throw err.badAccessibility(tag, kindOf(next));
    const writes: AriaWrite[] = [];
    const resets: AriaReset[] = [];
    const written = new Set<string>();

    for (const [name, raw] of Object.entries(next ?? {})) {
        const slot = slotOf(tag, name);
        const member = memberOf(name, slot, tag);
        written.add(name);
        // `null` and `undefined` both mean "removed" on this host — the contract `setProp`
        // states for every property — and GTK's answer for an ARIA slot is `reset_*`, which
        // puts back what the widget's own role implies rather than a value we would guess.
        if (raw === null || raw === undefined) resets.push({ table: slot.table, member });
        else writes.push({ table: slot.table, member, value: ariaValue(name, slot, tag, raw) });
    }

    // A name the previous object set and this one does not. Resolved through the same
    // lookup rather than trusted: `previous` is only ever an object this function already
    // accepted, and saying so in one place is cheaper than a second code path that assumes it.
    for (const name of Object.keys(previous ?? {})) {
        if (written.has(name)) continue;
        const slot = slotOf(tag, name);
        if (slot.kind === 'reference') continue; // never written, so never to reset
        resets.push({ table: slot.table, member: memberOf(name, slot, tag) });
    }

    return { writes, resets };
}

/**
 * Run a plan against a widget, one `update_*` call per table.
 *
 * BATCHED PER TABLE because that is the shape of the call: `gtk_accessible_update_state`
 * takes parallel arrays and applies them together, so three names in one table are one
 * call and one notification rather than three.
 *
 * The method names are DERIVED from the table name (`GtkAccessibleState` -> `update_state`),
 * which is why `girs-vocabulary.mts` refuses a table it does not know rather than emitting
 * its names: a derived call into a method GTK never installed is a `TypeError` in the middle
 * of a render. `generated.spec.ts` holds all six derived names against the installed GTK.
 */
export function applyAccessibilityPlan(widget: GObject.Object, plan: AccessibilityPlan): void {
    if (plan.writes.length === 0 && plan.resets.length === 0) return;
    // No `Gtk.Accessible` check here: `setAccessibility` asks the CLASS, before a widget
    // exists, so that `<gtk-string-list accessibility={…}>` is refused at the call that
    // wrote it. A second check on the instance would be a second answer to a settled
    // question, and the one on the class is the earlier and stronger of the two.
    const calls = widget as unknown as Record<string, (...args: unknown[]) => void>;

    const byTable = new Map<AriaTable, { members: number[]; values: GObject.Value[] }>();
    for (const write of plan.writes) {
        const bucket = byTable.get(write.table) ?? { members: [], values: [] };
        bucket.members.push(write.member);
        bucket.values.push(write.value);
        byTable.set(write.table, bucket);
    }
    for (const [table, bucket] of byTable) calls[`update_${verbOf(table)}`]?.(bucket.members, bucket.values);
    // `gtk_accessible_reset_*` takes ONE member, so these do not batch. Ordered after the
    // writes so that a patch which moves a name between two objects still ends up written.
    for (const reset of plan.resets) calls[`reset_${verbOf(reset.table)}`]?.(reset.member);
}

/**
 * Whether a class can carry accessibility at all.
 *
 * Asked of the CLASS, before the widget exists, so `<gtk-string-list accessibility={…}>`
 * is refused at the call that authored it rather than at materialisation. Not every row of
 * the generated table is a widget — the list carriers are `GObject`s that hold one — and
 * `Gtk.StringList` has no `update_property` at all (measured), which would otherwise be a
 * `TypeError` naming a method instead of a tag.
 */
export const isAccessibleClass = (klass: GObject.ObjectClass): boolean =>
    GObject.type_is_a((klass as unknown as { $gtype: GObject.GType }).$gtype, Gtk.Accessible.$gtype);
