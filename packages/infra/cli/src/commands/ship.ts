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
import { isGtkRuntimeTarget, stageAppRuntime, type StagedAppRuntime } from '../utils/ship/app-runtime.js';
import { discoverPayload } from '../utils/ship/discover.js';
import { buildDmgImage, dmgVolumeDir, dmgVolumeName } from '../utils/ship/dmg.js';
import { buildFlatpakBundle } from '../utils/ship/flatpak.js';
import { localizeMetadata } from '../utils/ship/localize-metadata.js';
import {
    assertHostCanFinish,
    assertToolsInstalled,
    configuredFormats,
    defaultFormatIds,
    formatIdsFor,
    resolveFormats,
    windowsProgramDirName,
    FORMAT_IDS,
    FORMATS,
} from '../utils/ship/formats.js';
import {
    assertLayoutSupportsArch,
    hostLayout,
    layoutForOs,
    place,
    placeStage,
    resolveLayout,
    LAYOUT_NAMES,
    type Layout,
} from '../utils/ship/layout.js';
import { isNodeRuntimeTarget, resolveNodeRuntime } from '../utils/ship/node-runtime.js';
import { compileSchemasForStage } from '../utils/ship/schemas.js';
import { buildMsi, MSI_PAYLOAD_DIR } from '../utils/ship/msi.js';
import { buildZip, zipEntriesFromPayload } from '../utils/ship/zip.js';
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
import {
    assertHostCanSign,
    notarizeArtifact,
    resolveNotaryPlan,
    resolveSignPlan,
    signPayload,
    type NotaryPlan,
    type SignPlan,
} from '../utils/ship/signing.js';
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
import { directorySize, readStage, writePayload, writeStage } from '../utils/ship/stage-writer.js';
import type {
    FormatDescriptor,
    FormatId,
    PackSettings,
    ShipArtifact,
    ShipSettings,
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
    sign?: string;
    notarize?: string;
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
            .option('sign', {
                type: 'string',
                // `requiresArg`, and it is not tidiness. `-` is the RESERVED
                // ad-hoc identity — the one value of this flag that needs no
                // developer identity and the only one this project's own CI can
                // use — and yargs-parser treats a lone `-` as a positional by
                // convention (stdin), so `--sign -` parsed as `sign: ''` plus a
                // stray `-` and the strict-mode refusal was "Unknown argument: -".
                // Measured on the first cut of this flag. The cost is that a bare
                // `--sign` with no value is now "Not enough arguments following"
                // rather than the empty-identity skip; that skip stays reachable
                // through `--sign ''` and through the config key, which is where
                // an unset CI variable actually lands.
                requiresArg: true,
                // An IDENTITY, never a certificate (ADR 0024 § A12): `codesign`
                // and `signtool` are both handed a NAME and look the private key
                // up themselves, so this command is never given a secret and has
                // nothing to redact. Deliberately no `default:` — a yargs default
                // is indistinguishable from a value the user typed and would
                // clobber `gjsify.ship.sign.<os>.identity`.
                description:
                    'Sign the payload with this identity, e.g. a Developer ID name or SHA-1 fingerprint. ' +
                    '`-` signs ad-hoc and needs no developer identity. Default: ' +
                    '`gjsify.ship.sign.<darwin|win32>.identity`; absent means unsigned, which is a ' +
                    'legitimate output.',
            })
            .option('notarize', {
                type: 'string',
                // Same reason as `--sign` one option up, applied for consistency
                // rather than for a measured case: a credential that begins with
                // a dash is not a shape anybody should have to think about.
                requiresArg: true,
                description:
                    'Submit the signed artifact to Apple with this `notarytool` keychain profile. Needs ' +
                    '--sign; darwin only.',
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
    // Resolved HERE and not from `settings`, because the format list is decided
    // before anything is built and `resolveShipSettings` runs after. The
    // defaulting rule is the one `resolveShipSettings` states and must stay the
    // same one: an undeclared target means `gjs`, never the host runtime this
    // command happens to run under.
    const interpreter: 'gjs' | 'node' = configData.app === 'node' ? 'node' : 'gjs';
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
    let formats: FormatDescriptor[];
    /** Formats that wrap this layout and cannot run this project — see the derived branch. */
    let unusable: FormatDescriptor[] = [];
    if (args.target !== undefined) {
        formats = resolveFormats(args.target, layout);
    } else if (ship.targets !== undefined) {
        const configured = configuredFormats(ship.targets, layout);
        formats = configured.formats;
        // SAID, not swallowed. The `--target` path refuses a foreign format by
        // name; this one used to shorten the list in silence, so a project whose
        // configured formats all wrap another layout got a stage and no account
        // of where its targets went.
        if (configured.dropped.length > 0) {
            console.log(
                `${LOG} \`gjsify.ship.targets\` names ${configured.dropped.join(', ')}, which wrap another ` +
                    `layout — not built for ${layout.name}. Pass --target to ask for one explicitly.`,
            );
        }
    } else {
        // FILTERED BY THE INTERPRETER, and the third of the same shape as the two
        // branches above: a derived default is not a claim anybody made, so a
        // format this project cannot use is dropped rather than refused. It has to
        // be — every format wrapping the darwin layout is `interpreters: ['node']`
        // (there is no relocatable GJS to put in a bundle), so without this
        // `gjsify ship darwin --stage` began exiting 1 on a `--app gjs` project,
        // which is every project this command has today. Measured on the first cut
        // of these rows: the whole audience of M1 lost the ability to assemble the
        // layout M1 added, over a format none of them had asked for.
        const wraps = defaultFormatIds(layout.os).map((id) => FORMATS[id]);
        formats = wraps.filter((format) => format.interpreters.includes(interpreter));
        unusable = wraps.filter((format) => !format.interpreters.includes(interpreter));
        // SAID, like the layout filter one branch up. A stage whose `formats` is
        // empty for this reason looks identical to one whose layout nothing wraps,
        // and the two need different next steps.
        if (unusable.length > 0) {
            console.log(
                `${LOG} ${unusable.map((format) => format.id).join(', ')} wrap the ${layout.name} layout but ` +
                    `cannot run \`gjsify.app: "${interpreter}"\` — ${unusable[0]?.interpreterGap ?? ''}. ` +
                    'Assembling the layout only; pass --target to be told the same thing as an error.',
            );
        }
    }
    if (!args.stage) assertPackable(formats, layout, args.os === undefined ? 'host' : 'positional', unusable);
    // BEFORE the build, beside `assertCanPack` and for the same reason: a
    // `--sign` this host cannot honour — wrong OS, no tool, a layout that has no
    // signature at all — is knowable up front, and discovering it after the
    // project's own build has run costs the whole build for a refusal nothing
    // learned from building.
    //
    // `ship.sign` is read HERE and nowhere on the `--from-stage` path, and that
    // asymmetry is § A14's amendment to § A1: a format declares where it can be
    // packed, the RUN declares what it can sign with. The finishing host has no
    // project to read a default out of, so there it is the flag or nothing.
    const sign = resolveSignPlan({ flag: args.sign, config: ship.sign, layoutOs: layout.os });
    const notarize = resolveNotaryPlan({ flag: args.notarize, layoutOs: layout.os, sign });
    if (args.stage) assertNothingToSignYet(args);
    if (!args.stage) {
        announceSigning(sign, notarize);
        if (sign.kind === 'sign') assertHostCanSign(sign.signer);
    }
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

    // Rendered in English, then TRANSLATED with the catalogues this package
    // already stages. Without this step the two halves never met: `share/locale/`
    // shipped every `.mo` while `Name=` and `<name>` stayed English, so a fully
    // translated app showed an English entry in the app menu and in Software.
    // Both files stay valid either way, which is why nobody reported it.
    const translated = localizeMetadata(
        {
            metainfo: settings.kind === 'app' ? renderMetainfoApp(metadataInputs) : renderMetainfoCli(metadataInputs),
            desktopEntry: settings.kind === 'app' ? renderDesktopEntry(metadataInputs) : undefined,
        },
        settings.localeFiles,
    );

    // BEFORE the launcher is rendered, because the launcher's exec line and its two
    // locators are functions of what the stage carries (#1354 M2b). Nothing is
    // resolved for a layout whose interpreter is a package dependency: on Linux the
    // `.deb`/`.rpm` `Depends:` is the promise that `node` or `gjs` is on `PATH`, and
    // carrying a second copy inside the payload would be a private interpreter no
    // distribution update ever patches.
    const runtime = resolveCarriedRuntime(layout, settings, projectDir);

    const stageInputs: StageInputs = {
        bundleFiles: discovered.bundleFiles,
        launcher: renderLauncher(settings, basename(settings.bundlePath), layout, runtime.launcher),
        metainfo: translated.metainfo,
        desktopEntry: translated.desktopEntry,
        licenseText: settings.licenseFile === undefined ? undefined : readFileSync(settings.licenseFile, 'utf-8'),
    };

    const outRoot = resolve(projectDir, settings.outDir);
    const stageDir = join(outRoot, 'stage');
    // Planned once, in the prefix-relative shape, then PLACED. Keeping the two
    // steps apart is what makes "one payload, three layouts" a checkable claim
    // rather than a slogan: the plan is the payload, `placeStage` is the layout
    // map, and `tests/e2e/ship-layout` asserts the three file sets agree modulo
    // exactly that map.
    //
    // The ONE prefix-relative addition a layout makes, and it is not a second
    // plan: a layout with no install step has to carry `gschemas.compiled`,
    // because every launcher points XDG_DATA_DIRS at the staged `share/` and
    // GSettings ABORTS on a schema directory that holds only sources. On Linux the
    // `.deb`/`.rpm` postinst compiles the SYSTEM directory at install time
    // (`utils/ship/scripts.ts`), where our schemas merge with every other
    // package's — shipping a prebuilt cache there would be a file the install step
    // overwrites. So the compile is conditional on the layout and nothing else.
    const planned = [
        ...planStage(settings, stageInputs),
        ...(layout.os === 'linux'
            ? []
            : await compileSchemasForStage({
                  schemaFiles: settings.schemaFiles,
                  workDir: join(outRoot, 'schemas'),
              })),
    ];
    const staged = placeStage(layout, settings, planned, runtime.files);
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
            // The marker is the whole point of `ShareVerdict`. Every launcher
            // exports XDG_DATA_DIRS at the staged `share/`, so an uncompiled
            // schema directory is not a missing feature — `g_settings_new()`
            // ABORTS on it. Printing that at the same weight as "neither OS reads
            // one" is what buried it in a list of five.
            const marker: Record<string, string> = { aborts: 'ABORTS: ', unknown: 'UNCLASSIFIED: ', inert: '' };
            for (const { path, verdict, why } of carried) {
                console.warn(`${LOG}   ${marker[verdict] ?? ''}${path} — ${why}`);
            }
        }
        // WHAT THE BUNDLE CARRIES, and what it still does not. Printed where the
        // layout's other honesty lives, and the `runtimeGap` is now CONDITIONAL:
        // that string says "the staged launcher execs an interpreter off `PATH`,
        // which a downloaded `.app` cannot assume", and printing it over a stage
        // that carries its own interpreter would be the command telling the author
        // something untrue about the tree it had just written.
        for (const line of runtime.found) console.log(`${LOG} carries its own ${line}`);
        for (const line of runtime.missing) console.warn(`${LOG} ${line}`);
        if (runtime.launcher.interpreter === undefined && layout.runtimeGap !== undefined) {
            console.warn(`${LOG} ${layout.runtimeGap}`);
        }
        // THE OTHER AXIS, warned about HERE and refused in `packOne`, and the split
        // is the same one `runtimeGap` and `assertFormatCanRunInterpreter` already
        // draw. A stage is a build intermediate, and assembling one for an
        // architecture no runtime exists for is what `tests/e2e/ship-layout` does on
        // purpose: it proves the layout MAP over one payload, and that payload's
        // native file has an architecture. What must not leave is an ARTIFACT — so
        // the refusal sits where an artifact is about to be written and the author
        // is told here, at the `--arch` that caused it, rather than only on the far
        // side of a handoff.
        if (layout.arches !== null && !layout.arches.only.includes(settings.arch)) {
            console.warn(
                `${LOG} this stage is labelled ${settings.arch} and the ${layout.name} layout has no runtime ` +
                    `for it — ${layout.arches.why}. Nothing can pack this stage; ` +
                    `\`--arch ${layout.arches.only.join('|')}\` is what produces an artifact.`,
            );
        }
    }

    // Scanned from the BUILD TREE's bundle, which is why it has to be recorded:
    // `gi://` specifiers are what the emitted `Depends:` is derived from
    // (ADR 0024 § 6), and the packing host has the staged copy but no way to
    // tell which staged file is the entry.
    const namespaces = scanGiNamespaces(readFileSync(settings.bundlePath, 'utf-8'));
    if (args.verbose) console.log(`${LOG} gi namespaces: ${namespaces.join(', ') || '(none)'}`);

    // PLACED, like the payload, and through the same map. `planOverlay` answers a
    // question about the FORMAT (`share/doc/<pkg>/copyright` for Debian policy,
    // `share/licenses/<pkg>/LICENSE` for rpm) in the prefix-relative shape every
    // plan uses; `packOne` then merges the overlay into the payload it reads back,
    // so the two have to be in one coordinate system. On Linux `place()` is the
    // identity for `share/…` and nothing moves. On darwin the licence would
    // otherwise land at the STAGE root, outside `<App>.app` — beside the bundle
    // rather than in it, where `codesign` later refuses it and no user ever finds
    // it. `dirs.other`'s doc already names that hazard for `extraFiles`; the
    // overlay reaches it by the same route.
    const overlay = new Map<FormatId, StagedFile[]>();
    for (const format of formats) {
        overlay.set(
            format.id,
            planOverlay(settings, format, stageInputs).map((file) => ({
                ...file,
                path: place(layout, settings, file.path),
            })),
        );
    }

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
        // "formats " reads as a truncated line rather than as a fact — and for
        // windows it is still the whole story. WHICH fact it is now depends on the
        // layout: darwin has two formats, so an empty list there means this project
        // cannot use them, and printing "none yet" would have told a `--app gjs`
        // author to wait for a milestone that has already landed.
        // Three reasons a list can be empty, and each names a different next step:
        // this project cannot use the formats that wrap the layout; the layout has
        // none; or the configured `targets` all wrap another one, which the branch
        // above has already SAID in its own words rather than repeating here.
        const none =
            unusable.length > 0
                ? `(none — ${unusable.map((format) => format.id).join(' and ')} need \`gjsify.app: "node"\`)`
                : formatIdsFor(layout.os).length === 0
                  ? `(none — no format wraps the ${layout.name} layout)`
                  : '(none asked for)';
        const wraps = manifest.formats.join(', ') || none;
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
                sign,
                notarize,
                verbose: args.verbose,
            }),
        );
    }
    printArtifacts(projectDir, artifacts);
}

