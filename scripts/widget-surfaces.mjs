// WHICH PACKAGES ARE WIDGET SURFACES — read from the packages, not from a list in a gate.
//
// THE HOLE THIS CLOSES
//
// `check-vocabulary-alignment.mjs` knew about its surfaces because they were NAMED in
// it: `adwaitaWebElements`, then `adwaitaNativeScriptWidgets` beside it. A list binds
// exactly what is on it, and the surface that carried the defect — four GTK widgets
// wearing an `Adw` prefix on NativeScript — sat outside that list for its entire life,
// so no gate could have failed. ADR 0034 § 5 states the fix as a property rather than a
// longer list: *"a package that declares `gjsify.adwaitaSurface` (or however the manifest
// ends up spelling it) and is absent from the reader list fails, and that is what makes
// the rule bind a port nobody has written yet."*
//
// THE SHAPE IS BORROWED, NOT INVENTED. `gjsify.runtimes`, `gjsify.headless`,
// `gjsify.platforms` and `gjsify.storybook` are all per-package declarations with a
// machine check behind each, and `manifest-conformance`'s `field-coverage` rule fails on
// any `gjsify.*` key no rule claims — so a new key is only admissible WITH its rule. That
// rule is `scripts/manifest-conformance/rules/widget-vocabulary.mjs`, and it calls the
// same {@link enrolmentProblems} the gate does, over the same two sets.
//
// WHAT THE DECLARATION SAYS, and why it is not a boolean
//
//     "gjsify": { "widgetVocabulary": { "role": "reference" | "renderer" } }
//
// `role` is the one fact the comparison needs and the one the package legitimately owns:
// which SIDE of it the surface is on. The `reference` is the GIR-derived vocabulary every
// other surface is held against — `@gjsify/gtk-host`, whose tags are emitted by a
// generator that reads no renderer. A `renderer` names its widgets by hand and is
// therefore the half that can carry a surprise. Two references would leave nothing
// independent to hold anything against, so exactly one is a rule; zero renderers would
// make every comparison vacuously true, so at least one is a rule too.
//
// WHICH HALF CAN GO RED. Both directions of the join can, because the declarations live
// in `package.json` files and the readers live here: a package that declares itself and
// has no reader fails, and a reader whose package stopped declaring fails. The `role`
// shape rules read the same package files, so they can go red on a manifest edit as well.
// What CANNOT go red is anything holding this file against itself — see the header of
// `check-vocabulary-alignment.mjs`, which states the same split for its own halves.

import { createContext } from '../packages/infra/manifest-conformance/lib/index.mjs';

import {
    adwaitaNativeScriptWidgets,
    adwaitaReactNativeWidgets,
    adwaitaWebElements,
    namespaceExport,
} from './adwaita-elements.mjs';

/** The manifest key, spelled once. Named in every failure that asks for a manifest edit. */
export const WIDGET_SURFACE_FIELD = 'widgetVocabulary';

/** Where a contributor adds a reader once a package has declared itself. */
export const READER_SOURCE = 'WIDGET_SURFACE_READERS in scripts/widget-surfaces.mjs';

/** The two sides of the comparison. `reference` is the GIR-derived one. */
export const SURFACE_ROLES = ['reference', 'renderer'];

/**
 * Every surface this repository can READ, and how.
 *
 * `widgets(root)` returns the surface's widget vocabulary in the tag namespace
 * (`adw-action-row`, `gtk-button`) — the namespace the GIR tag table is keyed in, so the
 * "already shares a spelling" comparison stays a lookup rather than a second
 * transformation. The `reference` entry has no reader here: its vocabulary IS the
 * generated table `check-vocabulary-alignment.mjs` reads directly, and a second reader of
 * the same file would be a copy that can drift.
 *
 * `namespace(root)` answers ADR 0034 clause 2 — the same vocabulary reachable as
 * `Adw.Bin`, not only as `AdwBin` — mapping each member to the identifier it is bound to,
 * and returning `null` for a surface that exports none. It REPORTS adoption rather than
 * demanding it: a renderer that has not adopted the clause is work that is left, and a
 * gate failing on that would only be turned off. What a surface HAS adopted is then held
 * where its two sides live — `namespaceProblems` in `check-vocabulary-alignment.mjs` for
 * the web elements, rule 8 of `check-adwaita-rn-platform-split.mjs` for React Native's
 * three barrels. Measuring adoption here keeps the answer next to the code instead of in
 * an ADR table that goes stale while the code moves.
 */
export const WIDGET_SURFACE_READERS = {
    '@gjsify/gtk-host': {
        role: 'reference',
        reads: 'packages/framework/gtk-host/src/generated/widgets.ts (GIR-derived, read by the gate itself)',
        widgets: null,
        // n/a by construction: the tags ARE the vocabulary here, and `@girs` supplies the
        // `Gtk`/`Adw` namespaces the reference surface would otherwise have to re-export.
        namespace: null,
    },
    '@gjsify/adwaita-web': {
        role: 'renderer',
        namespace: (root) => namespaceExport(root, 'packages/web/adwaita-web/src'),
        reads: "customElements.define('adw-…') across packages/web/adwaita-web/src",
        widgets: (root) => [...adwaitaWebElements(root).keys()],
    },
    '@gjsify/adwaita-nativescript': {
        role: 'renderer',
        namespace: (root) => namespaceExport(root, 'packages/nativescript-bridge/adwaita/src'),
        reads: 'the adw-<name>.ts / gtk-<name>.ts widget files under packages/nativescript-bridge/adwaita/src/widgets',
        widgets: (root) => [...adwaitaNativeScriptWidgets(root).keys()],
    },
    '@gjsify/adwaita-react-native': {
        role: 'renderer',
        namespace: (root) => namespaceExport(root, 'packages/framework/adwaita-react-native/src'),
        reads: "the base barrel's `export { Adw… } from './widgets/…'` lines",
        widgets: (root) => [...adwaitaReactNativeWidgets(root).keys()].map((name) => `adw-${name}`),
    },
};

