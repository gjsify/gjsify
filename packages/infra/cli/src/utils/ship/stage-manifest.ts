// `.gjsify-ship-stage.json` — what one `gjsify ship --stage` hands the
// `gjsify ship --from-stage` that finishes it (ADR 0024 § A2).
//
// A CLOSURE, not a settings dump. The packing host has the staged tree and
// nothing else: no project directory, no `package.json`, no built bundle, no
// `gjsify.ship` config. Everything the packers still need has to be in here,
// and everything that is a BUILD-HOST PATH must not be — serialised verbatim,
// `bundlePath` and friends name files that do not exist where they are read.
//
// The measurement that decided the contents: each of these omissions fails
// SILENTLY, at exit 0, with an artifact that installs.
//
//   * no `staged` — modes come from the plan (see `stage-writer.ts`), so the
//     launcher packs 0644 and the installed `bin/<name>` is not executable.
//   * no `overlay` — the `.deb` ships no `/usr/share/doc/<pkg>/copyright`,
//     which Debian Policy § 12.5 requires and lintian errors on, and the
//     `.rpm` ships no `/usr/share/licenses/<pkg>/LICENSE`.
//   * no `namespaces` — they are scanned from the BUILD TREE's bundle, so a
//     packing host that re-derived nothing would emit `Depends:` without
//     `gir1.2-gtk-4.0` and `gir1.2-adw-1`: the package installs on a machine
//     with no GTK and dies at the first import. That is the exact failure
//     ADR 0024 § 6 exists to prevent, moved one host to the left.
//   * no `mtime` — an artifact upload does not carry mtimes, so re-stat'ing
//     the stage stamps every header with the download time and two hosts
//     packing the same stage produce different bytes.
//
// What is deliberately NOT carried, so the next reader does not add it back:
//   * per-file digests. ADR 0024 § A4 measured that the darwin finish leg has
//     to re-sign all 106 Mach-O images inside the stage, at which point a
//     sha256 set either refuses the artifact it exists to produce or is
//     relaxed to exempt 106 files and stops checking anything. A per-file SIZE
//     survives that and still catches the truncated transfer, so that is what
//     `staged[].bytes` is.
//   * anything derivable from the payload — `hasIcons`, `hasSchemas`, the
//     bundled typelibs. `readPayloadFacts` answers all three from the tree
//     that is right there.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

import { cliVersion } from '../publish-headers.js';
import { FORMAT_IDS } from './formats.js';
import { layoutForOs, LAYOUTS, LAYOUT_NAMES } from './layout.js';
import type {
    FormatDescriptor,
    FormatId,
    HostOs,
    PackSettings,
    ShipFlatpakSettings,
    ShipSettings,
    StagedFile,
    StagedMode,
} from './types.js';

/** The one file a stage carries that is not payload. Lives at the stage ROOT. */
export const STAGE_MANIFEST_FILE = '.gjsify-ship-stage.json';