/**
 * Refuse `--sign` / `--notarize` on the phase that produces no artifact.
 *
 * `--stage` writes a build intermediate, and a signature over one would be
 * invalidated by the very next thing that happens to it — the packer reads the
 * tree back and the container is built around it (ADR 0024 § A17 fixes that
 * order for the opposite reason: `readStage` compares SIZES, and a re-signed
 * file has a new one). Silently accepting the flag would produce a stage nobody
 * could tell from an unsigned one.
 */
function assertNothingToSignYet(args: ShipOptions): void {
    const given = args.sign !== undefined ? '--sign' : args.notarize !== undefined ? '--notarize' : undefined;
    if (given === undefined) return;
    throw new Error(
        `gjsify ship: ${given} belongs to the finish phase, and --stage produces no artifact to sign — it ` +
            'writes the tree a packing host reads back. Assemble here, then run ' +
            '`gjsify ship --from-stage <dir> --sign <identity>` on the host that holds the identity ' +
            '(ADR 0024 § A2, § A14).',
    );
}

/**
 * Say what this run will do about signatures, once, before any of it happens.
 *
 * PRINTED rather than silent, and to stderr, because ADR 0024 § A13 makes the
 * skip the visible half of "unsigned is the default path": a pipeline that
 * captures the artifact list still shows the line, and an unsigned artifact
 * nobody was told about is how a signature gets claimed that was never made.
 */
