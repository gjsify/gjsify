// `gjsify ship` — turn a built application into something a stranger can
// install (ADR 0024).
//
// One payload, produced once, then wrapped per format. The command itself is
// thin on purpose: every decision worth testing lives in `utils/ship/*` as a
// pure function, and what is left here is filesystem work and printing.
//
// TWO PHASES, one verb each (ADR 0024 § A2). Phase one ASSEMBLES: it resolves
// the settings, plans the payload, writes `stage/`, and writes the closure that
// makes that tree packable somewhere else (`.gjsify-ship-stage.json`, see
// `utils/ship/stage-manifest.ts`). Phase two FINISHES: `--from-stage <dir>`
// packs a stage that arrived from another host, with no project, no config and
// no built bundle in reach. With neither flag both phases run in one process,
// which is what a developer on one machine wants and what the e2e suite
// compares the split against byte for byte.
//
// Scope today is Linux and `--app gjs`: no runtime is bundled, because GJS and
// GTK come from the distribution and shipping ~100 MiB of them would be cargo
// cult (ADR 0024 § 4). macOS and Windows layouts, and Flatpak as a target under
// this command, are the later stages of the same ADR — and they are the reason
// the split exists at all: a `.dmg` is a UDIF image over a real HFS+/APFS
// volume and no Linux host in this tree can write one (§ A1).

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { Argv } from 'yargs';

import { Config } from '../config.js';
import type { Command } from '../types/index.js';
import {
    renderDesktopEntry,
    renderMetainfoApp,
    renderMetainfoCli,
    validateAppMetadata,
} from '../utils/app-metadata.js';
import { readPackageJson } from '../utils/pkg-json.js';
import { describeExit, spawnToCompletion } from '../utils/spawn.js';
import { buildDeb } from '../utils/ship/deb.js';
import { deriveDepends, warnAboutGjsFloor, warnAboutNodeFloor } from '../utils/ship/depends.js';
import { discoverPayload } from '../utils/ship/discover.js';
import { buildFlatpakBundle } from '../utils/ship/flatpak.js';
import {
    assertHostCanFinish,
    assertToolsInstalled,
    configuredFormats,
    defaultFormatIds,
    formatIdsFor,
    resolveFormats,
    FORMAT_IDS,
    FORMATS,
} from '../utils/ship/formats.js';
import { hostLayout, layoutForOs, resolveLayout, placeStage, LAYOUT_NAMES, type Layout } from '../utils/ship/layout.js';
import { scanGiNamespaces } from '../utils/ship/gi-namespaces.js';
import {
    assertLauncherMatchesInterpreter,
    assertPayloadMatchesArch,
    buildTimestamp,
    isArchIndependent,
    linuxInstallDependent,
    readPayloadFacts,
} from '../utils/ship/payload.js';
import { assertOverlayIsLicensed, planOverlay, planStage, type StageInputs } from '../utils/ship/plan.js';
import { renderLauncher } from '../utils/ship/launcher.js';
import { buildRpm } from '../utils/ship/rpm.js';
import { declaredBundlePath, resolveShipSettings, type ShipPackageManifest } from '../utils/ship/settings.js';
import {
    assertExpectedTarget,
    assertFormatsStaged,
    formatTarget,
    overlayFiles,
    readStageManifest,
    resolveStageMtime,
    warnOnToolSkew,
    writeStageManifest,
    STAGE_MANIFEST_FILE,
} from '../utils/ship/stage-manifest.js';
import { readStage, writeStage } from '../utils/ship/stage-writer.js';
import type {
    FormatDescriptor,
    FormatId,
    PackSettings,
    ShipArtifact,
    StagedFile,
    StagePlanEntry,
} from '../utils/ship/types.js';

interface ShipOptions {
    os?: string;
    target?: string[];
    out?: string;
    stage: boolean;
    'from-stage'?: string;
    'expect-target'?: string;
    'skip-build': boolean;
    arch?: string;
    verbose: boolean;
}

const LOG = '[gjsify ship]';