/**
 * The schema this CLI writes and the only one it reads.
 *
 * A stage is a short-lived intermediate between two jobs of ONE run, not an
 * archive, so there is no migration path in either direction and both
 * mismatches are refused rather than guessed at — see {@link readStageManifest}.
 * Bump it whenever a field's MEANING changes, not when one is added that an
 * older reader would simply ignore; a reader that ignores a field it does not
 * know is exactly how a mode plan silently loses an entry.
 *
 * 2 added `settings.appId` and `settings.flatpak` for the Flatpak target. That
 * is the second case and not the first: an older reader ignoring
 * `settings.flatpak` would not skip a field, it would pack a Flatpak against
 * whatever runtime IT defaults to — a different `org.gnome.Platform` version
 * than the project asked for, at exit 0.
 *
 * 3 added `settings.minNodeVersion` and 4 added `settings.app`. Same case as 2
 * for the same reason: an older reader ignoring `app` does not skip a field, it
 * has no concept of an interpreter choice at all, so it seeds `gjs >= …` for a
 * stage whose launcher — already rendered, already in the tree it is packing —
 * execs `node`. The package then declares one interpreter and runs another.
 *
 * Stated as a consequence and not as an incident, because it never happened:
 * `app` and the launcher landed together. An earlier version of this comment
 * claimed the incident anyway, which is worth leaving on the record — a rule
 * with an invented reason gets "simplified" back out the first time somebody
 * notices the reason is not real.
 *
 * WHY TWO BUMPS IN ONE CHANGE, when neither was ever released. Because 3 and 4
 * are DIFFERENT SHAPES and 3 briefly existed: the intermediate commit wrote
 * `schema: 3` with no `app`. Folding `app` into 3 would have made this reader
 * meet that stage and fail on `settings.app must be "gjs" or "node", got
 * undefined` — fail-closed, but naming a field instead of the one thing the
 * reader can do about it. At 4 the schema check above catches it first and says
 * "re-run the `--stage` phase with this gjsify", which is the whole reason this
 * constant's header is an argument for bumping whenever a reader could mis-read.
 *
 * 5 added `settings.name`, and it was decided against the criterion above rather
 * than reflexively — #1354 M2a changed two things and only one of them warrants a
 * bump:
 *
 *  - NOT the two new format ids. `formats[]` and `overlay`'s keys carry new
 *    VALUES in fields whose meaning is unchanged, and `readStageManifest` already
 *    refuses a `formats[i]` it does not know BY NAME. An older gjsify meeting a
 *    macOS stage therefore fails closed with a message about the format, which is
 *    the right message. Adding a member to a validated enum is the case this
 *    header says not to bump for.
 *  - YES `settings.name`. It is REQUIRED, so this reader meeting a schema-4 stage
 *    would fail on `settings.name must be a string` — naming a field instead of
 *    the one thing the reader can do about it. That is the same shape the 3-to-4
 *    paragraph describes, and at 5 the schema check above fires first and says
 *    "re-run the `--stage` phase with this gjsify".
 */
export const STAGE_SCHEMA_VERSION = 5;

/** What this stage was assembled FOR, in the repo-wide `${process.platform}-${process.arch}` spelling. */
export interface StageTarget {
    /** The layout the stage carries, in the `process.platform` spelling — `win32`, never `windows`. */
    os: HostOs;
    arch: string;
}

/** One staged path, its planned mode, and the size it had when the stage was written. */
export interface StageFileRecord extends StagedMode {
    bytes: number;
}

/** One pre-rendered overlay file. Text only — see {@link writeStageManifest}. */
export interface StageOverlayFile extends StagedMode {
    text: string;
}

export interface StageManifest {
    schema: number;
    /** The tool that assembled the stage, so a mixed-version pipeline is answerable after the fact. */
    tool: { name: string; version: string };
    target: StageTarget;
    /** The formats phase 1 rendered an overlay closure for. */
    formats: FormatId[];
    /** The one build stamp every header and every rendered file shares. */
    mtime: number;
    /** GI namespaces the bundle imports, `Ns-Version` where the specifier pins one. */
    namespaces: string[];
    settings: PackSettings;
    staged: StageFileRecord[];
    overlay: Partial<Record<FormatId, StageOverlayFile[]>>;
}

export interface StageManifestInput {
    /** Absolute path of the stage root, already written. */
    stageDir: string;
    settings: ShipSettings;
    formats: readonly FormatDescriptor[];
    mtime: number;
    namespaces: readonly string[];
    staged: readonly StagedFile[];
    /** Per-format overlay, as `planOverlay` produced it. */
    overlay: ReadonlyMap<FormatId, readonly StagedFile[]>;
}

/**
 * The half of {@link ShipSettings} that crosses the host boundary.
 *
 * Written out field by field rather than spread: a spread would carry
 * `projectDir`, `bundlePath`, `bundleDir`, `iconFiles`, `schemaFiles`,
 * `extraFiles` and `licenseFile` — seven absolute paths from the assembling
 * host — into a file whose whole purpose is to be read somewhere else. The
 * explicit list is also what makes adding a field a decision: see the comment
 * on {@link PackSettings} for what belongs on each side. `appId` and `flatpak`
 * were that decision for the Flatpak target, and the `--from-stage` e2e is
 * where an omission would have shown: it deletes the project, so a field the
 * packer needs and the manifest lacks has nowhere to be read from.
 */