function announceSigning(sign: SignPlan, notarize: NotaryPlan): void {
    if (sign.kind === 'skip') console.warn(`${LOG} ${sign.message}`);
    if (notarize.kind === 'skip' && sign.kind === 'sign') console.warn(`${LOG} ${notarize.message}`);
}

/**
 * The runtime this artifact carries INSIDE itself, or an empty answer.
 *
 * THE GATE IS THE LAYOUT AND THE INTERPRETER, both. A Linux package declares
 * `Depends: nodejs` and takes the distribution's — carrying a second copy would be
 * a private interpreter no security update ever reaches. And a `--app gjs` payload
 * gets nothing even on macOS: there is no relocatable GJS to put in a bundle
 * (`build-gtk-runtime-darwin.mjs`: "GJS ships no relocation"), which is what
 * `macos-app`'s `interpreters: ['node']` already records, so staging a NODE
 * interpreter in front of a GJS bundle would be an interpreter that cannot read
 * its own payload.
 *
 * `${layout.os}-${settings.arch}` — the target the PAYLOAD was built for, never
 * the host's. Assembling a `darwin-arm64` bundle on a Linux x64 workstation is the
 * supported path (ADR 0024 § A1) and is what this project's own CI does; a
 * host-derived target would resolve the wrong closure, and the mismatch would only
 * surface as a dlopen failure on the user's machine. `assertPayloadMatchesArch`
 * reads the staged tree back afterwards and refuses a closure whose Mach-O
 * `cputype` disagrees with the label — a check the carried runtime is the first
 * thing to make non-vacuous on this layout, since a JavaScript bundle has no
 * cputype to disagree with.
 */