export const shipCommand: Command<unknown, ShipOptions> = {
    command: 'ship [os]',
    description: `Build installable artifacts (${FORMAT_IDS.join(', ')}) from the current project.`,
    // `defaultFormatIds` in the flag text, `FORMAT_IDS` in the description:
    // one of them answers "what can this build", the other "what will it build
    // if I say nothing", and they stopped being the same list when a host-bound
    // format arrived — and then stopped again when a second layout did.
    builder: (yargs: Argv) =>
        yargs
            .positional('os', {
                type: 'string',
                // Deliberately no yargs `choices`: `resolveLayout` accepts
                // `win32` beside `windows` — the spelling `--expect-target`
                // prints — and says so when it refuses, which a `choices` list
                // cannot.
                description:
                    `Operating system whose LAYOUT to assemble (${LAYOUT_NAMES.join('|')}, ADR 0024 § A2). ` +
                    'Default: this host. Assembly is not host-bound, so any of them can be staged anywhere.',
            })
            .option('target', {
                type: 'string',
                array: true,
                description:
                    'Formats to build, comma-separated or repeated. Default: every format wrapping the ' +
                    `target OS's layout that needs no extra tooling — on linux, ` +
                    `${defaultFormatIds('linux').join(',')}. Also available for linux, and opt-in because it ` +
                    'needs tooling this CLI does not carry: ' +
                    `${formatIdsFor('linux')
                        .filter((id) => !defaultFormatIds('linux').includes(id))
                        .join(', ')}.`,
            })
            .option('out', {
                type: 'string',
                normalize: true,
                description: 'Output root, relative to the project. Default: `gjsify.ship.outDir`, else `ship`.',
            })
            .option('stage', {
                type: 'boolean',
                default: false,
                description: 'Produce the staged payload and stop, without packing anything.',
            })
            .option('from-stage', {
                type: 'string',
                normalize: true,
                description:
                    'Pack a staged payload written by an earlier `--stage` run. Needs no project: the stage ' +
                    'carries its own closure.',
            })
            .option('expect-target', {
                type: 'string',
                description:
                    'With --from-stage: refuse unless the stage was assembled for this `<os>-<arch>`, e.g. ' +
                    '`linux-arm64`.',
            })
            .option('skip-build', {
                type: 'boolean',
                default: false,
                description: "Package what is already built instead of running the project's `build` script.",
            })
            .option('arch', {
                type: 'string',
                description: 'Target architecture in `process.arch` spelling. Default: this host.',
            })
            .option('verbose', {
                type: 'boolean',
                default: false,
                description:
                    'Print each staged file, the GI namespaces the bundle imports, and every tool a ' +
                    'host-bound packer invokes.',
            }),

    handler: async (args) => {
        // The two phases share nothing but `packOne`, and the branch is first
        // so that `--from-stage` never touches the cwd: a finishing host has no
        // project there, and reading one would make the artifact depend on
        // whatever directory the job happened to start in.
        if (args['from-stage'] !== undefined) return await finishFromStage(args, args['from-stage']);
        await assemble(args);
    },
};

/**
 * Phase one: resolve, plan, stage, and write the closure — then, unless
 * `--stage` was passed, pack right here.
 */
