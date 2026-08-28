/**
 * The generator CLI.
 *
 *   gjsify run generate -- [--gir-dir DIR]... [--out DIR]
 *
 * WHY THE GIR PATH IS AN ARGUMENT AND NOT A DEPENDENCY. The GIR files are not in
 * this repository and should not be: `Gtk-4.0.gir` alone is 6.2 MB, they are
 * distro artefacts, and four different GTK versions sit on the maintainer
 * workstation. So the ARTEFACT is committed (ADR 0028 § Implementation) and the
 * input is located at generation time — from `--gir-dir`, from `GJSIFY_GIR_DIR`,
 * or from the search list below. A fresh clone builds, checks, packs and tests
 * with no GIR present at all; only regenerating needs one.
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

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import system from 'system';

import { methodsOf } from '../conformance/index.js';
import { CURATED_DESCRIPTORS } from '../descriptors/index.js';
import { emitWidgets } from './emit.mjs';
import { emitProps, emitSurfaceData, type EmittedFile } from './emit-types.mjs';
import { concreteWidgets, placementCarriers, readNamespace, type GirNamespace } from './gir.mjs';
import { buildSurface } from './surface.mjs';
import { buildUniverse } from './tsmap.mjs';

/**
 * The namespaces to load, and why every one of them.
 *
 * Gtk and Adw are the widgets. The other five are there because a property or a
 * signal parameter REFERENCES them, measured: Gdk 203 times, GObject 170, Gio 26,
 * GLib 24, Pango 19. Load fewer and the type mapper throws by name on the first
 * reference it cannot resolve — which is the point: 6768 property slots and 1889
 * signal parameters resolve completely, so there is no silent fallback to hide an
 * omission in.
 */
const NAMESPACES: ReadonlyArray<readonly [string, string]> = [
    ['Gtk', '4.0'],
    ['Adw', '1'],
    ['Gdk', '4.0'],
    ['GObject', '2.0'],
    ['Gio', '2.0'],
    ['GLib', '2.0'],
    ['Pango', '1.0'],
];

/** Where a GIR file might be, most specific first. */
function searchPath(explicit: readonly string[]): string[] {
    const dirs = [...explicit];
    const env = GLib.getenv('GJSIFY_GIR_DIR');
    if (env) dirs.push(...env.split(':').filter((d) => d !== ''));
    // The ts-for-gir checkout is where this workspace keeps a complete, pinned set;
    // the system directory is what a stranger has, and carries only what their
    // -devel packages installed.
    // Relative to the CWD, which is this package's directory when the `generate`
    // script runs it. A git WORKTREE breaks the obvious sibling relationship — the
    // ts-for-gir checkout sits next to the main clone, not next to the worktree —
    // so `GJSIFY_GIR_DIR` above is the reliable answer and these are conveniences.
    dirs.push(
        'girs',
        '../../../girs',
        '../../../../ts-for-gir/girs',
        '../../../../../ts-for-gir/girs',
        '/usr/share/gir-1.0',
    );
    return dirs;
}

function locate(dirs: readonly string[], file: string): string | null {
    for (const dir of dirs) {
        const path = `${dir}/${file}`;
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) return path;
    }
    return null;
}

function read(path: string): string {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) throw new Error(`cannot read ${path}`);
    return new TextDecoder().decode(bytes);
}

interface Options {
    readonly girDirs: string[];
    readonly out: string;
    readonly help: boolean;
}

function parseArgs(argv: readonly string[]): Options {
    const girDirs: string[] = [];
    let out = 'src/generated';
    let help = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--gir-dir') girDirs.push(argv[++i] ?? '');
        else if (arg === '--out') out = argv[++i] ?? out;
        else if (arg === '--help') help = true;
        else throw new Error(`unknown argument ${arg}`);
    }
    return { girDirs: girDirs.filter((d) => d !== ''), out, help };
}

