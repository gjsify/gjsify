import { readFile } from 'node:fs/promises';
import {
    accessibilityElement,
    accessibilityValue,
    type EmitOptions,
    emitGtkBuilderXml,
    enumOrFlagsTypeOf,
    gtypeName,
    parseBlueprint,
    projectToSharedNode,
    resolveIdent,
} from '@gjsify/blueprint';
import minifyXML from 'minify-xml';
import { type Plugin } from 'vite';

export interface BlueprintPluginOptions {
    minify?: boolean;
    verbose?: boolean;
}

// Blueprint's OWN two error types are not re-exported here, and that is the shape rather than
// an omission. What a parse or an emit throws is `@gjsify/blueprint`'s `BlueprintSyntaxError` /
// `BlueprintEmitError`, raised by the package that DEFINES them and that every consumer of this
// plugin already has as a declared dependency — `plugin.spec.ts` catches them from there. A
// re-export would give the same two classes a second import path whose only job is to stay in
// step with the first.
//
// `BlueprintProjectionError` below is the opposite case and belongs here for the same reason
// those belong there: the refusal it carries is not a fact about the LANGUAGE. The parser reads
// the file fine and the projection hands back a tree plus the list of what it cost; deciding
// that such a tree may not reach a renderer is this plugin's decision, taken at the seam where
// a build target is known. So it is declared where it is thrown.
export { BlueprintProjectionError } from './projection-error.js';

import { BlueprintProjectionError } from './projection-error.js';

/**
 * The five seams `@gjsify/blueprint`'s emitter reaches introspection through, answered by that
 * same package out of the `@girs` vocabulary.
 *
 * ALL FIVE, and that is not tidiness. Every one is optional and every one NARROWS the output:
 * without `resolveIdent` an enum property emits `vertical` where GtkBuilder is given `1`, without
 * `gtypeName` a `Gio.ListStore` emits `GioListStore`, a class GtkBuilder resolves to nothing.
 * `emitGtkBuilderXml` documents a fallback for each, so a dropped seam does not throw — it builds,
 * and the widget is wrong at run time. That is the silent-wrong-output ADR 0053 clause 3 exists to
 * refuse, and no corpus run can catch it: `check-blueprint-corpus.mjs` hands in its own five, so
 * it would stay green over every tracked `.blp` while this file passed four.
 *
 * `Required<EmitOptions>` is what holds it, and it is a TYPE rather than a test because a test
 * would need a `.blp` whose bytes move for each seam and there is no such file. Drop a key and
 * `gjsify run check` fails on this line; change a seam's signature upstream and it fails here too.
 */
const SEAMS: Required<EmitOptions> = Object.freeze({
    accessibilityElement,
    accessibilityValue,
    enumOrFlagsTypeOf,
    gtypeName,
    resolveIdent,
});

/**
 * The query that asks for ADR 0051's authored-tree node instead of GtkBuilder XML.
 *
 * WHY A SPECIFIER AND NOT A BUILD-TARGET MODE. The obvious wiring is an option — `emit: 'tree'`
 * on the non-GTK app targets — and it is the wrong one, for a reason the whole point of sharing a
 * template rests on: it would make `import Template from './x.blp'` a string on `--app gjs` and
 * an object on `--app browser`. One source, two meanings, chosen by a build flag the file cannot
 * see. A consumer would have no spelling for "give me the XML here" on a target whose default had
 * been flipped, and the ambient `*.blp` declaration — which has exactly one shape per module
 * pattern — could not describe either honestly. The knowledge of WHICH exit a module wants sits
 * at the import site, so that is where it is written.
 *
 * Three properties fall out, and each is worth more than the shorter spelling:
 *
 *   · The GTK path cannot change. A bare `.blp` never reaches `projectToSharedNode` at all, so
 *     "the XML exit did not move" is a statement about reachable code and not about a default
 *     value someone could flip. ADR 0066 § The XML exit does not move made that a property to
 *     keep checkable rather than assert; this keeps it checkable one layer out.
 *   · The refusal below cannot break a build that did not ask. A `.blp` with losses keeps
 *     compiling to XML exactly as it does today; only asking for its TREE fails.
 *   · Every app target registers one plugin with no options. There is no target→mode table to
 *     keep in step with the list of targets, which is the drift `app/nativescript.ts`'s
 *     "NO blueprintPlugin" comment was one half of.
 */
