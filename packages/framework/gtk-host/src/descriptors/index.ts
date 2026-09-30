import type { GeneratedWidget, WidgetDescriptor } from '../types.js';
import { GENERATED_PROVENANCE, GENERATED_WIDGETS } from '../generated/widgets.js';
import { gtypeOfName } from '../props.js';
import { registerAbsentWidgets, registerWidgets } from '../registry.js';
import { ADW_DESCRIPTORS } from './adw.js';
import { GTK_DESCRIPTORS } from './gtk.js';

export { GTK_DESCRIPTORS } from './gtk.js';
export { ADW_DESCRIPTORS } from './adw.js';
export { GENERATED_PROVENANCE, GENERATED_WIDGETS } from '../generated/widgets.js';

/**
 * The hand-measured table: every widget whose PLACEMENT RULE is known.
 *
 * Kept separate from `GIR_DESCRIPTORS` because the generator's gates take it
 * as their input. Merging first and then checking would make G1 ("every curated
 * gtype is in the GIR") and G3 ("every method a policy names exists") trivially
 * true — the generated rows come from the GIR by construction and name no method,
 * so a gate fed the merged table would pass while checking nothing.
 */
export const CURATED_DESCRIPTORS: readonly WidgetDescriptor[] = [...GTK_DESCRIPTORS, ...ADW_DESCRIPTORS];

/**
 * Construct-only properties a GType ABORTS the process without.
 *
 * Not an exception: `adw_layout_slot_constructed` calls `g_error()`, which is
 * fatal by contract — no catch, no diagnostic, SIGABRT and a core dump. A table
 * that merely LISTS such a tag hands a renderer a way to kill the process, and
 * `descriptorProblems()` cannot see it because it never instantiates anything.
 *
 * MEASURED bare-constructing every generated row on gjs 1.88.1 / GTK 4.22.4 /
 * libadwaita 1.9.3, resuming past each abort: **all but one construct**, and not a
 * single row throws. So this map is one entry rather than a policy — and
 * `constructsEveryDescriptor` in `generated.spec.ts` is what keeps it one entry.
 *
 * CURATED, like every other placement fact: the GIR says `id` is construct-only
 * and nullable, which is exactly what it says about properties that construct
 * fine. Only running it tells them apart (ADR 0028 § 1).
 */
export const REQUIRED_CONSTRUCT_PROPS: Readonly<Record<string, readonly string[]>> = {
    AdwLayoutSlot: ['id'],
};

/**
 * Does this host's installed GTK BUILD the row's class?
 *
 * The one question a generated table cannot answer and its reader can, and the reason
 * is structural rather than a gap in the data: `src/generated/` is emitted from ONE
 * platform's GIR, and a GIR has no platform axis. GTK compiles `gtk/print/` under
 * `#ifdef G_OS_UNIX`, so `Gtk-4.0.gir` declares `GtkPrintUnixDialog` and
 * `GtkPageSetupUnixDialog` while the win32 typelib does not build either — the whole
 * table was offered there, and `materialize` then died on
 * `Cannot read properties of undefined (reading 'list_properties')` with no row named
 * (#1446). No name pattern and no hand list can stand in for the probe: the next class
 * a platform omits need not be spelled `Unix`, which is the reason this asks the
 * typelib instead.
 *
 * FAIL-OPEN, and the failure it guards is the one this function exists to prevent: a
 * probe that cannot answer keeps the row. An oracle that throws or returns nothing for
 * a whole namespace would empty the table, which is a far worse outcome than offering
 * a row the caller then refuses by name.
 */
export function isInstalledHere(descriptor: WidgetDescriptor): boolean {
    try {
        return gtypeOfName(descriptor.gtype) !== undefined;
    } catch {
        return true;
    }
}

export function mergeGenerated(
    curated: readonly WidgetDescriptor[],
    generated: readonly GeneratedWidget[],
): WidgetDescriptor[] {
    const out = [...curated];
    const known = new Set(curated.map((d) => d.gtype));
    for (const w of generated) {
        if (known.has(w.gtype)) continue;
        const requiresProps = REQUIRED_CONSTRUCT_PROPS[w.gtype];
        out.push({
            gtype: w.gtype,
            ctor: w.ctor,
            children: { kind: 'uncurated' },
            ...(requiresProps ? { requiresProps } : {}),
        });
    }
    return out;
}

/**
 * The GIR-derived table BEFORE the platform question — both halves of the shipped one.
 *
 * Separated from `builtinDescriptors()` because the split is what the platform axis is,
 * and a reader that wants to know what the GENERATOR found (the conformance suite's
 * vocabulary checks, `explains every class the installed library does not have`)
 * must be able to ask about the unfiltered half. Merging them would make "the table is
 * complete" unfalsifiable on the one platform where the question is interesting.
 */
