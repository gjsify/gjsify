// `gjsify ship` — turn a built application into something a stranger can
// install (ADR 0024).
//
// One payload, produced once, then wrapped per format. The command itself is
// thin on purpose: every decision worth testing lives in `utils/ship/*` as a
// pure function, and what is left here is filesystem work and printing.
//
// Scope today is Linux and `--app gjs`: no runtime is bundled, because GJS and
// GTK come from the distribution and shipping ~100 MiB of them would be cargo
// cult (ADR 0024 § 4). macOS and Windows layouts, and Flatpak as a target under
// this command, are the later stages of the same ADR.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
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
import { deriveDepends, warnAboutGjsFloor } from '../utils/ship/depends.js';
import { discoverPayload } from '../utils/ship/discover.js';
import { resolveFormats, FORMAT_IDS } from '../utils/ship/formats.js';
import { scanGiNamespaces } from '../utils/ship/gi-namespaces.js';
import { buildTimestamp, isArchIndependent } from '../utils/ship/payload.js';
import { planOverlay, planStage, type StageInputs } from '../utils/ship/plan.js';
import { renderLauncher } from '../utils/ship/launcher.js';
import { buildRpm } from '../utils/ship/rpm.js';
import { declaredBundlePath, resolveShipSettings, type ShipPackageManifest } from '../utils/ship/settings.js';
import { readStage, writeStage } from '../utils/ship/stage-writer.js';
import type { FormatDescriptor, ShipArtifact, ShipSettings } from '../utils/ship/types.js';

interface ShipOptions {
    target?: string[];
    out?: string;
    stage: boolean;
    'skip-build': boolean;
    arch?: string;
    verbose: boolean;
}

const LOG = '[gjsify ship]';

export const shipCommand: Command<unknown, ShipOptions> = {
    command: 'ship',
    description: `Build installable artifacts (${FORMAT_IDS.join(', ')}) from the current project.`,
    builder: (yargs: Argv) =>
        yargs
            .option('target', {
                type: 'string',
                array: true,
                description: `Formats to build, comma-separated or repeated. Default: ${FORMAT_IDS.join(',')}.`,
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
                description: 'Print each staged file and the GI namespaces the bundle imports.',
            }),

    handler: async (args) => {
        const projectDir = process.cwd();
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
        const formats = resolveFormats(args.target ?? ship.targets ?? FORMAT_IDS);

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
            cli: { outDir: args.out, arch: args.arch },
            discovered,
        });
        for (const warning of warnings) console.warn(`${LOG} ${warning}`);

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

        const stageInputs: StageInputs = {
            bundleFiles: discovered.bundleFiles,
            launcher: renderLauncher(settings, basename(settings.bundlePath)),
            metainfo: settings.kind === 'app' ? renderMetainfoApp(metadataInputs) : renderMetainfoCli(metadataInputs),
            desktopEntry: settings.kind === 'app' ? renderDesktopEntry(metadataInputs) : undefined,
            licenseText: settings.licenseFile === undefined ? undefined : readFileSync(settings.licenseFile, 'utf-8'),
        };

        const outRoot = resolve(projectDir, settings.outDir);
        const stageDir = join(outRoot, 'stage');
        const staged = planStage(settings, stageInputs);
        writeStage(stageDir, staged);
        console.log(`${LOG} staged ${staged.length} file(s) in ${relative(projectDir, stageDir)}/`);
        if (args.verbose) for (const file of staged) console.log(`${LOG}   ${file.path}`);

        if (args.stage) return;

        const namespaces = scanGiNamespaces(readFileSync(settings.bundlePath, 'utf-8'));
        if (args.verbose) console.log(`${LOG} gi namespaces: ${namespaces.join(', ') || '(none)'}`);

        const artifacts: ShipArtifact[] = [];
        for (const format of formats) {
            artifacts.push(
                await packOne({ format, settings, stageInputs, staged, stageDir, outRoot, namespaces, mtime }),
            );
        }

        for (const artifact of artifacts) {
            console.log(`${LOG} ${artifact.format}: ${relative(projectDir, artifact.path)} (${artifact.size} bytes)`);
        }
    },
};

interface PackInput {
    format: FormatDescriptor;
    /** The one build stamp every header and every rendered file shares. */
    mtime: number;
    settings: ShipSettings;
    stageInputs: StageInputs;
    staged: ReturnType<typeof planStage>;
    stageDir: string;
    outRoot: string;
    namespaces: string[];
}

async function packOne(input: PackInput): Promise<ShipArtifact> {
    const { format, settings, stageDir, outRoot, mtime } = input;

    const overlay = planOverlay(settings, format, input.stageInputs);
    const overlayDir = join(outRoot, 'overlay', format.id);
    writeStage(overlayDir, overlay);

    const payload = readStage([stageDir, overlayDir], [...input.staged, ...overlay]);
    const depends = deriveDepends(format.id, {
        namespaces: input.namespaces,
        kind: settings.kind,
        hasSchemas: settings.schemaFiles.length > 0,
        extra: settings.extraDepends[format.id],
        typelibPackages: settings.typelibPackages,
        bundledTypelibs: settings.typelibFiles,
        minGjsVersion: settings.minGjsVersion,
    });
    for (const warning of warnAboutGjsFloor(format.id, settings.minGjsVersion)) console.warn(`${LOG} ${warning}`);

    const archLabel = format.archName(settings.arch, isArchIndependent(payload));
    const common = { settings, payload, prefix: format.prefix, depends, archLabel, mtime };
    const bytes = format.id === 'deb' ? await buildDeb(common) : await buildRpm(common);

    const outDir = join(outRoot, 'out');
    mkdirSync(outDir, { recursive: true });
    const target = join(outDir, format.fileName(settings, archLabel));
    writeFileSync(target, bytes);
    return { format: format.id, path: target, size: bytes.byteLength };
}

/**
 * Refuse a build target this command cannot package correctly.
 *
 * The launcher execs `gjs -m <bundle>`, so a `--app node` bundle would produce
 * a package that installs and then fails at startup — and ADR 0024 § 4 says
 * that case needs a BUNDLED Node, whose delivery (fetched at ship time versus a
 * platform package) is still an open decision. Better to say so than to ship
 * the broken half of it.
 *
 * An undeclared target is the common case for a GJS app and is allowed: `app`
 * otherwise defaults to the HOST runtime, which would refuse a perfectly good
 * GJS project merely for running this command under Node.
 */
function assertShippableTarget(app: string | undefined): void {
    if (app === undefined || app === 'gjs') return;
    throw new Error(
        `gjsify ship: this project declares \`gjsify.app: "${app}"\`, and only \`gjs\` can be packaged today. ` +
            'The launcher execs `gjs -m <bundle>`, so any other target would install and then fail to start. ' +
            'ADR 0024 § 4 has the runtime-per-OS table and what is still open for the other targets.',
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
