/**
 * Emit the widget table, and the four gates that make it trustworthy.
 *
 * WHAT SHIPS is deliberately thin: tag, GType and the map between them (ADR 0028
 * § 1, as amended). Property names, the construct-only set and signal names are
 * consumed INSIDE the generator to emit the TYPE surfaces — shipping them as
 * runtime data would be a second source with no consumer, because `props.ts` and
 * `host.ts` already resolve every property through `paramSpecs()` on the class
 * that is actually installed.
 *
 * The artifact is COMMITTED and gets no regenerate-and-compare gate. Committing
 * is what makes `check`, `lint`, `format`, the build cache, the tarball and a
 * fresh clone with no GIR all work unchanged, and it makes a widget table
 * reviewable in a diff. A byte gate would fail for nothing the day a second CI
 * leg runs a different GTK: four GTK versions sit on the maintainer workstation
 * alone (4.16.13, 4.20.4, 4.22.4, 4.23.0) and the pinned `@girs` is a fifth
 * answer. The machine-INDEPENDENT check is the runtime one that already exists —
 * `descriptorProblems()` against the installed typelib.
 */

import type { ChildPolicy, WidgetDescriptor } from '../types.js';

import type { GirClass, GirNamespace } from './gir.mjs';
import { ancestors, indexClasses } from './gir.mjs';
import { assertInjective, tagOf } from '../tags.js';

/**
 * The `gi://` import a generated table needs, per GIR namespace.
 *
 * Injectable through `EmitInput`, not read from here directly, and the fixture
 * that forced that is the point: with the map hard-coded, G4 rejected every widget
 * of a five-class test namespace as an "unexpected gtype shape" and the floor check
 * below it could never be reached. A gate whose own test cannot run is a gate on
 * trust.
 */
export const GJS_MODULES: Readonly<Record<string, string>> = {
    Gtk: 'gi://Gtk?version=4.0',
    Adw: 'gi://Adw?version=1',
};

export interface EmitInput {
    readonly namespaces: readonly GirNamespace[];
    readonly widgets: readonly GirClass[];
    readonly curated: readonly WidgetDescriptor[];
    /** `methodsOf` from the conformance module — one extractor, not a second copy. */
    readonly methodsOf: (policy: ChildPolicy) => string[];
    /** GIR namespace -> `gi://` import. Defaults to the GTK/Adwaita pair. */
    readonly modules?: Readonly<Record<string, string>>;
}

export class GateFailure extends Error {
    constructor(
        readonly gate: string,
        message: string,
    ) {
        super(`${gate}: ${message}`);
    }
}

/** A class's own methods plus every ancestor's — `set_child` is inherited. */
function reachableMethods(cls: GirClass, index: Map<string, GirClass>): Set<string> {
    const out = new Set<string>(cls.methods);
    for (const a of ancestors(cls, index)) for (const m of a.methods) out.add(m);
    return out;
}

/**
 * G1 — every curated gtype is present in the GIR.
 *
 * Demonstrated worth: a census that walked parent chains without tracking the
 * namespace switch silently dropped `AdwWindow` and `AdwApplicationWindow`. This
 * gate fails with exactly those names rather than emitting a table missing them.
 */
function gate1(input: EmitInput): void {
    const present = new Set(input.widgets.map((w) => w.gtype));
    // An abstract or non-widget class can still be curated as a MOUNT container,
    // so the membership test is the whole GIR, not the concrete-widget subset.
    for (const ns of input.namespaces) for (const c of ns.classes) present.add(c.gtype);
    const missing = input.curated.map((d) => d.gtype).filter((g) => !present.has(g));
    if (missing.length > 0) throw new GateFailure('G1', `curated gtype(s) absent from the GIR: ${missing.join(', ')}`);
}

/**
 * G2 — curated may ADD, never contradict.
 *
 * Structural rather than comparative: the emitted table carries no curated FIELD
 * at all, so a contradiction is impossible instead of merely checked. The
 * assertion guards that structure.
 */
function gate2(text: string): void {
    for (const field of ['children:', 'textSink:', 'eventAliases:']) {
        if (text.includes(field)) {
            throw new GateFailure(
                'G2',
                `emitted table carries the curated field \`${field}\` — it must only ever add tags`,
            );
        }
    }
}

