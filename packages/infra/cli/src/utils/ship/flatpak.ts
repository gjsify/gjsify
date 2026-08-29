// The Flatpak packer — ADR 0024 § 8, stage 6.
//
// This is a MOVE, not a second implementation. `gjsify flatpak` has emitted
// Flatpak manifests since long before `ship` existed; what it emitted was a
// `buildsystem: meson` module, which made every app carry meson glue whose only
// job was to call `gjsify build` and copy the result into a prefix — 158 lines
// of it in Learn6502, 66 of them `GI_TYPELIB_PATH`/`LD_LIBRARY_PATH` plumbing.
// `ship` already produces that prefix. So the module becomes:
//
//     buildsystem: simple
//     build-commands: mkdir -p /app; cp -a stage/. /app/; cp -a overlay/. /app/
//
// and meson leaves the sandbox. Nothing else about the payload changes — the
// launcher derives its own prefix at runtime (§ 3), which is exactly why one
// staged tree can be `/usr` in a `.deb` and `/app` here.
//
// FOUR THINGS ABOUT flatpak-builder 1.4.10 WERE MEASURED before this file was
// written, because each had a plausible wrong answer and flatpak-builder reports
// none of them: an absolute `dir` source `path` works, `skip` works and is what
// keeps the stage's own sidecar out of `/app`, `cp -a` preserves the mode, and
// `--show-manifest` is NOT a validator (it accepted an unknown source property
// and `buildsystem: "nonsense"` at exit 0, so it must never be used as a gate).
// The numbers, the commands and the oracle that replaces `--show-manifest`:
// `docs/ship-formats.md`.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describeExit, spawnToCompletion } from '../spawn.js';
import type { PackSettings } from './types.js';

export interface FlatpakManifestInput {
    settings: PackSettings;
    /** Absolute path of the staged payload — the tree `readStage` validated. */
    stageDir: string;
    /** Absolute path of this format's rendered overlay (the licence file). */
    overlayDir: string;
    /** The stage's own closure file, which is not payload and must not be copied into `/app`. */
    stageManifestFile: string;
}

/**
 * The generated Flatpak manifest, as a plain object.
 *
 * Pure, so every field is unit-testable without flatpak tooling — and the
 * suite that needs that is the one running in CI, where there is none.
 *
 * The app id is what makes this legal Flatpak: every file flatpak EXPORTS out
 * of `/app/share` has to be named after it, and `planStage` already enforces
 * exactly that for its own reasons — the desktop entry, the metainfo, the icon,
 * the GSettings schema and the shared-mime-info document are all
 * `<appId>[.…].<ext>`, because `share/glib-2.0/schemas/` and
 * `share/mime/packages/` are directories shared between packages. Two
 * independent constraints, one naming rule.
 */
export function renderShipFlatpakManifest(input: FlatpakManifestInput): Record<string, unknown> {
    const { settings, stageDir, overlayDir } = input;
    const flatpak = settings.flatpak;

    const manifest: Record<string, unknown> = {
        id: settings.appId,
        runtime: flatpak.runtime,
        'runtime-version': flatpak.runtimeVersion,
        sdk: flatpak.sdk,
        branch: flatpak.branch,
        // `bin/<binaryName>`, which is the one executable the stage plans. NOT
        // the app id, which is what `gjsify flatpak init` defaults to: under
        // `ship` the launcher's name is decided by `gjsify.ship.binaryName`, and
        // a `command` naming a file that is not in `/app/bin` produces an app
        // that installs and cannot be launched.
        command: settings.binaryName,
        'finish-args': flatpak.finishArgs,
    };
    if (flatpak.sdkExtensions.length > 0) manifest['sdk-extensions'] = flatpak.sdkExtensions;
    if (flatpak.appendPath.length > 0) {
        manifest['build-options'] = { 'append-path': flatpak.appendPath.join(':') };
    }
    if (flatpak.cleanup.length > 0) manifest.cleanup = flatpak.cleanup;

    manifest.modules = [
        {
            name: settings.binaryName,
            buildsystem: 'simple',
            // `mkdir -p /app` first: flatpak-builder creates the app directory,
            // but a module whose only command is a `cp` into a path that does
            // not exist yet is one refactor away from failing, and the mkdir is
            // free. `stage/.` and not `stage` — `cp -a stage /app/` would
            // create `/app/stage`, which installs cleanly and puts the whole
            // payload one directory too deep.
            'build-commands': ['mkdir -p /app', 'cp -a stage/. /app/', 'cp -a overlay/. /app/'],
            sources: [
                { type: 'dir', path: stageDir, dest: 'stage', skip: [input.stageManifestFile] },
                { type: 'dir', path: overlayDir, dest: 'overlay' },
            ],
        },
    ];
    return manifest;
}