export function toPackSettings(settings: ShipSettings): PackSettings {
    return {
        binaryName: settings.binaryName,
        appId: settings.appId,
        name: settings.name,
        version: settings.version,
        release: settings.release,
        maintainer: settings.maintainer,
        summary: settings.summary,
        description: settings.description,
        license: settings.license,
        ...(settings.homepage === undefined ? {} : { homepage: settings.homepage }),
        section: settings.section,
        group: settings.group,
        extraDepends: settings.extraDepends,
        typelibPackages: settings.typelibPackages,
        app: settings.app,
        minGjsVersion: settings.minGjsVersion,
        minNodeVersion: settings.minNodeVersion,
        flatpak: settings.flatpak,
    };
}

/** Absolute path of a stage's manifest. */
export function stageManifestPath(stageDir: string): string {
    return join(stageDir, STAGE_MANIFEST_FILE);
}

/** `linux-x64`. One spelling repo-wide (root AGENTS.md § Runtime & platform model). */
export function formatTarget(target: StageTarget): string {
    return `${target.os}-${target.arch}`;
}

/**
 * Write the manifest at the stage root, AFTER the tree itself.
 *
 * `bytes` is stat'ed off the written tree rather than taken from the plan: the
 * plan holds a source path or a string, and what the packing host will compare
 * against is what actually landed on disk here.
 */