const SHARED_TREE_QUERY = '?shared-tree';

/** The `.blp` path a module id names, with the exit it asked for. */
function readId(id: string): { file: string; sharedTree: boolean } | undefined {
    if (id.endsWith(SHARED_TREE_QUERY)) {
        const file = id.slice(0, -SHARED_TREE_QUERY.length);
        return file.endsWith('.blp') ? { file, sharedTree: true } : undefined;
    }
    return id.endsWith('.blp') ? { file: id, sharedTree: false } : undefined;
}

export default function blueprintPlugin(options: BlueprintPluginOptions = {}): Plugin {
    const { minify = false, verbose = false } = options;

    return {
        name: 'vite-plugin-blueprint',

        // The query has to be resolved by hand: the default resolver stats the specifier, and
        // no file is named `main-window.blp?shared-tree`. Resolving the path WITHOUT the query
        // and putting it back is also what keeps the two exits separate modules — same file,
        // two ids, two module records — so importing a template both ways in one bundle gets
        // the XML and the tree rather than whichever was loaded first.
        async resolveId(source, importer) {
            if (!source.endsWith(SHARED_TREE_QUERY)) return null;
            const bare = source.slice(0, -SHARED_TREE_QUERY.length);
            if (!bare.endsWith('.blp')) return null;
            const resolved = await this.resolve(bare, importer, { skipSelf: true });
            return resolved === null ? null : `${resolved.id}${SHARED_TREE_QUERY}`;
        },

        async load(id) {
            const asked = readId(id);
            if (asked === undefined) return;

            // ADR 0053 clause 5: the in-repo parser is authoritative for the build and
            // `blueprint-compiler` is the oracle it is measured against. There is deliberately
            // NO fallback to the binary. A silent one would put back the dependency clause 7
            // exists to remove, and it would hide any disagreement behind whichever of the two
            // happened to be installed — the build's output would depend on the host.
            //
            // The subset is a real limit while it lasts. A `.blp` reaching a construct the
            // parser does not hold fails the build rather than compiling, and the error names
            // the construct, the file and the line: `BlueprintSyntaxError` before an AST
            // exists, `BlueprintEmitError` after. That is clause 3's declared trade against
            // output that looks plausible and means something else.
            const source = await readFile(asked.file, 'utf8');
            const ast = parseBlueprint(source, asked.file);

            if (asked.sharedTree) {
                // THE LOSSY EXIT REFUSES ITS LOSSES RATHER THAN SHIPPING THEM.
                //
                // `projectToSharedNode` declares what it dropped — ADR 0053 clause 1 calls the
                // losses "named at the seam rather than discovered downstream" — and this is the
                // seam that has to act on the naming. A renderer handed a tree with losses builds
                // a SMALLER UI than the `.blp` describes and cannot tell: a `bind` that never
                // updates, an `Adw.Breakpoint` whose setters never fire. The template would then
                // be complete on GTK and quietly partial everywhere else, which is worse than not
                // sharing it at all, because the GTK build keeps saying it works.
                //
                // So the build stops here, with the file, the line and the kind of every loss —
                // a porting task a reader can open, not a warning scrolled past. `minify` does
                // not apply: it is an XML setting and this exit emits none.
                const { node, lost } = projectToSharedNode(ast, { gtypeName });
                if (lost.length > 0) throw new BlueprintProjectionError(asked.file, lost);
                if (verbose) console.log(`Projected ${asked.file} (@gjsify/blueprint)`);
                return `export default ${JSON.stringify(node)};`;
            }

            let xmlContent = emitGtkBuilderXml(ast, SEAMS);
            if (verbose) console.log(`Compiled ${asked.file} (@gjsify/blueprint)`);

            // Minify XML if option is enabled
            if (minify) {
                xmlContent = minifyXML(xmlContent);
                if (verbose) console.log(`Minified XML for ${asked.file}`);
            }

            // Return the XML content as a string
            return `export default ${JSON.stringify(xmlContent)};`;
        },
    };
}
