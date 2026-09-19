import { readFile } from 'node:fs/promises';
import {
    accessibilityElement,
    accessibilityValue,
    type EmitOptions,
    emitGtkBuilderXml,
    enumOrFlagsTypeOf,
    gtypeName,
    parseBlueprint,
    resolveIdent,
} from '@gjsify/blueprint';
import minifyXML from 'minify-xml';
import { type Plugin } from 'vite';

export interface BlueprintPluginOptions {
    minify?: boolean;
    verbose?: boolean;
}

// No error type is re-exported here, and that is the shape rather than an omission. What `load()`
// throws is `@gjsify/blueprint`'s `BlueprintSyntaxError` / `BlueprintEmitError`, raised by the
// package that DEFINES them and that every consumer of this plugin already has as a declared
// dependency — `plugin.spec.ts` catches them from there. A re-export would give the same two
// classes a second import path whose only job is to stay in step with the first.

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

export default function blueprintPlugin(options: BlueprintPluginOptions = {}): Plugin {
    const { minify = false, verbose = false } = options;

    return {
        name: 'vite-plugin-blueprint',

        async load(id) {
            if (id.endsWith('.blp')) {
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
                const source = await readFile(id, 'utf8');
                let xmlContent = emitGtkBuilderXml(parseBlueprint(source, id), SEAMS);
                if (verbose) console.log(`Compiled ${id} (@gjsify/blueprint)`);

                // Minify XML if option is enabled
                if (minify) {
                    xmlContent = minifyXML(xmlContent);
                    if (verbose) console.log(`Minified XML for ${id}`);
                }

                // Return the XML content as a string
                return `export default ${JSON.stringify(xmlContent)};`;
            }
        },
    };
}