async function assemble(args: ShipOptions): Promise<void> {
    const projectDir = process.cwd();
    // FIRST, because everything below is decided per layout: which formats
    // exist, which build target the launcher can run, and where every staged
    // file lands. A bad positional must not cost a build.
    const layout = args.os === undefined ? hostLayout() : resolveLayout(args.os);
    const config = new Config();
    // No `.catch(() => ({}))` here, unlike the flatpak commands: a config
    // file that fails to load would silently become "no config", and the
    // result is a shipped artifact carrying default metadata the author
    // never chose. An unreadable config is an error worth printing.
    const configData = await config.forCommand(projectDir);
    const ship = configData.ship ?? {};
    const flatpak = configData.flatpak ?? {};
    assertShippableTarget(configData.app);
    const pkg = (readPackageJson(join(projectDir, 'package.json')) ?? {}) as ShipPackageManifest;

    // Resolved before anything is built or written: a typo'd `--target`
    // should not cost a build and leave a half-written `ship/stage/`.
    //
    // THREE sources, three meanings, and collapsing them was a real defect. A
    // `--target` is a claim about THIS run, so a format belonging to another
    // layout is refused by name. `gjsify.ship.targets` is a project-level
    // DEFAULT written once, so it is filtered to this layout instead — passing it
    // through the strict path made `gjsify ship darwin --stage` exit 1 inside
    // this very repository, whose `packages/infra/cli/package.json` declares
    // `targets: ["deb", "rpm"]`, with a message telling the author to run the
    // command they had just run. And the derived default can legitimately be
    // EMPTY, which `resolveFormats` refuses — rightly, for a list a caller typed.
    const formats =
        args.target !== undefined
            ? resolveFormats(args.target, layout)
            : ship.targets !== undefined
              ? configuredFormats(ship.targets, layout)
              : defaultFormatIds(layout.os).map((id) => FORMATS[id]);
    if (!args.stage) assertPackable(formats, layout, args.os === undefined ? 'host' : 'positional');
    // BEFORE the build, not before the pack. `gjsify ship` runs the project's
    // own `build` script first, so discovering a missing `flatpak-builder`
    // afterwards costs the whole build for a refusal that was knowable up
    // front. Skipped under `--stage`, which is precisely the phase that does
    // NOT need the format's tooling — that asymmetry is the point of the split.
    if (!args.stage) for (const format of formats) assertCanPack(format);

    if (!args['skip-build']) await runProjectBuild(projectDir);

    const discovered = discoverPayload({
        projectDir,
        pkg,
        ship,
        flatpakIcon: flatpak.icon,
        declaredBundle: declaredBundlePath(pkg, ship),
    });
    const { settings, metadata, warnings } = resolveShipSettings({
        projectDir,
        pkg,
        ship,
        flatpak,
        cli: { outDir: args.out, arch: args.arch, layoutOs: layout.os },
        discovered,
        app: configData.app,
    });
    for (const warning of warnings) console.warn(`${LOG} ${warning}`);
    // BEFORE anything is staged, and NOT under `assertCanPack` (which `--stage`
    // deliberately skips): a stage whose launcher execs an interpreter the target
    // runtime does not have is already wrong, and it is the stage that crosses to
    // the packing host.
    for (const format of formats) assertFormatCanRunInterpreter(format, settings.app);

    const mtime = buildTimestamp(settings.bundlePath);
    const metadataInputs = {
        appId: settings.appId,
        name: settings.name,
        command: settings.binaryName,
        kind: settings.kind,
        metadata,
        configKey: 'gjsify.ship',
        copyrightYear: new Date(mtime * 1000).getUTCFullYear(),
    };
    // Warn rather than fail: an incomplete AppStream component still
    // installs and still runs. It is app STORES that will reject it, and
    // that is a different day's problem than getting the package built.
    for (const missing of validateAppMetadata(metadataInputs)) {
        console.warn(`${LOG} ${missing.field} is not set — ${missing.hint}`);
    }

    // Printed, not assumed. The text may come from an ancestor — one `LICENSE`
    // at a monorepo root covers every package under it (see `discoverLicense`)
    // — and which file was baked into the copyright is not recoverable from the
    // artifact afterwards without unpacking it.
    if (settings.licenseFile !== undefined && dirname(settings.licenseFile) !== projectDir) {
        console.log(
            `${LOG} licence text from ${relative(projectDir, settings.licenseFile)} ` +
                '(this package carries none of its own)',
        );
    }

    const stageInputs: StageInputs = {
        bundleFiles: discovered.bundleFiles,
        launcher: renderLauncher(settings, basename(settings.bundlePath), layout),
        metainfo: settings.kind === 'app' ? renderMetainfoApp(metadataInputs) : renderMetainfoCli(metadataInputs),
        desktopEntry: settings.kind === 'app' ? renderDesktopEntry(metadataInputs) : undefined,
        licenseText: settings.licenseFile === undefined ? undefined : readFileSync(settings.licenseFile, 'utf-8'),
    };

    const outRoot = resolve(projectDir, settings.outDir);
    const stageDir = join(outRoot, 'stage');
    // Planned once, in the prefix-relative shape, then PLACED. Keeping the two
    // steps apart is what makes "one payload, three layouts" a checkable claim
    // rather than a slogan: the plan is the payload, `placeStage` is the layout
    // map, and `tests/e2e/ship-layout` asserts the three file sets agree modulo
    // exactly that map.
    const planned = planStage(settings, stageInputs);
    const staged = placeStage(layout, settings, planned);
    writeStage(stageDir, staged);
    console.log(`${LOG} staged ${staged.length} file(s) for ${layout.name} in ${relative(projectDir, stageDir)}/`);
    if (args.verbose) for (const file of staged) console.log(`${LOG}   ${file.path}`);

    // Read the tree back and hold the payload against the label, HERE and not
    // only in `packOne`. That check has always existed, one phase to the right,
    // where it guards the artifact — and this is the first milestone in which the
    // STAGE is the deliverable: darwin and windows have no packer, so a stage
    // assembled `--arch x64` from an arm64 payload reached `--expect-target
    // darwin-x64` with nothing having compared the two. Measured before this
    // line: exit 0, `target: {os: "darwin", arch: "x64"}`, and a Mach-O
    // `cputype` of arm64 inside it.
    //
    // It costs a second read of the payload on the one-shot Linux path, where
    // `packOne` reads it again. That is the price of checking the tree that is
    // shipped rather than the bytes that happen to be in memory, and it is the
    // same reason `readStage` exists at all.
    assertPayloadMatchesArch(readStage([stageDir], staged), settings.arch);

    // What the map carried into a layout that has no install step for it.
    //
    // NOT a warning about this command's output being wrong — the files are the
    // payload's and belong to it. It is the half the layout equality cannot see:
    // three of these are only correct on Linux because a `.deb`/`.rpm` scriptlet
    // compiles or reindexes them at install, and two are freedesktop metadata
    // neither OS reads. Printed so the author of a `.app` knows before the
    // container exists to decide what they become (ADR 0024 stages 4 and 5).
    if (layout.os !== 'linux') {
        const carried = linuxInstallDependent(planned);
        if (carried.length > 0) {
            console.warn(
                `${LOG} the ${layout.name} layout carries ${carried.length} file(s) whose Linux correctness ` +
                    'comes from a package install step it has no equivalent for:',
            );
            for (const { path, why } of carried) console.warn(`${LOG}   ${path} — ${why}`);
        }
        if (layout.runtimeGap !== undefined) console.warn(`${LOG} ${layout.runtimeGap}`);
    }

    // Scanned from the BUILD TREE's bundle, which is why it has to be recorded:
    // `gi://` specifiers are what the emitted `Depends:` is derived from
    // (ADR 0024 § 6), and the packing host has the staged copy but no way to
    // tell which staged file is the entry.
    const namespaces = scanGiNamespaces(readFileSync(settings.bundlePath, 'utf-8'));
    if (args.verbose) console.log(`${LOG} gi namespaces: ${namespaces.join(', ') || '(none)'}`);

    const overlay = new Map<FormatId, StagedFile[]>();
    for (const format of formats) overlay.set(format.id, planOverlay(settings, format, stageInputs));

    // The dependency derivation runs HERE as well, and its result is thrown
    // away. It is the only check in the pipeline that can refuse a project
    // (`gi://Nautilus` with no known package, ADR 0024 § 6), and this is the
    // host that has the `package.json` the refusal tells you to edit — letting
    // it fire two jobs later, on a machine with no project, would name a fix
    // nobody there can apply. Facts come from the PREFIX-RELATIVE plan, not from
    // the placed tree: `readPayloadFacts` asks `share/icons/hicolor/…` questions,
    // which is the shape the plan is written in and the shape the only formats
    // that read the answer (`deb`, `rpm`) install into. Reading the placed tree
    // would give the same answer on Linux and quietly give `false` everywhere
    // else the day a format wraps another layout.
    const facts = readPayloadFacts(planned);
    for (const format of formats) {
        // `format.depends`, not `format.id`: a Flatpak has no package
        // dependency list at all, and asking for one would either invent a
        // third column in the typelib table or silently reuse rpm's — which is
        // the exact defect `check-ship-format-vocabulary.mjs`'s header records
        // from the other direction (a third format taking rpm's package name
        // into a Debian `Depends:`, at exit 0).
        if (format.depends === null) continue;
        deriveDepends(format.depends, {
            namespaces,
            hasIcons: facts.hasIcons,
            hasSchemas: facts.hasSchemas,
            interpreter: settings.app,
            extra: settings.extraDepends[format.depends],
            typelibPackages: settings.typelibPackages,
            bundledTypelibs: facts.bundledTypelibs,
            minGjsVersion: settings.minGjsVersion,
            minNodeVersion: settings.minNodeVersion,
        });
        // One warning per package, for the interpreter it actually declares. A
        // floor warning about a dependency this package does not emit is noise,
        // and a noisy warning is the one nobody reads when it matters.
        const floorWarnings =
            settings.app === 'node'
                ? warnAboutNodeFloor(format.depends, settings.minNodeVersion)
                : warnAboutGjsFloor(format.depends, settings.minGjsVersion);
        for (const warning of floorWarnings) console.warn(`${LOG} ${warning}`);
    }

    // Written unconditionally, not only under `--stage`: a `ship/stage/` that
    // is sometimes packable elsewhere and sometimes not is a worse contract
    // than one that always is, and it is what lets the e2e suite compare the
    // one-process artifact with the two-phase one.
    const manifest = writeStageManifest({ stageDir, settings, formats, mtime, namespaces, staged, overlay });

    if (args.stage) {
        // `(none)` spelled out, because an empty list printed as nothing after
        // "formats " reads as a truncated line rather than as a fact about the
        // layout — and for darwin and windows it is the whole story today.
        const wraps = manifest.formats.join(', ') || '(none yet — ADR 0024 stages 4 and 5)';
        console.log(`${LOG} stage manifest: ${formatTarget(manifest.target)}, formats ${wraps}`);
        return;
    }

    const artifacts: ShipArtifact[] = [];
    for (const format of formats) {
        artifacts.push(
            await packOne({
                format,
                settings,
                arch: settings.arch,
                staged,
                overlay: overlay.get(format.id) ?? [],
                stageDir,
                outRoot,
                namespaces,
                mtime,
                verbose: args.verbose,
            }),
        );
    }
    printArtifacts(projectDir, artifacts);
}