function resolveCarriedRuntime(layout: Layout, settings: ShipSettings, projectDir: string): StagedAppRuntime {
    const empty: StagedAppRuntime = { files: [], launcher: {}, found: [], missing: [] };
    if (layout.os === 'linux' || settings.app !== 'node') return empty;
    const target = `${layout.os}-${settings.arch}`;
    if (!isGtkRuntimeTarget(target)) return empty;
    return stageAppRuntime({
        layout,
        identity: settings,
        target,
        cwd: projectDir,
        interpreter: isNodeRuntimeTarget(target) ? resolveNodeRuntime(target, { cwd: projectDir }) : null,
    });
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
    // THE STAGE'S list, not the layout's. The two agreed while darwin and windows
    // had no formats at all, and stopped the moment two rows wrapped darwin: a
    // `--app gjs` project's darwin stage records `formats: []` against a layout
    // that now has two. Asking the layout would let that stage past this refusal
    // and into `resolveFormats([])`, whose message is about a `--target` the caller
    // never typed.
    if (args.target === undefined) {
        assertPackable(
            manifest.formats.map((id) => FORMATS[id]),
            layout,
            'stage',
            // What WOULD have wrapped it, so this can tell a `--app gjs` darwin
            // stage apart from a windows one, which nothing wraps at all.
            defaultFormatIds(layout.os)
                .map((id) => FORMATS[id])
                .filter((format) => !format.interpreters.includes(manifest.settings.app)),
        );
    }
    const formats = resolveFormats(args.target ?? manifest.formats, layout);
    assertFormatsStaged(manifest, formats);
    for (const format of formats) assertCanPack(format);

    // NO `config` — this phase has no project, by construction (`tests/e2e/
    // ship-from-stage` deletes the project tree between the two phases). So the
    // identity is the flag or nothing, which is also the right answer: § A14
    // amends § A1 to *a format declares where it can be packed; the RUN declares
    // what it can sign with*, and this run is the one holding the keychain.
    const sign = resolveSignPlan({ flag: args.sign, layoutOs: layout.os });
    const notarize = resolveNotaryPlan({ flag: args.notarize, layoutOs: layout.os, sign });
    announceSigning(sign, notarize);
    if (sign.kind === 'sign') assertHostCanSign(sign.signer);

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
                sign,
                notarize,
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
    /** What this RUN can sign with — resolved once, never per format. */
    sign: SignPlan;
    /** What this RUN can notarise with. */
    notarize: NotaryPlan;
    /** Print each tool invocation a host-bound packer makes. */
    verbose: boolean;
}

