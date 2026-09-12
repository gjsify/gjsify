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
// AND THE PREDICATE IS THE ARTIFACT, NOT THE LAYOUT — which is what the first
// version of this module got wrong and what the AppImage measured. The condition
// was written as `layout.os === 'linux' ? [] : compile` (`commands/ship.ts`), and
// it stood for a year because on Linux every format DID have an install step.
// An AppImage has none — that is the entire point of the format — so it inherited
// the Linux layout, inherited the skip, and shipped an artifact that died on
// `Gio.Settings.new()` at its first line. Learn6502 0.8.0's AppImage, measured:
//
//     JS ERROR: Error: GSettings schema eu.jumplink.Learn6502 not found
//
// A layout is not a claim about install steps. {@link compileSchemasForPayload}
// is what the format that has none calls for itself.
//
// AT STAGE TIME, not at pack time, and that is the decision worth stating.
// A stage is a deliverable in its own right — it is what crosses to the host
// that finishes a `.dmg` or an `.msi` — and the warning `gjsify ship` prints
// about it is a claim about the TREE. Leaving the compile to a packer would keep
// `--stage` producing an aborting bundle while the message said otherwise.
//
// The cost is that assembly now execs one tool for a non-Linux layout with
// schemas in the payload. That does not make assembly host-BOUND (ADR 0024 § A1):
// `glib-compile-schemas` is GLib's and runs on all three OSes, which is why the
// four rows that ASSEMBLE a non-Linux tree — the `.app`, its zip, the Windows
// program directory and its zip — stay `finishOn: 'any'` and declare the tool
// through `requiredTools` instead. The `.dmg` and the `.msi` deliberately do not
// declare it: they wrap a tree that is already assembled, so a `--from-stage`
// pack of one needs no GLib at all (the `macos-app-dmg` row says so).

import { execFile } from 'node:child_process';
import { basename, join, posix } from 'node:path';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    await runSchemaCompiler(input.workDir);

    return [
        {
            path: SCHEMA_CACHE,
            mode: 0o644,
            source: { kind: 'file', path: join(input.workDir, 'gschemas.compiled') },
        },
    ];
}

/**
 * The same compile, driven from a PAYLOAD instead of from the project's files.
 *
 * WHY A SECOND ENTRY POINT AND NOT A SECOND CALLER OF THE FIRST. The AppImage is
 * the one format whose LAYOUT has an install step and whose ARTIFACT does not
 * (`formats.ts`, the `appimage` row), so the compile cannot move to the place
 * {@link compileSchemasForStage} runs: the Linux stage is SHARED with the `.deb`
 * and the `.rpm`, whose `share/glib-2.0/schemas` is the SYSTEM directory. A cache
 * staged there is our 700 bytes installed over every other package's schemas —
 * regenerated by the postinst on dpkg, and REMOVED from the system on `rpm -e`.
 * So the cache is produced on the AppImage's own pack path, into the AppDir, and
 * nowhere else.
 *
 * FROM THE PAYLOAD AND NOT FROM `settings.schemaFiles`, which is the input that
 * makes `--from-stage` work: a stage that crossed from another host carries the
 * `.gschema.xml` bytes and not the project directory they came from. The same
 * argument `packOne`'s header already makes for every other container here.
 *
 * `undefined` RATHER THAN AN EMPTY LIST when the payload has no schema, because
 * the caller has to tell "nothing to compile" from "a cache is expected" — see
 * `assertAppImageIsPackable`, which refuses the second case.
 */
export async function compileSchemasForPayload(input: {
    payload: readonly { path: string; data: Uint8Array }[];
    workDir: string;
}): Promise<{ path: string; mode: number; data: Uint8Array } | undefined> {
    const sources = input.payload.filter((entry) => isSchemaSource(entry.path));
    if (sources.length === 0) return undefined;

    rmSync(input.workDir, { recursive: true, force: true, maxRetries: 5 });
    mkdirSync(input.workDir, { recursive: true });
    for (const source of sources) {
        // `posix.basename` AND NOT `basename`, which the function above correctly
        // uses one screen up. The two take different kinds of string: that one is
        // handed a path read off THIS filesystem, where the host is the authority;
        // this one is handed a `PayloadEntry.path`, which is POSIX-separated by its
        // own type contract and built with `posix.join`. On win32 the host-aware
        // `basename` also separates on `\`, so a Linux schema whose filename
        // legitimately contains a backslash would be silently truncated while
        // assembling a payload that is not the host's.
        writeFileSync(join(input.workDir, posix.basename(source.path)), source.data);
    }
    await runSchemaCompiler(input.workDir);

    return { path: SCHEMA_CACHE, mode: 0o644, data: readFileSync(join(input.workDir, 'gschemas.compiled')) };
}

/**
 * Whether a prefix-relative payload path is a GSettings schema SOURCE.
 *
 * Exported because two modules ask it of the same payload and a second spelling
 * would let them disagree: this module decides what to compile, and
 * `assertAppImageIsPackable` decides whether a compiled cache was owed.
 *
 * The extension is `glib-compile-schemas`'s own — it reads `*.gschema.xml` from
 * the directory it is given and ignores everything else — so a payload that
 * staged `foo.xml` under `share/glib-2.0/schemas` is a file GSettings never reads
 * and this correctly says nothing about it.
 */
export function isSchemaSource(path: string): boolean {
    return path.startsWith(`${SHARE.schemas}/`) && path.endsWith('.gschema.xml');
}

/**
 * `glib-compile-schemas --strict` over a directory, with the two failures named.
 *
 * Split out when the AppImage needed the same compile from different bytes. The
 * MESSAGES are the reason it is one function rather than two copies: they are the
 * whole value of this module over a bare `execFile`, and an ENOENT that named the
 * package on one path and not the other is the drift this shape cannot have.
 */
async function runSchemaCompiler(workDir: string): Promise<void> {
    try {
        await execFileAsync(SCHEMA_COMPILER, ['--strict', `--targetdir=${workDir}`, workDir]);
    } catch (error) {
        const failure = error as { code?: unknown; stderr?: string };
        if (failure.code === 'ENOENT') {
            throw new Error(
                `gjsify ship: this artifact has no install step, so \`${SCHEMA_COMPILER}\` has to run HERE to ` +
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
}