/**
 * Phase two: pack a stage that was assembled somewhere else.
 *
 * Everything this needs is in the stage. Nothing under the cwd is read, and
 * that is the property under test — `tests/e2e/ship-from-stage` deletes the
 * project tree between the two phases, because without the deletion every
 * accidental reach-back succeeds and the suite proves nothing.
 */
async function finishFromStage(args: ShipOptions, fromStage: string): Promise<void> {
    if (args.stage) {
        throw new Error(
            'gjsify ship: --stage and --from-stage are the two halves of one split and cannot run together. ' +
                '`--stage` assembles a payload and stops; `--from-stage <dir>` packs one that is already ' +
                'assembled. Run them as two commands, on the host each belongs on (ADR 0024 § A2).',
        );
    }
    if (args['skip-build']) {
        throw new Error(
            'gjsify ship: --from-stage never runs a build — the payload it packs was built and staged by an ' +
                'earlier run — so --skip-build has nothing to skip. Drop it.',
        );
    }
    if (args.arch !== undefined) {
        throw new Error(
            'gjsify ship: --arch is decided when the stage is assembled, not when it is packed: the launcher, ' +
                'the payload and the recorded target were all fixed then. Pass --arch to ' +
                '`gjsify ship --stage`, and use `--expect-target <os>-<arch>` here to assert which leg you are ' +
                'packing.',
        );
    }

    if (args.os !== undefined) {
        // Same reason as `--arch`, one axis over: the LAYOUT is what phase one
        // wrote — the launcher's language, every staged path, the recorded
        // target. Naming it again here could only agree with the stage or
        // contradict it, and there is no useful behaviour behind either.
        throw new Error(
            `gjsify ship: the layout is decided when the stage is assembled, so "${args.os}" has nothing to ` +
                "change here — the staged tree already IS one OS's layout. Use `--expect-target <os>-<arch>` " +
                'to assert which one you are packing.',
        );
    }

    const cwd = process.cwd();
    const stageDir = resolve(cwd, fromStage);
    const manifest = readStageManifest(stageDir);
    assertExpectedTarget(manifest, args['expect-target']);

    // `layoutForOs`, not `resolveLayout`: the manifest is a wire format with one
    // legal spelling per OS, and `readStageManifest` has already refused any other.
    const layout = layoutForOs(manifest.target.os);
    // Before `resolveFormats`, which would otherwise answer a `--target` the
    // caller never typed: a stage for a layout no format wraps carries
    // `formats: []`, and the empty-list refusal there names `--target` and the
    // three Linux formats — three sentences about the wrong thing.
    if (args.target === undefined)
        assertPackable(
            defaultFormatIds(layout.os).map((id) => FORMATS[id]),
            layout,
            'positional',
        );
    const formats = resolveFormats(args.target ?? manifest.formats, layout);
    assertFormatsStaged(manifest, formats);
    for (const format of formats) assertCanPack(format);

    for (const warning of warnOnToolSkew(manifest)) console.warn(`${LOG} ${warning}`);
    const { mtime, warnings } = resolveStageMtime(manifest);
    for (const warning of warnings) console.warn(`${LOG} ${warning}`);

    console.log(
        `${LOG} packing ${manifest.settings.binaryName} ${manifest.settings.version}-${manifest.settings.release} ` +
            `for ${formatTarget(manifest.target)} from ${relative(cwd, stageDir) || '.'}/`,
    );
    if (args.verbose) {
        for (const file of manifest.staged) console.log(`${LOG}   ${file.path}`);
        console.log(`${LOG} gi namespaces: ${manifest.namespaces.join(', ') || '(none)'}`);
    }

    // The stage's own directory is not written to — `writeStage` wipes what it
    // is pointed at, and pointing it at an arriving stage would delete the
    // payload. The overlay is the only thing this phase materialises, and it
    // goes beside the artifacts.
    const outRoot = args.out === undefined ? dirname(stageDir) : resolve(cwd, args.out);

    const artifacts: ShipArtifact[] = [];
    for (const format of formats) {
        // Re-asserted here and not only in phase one. `--from-stage` can be
        // pointed at any stage with any `--target`, so a stage assembled for
        // deb+rpm can be packed as a Flatpak on the finishing host — the phase
        // that HAS no project and cannot re-read `gjsify.app` from it. The stage
        // manifest carries the answer precisely so this stays checkable.
        assertFormatCanRunInterpreter(format, manifest.settings.app);
        if (format.depends !== null) {
            // From the stage manifest's settings, which is all this phase has: it
            // may be running on a machine that has never seen the project
            // (ADR 0024 § A2).
            const floorWarnings =
                manifest.settings.app === 'node'
                    ? warnAboutNodeFloor(format.depends, manifest.settings.minNodeVersion)
                    : warnAboutGjsFloor(format.depends, manifest.settings.minGjsVersion);
            for (const warning of floorWarnings) console.warn(`${LOG} ${warning}`);
        }
        artifacts.push(
            await packOne({
                format,
                settings: manifest.settings,
                arch: manifest.target.arch,
                staged: manifest.staged,
                overlay: overlayFiles(manifest, format.id),
                stageDir,
                outRoot,
                namespaces: manifest.namespaces,
                mtime,
                verbose: args.verbose,
            }),
        );
    }
    printArtifacts(cwd, artifacts);
}