export const GIR_DESCRIPTORS: readonly WidgetDescriptor[] = mergeGenerated(CURATED_DESCRIPTORS, GENERATED_WIDGETS);

/**
 * Curated placement rules, plus a tag for every other widget in the GIR
 * THAT THIS PLATFORM BUILT.
 *
 * The direction is one-way and enforced by shape rather than by review: a
 * `GeneratedWidget` carries no `children`, no `textSink` and no `eventAliases`, so
 * the generator CANNOT contradict a curated descriptor — it can only add a gtype
 * that was not there. A generated-only row gets `children: { kind: 'uncurated' }`,
 * which means the widget can be created, given properties and given handlers,
 * while inserting a child into it raises an error naming the tag that needs a
 * curated policy. Guessing an adder is the one thing not on offer: `add`, `append`
 * and `set_child` all exist somewhere in GTK, and calling the wrong one is a
 * warning at exit 0.
 *
 * The filter is the platform axis, and it is ONE filter over both halves — curated
 * included. `descriptors/gtk.ts` carries hand-written rows for both Unix print
 * dialogs, and `mergeGenerated` skips a generated row the curated half already has, so
 * a generated-only filter would have left the two rows that actually broke Windows in
 * the table.
 *
 * Partitioned in ONE pass, because the two lists must be complements and a second
 * `filter` over the same predicate would be a second chance for a probe that answers
 * differently between them. Exported because it is also the seam a spec drives with a
 * row the host does not have: no host in CI lacks either Unix print dialog, so the
 * absent arm is otherwise reachable only on the platform that broke (#1446).
 */
export function partitionByPlatform(rows: readonly WidgetDescriptor[]): {
    readonly installed: WidgetDescriptor[];
    readonly absent: WidgetDescriptor[];
} {
    const installed: WidgetDescriptor[] = [];
    const absent: WidgetDescriptor[] = [];
    for (const row of rows) (isInstalledHere(row) ? installed : absent).push(row);
    return { installed, absent };
}

/**
 * THE SPLIT IS LAZY, and the measurement is why.
 *
 * Asking the typelib about a class forces that class's registration, so partitioning
 * all 169 rows is a one-off cost: MEASURED on gjs 1.88.1 / Homebrew GTK 4.24.0, 38 ms
 * where `Gtk.init()` itself is 133 ms. That is not a cost a module-level `const` should
 * pay — an application that imports this package and mounts one `GtkLabel` must not
 * register 169 GI classes to find out it cannot use two of them — and it is the same
 * cost `nearestRegistered()` was rewritten to stop paying on the first subclass ever
 * mounted. A reader that wants it calls for it; `registerBuiltinWidgets()` is such a
 * reader, so an application that installs the shipped table pays exactly once and an
 * application that brings its own pays nothing.
 */
let partition: { installed: WidgetDescriptor[]; absent: WidgetDescriptor[] } | null = null;

function thePartition(): { installed: WidgetDescriptor[]; absent: WidgetDescriptor[] } {
    partition ??= partitionByPlatform(GIR_DESCRIPTORS);
    return partition;
}

/** The rows the shipped table offers on THIS platform. Memoised; see {@link thePartition}. */
export function builtinDescriptors(): readonly WidgetDescriptor[] {
    return thePartition().installed;
}

/** Every GIR row the installed typelib does not have — reported, never offered. */
export function notInstalledDescriptors(): readonly WidgetDescriptor[] {
    return thePartition().absent;
}

/** Install the built-in table. Idempotent — registration is keyed on the GType name. */
export function registerBuiltinWidgets(): void {
    registerWidgets(builtinDescriptors());
    registerAbsentWidgets(notInstalledDescriptors());
}

/** What the shipped table is made of, for a diagnostic or an about box. */
export const tableProvenance = () => ({
    gir: GENERATED_PROVENANCE,
    curated: CURATED_DESCRIPTORS.length,
    generated: GENERATED_WIDGETS.length,
    total: builtinDescriptors().length,
    /**
     * What THIS host does not have, by name.
     *
     * Reported rather than only enforced, because the table and the platform it runs on
     * are two different things and a reader has to be able to see the difference. On
     * Linux and both darwin arches this is empty — measured, 169 of 169 generated rows
     * resolve on Homebrew GTK 4.24.0 — and on Windows it names GTK's whole Unix print
     * stack. `total` alone cannot tell those apart: it drops by exactly the number of
     * absent rows and says nothing about which.
     */
    notInstalled: notInstalledDescriptors().map((d) => d.gtype),
});
