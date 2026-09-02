/**
 * The generator CLI.
 *
 *   gjsify run generate -- [--girs-dir DIR] [--out DIR]
 *
 * WHERE THE VOCABULARY COMES FROM. The input used to be GIR XML: distro artefacts
 * that are not in this repository, 6.2 MB for `Gtk-4.0.gir` alone, with four GTK
 * versions on the maintainer workstation and no way to know which one a build saw.
 * It is now the `@girs/<ns>/vocabulary` subpath (ADR 0029), which is an ordinary
 * dependency, resolved like any other. That closes the provenance question the old
 * route could only answer by convention: each vocabulary states the namespace,
 * version and library version it was generated from, and this generator copies that
 * into the artefact header instead of naming the files it happened to read.
 *
 * `--girs-dir` stays an argument so a locally built `@girs` can be generated against
 * before it is published. Without it the directory is found by walking up from the
 * working directory, which is what makes `npm run generate` work from the package.
 *
 * The ARTEFACT remains committed (ADR 0028 § Implementation): a fresh clone builds,
 * checks, packs and tests without regenerating anything.
 *
 * THERE IS NO `--check` MODE, and the attempt to add one is worth recording: the
 * `generate` script pipes the output through `gjsify format`, which reflows it
 * (+4 KB on `props.ts`), so a byte comparison against the committed file reports a
 * difference on every run. Two of my own measurements said otherwise first, both
 * because they compared a formatted file against itself. `git diff` after a
 * regeneration answers the same question with no machinery, and the check that
 * matters is machine-INDEPENDENT: `generated.spec.ts` asks the installed GTK
 * whether every generated name is real.
 */

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import system from 'system';

import { CURATED_DESCRIPTORS } from '../descriptors/index.js';
import { emitWidgets } from './emit.mjs';
import { emitProps, emitSurfaceData, type EmittedFile } from './emit-types.mjs';
import { buildFromVocabulary, type VocabularySource } from './girs-vocabulary.mjs';

interface Options {
    /** Where the `@girs/*` vocabulary packages live. */
    readonly girsDir: string;
    readonly out: string;
    readonly help: boolean;
}

/**
 * Walk up from the working directory looking for `node_modules/@girs`.
 *
 * The generator is run from the package (`npm run generate`), where the hoisted
 * dependency sits three levels up. A bare relative default silently resolved to
 * nothing there, and the first symptom was a missing-file error naming a path the
 * caller never typed.
 */
function findGirsDir(): string {
    let dir = GLib.get_current_dir();
    for (let depth = 0; depth < 8; depth++) {
        const candidate = `${dir}/node_modules/@girs`;
        if (GLib.file_test(candidate, GLib.FileTest.IS_DIR)) return candidate;
        const parent = GLib.path_get_dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return 'node_modules/@girs';
}

function parseArgs(argv: readonly string[]): Options {
    let girsDir = '';
    let out = 'src/generated';
    let help = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--girs-dir') girsDir = argv[++i] ?? girsDir;
        else if (arg === '--out') out = argv[++i] ?? out;
        else if (arg === '--help') help = true;
        else throw new Error(`unknown argument ${arg}`);
    }
    return { girsDir: girsDir || findGirsDir(), out, help };
}

const USAGE = `usage: generate [--girs-dir DIR] [--out DIR]

  --girs-dir DIR  where the @girs/* vocabulary packages live
                  (default node_modules/@girs).
  --out DIR       where to write (default src/generated).

Regenerating is a maintainer step: the artefact is committed, so a fresh clone
builds, checks, packs and tests without running this. \`git diff\` after a run shows
what the vocabulary changed.

There is no .gir here any more. The widget vocabulary comes from
\`@girs/<ns>/vocabulary\`, generated once by ts-for-gir, so this package is no longer
a second reader of the same XML (ADR 0029).`;

function writeFile(dir: string, file: EmittedFile): void {
    const target = Gio.File.new_for_path(`${dir}/${file.path}`);
    const parent = target.get_parent();
    if (parent && !parent.query_exists(null)) parent.make_directory_with_parents(null);
    target.replace_contents(new TextEncoder().encode(file.text), null, false, Gio.FileCreateFlags.NONE, null);
}

async function main(argv: readonly string[]): Promise<number> {
    const options = parseArgs(argv);
    if (options.help) {
        console.log(USAGE);
        return 0;
    }
    const dir = options.girsDir;

    // The vocabulary packages this table is built from. Gtk and Adw are the only two that
    // declare widgets; everything else they reference is a TYPE reference, which the
    // vocabulary's own `.d.ts` imports resolve — no second namespace list here.
    const sources: VocabularySource[] = [
        { pkg: 'gtk-4.0', prefix: 'Gtk' },
        { pkg: 'adw-1', prefix: 'Adw' },
    ];

    const start = GLib.get_monotonic_time();
    const { model, widgets, provenance } = await buildFromVocabulary(dir, sources);
    const readMs = (GLib.get_monotonic_time() - start) / 1000;

    const knownGTypes = new Set([...model.declarations.values()].map((d) => d.gtype));
    for (const gtype of model.closure.keys()) knownGTypes.add(gtype);

    const table = emitWidgets({
        provenance,
        knownGTypes,
        widgets,
        // CURATED, never BUILTIN: the merged table contains every generated row, so
        // G1 ("every curated gtype is in the GIR") and G3 ("every method a policy
        // names exists") would be trivially true and the gates would check nothing.
        // Measured — passing the merged table made the emitted header claim 164
        // measured placement rules where there are 26.
        curated: CURATED_DESCRIPTORS,
    });

    const files: EmittedFile[] = [
        { path: 'widgets.ts', text: table.text },
        emitProps(model, provenance),
        emitSurfaceData(model, provenance),
    ];

    console.log(`read ${sources.length} vocabularies in ${readMs.toFixed(0)} ms — ${provenance}`);
    console.log(`widgets: ${table.count}, declarations: ${model.declarations.size}, enums: ${model.enumNicks.size}`);
    console.log(`namespaces referenced by the surface: ${[...model.namespacesUsed].sort().join(' ')}`);

    for (const file of files) {
        writeFile(options.out, file);
        console.log(`  wrote ${options.out}/${file.path} (${file.text.length} chars)`);
    }
    return 0;
}

// GJS prints only the stack for a rejection out of top-level await, so the message —
// the half that says what went wrong — never reaches the terminal. Print it here.
let code = 1;
try {
    code = await main(system.programArgs);
} catch (error) {
    console.error(error instanceof Error ? `error: ${error.message}` : `error: ${String(error)}`);
    if (error instanceof Error && error.stack) console.error(error.stack);
}
if (code !== 0) system.exit(code);