interface PackInput {
    format: FormatDescriptor;
    /** The one build stamp every header and every rendered file shares. */
    mtime: number;
    /** The half of the settings that survives the host boundary — see {@link PackSettings}. */
    settings: PackSettings;
    /** Target architecture in `process.arch` spelling, resolved when the stage was assembled. */
    arch: string;
    /** The mode plan, and the sizes when the plan arrived with a stage. */
    staged: readonly StagePlanEntry[];
    /** This format's overlay, planned here or rehydrated from the stage manifest. */
    overlay: readonly StagedFile[];
    stageDir: string;
    outRoot: string;
    namespaces: readonly string[];
    /** Print each tool invocation a host-bound packer makes. */
    verbose: boolean;
}

async function packOne(input: PackInput): Promise<ShipArtifact> {
    const { format, settings, stageDir, outRoot, mtime } = input;

    assertOverlayIsLicensed(format.id, settings.binaryName, input.overlay);

    const overlayDir = join(outRoot, 'overlay', format.id);
    writeStage(overlayDir, input.overlay);

    const payload = readStage([stageDir, overlayDir], [...input.staged, ...input.overlay]);
    // What the package installs, read off what it installs. The three questions
    // this answers used to be answered from the project's file lists, which are
    // absolute paths on the build host and therefore unavailable here.
    const facts = readPayloadFacts(payload);
    const depends =
        format.depends === null
            ? []
            : deriveDepends(format.depends, {
                  namespaces: input.namespaces,
                  hasIcons: facts.hasIcons,
                  hasSchemas: facts.hasSchemas,
                  interpreter: settings.app,
                  extra: settings.extraDepends[format.depends],
                  typelibPackages: settings.typelibPackages,
                  bundledTypelibs: facts.bundledTypelibs,
                  minGjsVersion: settings.minGjsVersion,
                  minNodeVersion: settings.minNodeVersion,
              });

    // `--arch` is a CLAIM about the payload and nothing else compared it to one:
    // an x86-64 `.so` staged with `--arch arm64` packed at exit 0 and `rpm -qp
    // --qf %{ARCH}` confirmed `aarch64`, because rpm reads the header and the
    // header was written from the claim. Read the two bytes further that settle
    // it before the label reaches a header. Payload-versus-LABEL, never
    // payload-versus-HOST — a host check would refuse the cross-host pack this
    // whole split exists for.
    //
    // And BEFORE the label is chosen, not after — this ordering is load-bearing:
    // `archName` collapses an arch-independent payload to `all`/`noarch`, so
    // asserting afterwards would compare against a label that no longer names an
    // architecture, and the mismatch that matters is exactly the one on a payload
    // that IS architecture-specific.
    assertPayloadMatchesArch(payload, input.arch);

    // The second half of the same idea, on the other label this package carries:
    // the dependency list says which interpreter runs the app, and until now
    // nothing compared it to the launcher that will. They CAN disagree — a stage
    // assembled by one gjsify and packed by another — and a package that depends
    // on `gjs` while execing `node` installs cleanly and dies at first launch.
    if (format.depends !== null) assertLauncherMatchesInterpreter(payload, settings.binaryName, settings.app);

    const archLabel = format.archName(input.arch, isArchIndependent(payload));
    const common = { settings, payload, prefix: format.prefix, depends, archLabel, mtime };

    const outDir = join(outRoot, 'out');
    mkdirSync(outDir, { recursive: true });
    const target = join(outDir, format.fileName(settings, archLabel));

    // A SWITCH with a `never` guard, not a ternary. `format.id === 'deb' ? deb : rpm`
    // read as a dispatch and behaved as one only while there were exactly two
    // formats: a third would have taken the else-branch and written an RPM under a
    // `.dmg` name, at exit 0. This is the same closed-vocabulary hazard the format
    // list has, one level worse — a wrong ARTIFACT rather than a rejected
    // declaration — so the compiler owns it now.
    //
    // Each branch WRITES `target` rather than returning bytes. It used to return
    // them, which is the right shape only while every packer is a byte writer: a
    // Flatpak is produced by `flatpak build-bundle`, so its bytes exist as a file
    // before this process could hold them, and reading a bundle back into memory
    // to hand it to one `writeFileSync` would be a copy for the sake of a
    // signature. The size is stat'ed off what landed, for every format.
    switch (format.id) {
        case 'deb':
            writeFileSync(target, await buildDeb(common));
            break;
        case 'rpm':
            writeFileSync(target, await buildRpm(common));
            break;
        case 'flatpak':
            await buildFlatpakBundle({
                settings,
                stageDir,
                overlayDir,
                stageManifestFile: STAGE_MANIFEST_FILE,
                workDir: join(outRoot, 'flatpak'),
                target,
                archLabel,
                verbose: input.verbose,
            });
            break;
        default: {
            const unhandled: never = format.id;
            throw new Error(`gjsify ship: no packer is wired for format "${String(unhandled)}".`);
        }
    }

    return { format: format.id, path: target, size: statSync(target).size };
}

