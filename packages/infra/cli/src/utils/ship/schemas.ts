// Compiling `gschemas.compiled` into a stage that has no install step.
//
// THE DEFECT THIS CLOSES is not cosmetic and `payload.ts` already named it:
// every launcher form exports `XDG_DATA_DIRS` at the staged `share/`, and
// GSettings ABORTS on a schema directory holding a `.gschema.xml` with no
// `gschemas.compiled` beside it. On Linux the `.deb`/`.rpm` postinst runs
// `glib-compile-schemas` at install (`scripts.ts`); a `.app` has no postinst and
// nothing else was going to run it. So `gjsify ship darwin --stage` produced a
// bundle whose first `Gio.Settings.new()` kills the process — an artifact that
// installs and does not start, which is the class this whole command exists
// against.
//
// AT STAGE TIME, not at pack time, and that is the decision worth stating.
// A stage is the deliverable for a layout no format wrapped until now, and the
// warning `gjsify ship` prints about it is a claim about the TREE — leaving the
// compile to a packer would keep `--stage` producing an aborting bundle while
// the message said otherwise.
//
// The cost is that assembly now execs one tool for a non-Linux layout with
// schemas in the payload. That does not make assembly host-BOUND (ADR 0024 § A1):
// `glib-compile-schemas` is GLib's and runs on all three OSes, which is why the
// two macOS format rows stay `finishOn: 'any'` and declare the tool through
// `requiredTools` instead.

import { execFile } from 'node:child_process';
import { basename, join } from 'node:path';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { promisify } from 'node:util';

import { SHARE } from './share-dirs.js';
import type { StagedFile } from './types.js';

const execFileAsync = promisify(execFile);

/** The one spelling of the tool, read by this module AND by the format rows. */
export const SCHEMA_COMPILER = 'glib-compile-schemas';

/**
 * How to install it, in the two distributions' words.
 *
 * The same two package names `depends.ts`'s `SCHEMA_COMPILER_PACKAGE` emits into
 * a `Depends:`/`Requires:`, so the advice a user gets here and the dependency a
 * `.deb` declares cannot name different packages.
 */
export const SCHEMA_COMPILER_HINT =
    'Fedora: `sudo dnf install glib2`, Debian/Ubuntu: `sudo apt install libglib2.0-bin`';

/** The compiled cache's prefix-relative path — one definition, several readers. */
export const SCHEMA_CACHE = `${SHARE.schemas}/gschemas.compiled`;

export interface CompileSchemasInput {
    /** Absolute paths of the project's `*.gschema.xml` files. */
    schemaFiles: readonly string[];
    /** A scratch directory this function owns; wiped and rewritten on every run. */
    workDir: string;
}

/**
 * Compile the payload's schemas and return the cache as ONE prefix-relative
 * planned file, or nothing when the payload has no schema.
 *
 * PREFIX-RELATIVE, so `place()` maps it into `Contents/Resources/share/…` or a
 * Windows `share\` with no rule of its own. That is the whole reason this returns
 * a `StagedFile` rather than writing into the stage directly: the layout map stays
 * the single place that knows where `share/` goes, and the e2e's hand-written map
 * needs no new entry to cover it.
 *
 * `--strict` IS LOAD-BEARING and was measured, not assumed. Against a schema whose
 * `path` attribute lacks its leading slash, on glib 2.88.3 — the observable is the
 * exit code and the file, not the wording, because the diagnostic is translated
 * and was read here in German:
 *
 *     glib-compile-schemas in --targetdir out            → exit 0, warns that the
 *                                                          whole file was ignored,
 *                                                          gschemas.compiled WRITTEN
 *     glib-compile-schemas in --targetdir out --strict   → exit 1, nothing written
 *
 * Without the flag a broken schema is skipped at exit 0 and a cache is produced
 * that simply does not contain it — so the stage looks compiled, the warning goes
 * away, and `g_settings_new()` still aborts on the schema that was dropped. That
 * is a green that checked nothing, produced by the step meant to close the hole.
 *
 * A DIRECTORY, because that is the only input the tool takes: the schemas are
 * copied into `workDir` under their own basenames first. `plan.ts` has already
 * refused any basename not prefixed with the app id, so two schemas cannot
 * collide here.
 *
 * ENDIANNESS, stated rather than assumed away. The output is GVDB, and the file
 * this tree produces is HOST-endian — measured on x86-64 with glib 2.88.3: in a
 * 256-byte `gschemas.compiled` compiled from one schema with one key, the eight
 * bytes at offset 16 read `18 00 00 00 58 00 00 00`, i.e. the pointer pair 24 and
 * 88 stored little-endian. Whether GLib's reader byte-swaps a foreign-endian
 * cache is UNVERIFIED here — nothing in this tree tested it and nothing below
 * assumes an answer. It does not bite today: both darwin targets (x64, arm64) and
 * every runner in this project's CI are little-endian, so no cache yet crosses
 * that boundary. A big-endian assembling host is the case to measure before
 * anyone claims otherwise.
 */
export async function compileSchemasForStage(input: CompileSchemasInput): Promise<StagedFile[]> {
    if (input.schemaFiles.length === 0) return [];

    rmSync(input.workDir, { recursive: true, force: true, maxRetries: 5 });
    mkdirSync(input.workDir, { recursive: true });
    for (const schema of input.schemaFiles) copyFileSync(schema, join(input.workDir, basename(schema)));

    try {
        await execFileAsync(SCHEMA_COMPILER, ['--strict', `--targetdir=${input.workDir}`, input.workDir]);
    } catch (error) {
        const failure = error as { code?: unknown; stderr?: string };
        if (failure.code === 'ENOENT') {
            throw new Error(
                `gjsify ship: this layout has no install step, so \`${SCHEMA_COMPILER}\` has to run HERE to ` +
                    `turn the payload's schemas into \`${SCHEMA_CACHE}\` — and it is not on PATH. ` +
                    `Install it (${SCHEMA_COMPILER_HINT}). Without the compiled cache the launcher points ` +
                    'XDG_DATA_DIRS at a schema directory GSettings aborts on, so the bundle would build and ' +
                    'then die at its first `Gio.Settings.new()`.',
            );
        }
        throw new Error(
            `gjsify ship: \`${SCHEMA_COMPILER} --strict\` refused this project's schemas.\n` +
                `${(failure.stderr ?? '').trimEnd()}\n` +
                '    `--strict` is deliberate: without it a malformed schema is SKIPPED at exit 0 and a ' +
                'cache\n    is written without it, so the app still aborts on the schema that was dropped. ' +
                'Fix the\n    file it names, or drop it from `gjsify.ship.schemas`.',
        );
    }

    return [
        {
            path: SCHEMA_CACHE,
            mode: 0o644,
            source: { kind: 'file', path: join(input.workDir, 'gschemas.compiled') },
        },
    ];
}
