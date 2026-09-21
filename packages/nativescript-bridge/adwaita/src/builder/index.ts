// THE `xmlns`-BARREL TREE BUILDER, SHIPPED — the NativeScript half of what PR #1726 did for
// `packages/framework/gtk-host`: `elementFor`/`build` are the dialect's OWN interpreter (ADR
// 0034 § Amendment 9), not a test helper, so keeping them in a `.spec.ts` file put production
// logic where only a test entry could ever reach it.
//
// REACHABILITY IS THE RULE THIS FILE MUST NOT BREAK. The namespace barrels below
// (`../namespace/adw.js`, `../namespace/gtk.js`) evaluate EVERY widget class in this package
// at module scope, and every widget module opens with a value import from `@nativescript/core`
// — unresolvable off a device unless aliased. This module may be imported ONLY from
// `src/test.trees.mts`, whose two builds supply `--alias @nativescript/core=../testing/ns-core.mjs`
// (`package.json` `build:test:trees:{gjs,node}`). It must NEVER be reachable from `src/index.ts`
// (that entry already reaches every widget on its own terms, but re-exporting this from there
// would put test-only tooling on the public API) and NEVER from `src/test.mts` (that entry
// bundles every OTHER spec in this package with no alias at all — one edge into this file
// would drag `@nativescript/core` under specs that build without it today, silently, the same
// class of defect the package's own AGENTS.md names for the ONE existing exception).
//
// THE ONLY THING THIS FILE NEEDS FROM `@nativescript/core` ITSELF IS THE `View` TYPE, and it
// is imported `type`-only below — erased at build, so it carries no runtime specifier for an
// alias (or its absence) to resolve. The same choice `bottom-sheet.spec.ts` and
// `signals.spec.ts` already make for the same package. Consequently this module has no
// dependency on the testing double's OWN directory depth (`src/testing/ns-core.mjs`, one level
// under `src/`, per the alias's own relative target) — but it still lives one level under
// `src/` itself, at parity with `../namespace/` and `../widgets/`, rather than risk a reader
// assuming the depth-sensitive alias applies here too.
//
// The three `throw`s in {@link build} are door refusals, not test assertions — ADR 0051
// Amendment 3 broke each one on purpose to prove it fires — and they moved here with the
// function they belong to.

import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import type { View } from '@nativescript/core';

// The two `xmlns` barrels an app declares, one module per library (ADR 0034 § Amendment 9).
// Imported as MODULE NAMESPACES because that is literally what this door is:
// `component-builder`'s `createComponentInstance` ends in `instanceModule[elementName]`, and
// the prefix selects the module. Importing the widget classes by name instead would be a
// per-widget table and would skip the door entirely.
import * as Adw from '../namespace/adw.js';
import * as Gtk from '../namespace/gtk.js';

/** A class the barrel offers as an element — NativeScript builds one with NO arguments. */
export type ElementClass = new () => View;

/** `AdwSwitchRow` -> `<adw:SwitchRow>`: the element name, and the class behind it. */
export interface Element {
    /** The XML name this dialect spells, which is also what an XML child arrives under. */
    xmlName: string;
    ctor: ElementClass;
}

const BARRELS: Readonly<Record<string, object>> = { adw: Adw, gtk: Gtk };

/**
 * The element a GIR class name is, in the `xmlns` barrel dialect.
 *
 * THE WHOLE TRANSFORM, and it is a split rather than a table: the prefix names the library,
 * the member is the rest. What makes it safe is that the member is then READ OFF THE BARREL
 * — the same module NativeScript would read — so a placement this split gets wrong is a
 * missing member and throws, never another library's widget under this prefix. That is the
 * measured hazard `generate-adwaita-nativescript-templates.mjs` records as the
 * prefix-as-membership-test defect: the defect was deciding placement from the name ALONE.
 *
 * The class the barrel hands back must be the class the corpus NAMED, which is ADR 0034
 * clause 1 — a widget is named after the library owning its GType — held at runtime instead
 * of taken on trust. (The tree-driver bundles that reach this function are built
 * `--no-minify` so a class name is the one the source declares; a mangled one fails here
 * rather than resolving to a stranger.)
 */
export function elementFor(tag: string): Element {
    for (const [prefix, barrel] of Object.entries(BARRELS)) {
        const library = `${prefix[0]!.toUpperCase()}${prefix.slice(1)}`;
        if (!tag.startsWith(library)) continue;
        const member = tag.slice(library.length);
        const exported = (barrel as Record<string, unknown>)[member];
        if (typeof exported !== 'function') {
            throw new Error(
                `Module '~/${prefix}' has no member for element '${prefix}:${member}' — the name ` +
                    `\`${tag}\` is authored in the shared corpus and this dialect cannot spell it. Give the ` +
                    'widget a namespace member (ADR 0034 clause 2), or ledger the block as divergent.',
            );
        }
        if (exported.name !== tag) {
            throw new Error(
                `'${prefix}:${member}' resolves to class \`${exported.name}\`, not \`${tag}\`. The corpus is ` +
                    'authored in GIR class names and ADR 0034 clause 1 says a widget carries that name, so a ' +
                    'barrel member bound to another class would build the wrong widget at exit 0.',
            );
        }
        return { xmlName: `${prefix}:${member}`, ctor: exported as ElementClass };
    }
    throw new Error(
        `\`${tag}\` starts with no library this dialect has a barrel for (${Object.keys(BARRELS).join(', ')}).`,
    );
}

/** What a parent must be for an XML child to reach a slot rather than the first cell. */
interface BuilderParent {
    _addChildFromBuilder(name: string, view: View): void;
}

/**
 * Build one authored node the way NativeScript's XML builder does: construct with no
 * arguments, write the attributes, then hand each child to the parent's own child door.
 *
 * AN ATTRIBUTE IS ALWAYS A STRING, and that is the door rather than a choice of this
 * builder: `setPropertyValue` ends in `instance[name] = value` with no conversion at all for
 * a plain accessor, so a setter declared `boolean` is handed `'true'`. Writing the authored
 * boolean instead would drive the construct-props bag — a different door — and would leave
 * the coercion `widgets/xml-values.ts` exists for untested on the trees the website ships.
 *
 * AN ATTRIBUTE THAT LANDS NOWHERE IS REFUSED HERE. `instance[name] = value` on a name
 * nothing declares adds a dead own-property and returns, at exit 0 — this surface's own
 * silent drop. The membership test runs BEFORE the write, because afterwards the dead
 * property answers it.
 */
export function build(node: SharedTreeNode): View {
    const element = elementFor(node.tag);
    const view = new element.ctor();
    for (const [prop, value] of Object.entries(node.props ?? {})) {
        if (!(prop in view)) {
            throw new Error(
                `<${element.xmlName} ${prop}="${value}"> reaches nothing: \`${node.tag}\` declares no ` +
                    `'${prop}'. NativeScript's builder assigns it anyway, as a dead own-property at exit 0, ` +
                    'so the attribute door cannot report this and the tree would render without it.',
            );
        }
        (view as unknown as Record<string, unknown>)[prop] = String(value);
    }
    for (const child of node.children ?? []) {
        const parent = view as unknown as Partial<BuilderParent>;
        if (typeof parent._addChildFromBuilder !== 'function') {
            throw new Error(
                `<${element.xmlName}> takes no XML child: \`${node.tag}\` has no \`_addChildFromBuilder\`, so ` +
                    'the corpus nests a node this element cannot hold.',
            );
        }
        parent._addChildFromBuilder(elementFor(child.tag).xmlName, build(child));
    }
    return view;
}