function printArtifacts(base: string, artifacts: readonly ShipArtifact[]): void {
    for (const artifact of artifacts) {
        console.log(`${LOG} ${artifact.format}: ${relative(base, artifact.path)} (${artifact.size} bytes)`);
    }
}

/**
 * Refuse a format this host cannot finish, and say which half is missing.
 *
 * Two checks and not one, because the fixes differ: the wrong OS needs another
 * machine, an absent tool needs a package. Both run on the pack path only —
 * `--stage` deliberately needs neither, which is what makes a Flatpak
 * assemblable on a host that cannot build one (ADR 0024 § A1).
 */
function assertCanPack(format: FormatDescriptor): void {
    assertHostCanFinish(format);
    assertToolsInstalled(format);
}

/**
 * Refuse a pack for a layout no format wraps.
 *
 * Reached only when the format list was DERIVED — no `--target`, or a
 * `gjsify.ship.targets` filtered empty by this layout — where the empty set is a
 * fact about the layout rather than something a caller typed. Without it,
 * `gjsify ship darwin` would assemble the tree, iterate an empty format list,
 * print no artifact line and exit 0 — a success that produced nothing, which is
 * the same shape `resolveFormats` refuses an empty `--target` for.
 *
 * `chosenBy` is not decoration. When the layout came from the HOST rather than
 * from the positional, this is a BEHAVIOUR CHANGE the caller did not ask for:
 * a bare `gjsify ship` on a Mac used to emit `.deb` + `.rpm`, because the default
 * format set was host-independent. It is deliberate — the positional means what
 * it says, and a Linux package built on a Mac is now something you ask for — but
 * a refusal that does not name the one-word replacement is just a regression.
 */