export interface FlatpakPackInput extends FlatpakManifestInput {
    /** Working root for the manifest, the build dir, the repo and the builder's state. */
    workDir: string;
    /** Absolute path the finished `.flatpak` is written to. */
    target: string;
    /** Flatpak's spelling of the architecture, e.g. `x86_64`. */
    archLabel: string;
    verbose: boolean;
}

/**
 * Build the app and export a single-file bundle at `input.target`.
 *
 * The only packer in this tree that execs anything, and the descriptor says so
 * (`FORMATS.flatpak.host.requiredTools`). ADR 0024 § A3 is explicit that this
 * costs the independent oracle the hand-written deb/rpm writers bought: what
 * pays it back here is that a `.flatpak` is an OSTree static delta, so
 * `flatpak build-import-bundle` + `ostree ls -R` read the artifact back with
 * code this tree did not write.
 */
export async function buildFlatpakBundle(input: FlatpakPackInput): Promise<void> {
    const { settings, workDir, archLabel } = input;

    const manifestPath = join(workDir, `${settings.appId}.json`);
    const buildDir = join(workDir, 'build');
    const repoDir = join(workDir, 'repo');
    // Kept between runs: it is flatpak-builder's own ostree cache, and dropping
    // it turns every re-pack into a full rebuild of every module.
    const stateDir = join(workDir, 'state');

    mkdirSync(workDir, { recursive: true });
    // The repo is wiped, the state dir is not. A repo that survives holds the
    // PREVIOUS commit on the same ref, and `build-bundle` would happily export
    // it if this run's export failed for any reason that did not fail the
    // build — a stale artifact wearing the new version's filename.
    rmSync(repoDir, { recursive: true, force: true, maxRetries: 5 });
    writeFileSync(manifestPath, `${JSON.stringify(renderShipFlatpakManifest(input), null, 2)}\n`);

    await run(
        'flatpak-builder',
        [
            '--force-clean',
            // Needed wherever FUSE is unavailable — containers, most CI runners.
            // It only disables a read-only-bind optimisation, and a build that
            // cannot start is worse than one that copies a few more bytes.
            '--disable-rofiles-fuse',
            '--delete-build-dirs',
            `--state-dir=${stateDir}`,
            `--arch=${archLabel}`,
            `--repo=${repoDir}`,
            buildDir,
            manifestPath,
        ],
        input,
        'flatpak-builder not found. Install it (Fedora: `sudo dnf install flatpak-builder`).',
    );

    // The branch is passed explicitly even though the manifest declares it: the
    // two have to name the same ref, and `build-bundle`'s default is `master`
    // while a manifest that sets `branch` exports somewhere else. Leaving it
    // implicit is how this exports nothing and says "ref not found".
    await run(
        'flatpak',
        ['build-bundle', `--arch=${archLabel}`, repoDir, input.target, settings.appId, settings.flatpak.branch],
        input,
        'flatpak not found. Install it via your distro: see https://flathub.org/setup.',
    );
}

async function run(cmd: string, args: string[], input: FlatpakPackInput, notFoundHint: string): Promise<void> {
    if (input.verbose) console.log(`[gjsify ship] ${cmd} ${args.join(' ')}`);
    // `completion: 'return'` because `ship` packs the remaining formats and
    // prints the artifact list afterwards, so it cannot end in `process.exit()`
    // the way `gjsify flatpak build` does. Under GJS that selects the blocking
    // path, which captures the child's output and re-emits it at the end
    // instead of streaming it — the documented cost of a spawn a caller has to
    // return from (see utils/spawn.ts), and the reason `--verbose` prints the
    // invocation before the silence starts.
    const result = await spawnToCompletion(cmd, args, {
        completion: 'return',
        cwd: input.workDir,
        stdio: 'inherit',
        notFound: () => new Error(`gjsify ship: ${notFoundHint}`),
    });
    if (result.code !== 0) {
        throw new Error(`gjsify ship: ${cmd} failed with ${describeExit(result)}.`);
    }
}
