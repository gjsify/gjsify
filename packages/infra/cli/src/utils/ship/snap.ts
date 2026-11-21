// The Snap packer — ADR 0149.
//
// The Flatpak shape, not the `.deb` shape: this tree writes the INPUT of a build tool
// (`snap/snapcraft.yaml` plus the payload it points at) and the host's `snapcraft` writes
// the container. A `.snap` is a squashfs plus `meta/snap.yaml`, and writing a squashfs is
// what ADR 0024 § A6 rejects by name; the `gnome` extension's launcher glue
// (`desktop-launch`, the GPU wrapper) is GPL-3 code that changes per base, so porting it
// would turn gjsify into a downstream of snapcraft's tree. The cost is the one every
// tool-backed row pays: `snapcraft` must be on PATH, and it is not on the machine this was
// written on. What only the tool can answer is measured by `ship-pack-snap` in CI and
// recorded in ADR 0149: the launcher reaches the platform's `gjs` (with
// `GJS_PRIVATE_TYPELIB_DIR` below), every extension plug auto-connects, and a window opens
// under Xvfb. arm64 and a real desktop session are not measured.
//
// WHAT IS MEASURED, from the published `gnome-core26` revision (2026-11-20): it carries
// `gjs` 1.88, GTK 4, libadwaita, libsoup 3 and the GObject typelibs a GJS app imports, so
// the payload bundles nothing and the interpreter half of the artifact is the platform
// snap, exactly as `org.gnome.Platform` is for a Flatpak.
//
// THE PAYLOAD LIVES INSIDE THE PROJECT DIRECTORY and `source` is relative. snapcraft builds
// in an LXD container that mounts the project directory and nothing else, so an absolute
// path into `out/` would resolve on the host and not in the build.

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describeExit, spawnToCompletion } from '../spawn.js';
import { encodeUtf8 } from './bytes.js';
import type { PayloadEntry } from './payload.js';
import { SHARE } from './share-dirs.js';
import { writePayload } from './stage-writer.js';
import type { PackSettings } from './types.js';

/** The tool this packer execs. One spelling, read by this module AND by the format row. */
export const SNAP_TOOL = 'snapcraft';

/** The base the generated snap declares, and the platform snap that goes with it. */
export const SNAP_BASE = 'core26';

/** Set to `1` to build on the host instead of in LXD (`snapcraft pack --destructive-mode`). */
export const SNAP_DESTRUCTIVE_ENV = 'GJSIFY_SNAP_DESTRUCTIVE';

/**
 * Where `gnome-core26` keeps `GjsPrivate-1.0.typelib`, which every GJS override of Gio and Gtk
 * requires. The extension's `desktop-launch` prepends `usr/lib/gjs/girepository-1.0` but not
 * this Debian multiarch spelling, and the platform's `gjs` has the path compiled in relative to
 * `/`, so without it the first `gi://Gtk` throws "Typelib file for namespace 'GjsPrivate' (any
 * version) not found" — measured in run 44885398599. `desktop-launch` prepends to an existing
 * value, so setting it on the app survives the command chain. snapcraft expands the triplet.
 */
const GJS_PRIVATE_TYPELIB_DIR = '$SNAP/gnome-platform/usr/lib/$CRAFT_ARCH_TRIPLET_BUILD_FOR/gjs/girepository-1.0';

/** Directory inside the work dir that holds the payload `dump` copies. */
const PAYLOAD_DIR = 'payload';

/** The prefix the payload sits under inside the snap — the AppImage layout, for its reason. */
const PREFIX_DIR = 'usr';

/**
 * Snap names: lowercase letters, digits and hyphens, no leading, trailing or doubled hyphen,
 * at least one letter, at most 40 characters. The store enforces it at registration; failing
 * here is minutes earlier than failing inside an LXD container.
 */
const SNAP_NAME = /^(?=.*[a-z])[a-z0-9]+(-[a-z0-9]+)*$/;
const SNAP_NAME_MAX = 40;
const SNAP_VERSION_MAX = 32;

/** Shared with the store helpers (`gjsify snap register`), so both refuse the same names. */
export function isSnapName(name: string): boolean {
    return name.length <= SNAP_NAME_MAX && SNAP_NAME.test(name);
}
const SNAP_SUMMARY_MAX = 78;

export interface SnapManifestInput {
    settings: PackSettings;
}

/**
 * Everything the store or snapcraft would refuse, refused here with the field named.
 *
 * Pure. The desktop entry is checked against the payload because `desktop:` pointing at a
 * file that is not there is a snapcraft error that names neither the file nor the cause.
 */
export function assertSnapIsPackable(payload: readonly { path: string }[], settings: PackSettings): void {
    const problems: string[] = [];
    if (!isSnapName(settings.binaryName)) {
        problems.push(
            `the binary name "${settings.binaryName}" is not a snap name (lowercase letters, digits and single ` +
                `hyphens, at most ${SNAP_NAME_MAX} characters, at least one letter)`,
        );
    }
    if (settings.version.length > SNAP_VERSION_MAX) {
        problems.push(`the version "${settings.version}" is longer than ${SNAP_VERSION_MAX} characters`);
    }
    if (settings.summary.length > SNAP_SUMMARY_MAX) {
        problems.push(`the summary is ${settings.summary.length} characters, the store takes ${SNAP_SUMMARY_MAX}`);
    }
    const desktop = snapDesktopPath(settings);
    if (!payload.some((entry) => entry.path === desktop)) {
        problems.push(`the payload has no ${desktop}, which the snap's \`desktop:\` key must point at`);
    }
    if (problems.length > 0) {
        throw new Error(`gjsify ship: cannot pack a snap: ${problems.join('; ')}.`);
    }
}