const USAGE = `usage: generate [--gir-dir DIR]... [--out DIR]

  --gir-dir DIR   where to look for the .gir files, repeatable. Also read from
                  GJSIFY_GIR_DIR (colon-separated).
  --out DIR       where to write (default src/generated).

Regenerating is a maintainer step: the artefact is committed, so a fresh clone
builds, checks, packs and tests with no GIR present. \`git diff\` after a run shows
what your GTK changed.`;

function writeFile(dir: string, file: EmittedFile): void {
    const target = Gio.File.new_for_path(`${dir}/${file.path}`);
    const parent = target.get_parent();
    if (parent && !parent.query_exists(null)) parent.make_directory_with_parents(null);
    target.replace_contents(new TextEncoder().encode(file.text), null, false, Gio.FileCreateFlags.NONE, null);
}

function main(argv: readonly string[]): number {
    const options = parseArgs(argv);
    if (options.help) {
        console.log(USAGE);
        return 0;
    }
    const dirs = searchPath(options.girDirs);

    const namespaces: GirNamespace[] = [];
    const missing: string[] = [];
    const start = GLib.get_monotonic_time();
    for (const [name, version] of NAMESPACES) {
        const file = `${name}-${version}.gir`;
        const path = locate(dirs, file);
        if (!path) {
            missing.push(file);
            continue;
        }
        namespaces.push(readNamespace(read(path)));
    }
    if (missing.length > 0) {
        console.error(`missing GIR file(s): ${missing.join(', ')}`);
        console.error(`searched: ${dirs.join(', ')}`);
        console.error('pass --gir-dir, or set GJSIFY_GIR_DIR');
        return 1;
    }
    const readMs = (GLib.get_monotonic_time() - start) / 1000;

    const universe = buildUniverse(namespaces);
    // Widgets come from Gtk and Adw ONLY. The other namespaces are loaded to
    // RESOLVE types, not to contribute tags — Gio and GObject carry classes that
    // are not widgets, and Gdk carries none at all.
    const widgetNamespaces = namespaces.filter((ns) => ns.name === 'Gtk' || ns.name === 'Adw');
    // Two rules, one table. `concreteWidgets` answers "what can be created and
    // shown"; `placementCarriers` answers "what else can HOLD one" — the GTK4 list
    // carriers, which are not widgets at all. Neither overlaps the other: the
    // carrier rule excludes anything on `GtkWidget`'s chain, so `assertInjective`
    // over the merged gtypes stays true.
    const widgets = [...concreteWidgets(widgetNamespaces), ...placementCarriers(widgetNamespaces)];
    const provenance = namespaces.map((ns) => `${ns.name}-${ns.version}`).join(' ');

    const table = emitWidgets({
        namespaces: widgetNamespaces,
        widgets,
        // CURATED, never BUILTIN: the merged table contains every generated row, so
        // G1 ("every curated gtype is in the GIR") and G3 ("every method a policy
        // names exists") would be trivially true and the gates would check nothing.
        // Measured — passing the merged table made the emitted header claim 164
        // measured placement rules where there are 26.
        curated: CURATED_DESCRIPTORS,
        methodsOf,
    });

    const model = buildSurface(widgets, namespaces, universe);
    const files: EmittedFile[] = [
        { path: 'widgets.ts', text: table.text },
        emitProps(model, provenance),
        emitSurfaceData(model, provenance),
    ];

    console.log(`read ${namespaces.length} GIR files in ${readMs.toFixed(0)} ms — ${provenance}`);
    console.log(`widgets: ${table.count}, declarations: ${model.declarations.size}, enums: ${model.enumNicks.size}`);
    console.log(`namespaces referenced by the surface: ${[...model.namespacesUsed].sort().join(' ')}`);

    for (const file of files) {
        writeFile(options.out, file);
        console.log(`  wrote ${options.out}/${file.path} (${file.text.length} chars)`);
    }
    return 0;
}

const code = main(system.programArgs);
if (code !== 0) system.exit(code);