/**
 * G3 — every method a curated policy names exists on that GType.
 *
 * With the ancestor walk, which is not optional: measured, an own-methods-only
 * check reports two false failures (`GtkApplicationWindow.set_child` and
 * `GtkToggleButton.set_child` are both inherited).
 */
function gate3(input: EmitInput): void {
    const index = indexClasses(input.namespaces);
    const byGtype = new Map<string, GirClass>();
    for (const ns of input.namespaces) for (const c of ns.classes) byGtype.set(c.gtype, c);
    const problems: string[] = [];
    for (const d of input.curated) {
        const cls = byGtype.get(d.gtype);
        if (!cls) continue; // G1 already reported it
        const reachable = reachableMethods(cls, index);
        for (const method of input.methodsOf(d.children)) {
            if (!reachable.has(method)) problems.push(`${d.gtype}.${method}`);
        }
    }
    if (problems.length > 0)
        throw new GateFailure('G3', `policy names a method that does not exist: ${problems.join(', ')}`);
}

/**
 * G4 — no vacuous descriptor, and enough of them.
 *
 * The count floor is the load-bearing half: a parse that silently yields three
 * entries is the failure this repo pays most for, and a generator reporting
 * success over an almost-empty table looks identical to one that worked.
 */
function gate4(input: EmitInput, floor: number): void {
    const modules = input.modules ?? GJS_MODULES;
    for (const w of input.widgets) {
        // The shape is derived from the namespace GIR itself declared, so the check
        // travels with the input instead of naming two namespaces in a regex.
        const local = w.gtype.startsWith(w.namespace) ? w.gtype.slice(w.namespace.length) : '';
        if (!/^[A-Z]/.test(local)) {
            throw new GateFailure('G4', `gtype ${w.gtype} is not ${w.namespace} followed by a capitalised name`);
        }
        if (!modules[w.namespace]) throw new GateFailure('G4', `no GJS module known for namespace ${w.namespace}`);
    }
    if (input.widgets.length < floor) {
        throw new GateFailure(
            'G4',
            `only ${input.widgets.length} widget(s) emitted, below the floor of ${floor} — the parse is probably wrong`,
        );
    }
    assertInjective(input.widgets.map((w) => w.gtype));
}

export interface EmitResult {
    readonly text: string;
    readonly count: number;
    readonly provenance: string;
}

export function emitWidgets(input: EmitInput, floor = 100): EmitResult {
    gate1(input);
    gate3(input);
    gate4(input, floor);

    const modules = input.modules ?? GJS_MODULES;
    const provenance = input.namespaces.map((ns) => `${ns.name}-${ns.version}`).join(' ');
    const used = [...new Set(input.widgets.map((w) => w.namespace))].sort();
    const rows = [...input.widgets]
        .sort((a, b) => (a.gtype < b.gtype ? -1 : a.gtype > b.gtype ? 1 : 0))
        .map((w) => `    { gtype: '${w.gtype}', tag: '${tagOf(w.gtype)}', ctor: () => ${w.namespace}.${w.name} },`);

    const text = `// GENERATED by src/generator/main.mts — do not edit.
//
// Provenance: ${provenance}
//
// What this file is, and what it is NOT: every concrete descendant of GtkWidget
// the GIR describes, with its GType name and its kebab tag. It carries no
// placement rule, no text sink and no event alias — those are CURATED, in
// descriptors/, and the generator may only ever ADD a tag (ADR 0028 § 1).
//
// A tag here that the curated table does not cover can be CREATED but not filled:
// its child policy is \`uncurated\`, so inserting into it raises a named error
// instead of guessing an adder. That is the honest state — ${input.widgets.length} tags a
// renderer can name, ${input.curated.length} of them with measured placement rules.

${used.map((ns) => `import ${ns} from '${modules[ns]}';`).join('\n')}

import type { GeneratedWidget } from '../types.js';

export const GENERATED_PROVENANCE = '${provenance}' as const;

export const GENERATED_WIDGETS: readonly GeneratedWidget[] = [
${rows.join('\n')}
];
`;

    gate2(text);
    return { text, count: input.widgets.length, provenance };
}