async function packOne(input: PackInput): Promise<ShipArtifact> {
    const { format, settings, stageDir, outRoot, mtime } = input;

    assertOverlayIsLicensed(format.id, settings.binaryName, input.overlay);

    const overlayDir = join(outRoot, 'overlay', format.id);
    writeStage(overlayDir, input.overlay);

    // THE PRE-SIGN TREE, and the name says which one it is (ADR 0024 § A17).
    // `readStage` holds each file's SIZE against the stage manifest, and a size is
    // no more re-sign-proof than a digest would be — measured on this tree:
    // append one byte to a staged file and it refuses with "… is 6 bytes in the
    // stage and 5 in its manifest". So the validation runs over what phase one
    // wrote, and the signer below takes its OUTPUT: the signed bytes are computed
    // from the validated ones and therefore cannot exist before them, which is
    // what makes the order structural rather than a comment somebody may reorder.
    const assembled = readStage([stageDir, overlayDir], [...input.staged, ...input.overlay]);
    // What the package installs, read off what it installs. The three questions
    // this answers used to be answered from the project's file lists, which are
    // absolute paths on the build host and therefore unavailable here.
    const facts = readPayloadFacts(assembled);
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
    assertPayloadMatchesArch(assembled, input.arch);

    // The second half of the same idea, on the other label this artifact carries:
    // something declares which interpreter runs the app, and until now nothing
    // compared it to the launcher that will. They CAN disagree — a stage assembled
    // by one gjsify and packed by another — and an artifact that promises one
    // interpreter and runs another installs cleanly and dies at first launch.
    //
    // EVERY FORMAT, not only the ones with a `Depends:`. The guard used to run
    // behind `format.depends !== null`, which was the right condition while the
    // only declaration was a package list. The macOS rows have no dependency list
    // and a HARDER promise instead: `interpreters: ['node']`, because there is no
    // relocatable GJS to put in a bundle. So the launcher has to be read for them
    // too. Widening this costs the Flatpak path nothing — its row is
    // `interpreters: ['gjs']` and `assertFormatCanRunInterpreter` has already
    // refused anything else — and the check is asymmetric by construction, so a
    // launcher it cannot resolve stays silent rather than failing a working
    // artifact.
    const layout = layoutForOs(format.layoutOs);
    assertLauncherMatchesInterpreter(assembled, layout, settings, settings.app);

    // The label against the LAYOUT, which is the question one level up from
    // `assertPayloadMatchesArch`: that one asks whether the bytes agree with the
    // label, this asks whether an artifact for that label can exist at all. They
    // are not the same check, and the windows row is where they come apart — a
    // payload of x64 DLLs labelled `arm64` fails the first, while a payload of pure
    // JavaScript labelled `arm64` passes it and still produces a program directory
    // no Windows/ARM machine has a GTK for (#1117).
    //
    // HERE and not at `--stage`, which is the same split `Layout.runtimeGap` draws:
    // a stage is a build intermediate and assembling one for a foreign arch is what
    // `tests/e2e/ship-layout` does on purpose (one payload, three layouts, and that
    // payload's native file has an architecture). What must not leave is an
    // ARTIFACT. `assemble` warns at the `--arch` that caused it.
    //
    // And BEFORE `archName`, deliberately: that function refuses an unknown value
    // too, with a message about a table. This one names the blocker and where it is
    // tracked, which is the difference between "unsupported" and "here is what
    // would have to change".
    assertLayoutSupportsArch(layout, input.arch);

    // AFTER every check above and BEFORE any container below — the seam § A17
    // asks M2's packer to leave, filled. Signing is a MUTATION of the payload
    // (§ A4): what the packers get back is new bytes, not a wrapper, because a
    // Developer-ID-signed main executable will not load ad-hoc-signed dylibs
    // under library validation and all 106 images in the shipped darwin closure
    // are ad-hoc today.
    //
    // Per FORMAT rather than once per run, and that costs darwin a second
    // `codesign` pass over the same images (`macos-app` and `macos-app-zip` are
    // two calls). It is not avoidable by hoisting: the payload a format signs
    // includes that format's own overlay — on darwin the licence, which lands
    // INSIDE `<App>.app` — so two formats have two payloads.
    //
    // `signed/<id>/` is scratch this function owns. The arriving stage is never
    // written to: `writeStage` wipes what it is pointed at, and a re-signed file
    // in it would fail the very `readStage` above on the next run.
    const payload =
        input.sign.kind === 'sign'
            ? await signPayload({
                  payload: assembled,
                  identity: input.sign.identity,
                  signer: input.sign.signer,
                  workDir: join(outRoot, 'signed', format.id),
                  verbose: input.verbose,
                  log: (line) => console.log(`${LOG} ${line}`),
              })
            : assembled;

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
        case 'macos-app':
        case 'windows-dir':
            // ONE STATEMENT FOR TWO ROWS, folded because the code really is
            // identical: `Layout.root` is where the two differ, and the first draft
            // of the windows arm said "NO REBASE, which is the one place the two
            // rows differ" over a line byte-identical to this one.
            //
            // No container at all: the artifact IS the payload plus this format's
            // overlay, written out. `writePayload` rather than a directory copy of
            // the stage, so the same two properties every other packer has hold
            // here — modes come from the plan (`readStage` has applied them, and
            // the artifact upload that flattens them cannot reach in between), and
            // the stage's own sidecar stays out because it was never payload.
            //
            // REBASED ON `Layout.root`, which is `<App>.app` on darwin and `''` on
            // windows — the difference between the artifact and a directory
            // containing it, measured as a defect on the first: every staged darwin
            // path already begins with `<App>.app/` and `format.fileName` names the
            // artifact the same thing, so writing them verbatim produced
            // `out/Ship Demo.app/Ship Demo.app/Contents/…`, a folder the Finder does
            // not treat as an application with a real bundle hidden one level down,
            // at exit 0, with `zipinfo` on the sibling zip showing the correct tree
            // the whole time. On windows the stage IS the directory's contents,
            // because an installer picks the parent, and `writePayload` documents
            // `stripPrefix === ''` as a no-op — so the same call is right for both.
            // Neither zip needs a rebase, and for opposite reasons: the darwin
            // archive INHERITS its top level from the staged paths, the windows one
            // SYNTHESISES it (see `windows-dir-zip`).
            writePayload(target, payload, layout.root(settings));
            break;
        case 'macos-app-dmg': {
            // FROM THE STAGE, never from the `out/<App>.app` the row above
            // writes, and that is a design decision rather than an accident of
            // where the bytes were handy. Three reasons, in the order they bite:
            //
            //  * a `--target macos-app-dmg` run alone must produce a `.dmg`.
            //    Reading the sibling artifact would make this row depend on
            //    another row having run, and the only thing that orders them
            //    today is `resolveFormats`' alphabetical sort — an invariant
            //    nothing states and `--target macos-app-dmg` on its own breaks.
            //  * ADR 0024 § A17 fixes the seam for a later `--sign`: `readStage`
            //    validates the PRE-sign tree, the re-sign runs after it, and the
            //    container is built after that. A packer that opened an artifact
            //    would put its container step on the far side of a directory
            //    nothing validated.
            //  * the modes. `writePayload` applies the PLAN's modes, which
            //    `readStage` has already resolved from the manifest; a directory
            //    copy would inherit whatever the filesystem — or a CI artifact
            //    round trip — left behind.
            //
            // `stripPrefix: ''` and not `layout.root(settings)`, which is the one
            // line where this differs from the `macos-app` arm above: that
            // artifact IS the bundle, so the `<App>.app/` prefix comes off; this
            // one is the VOLUME, and the bundle has to sit inside it or the image
            // mounts showing `Contents/` — a window with no application in it.
            const volumeDir = dmgVolumeDir(outRoot);
            writePayload(volumeDir, payload, '');
            await buildDmgImage({
                settings,
                volumeName: dmgVolumeName(settings),
                sourceDir: volumeDir,
                target,
                workDir: dirname(volumeDir),
                verbose: input.verbose,
            });
            break;
        }
        case 'macos-app-zip':
            // The SAME payload, in the one container a browser download can be.
            // Written by this tree (`utils/ship/zip.ts`) so the packing host needs
            // no `zip(1)` and `zipinfo` stays an independent reader — ADR 0024
            // § A3's argument for the hand-written deb and rpm, applied again.
            // The paths inside are the staged ones, so the archive expands to
            // `<App>.app/…` and not to a bare `Contents/`.
            writeFileSync(target, buildZip(zipEntriesFromPayload(payload), mtime));
            break;
        case 'windows-dir-zip':
            // The same payload, with the top level the layout deliberately does not
            // carry. `windowsProgramDirName` is the same function the row above
            // names the directory with, so unzipping this archive and running the
            // installer put the app at the same relative path — and a user who
            // unzips it in `Downloads` gets one directory rather than `app\`,
            // `share\` and a `.cmd` loose in it.
            writeFileSync(target, buildZip(zipEntriesFromPayload(payload, windowsProgramDirName(settings)), mtime));
            break;
        case 'msi': {
            // The SAME payload again, and the third artifact to carry it —
            // `payload`, which is `signPayload`'s OUTPUT when an identity was
            // passed and `assembled` otherwise (§ A17). The installer therefore
            // packs the signed bytes by construction rather than by ordering: it
            // cannot read them before the signer has produced them.
            //
            // The source document addresses files by PATH, so the tree is written
            // out once into the work directory and the `.wxs` points at it with
            // paths RELATIVE to that directory — the same shape the Flatpak packer
            // uses, where a manifest also names a directory the packer just laid
            // down. Relative and not absolute because the same document is compiled
            // a second time by WiX on another machine; see `utils/ship/msi.ts`.
            // Not a copy of `out/<App>/`: `--target msi` alone must work, and the
            // directory row may not be in this run's format list at all.
            const workDir = join(outRoot, 'msi');
            writePayload(join(workDir, MSI_PAYLOAD_DIR), payload, layout.root(settings));
            await buildMsi({
                settings,
                // POSIX-separated and RELATIVE to `workDir`, so the `.wxs` plus the
                // tree beside it is a pair that can be handed to a second compiler
                // on another machine — which is what the WiX half of the
                // cross-check does with this exact document.
                files: payload.map((entry) => ({
                    path: entry.path,
                    source: `${MSI_PAYLOAD_DIR}/${entry.path}`,
                })),
                programDirName: windowsProgramDirName(settings),
                archLabel,
                workDir,
                target,
                verbose: input.verbose,
            });
            break;
        }
        default: {
            const unhandled: never = format.id;
            throw new Error(`gjsify ship: no packer is wired for format "${String(unhandled)}".`);
        }
    }

    // The SIZE of a directory is not `statSync().size`, which answers 4096 for the
    // directory entry — so a `.app` with a 20 MiB bundle would be reported as
    // "4096 bytes". `artifactKind` is on the descriptor for exactly this.
    const size = format.artifactKind === 'directory' ? directorySize(target) : statSync(target).size;

    // LAST, on the artifact that landed — notarisation is a check on a finished,
    // signed container and there is nothing to submit before one exists.
    //
    // A DIRECTORY IS SKIPPED, not refused. `notarytool` takes an archive or an
    // installer, so a `<App>.app` has no submittable form of its own; on darwin
    // the zip beside it is the one that goes. Refusing here would make
    // `--notarize` unusable with the default format set, which is both rows.
    if (input.notarize.kind === 'notarize') {
        if (format.artifactKind === 'directory') {
            console.warn(
                `${LOG} ${format.id} is a directory, and notarytool submits an archive or an installer — ` +
                    'not notarised. The container format beside it is what carries the ticket.',
            );
        } else {
            await notarizeArtifact({
                plan: input.notarize,
                artifact: target,
                verbose: input.verbose,
                log: (line) => console.log(`${LOG} ${line}`),
            });
        }
    }
    return { format: format.id, path: target, size };
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
function assertPackable(
    formats: readonly FormatDescriptor[],
    layout: Layout,
    chosenBy: 'host' | 'positional' | 'stage',
    unusable: readonly FormatDescriptor[] = [],
): void {
    if (formats.length > 0) return;
    // A DIFFERENT emptiness, and conflating the two sends the reader to the wrong
    // fix. "No format wraps this layout" is answered by a later milestone; "the
    // formats that wrap it cannot run this project's interpreter" is answered by
    // the project, today — and the two produce byte-identical empty lists.
    if (unusable.length > 0) {
        throw new Error(
            `gjsify ship: ${unusable.map((format) => format.id).join(' and ')} wrap the ${layout.name} ` +
                `layout, and neither can run this project — ${unusable[0]?.interpreterGap ?? ''}.\n` +
                `    \`gjsify ship ${layout.name} --stage\` assembles the tree anyway; packing it is what ` +
                'the milestone that stages an interpreter is for (#1354 M2b).',
        );
    }
    const linux = defaultFormatIds('linux').join(',');
    // Three callers, three different next steps. Telling a `--from-stage` caller
    // to run `gjsify ship <os> --stage` names the command that PRODUCED the stage
    // they are holding, which is advice to go in a circle.
    const advice = {
        host:
            `This host is ${process.platform}, so \`gjsify ship\` assembled the ${layout.name} layout. ` +
            'Assembly is not host-bound (ADR 0024 § A1), so the Linux packages are still one word away: ' +
            `\`gjsify ship linux\` builds ${linux} from right here.`,
        positional:
            `\`gjsify ship ${layout.name} --stage\` assembles the payload and stops, which is the whole of ` +
            'what this command does for that OS today.',
        stage:
            `This stage carries the ${layout.name} layout and nothing here can wrap it — a stage is a build ` +
            'intermediate, not an artifact. Keep it for the milestone that packs it, or re-assemble with ' +
            '`gjsify ship linux --stage` if a Linux package is what you wanted.',
    }[chosenBy];
    // UNREACHABLE FROM THE THREE LAYOUTS THAT EXIST, and kept rather than deleted:
    // every one of them has formats as of #1354 M3, so a `--app gjs` project meets
    // the INTERPRETER refusal above instead. This branch is what a fourth layout
    // gets on the day it is added and before a format wraps it — the same state
    // windows was in between M1 and M3 — and deleting it would make that day's
    // failure a `TypeError` on an empty list.
    throw new Error(
        `gjsify ship: no format wraps the ${layout.name} layout, so there is nothing to pack. ${advice}` +
            ' Every layout this gjsify knows has one (ADR 0024 stages 2-5), so this is a layout added ' +
            'without a `FORMATS` row.',
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
 * WHY THIS REFUSES AND `Layout.runtimeGap` ONLY WARNS, since the two describe
 * neighbouring predicaments and get opposite treatment. A target this command
 * cannot package would leave here as an ARTIFACT — a `.deb` a stranger installs,
 * which then fails at startup, with no gate between here and their machine. A
 * windows stage cannot run on any Windows machine either, but it is not an
 * artifact: `assertPackable` refuses to pack it, so the only thing leaving this
 * command is a build intermediate whose consumer is the milestone that wraps it.
 * Refusing would ban assembling the layout at all, which is the whole of M1. The
 * day a Windows format exists, that warning has to become this refusal.
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
            // The ROW's own sentence, not one written here. Hardcoded, this
            // paragraph told the first `.app` author about
            // `org.freedesktop.Sdk.Extension.node2x` and the GNOME runtime.
            `    ${format.interpreterGap}.\n` +
            '    Build the formats that wrap this layout and can run it, or ship this app as ' +
            `\`gjsify.app: "${format.interpreters.join('" / "')}"\`.`,
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