function assertPackable(formats: readonly FormatDescriptor[], layout: Layout, chosenBy: 'host' | 'positional'): void {
    if (formats.length > 0) return;
    const linux = defaultFormatIds('linux').join(',');
    throw new Error(
        `gjsify ship: no format wraps the ${layout.name} layout yet, so there is nothing to pack. ` +
            (chosenBy === 'host'
                ? `This host is ${process.platform}, so \`gjsify ship\` assembled the ${layout.name} layout. ` +
                  'Assembly is not host-bound (ADR 0024 § A1), so the Linux packages are still one word away: ' +
                  `\`gjsify ship linux\` builds ${linux} from right here.`
                : `\`gjsify ship ${layout.name} --stage\` assembles the payload and stops, which is the whole ` +
                  'of what this command does for that OS today.') +
            ' A macOS `.app`/`.dmg` and a Windows program directory plus installer are ADR 0024 stages 4 and 5.',
    );
}

/**
 * Refuse a build target this command cannot package correctly.
 *
 * `gjs` and `node` are packageable: `renderLauncher` execs the one
 * `settings.app` names and `deriveDepends` declares the same one — `gjs >= …`,
 * or `nodejs (>= 24)` / `nodejs(engine) >= 24`. Until #1354's M0 this said "only
 * `gjs` can be packaged today", which was true: the launcher execed gjs
 * unconditionally, so a `--app node` package would have installed and died at
 * startup.
 *
 * `browser` and `nativescript` stay refused, and not for want of a launcher
 * line: a browser bundle has no process to start, and NativeScript ships as an
 * APK/IPA through a different pipeline entirely (ADR 0024 § 4).
 *
 * DELIBERATELY NOT PER LAYOUT, and the first cut of the layout axis got this
 * exactly backwards. Reading ADR § 4's runtime table as a per-layout `app`
 * requirement refused `gjsify.app: "gjs"` for the macOS layout — i.e. refused the
 * entire audience of this command from assembling a `.app` — while a project with
 * no `gjsify.app` key sailed through and staged a launcher naming `node` in front
 * of a GJS bundle. Both halves came from the same mistake: § 4 derives the runtime
 * a SHIPPED ARTIFACT carries, which is `Layout.shippedRuntime` and is printed as
 * `Layout.runtimeGap`. What the launcher execs is what the PAYLOAD was built for,
 * and that is `settings.app` on every layout.
 *
 * An undeclared target is the common case for a GJS app and is allowed. It must
 * NOT be resolved through `Config.forBuild`, whose fallback is the HOST runtime
 * — that would refuse, or worse silently re-target, a perfectly good GJS project
 * merely for running this command under Node.
 *
 * Phase one only. Phase two does not re-read `gjsify.app` — it has no project —
 * but it is not unchecked either: `assertLauncherMatchesInterpreter` compares
 * the staged `bin/<name>`'s own `exec` line against the dependency about to be
 * written.
 */