/**
 * Every package declaring {@link WIDGET_SURFACE_FIELD}, as plain data.
 *
 * `createContext` is the workspace-glob answer to "which packages exist" that every
 * conformance rule already uses, so a package invisible to the manifest gates cannot be
 * visible here and vice versa — three different answers to that question is the incident
 * `context.mjs` exists because of.
 *
 * @param {string} root repository root
 * @returns {{name: string, rel: string, declaration: unknown}[]}
 */
export function declaredWidgetSurfaces(root) {
    const ctx = createContext({ root });
    const declared = [];
    for (const pkg of ctx.allPackages) {
        const declaration = pkg.gjsify?.[WIDGET_SURFACE_FIELD];
        if (declaration === undefined) continue;
        declared.push({ name: pkg.name, rel: pkg.rel, declaration });
    }
    return declared.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The enrolment rules, as one pure function over plain data.
 *
 * Pure for the reason the sibling gate gives: a rule that cannot fail is visible as a
 * rule with no failing vector, and a synthetic world is the only way to show one red
 * without breaking the tree.
 *
 * @param {{
 *   declared: {name: string, rel: string, declaration: unknown}[],
 *   readers: Record<string, {role: string}>,
 * }} world
 * @returns {string[]} problems, empty when every surface is enrolled and readable
 */
export function enrolmentProblems(world) {
    const { declared, readers } = world;
    const problems = [];

    const roles = new Map();
    // Every package that declared ANYTHING, valid or not. Kept apart from `roles` because
    // the reverse-direction rule below asks "did this package declare itself", and a
    // malformed declaration is still a declaration: folding the two made one bad `role`
    // report a second, false problem saying the package declares nothing — a failure whose
    // text contradicts the file it just read is the shape that teaches people to switch a
    // guard off.
    const declaredNames = new Set(declared.map(({ name }) => name));
    for (const { name, rel, declaration } of declared) {
        if (typeof declaration !== 'object' || declaration === null || Array.isArray(declaration)) {
            problems.push(
                `${rel}/package.json: \`gjsify.${WIDGET_SURFACE_FIELD}\` must be an object with a \`role\` ` +
                    `(got ${Array.isArray(declaration) ? 'an array' : typeof declaration}).`,
            );
            continue;
        }
        const role = declaration.role;
        if (!SURFACE_ROLES.includes(role)) {
            problems.push(
                `${rel}/package.json: \`gjsify.${WIDGET_SURFACE_FIELD}.role\` is ${JSON.stringify(role)}, ` +
                    `expected one of ${SURFACE_ROLES.map((r) => `'${r}'`).join(', ')}. The role says which side ` +
                    'of the comparison the surface is on: the GIR-derived reference, or a hand-named renderer ' +
                    'held against it.',
            );
            continue;
        }
        roles.set(name, role);

        // THE ARM. A surface that declares itself and has no reader is a surface the
        // gate cannot see — exactly the state NativeScript was in for its whole life.
        const reader = readers[name];
        if (reader === undefined) {
            problems.push(
                `${name} declares \`gjsify.${WIDGET_SURFACE_FIELD}\` and NO reader covers it, so the widget ` +
                    'vocabulary gate does not read this surface at all. A surface outside the check cannot ' +
                    `fail it, which is how four GTK widgets came to wear an Adw prefix unnoticed. Add it to ` +
                    `${READER_SOURCE}, or drop the declaration if the package is not a widget surface.`,
            );
            continue;
        }
        if (reader.role !== role) {
            problems.push(
                `${name} declares role '${role}' and ${READER_SOURCE} reads it as '${reader.role}'. The role ` +
                    'decides which side of the comparison carries information; two answers is none.',
            );
        }
    }

    // The other direction: a reader for a package that does not declare itself. Deleting
    // the declaration would otherwise silently un-enrol a surface the gate still reads,
    // and the next surface would learn from that precedent.
    for (const name of Object.keys(readers)) {
        if (declaredNames.has(name)) continue;
        problems.push(
            `${READER_SOURCE} reads ${name}, which declares no \`gjsify.${WIDGET_SURFACE_FIELD}\`. Enrolment is ` +
                'the property, not the reader list — restore the declaration in that package or drop the reader.',
        );
    }

    const references = [...roles].filter(([, role]) => role === 'reference').map(([name]) => name);
    const renderers = [...roles].filter(([, role]) => role === 'renderer').map(([name]) => name);
    if (references.length !== 1) {
        problems.push(
            `${references.length} package(s) declare role 'reference' (${references.join(', ') || 'none'}), and ` +
                'exactly one may: the reference is the GIR-derived vocabulary every renderer is held against, and ' +
                'two of them would leave nothing independent on either side.',
        );
    }
    if (renderers.length === 0) {
        problems.push(
            "no package declares role 'renderer', so every name comparison in the widget vocabulary gate has an " +
                'empty side and passes vacuously. That is the one failure this arrangement exists to prevent.',
        );
    }

    return problems;
}