export function writeStageManifest(input: StageManifestInput): StageManifest {
    const overlay: Partial<Record<FormatId, StageOverlayFile[]>> = {};
    for (const format of input.formats) {
        overlay[format.id] = (input.overlay.get(format.id) ?? []).map((file) => {
            if (file.source.kind !== 'text') {
                // Every overlay entry `planOverlay` produces today is rendered text. A file
                // reference would be a build-host path, and putting one in here is how the
                // manifest would start naming files the packing host cannot open.
                throw new Error(
                    `gjsify ship: internal error — the ${format.id} overlay entry ${file.path} is a file ` +
                        'reference, and a stage manifest may only carry rendered text. Render it in ' +
                        '`planOverlay` instead.',
                );
            }
            return { path: file.path, mode: file.mode, text: file.source.text };
        });
    }

    const manifest: StageManifest = {
        schema: STAGE_SCHEMA_VERSION,
        tool: { name: '@gjsify/cli', version: cliVersion() },
        // The POSITIONAL's value, not a constant. It used to be the literal
        // `'linux'`, correct while the planner produced exactly one layout and
        // wrong the moment it produced three — and wrong SILENTLY, because a
        // darwin stage labelled `linux-arm64` passes every structural check in
        // `readStageManifest` and would be accepted by `--expect-target
        // linux-arm64` on a leg that wanted the Linux one.
        target: { os: input.settings.layoutOs, arch: input.settings.arch },
        formats: input.formats.map((format) => format.id),
        mtime: input.mtime,
        namespaces: [...input.namespaces],
        settings: toPackSettings(input.settings),
        staged: input.staged.map((file) => ({
            path: file.path,
            mode: file.mode,
            bytes: statSync(join(input.stageDir, file.path.split('/').join(sep))).size,
        })),
        overlay,
    };
    writeFileSync(stageManifestPath(input.stageDir), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
}

/**
 * Read and validate a stage's manifest.
 *
 * Every field is checked, because this file is the only thing standing between
 * "a directory someone pointed us at" and a signed-looking `.deb`. A missing
 * `staged` entry would reach `readStage` as a mode nobody planned; a `mode` that
 * arrived as a string would reach `chmod` as `NaN`.
 */
export function readStageManifest(stageDir: string): StageManifest {
    const path = stageManifestPath(stageDir);
    if (!existsSync(path)) {
        throw new Error(
            `gjsify ship: ${stageDir} has no ${STAGE_MANIFEST_FILE}, so it is not a stage this command can ` +
                'pack. A stage is produced by `gjsify ship --stage`, which writes that file at the stage root ' +
                "beside the payload. If you pointed --from-stage at a project's `ship/` directory, point it at " +
                '`ship/stage/` instead.',
        );
    }

    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (error) {
        throw new Error(
            `gjsify ship: ${path} is not readable JSON (${(error as Error).message}). ` +
                'Re-run the `--stage` phase; a truncated manifest means the stage transfer was truncated too.',
        );
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error(`gjsify ship: ${path} is not a JSON object. Re-run the \`--stage\` phase.`);
    }
    const data = raw as Record<string, unknown>;

    const schema = data.schema;
    if (typeof schema !== 'number' || !Number.isInteger(schema)) {
        throw new Error(
            `gjsify ship: ${path} has no integer \`schema\` field, so it was not written by \`gjsify ship ` +
                '--stage`. Re-run the `--stage` phase.',
        );
    }
    if (schema > STAGE_SCHEMA_VERSION) {
        throw new Error(
            `gjsify ship: ${path} declares schema ${schema} and this gjsify understands ` +
                `${STAGE_SCHEMA_VERSION}. The stage was assembled by a newer gjsify: upgrade this one ` +
                '(`gjsify self-update`), or re-run the `--stage` phase with this version. A manifest from the ' +
                'future is refused rather than partially read, because an unknown field could be the one that ' +
                "decides a file's mode.",
        );
    }
    if (schema < STAGE_SCHEMA_VERSION) {
        throw new Error(
            `gjsify ship: ${path} declares schema ${schema} and this gjsify understands ` +
                `${STAGE_SCHEMA_VERSION}. Re-run the \`--stage\` phase with this gjsify. A stage is a ` +
                'short-lived intermediate between two jobs of one run, not an archive, so no migration is ' +
                'kept for it.',
        );
    }

    const at = (field: string): string => `${path} → ${field}`;
    const tool = record(data.tool, at('tool'));
    const target = record(data.target, at('target'));
    const manifest: StageManifest = {
        schema,
        tool: {
            name: expectString(tool.name, at('tool.name')),
            version: expectString(tool.version, at('tool.version')),
        },
        target: {
            // `layoutForOs`, which takes the `process.platform` spelling and NO
            // alias. `resolveLayout` — the positional's resolver — also accepts
            // `windows`, and routing this field through it would mean a manifest
            // literally saying `"windows"` was accepted and then COMPARED as
            // `win32`: two files with different bytes in the one field
            // `--expect-target` exists to compare would both match it, on a wire
            // format whose entire job is to catch a job that downloaded the wrong
            // artifact. Refused here rather than reaching the layout lookup as a
            // lie, and named the way every other field in this function is.
            os: expectLayoutOs(expectString(target.os, at('target.os')), at('target.os')),
            arch: expectString(target.arch, at('target.arch')),
        },
        formats: expectArray(data.formats, at('formats')).map((entry, index) => {
            const id = expectString(entry, at(`formats[${index}]`));
            if (!(FORMAT_IDS as string[]).includes(id)) {
                throw new Error(
                    `gjsify ship: ${at(`formats[${index}]`)} is "${id}", which this gjsify does not know. ` +
                        `Known formats: ${FORMAT_IDS.join(', ')}.`,
                );
            }
            return id as FormatId;
        }),
        mtime: expectInteger(data.mtime, at('mtime')),
        namespaces: expectArray(data.namespaces, at('namespaces')).map((entry, index) =>
            expectString(entry, at(`namespaces[${index}]`)),
        ),
        settings: readPackSettings(record(data.settings, at('settings')), at('settings')),
        staged: expectArray(data.staged, at('staged')).map((entry, index) => {
            const file = record(entry, at(`staged[${index}]`));
            return {
                path: expectString(file.path, at(`staged[${index}].path`)),
                mode: expectInteger(file.mode, at(`staged[${index}].mode`)),
                bytes: expectInteger(file.bytes, at(`staged[${index}].bytes`)),
            };
        }),
        overlay: {},
    };

    // `readStage` refuses in both directions — a staged path the plan does not name,
    // and a planned path the stage lacks — but both sides can be empty TOGETHER and
    // agree. Measured: a directory holding only the sidecar packed into a structurally
    // valid `ship-demo_1.2.3-1_all.deb` that `dpkg -i` installs and that contains no
    // `bin/` and no `lib/`; the command simply does not exist afterwards.
    if (manifest.staged.length === 0) {
        throw new Error(
            `gjsify ship: ${at('staged')} is empty, so this stage describes no payload. ` +
                'A stage always carries at least the launcher its plan named. Re-run the ' +
                '`--stage` phase; a stage that lost its plan cannot be packed into anything ' +
                'but an empty package.',
        );
    }

    const overlay = record(data.overlay, at('overlay'));
    for (const id of manifest.formats) {
        // No `?? []`: `writeStageManifest` emits a key for every staged format even
        // when the project has no LICENCE (the value is then an empty array), so a
        // MISSING key can only mean a mutilated manifest. Defaulting it away is the
        // `?? 0o644` bug one field over — measured: with `"overlay": {}` the finish
        // phase exited 0 and wrote a `.deb` carrying no
        // `/usr/share/doc/<pkg>/copyright`, which Debian Policy § 12.5 requires and
        // lintian errors on.
        manifest.overlay[id] = expectArray(overlay[id], at(`overlay.${id}`)).map((entry, index) => {
            const file = record(entry, at(`overlay.${id}[${index}]`));
            return {
                path: expectString(file.path, at(`overlay.${id}[${index}].path`)),
                mode: expectInteger(file.mode, at(`overlay.${id}[${index}].mode`)),
                text: expectString(file.text, at(`overlay.${id}[${index}].text`)),
            };
        });
    }
    return manifest;
}

/**
 * `target.os`, resolved to a layout, in the one spelling this field may carry.
 *
 * The catch REPLACES the message rather than swallowing it: `layoutForOs` speaks
 * about a token, and this is a named field in a file that arrived from another
 * host, so the fix is different and so is the sentence. Every other field in
 * `readStageManifest` names its own location the same way.
 */
function expectLayoutOs(value: string, where: string): HostOs {
    try {
        return layoutForOs(value).os;
    } catch {
        const known = LAYOUT_NAMES.map((name) => LAYOUTS[name].os).join(', ');
        throw new Error(
            `gjsify ship: ${where} is "${value}", which is not a layout this gjsify can pack. It carries ` +
                `the \`process.platform\` spelling and only that — ${known}, so \`win32\` and never ` +
                "`windows`. A stage holds exactly one OS's layout and every path in it has that OS's shape, " +
                'so there is nothing to pack here. Re-run the `--stage` phase.',
        );
    }
}

/** The overlay for one format, in the shape `writeStage` takes. */
export function overlayFiles(manifest: StageManifest, format: FormatId): StagedFile[] {
    return (manifest.overlay[format] ?? []).map((file) => ({
        path: file.path,
        mode: file.mode,
        source: { kind: 'text', text: file.text },
    }));
}

/**
 * Refuse a stage that is not the one this job was told to pack.
 *
 * WHAT THIS IS: a matrix-leg mix-up check. It catches a finish job that
 * downloaded the wrong artifact — the leg that forgot to route — and nothing
 * more. It is opt-in (no flag, no check) and it compares two strings the same
 * pipeline wrote one job apart, so treat a green run as "this is the stage I
 * asked for", never as "this stage is correctly labelled".
 *
 * WHAT THIS IS NOT: the guard its precedent
 * (`packages/node-gi/scripts/verify-bundle-manifest.mjs --expect-host-target`)
 * provides. That script compares a bundle to `process.platform`/`process.arch`
 * because the runner BUILT it, so the machine is the right second opinion.
 * Here the stage arrives from another host by design, so a host comparison
 * would refuse a legal use — measured: an `arm64`-labelled stage packs on this
 * x64 host at exit 0 with correct bytes, because both packers are pure JS.
 *
 * The class that precedent guards — a label and the bytes under it disagreeing
 * — is NOT guarded here, and `target.arch` cannot guard it: it is defaulted
 * from `process.arch` only when `--arch` is absent, so the moment an operator
 * says which leg they are on, `target.arch` is that operator's claim and
 * nothing compares it to a machine or to a byte. Measured BEFORE
 * {@link assertPayloadMatchesArch} existed: a stage carrying an x86-64 `.so`,
 * assembled `--stage --arch arm64` and packed `--expect-target linux-arm64`,
 * exited 0 and produced an `aarch64` rpm whose only `.so` was `e_machine=0x3e`.
 * The same command in this tree now exits 1 and writes nothing — kept in the
 * past tense because it is the reason the guard below it exists, not a
 * description of what this function does.
 *
 * That class is guarded one layer down instead, where the oracle is free and
 * cannot be wrong about a machine it never saw: {@link assertPayloadMatchesArch}
 * in `payload.ts` reads ELF `e_machine` / Mach-O `cputype` out of the payload
 * and refuses a label the bytes contradict. Payload-versus-label goes red on
 * the mislabelled stage AND stays green on the legitimate cross-host pack;
 * host-versus-label can only do one of the two.
 */
export function assertExpectedTarget(manifest: StageManifest, expected: string | undefined): void {
    if (expected === undefined) return;
    const actual = formatTarget(manifest.target);
    if (expected !== actual) {
        throw new Error(
            `gjsify ship: --expect-target ${expected} but this stage was assembled for ${actual}. ` +
                'The stage records the target its `--arch` resolved to at stage time, so this is a stage from ' +
                'another matrix leg: download the artifact belonging to ' +
                `${expected}, or drop --expect-target if packing this one is what you meant.`,
        );
    }
}

/** Refuse a format the stage carries no overlay closure for. */
export function assertFormatsStaged(manifest: StageManifest, formats: readonly FormatDescriptor[]): void {
    const missing = formats.filter((format) => !manifest.formats.includes(format.id)).map((format) => format.id);
    if (missing.length === 0) return;
    throw new Error(
        `gjsify ship: this stage was assembled for ${manifest.formats.join(', ')}, and --target names ` +
            `${missing.join(', ')}. Phase one renders each format's overlay — rpm wants the licence at ` +
            '`share/licenses/<pkg>/LICENSE`, deb wants a machine-readable copyright at ' +
            '`share/doc/<pkg>/copyright` — so a format the stage never saw would pack without it, and Debian ' +
            `Policy § 12.5 makes that a broken package. Re-run \`gjsify ship --stage --target ${[
                ...manifest.formats,
                ...missing,
            ].join(',')}\` on the assembling host.`,
    );
}

/**
 * The build stamp the packing host uses: the stage's, always.
 *
 * A `SOURCE_DATE_EPOCH` set only in the finish job would silently produce a
 * different artifact than the same stage packed on the assembling host, which
 * is the one property the two-phase split has to keep. It is a warning rather
 * than a refusal because the honest fix ("set it in both jobs or in neither")
 * is the caller's, and refusing would break a runner that exports it globally.
 */
export function resolveStageMtime(
    manifest: StageManifest,
    env: Record<string, string | undefined> = process.env,
): { mtime: number; warnings: string[] } {
    const raw = env.SOURCE_DATE_EPOCH;
    if (raw === undefined || Number(raw) === manifest.mtime) return { mtime: manifest.mtime, warnings: [] };
    return {
        mtime: manifest.mtime,
        warnings: [
            `SOURCE_DATE_EPOCH is ${raw} here and this stage was stamped ${manifest.mtime}. The stage's stamp ` +
                'wins, because changing it would make this artifact differ from the same stage packed on the ' +
                'assembling host. Set the same value in both jobs, or set it in neither.',
        ],
    };
}

/** One actionable line when the two phases ran different gjsify versions. */
export function warnOnToolSkew(manifest: StageManifest): string[] {
    const running = cliVersion();
    if (manifest.tool.version === running) return [];
    return [
        `this stage was assembled by ${manifest.tool.name} ${manifest.tool.version} and is being packed by ` +
            `${running}. Both phases run the same packer, so a version difference can change the artifact's ` +
            'bytes. Pin both jobs to one gjsify version.',
    ];
}

function readPackSettings(data: Record<string, unknown>, at: string): PackSettings {
    const field = (name: string): string => `${at}.${name}`;
    const extraDepends = record(data.extraDepends, field('extraDepends'));
    const typelibPackages = record(data.typelibPackages, field('typelibPackages'));
    return {
        binaryName: expectString(data.binaryName, field('binaryName')),
        appId: expectString(data.appId, field('appId')),
        name: expectString(data.name, field('name')),
        version: expectString(data.version, field('version')),
        release: expectString(data.release, field('release')),
        maintainer: expectString(data.maintainer, field('maintainer')),
        summary: expectString(data.summary, field('summary')),
        description: expectArray(data.description, field('description')).map((entry, index) =>
            expectString(entry, field(`description[${index}]`)),
        ),
        license: expectString(data.license, field('license')),
        ...(data.homepage === undefined ? {} : { homepage: expectString(data.homepage, field('homepage')) }),
        section: expectString(data.section, field('section')),
        group: expectString(data.group, field('group')),
        extraDepends: {
            deb: expectArray(extraDepends.deb ?? [], field('extraDepends.deb')).map((entry, index) =>
                expectString(entry, field(`extraDepends.deb[${index}]`)),
            ),
            rpm: expectArray(extraDepends.rpm ?? [], field('extraDepends.rpm')).map((entry, index) =>
                expectString(entry, field(`extraDepends.rpm[${index}]`)),
            ),
        },
        typelibPackages: Object.fromEntries(
            Object.entries(typelibPackages).map(([namespace, value]) => {
                const row = record(value, field(`typelibPackages.${namespace}`));
                return [
                    namespace,
                    {
                        deb: expectString(row.deb, field(`typelibPackages.${namespace}.deb`)),
                        rpm: expectString(row.rpm, field(`typelibPackages.${namespace}.rpm`)),
                    },
                ];
            }),
        ),
        app: expectApp(data.app, field('app')),
        minGjsVersion: expectString(data.minGjsVersion, field('minGjsVersion')),
        minNodeVersion: expectString(data.minNodeVersion, field('minNodeVersion')),
        flatpak: readFlatpakSettings(record(data.flatpak, field('flatpak')), field('flatpak')),
    };
}

/**
 * The Flatpak half, validated the same way as everything else here.
 *
 * Every field is required and none is defaulted, deliberately: a `?? []` on
 * `finishArgs` would turn a mutilated manifest into an app with no display
 * socket — it installs, it starts, and it draws nothing. The defaults belong on
 * the assembling host, where `gjsify.ship` and `kind` are in reach; by the time
 * a manifest exists the answer has already been decided and writing it down
 * twice is how the two hosts disagree.
 */
function readFlatpakSettings(data: Record<string, unknown>, at: string): ShipFlatpakSettings {
    const field = (name: string): string => `${at}.${name}`;
    const strings = (value: unknown, name: string): string[] =>
        expectArray(value, field(name)).map((entry, index) => expectString(entry, field(`${name}[${index}]`)));
    return {
        runtime: expectString(data.runtime, field('runtime')),
        runtimeVersion: expectString(data.runtimeVersion, field('runtimeVersion')),
        sdk: expectString(data.sdk, field('sdk')),
        branch: expectString(data.branch, field('branch')),
        sdkExtensions: strings(data.sdkExtensions, 'sdkExtensions'),
        appendPath: strings(data.appendPath, 'appendPath'),
        finishArgs: strings(data.finishArgs, 'finishArgs'),
        cleanup: strings(data.cleanup, 'cleanup'),
    };
}

function record(value: unknown, at: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`gjsify ship: ${at} must be an object. Re-run the \`--stage\` phase.`);
    }
    return value as Record<string, unknown>;
}

function expectArray(value: unknown, at: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new Error(`gjsify ship: ${at} must be an array. Re-run the \`--stage\` phase.`);
    }
    return value;
}

/**
 * The interpreter field, checked against the two values that exist.
 *
 * Not `expectString`: this one decides which interpreter the package DEPENDS on,
 * so an unknown value must stop the pack rather than flow into a `Depends:` line
 * as itself. The only way to reach it is a stage from a gjsify that knows a third
 * target, which the schema check above already refuses — this is the second wall.
 */
function expectApp(value: unknown, at: string): 'gjs' | 'node' {
    if (value === 'gjs' || value === 'node') return value;
    throw new Error(`gjsify ship: ${at} must be "gjs" or "node", got ${JSON.stringify(value)}.`);
}

function expectString(value: unknown, at: string): string {
    if (typeof value !== 'string') {
        throw new Error(`gjsify ship: ${at} must be a string. Re-run the \`--stage\` phase.`);
    }
    return value;
}

function expectInteger(value: unknown, at: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(
            `gjsify ship: ${at} must be a non-negative integer. Re-run the \`--stage\` phase. ` +
                '(Modes are decimal here — JSON has no octal literal, so 0o755 is written 493.)',
        );
    }
    return value;
}
