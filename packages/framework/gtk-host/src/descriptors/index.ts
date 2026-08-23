import type { GeneratedWidget, WidgetDescriptor } from '../types.js';
import { GENERATED_PROVENANCE, GENERATED_WIDGETS } from '../generated/widgets.js';
import { registerWidgets } from '../registry.js';
import { ADW_DESCRIPTORS } from './adw.js';
import { GTK_DESCRIPTORS } from './gtk.js';

export { GTK_DESCRIPTORS } from './gtk.js';
export { ADW_DESCRIPTORS } from './adw.js';
export { GENERATED_PROVENANCE, GENERATED_WIDGETS } from '../generated/widgets.js';

/**
 * The hand-measured table: every widget whose PLACEMENT RULE is known.
 *
 * Kept separate from `BUILTIN_DESCRIPTORS` because the generator's gates take it
 * as their input. Merging first and then checking would make G1 ("every curated
 * gtype is in the GIR") and G3 ("every method a policy names exists") trivially
 * true — the generated rows come from the GIR by construction and name no method,
 * so a gate fed the merged table would pass while checking nothing.
 */
export const CURATED_DESCRIPTORS: readonly WidgetDescriptor[] = [...GTK_DESCRIPTORS, ...ADW_DESCRIPTORS];

/**
 * Curated placement rules, plus a tag for every other widget in the GIR.
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
 */
export function mergeGenerated(
    curated: readonly WidgetDescriptor[],
    generated: readonly GeneratedWidget[],
): WidgetDescriptor[] {
    const out = [...curated];
    const known = new Set(curated.map((d) => d.gtype));
    for (const w of generated) {
        if (known.has(w.gtype)) continue;
        out.push({ gtype: w.gtype, ctor: w.ctor, children: { kind: 'uncurated' } });
    }
    return out;
}

export const BUILTIN_DESCRIPTORS: readonly WidgetDescriptor[] = mergeGenerated(CURATED_DESCRIPTORS, GENERATED_WIDGETS);

/** Install the built-in table. Idempotent — registration is keyed on the GType name. */
export function registerBuiltinWidgets(): void {
    registerWidgets(BUILTIN_DESCRIPTORS);
}

/** What the shipped table is made of, for a diagnostic or an about box. */
export const tableProvenance = () => ({
    gir: GENERATED_PROVENANCE,
    curated: CURATED_DESCRIPTORS.length,
    generated: GENERATED_WIDGETS.length,
    total: BUILTIN_DESCRIPTORS.length,
});