/** Prefix-relative path of the staged desktop entry. */
function snapDesktopPath(settings: PackSettings): string {
    return `${SHARE.applications}/${settings.appId}.desktop`;
}

/**
 * The generated `snap/snapcraft.yaml`, as a plain object.
 *
 * Pure, so every key is unit-testable without snapcraft. `extensions` sits on the APP, which
 * is where snapcraft reads it; the part is a `dump` of the staged payload, so nothing is
 * compiled or fetched in the build.
 */
export function renderSnapcraftManifest(input: SnapManifestInput): Record<string, unknown> {
    const { settings } = input;
    const app: Record<string, unknown> = {
        command: `${PREFIX_DIR}/bin/${settings.binaryName}`,
        extensions: ['gnome'],
        desktop: `${PREFIX_DIR}/${snapDesktopPath(settings)}`,
        'common-id': settings.appId,
        environment: { GI_TYPELIB_PATH: GJS_PRIVATE_TYPELIB_DIR },
    };
    const manifest: Record<string, unknown> = {
        name: settings.binaryName,
        title: settings.name,
        base: SNAP_BASE,
        version: settings.version,
        summary: settings.summary,
        description: settings.description.join('\n\n'),
        license: settings.license,
        grade: 'stable',
        confinement: 'strict',
        apps: { [settings.binaryName]: app },
        parts: {
            [settings.binaryName]: { plugin: 'dump', source: PAYLOAD_DIR },
        },
    };
    if (settings.homepage !== undefined) manifest.website = settings.homepage;
    return manifest;
}

/**
 * The file's text. JSON IS YAML, and snapcraft reads it as YAML — a generated build input
 * needs no emitter whose quoting rules this tree would then own.
 */
export function renderSnapcraftYaml(input: SnapManifestInput): string {
    return `${JSON.stringify(renderSnapcraftManifest(input), null, 2)}\n`;
}

/** The argument vector, as data, for the same reason the AppImage's is. */
export function snapcraftArgs(input: { target: string; archLabel: string; destructive: boolean }): string[] {
    const args = ['pack', `--build-for=${input.archLabel}`, '--output', input.target];
    if (input.destructive) args.push('--destructive-mode');
    return args;
}

export interface SnapPackInput {
    settings: PackSettings;
    /** Prefix-relative payload, with `gschemas.compiled` already appended when there are schemas. */
    payload: readonly PayloadEntry[];
    /** Working root: holds `snap/snapcraft.yaml` and `payload/`, and is wiped first. */
    workDir: string;
    /** Absolute path the finished `.snap` is written to. */
    target: string;
    /** snapd's spelling of the architecture, e.g. `amd64`. */
    archLabel: string;
    verbose: boolean;
}

/** Write the project directory snapcraft builds from. Wipes `workDir`. */
export function writeSnapProject(input: SnapPackInput): void {
    assertSnapIsPackable(input.payload, input.settings);
    rmSync(input.workDir, { recursive: true, force: true, maxRetries: 5 });
    mkdirSync(join(input.workDir, 'snap'), { recursive: true });
    writePayload(
        join(input.workDir, PAYLOAD_DIR),
        input.payload.map((entry) => ({ ...entry, path: `${PREFIX_DIR}/${entry.path}` })),
        '',
    );
    writeFileSync(join(input.workDir, 'snap', 'snapcraft.yaml'), encodeUtf8(renderSnapcraftYaml(input)));
}

/** Build the snap and leave it at `input.target`. */
export async function buildSnap(input: SnapPackInput): Promise<void> {
    writeSnapProject(input);
    const destructive = process.env[SNAP_DESTRUCTIVE_ENV] === '1';
    const stagedTarget = join(input.workDir, 'out.snap');
    const args = snapcraftArgs({ target: stagedTarget, archLabel: input.archLabel, destructive });
    if (input.verbose) console.log(`[gjsify ship] ${SNAP_TOOL} ${args.join(' ')}`);
    const result = await spawnToCompletion(SNAP_TOOL, args, {
        completion: 'return',
        cwd: input.workDir,
        stdio: 'inherit',
        notFound: () =>
            new Error(
                `gjsify ship: ${SNAP_TOOL} not found. Install it with \`sudo snap install snapcraft --classic\`.`,
            ),
    });
    if (result.code !== 0) {
        throw new Error(`gjsify ship: ${SNAP_TOOL} failed with ${describeExit(result)}.`);
    }
    // Built to a fixed name inside the work dir and moved, so a snapcraft that exits 0 without
    // writing the file fails HERE, and a stale `.snap` from a previous run cannot be mistaken
    // for this one (the work dir is wiped above).
    if (!existsSync(stagedTarget)) {
        throw new Error(`gjsify ship: ${SNAP_TOOL} exited 0 but wrote no snap at ${stagedTarget}.`);
    }
    renameSync(stagedTarget, input.target);
}