function assertShippableTarget(app: string | undefined): void {
    if (app === undefined || app === 'gjs' || app === 'node') return;
    throw new Error(
        `gjsify ship: this project declares \`gjsify.app: "${app}"\`, and only \`gjs\` and \`node\` can be ` +
            'packaged. A browser bundle has no process to launch, and a NativeScript app ships as an APK/IPA ' +
            'through a different pipeline. ADR 0024 § 4 has the runtime-per-OS table.',
    );
}

/**
 * Refuse a format whose runtime cannot provide the interpreter the launcher execs.
 *
 * THE HOLE THIS CLOSES, and it was opened by the commit that made `--app node`
 * packageable. `assertShippableTarget` used to refuse `app: 'node'` outright, so
 * no format ever saw one. Lifting that made deb and rpm correct and left Flatpak
 * silently wrong: measured at exit 0, a `--target flatpak --stage` with
 * `app: 'node'` emitted a manifest with `runtime: org.gnome.Platform`,
 * `runtime-version: 50`, no `sdk-extensions` and no `append-path`, beside a
 * launcher that execs `node`. That runtime ships `gjs` and no `node`.
 *
 * WHY THE OTHER CHECK DOES NOT CATCH IT. `assertLauncherMatchesInterpreter`
 * compares the launcher against the DEPENDENCY, and a Flatpak has no dependency
 * list — `format.depends` is `null`, so both sides come from `settings.app` and
 * agree by construction. Only the format's runtime knows what it can execute,
 * which is why the answer is a descriptor field.
 *
 * Not a warning. The artifact would install and die at first launch on a user's
 * machine, which is the failure this whole command is built to make impossible.
 */
function assertFormatCanRunInterpreter(format: FormatDescriptor, app: 'gjs' | 'node'): void {
    if (format.interpreters.includes(app)) return;
    throw new Error(
        `gjsify ship: this project is \`gjsify.app: "${app}"\`, and the ${format.id} runtime cannot run it — ` +
            `it provides ${format.interpreters.join(', ')}.\n` +
            '    A Flatpak runs against `org.gnome.Platform`, which ships `gjs` and no `node`. Node exists only ' +
            'as\n' +
            '    `org.freedesktop.Sdk.Extension.node2x`, and that extension puts node on the BUILD path, not in ' +
            'the\n' +
            '    runtime — so the artifact would install and then fail at `exec node`.\n' +
            `    Build the other formats (\`--target deb,rpm\`), or ship this app as \`gjsify.app: "gjs"\`.`,
    );
}

/**
 * Run the project's own `build` script, as a CHILD process.
 *
 * NOT dispatched in-process, even though `cli-app.ts` exists to allow exactly
 * that: `gjsify run`'s script path ends in `return process.exit(code)` on every
 * branch — deliberately, because under GJS a bare `process.exit` falls through
 * and it needs exactly one exit scheduled. Calling it from here would end the
 * process after the build and never reach the packing, and neither the types
 * nor a `--skip-build` test would have caught it.
 *
 * `completion: 'return'` because this handler returns afterwards; on GJS that
 * selects the blocking path rather than arming a main loop only an exit quits.
 */
async function runProjectBuild(projectDir: string): Promise<void> {
    const pkg = readPackageJson(join(projectDir, 'package.json')) as { scripts?: Record<string, string> } | null;
    if (typeof pkg?.scripts?.build !== 'string') {
        throw new Error(
            'gjsify ship: this project has no `build` script to run. Add one, or pass --skip-build to ' +
                'package what is already built.',
        );
    }
    console.log(`${LOG} running the project's build script`);
    const result = await spawnToCompletion('gjsify', ['run', 'build'], {
        completion: 'return',
        cwd: projectDir,
        stdio: 'inherit',
        notFound: () =>
            new Error(
                'gjsify ship: `gjsify` is not on PATH, so the project build cannot be run. Build the project ' +
                    'yourself and pass --skip-build.',
            ),
    });
    if (result.code !== 0) {
        throw new Error(`gjsify ship: the project's build script failed${describeExit(result)}.`);
    }
}
