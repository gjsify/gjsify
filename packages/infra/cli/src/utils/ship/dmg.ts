// The `.dmg` packer — ADR 0024 § A1/§ A6, issue #1354 M4.
//
// THE FIRST FORMAT THAT IS HOST-BOUND IN THE `HostRequirement` SENSE, and the
// distinction ADR 0024 § A3 drew between its two refusals is what this row is
// the first subject of. A Flatpak is `finishOn: ['linux']` because flatpak runs
// on Linux — the format is bound the way the application is. A `.dmg` is bound
// by the CONTAINER: it is a UDIF image over a real HFS+/APFS volume, no
// HFS+/APFS writer exists anywhere in this tree, and `hdiutil` is macOS-only.
// So `assertHostCanFinish` refuses it off darwin and `assertToolsInstalled`
// names `hdiutil` on a darwin host that somehow lacks it — two failures with
// two different fixes, which is exactly why they are two functions.
//
// A HAND-WRITTEN UDIF WRITER STAYS REJECTED (§ A6), in that section's own
// words: 1200-2000 lines against a whole existing packer surface of ~1243, and
// every mistake silent, because the Finder mounts the image and shows an empty
// window. What we would buy is an independent reader, and 7-Zip already
// advertises `Dmg`, `HFS` and `APFS` handlers regardless of who wrote the file.
//
// WHICH MAKES THE ORACLE THE INTERESTING PART, because `hdiutil verify` is
// `hdiutil` reading what `hdiutil` wrote. The reader is a chain that runs on
// LINUX — `7z l` (7-Zip 23.01 on ubuntu-24.04 carries `Dmg`, `HFS` and `APFS`),
// then `dmg2img` to a raw volume, then `fsck.hfsplus -f -n` over it — driven by
// `.github/ship-oracle/verify-dmg.py` and compared against the stage manifest.
// Three implementations, none of them Apple's and none of them ours.
//
// TWO hdiutil FLAGS ARE DECISIONS AND NOT DEFAULTS:
//
//   * `-fs HFS+J`. APFS is what a modern `hdiutil` reaches for when nothing says
//     otherwise, and the whole Linux reader chain above is an HFS+ chain —
//     `dmg2img` writes a raw volume and `fsck.hfsplus` is an HFS+ fsck. An APFS
//     image would leave 7-Zip's handler as the only reader, i.e. one reader for
//     the negative control to fool. Journaling costs a read-only image nothing
//     and `fsck.hfsplus` reads it: measured on ubuntu-24.04 / hfsprogs
//     540.1.linux3-5build3 against a `mkfs.hfsplus -J` volume, "** Checking
//     Journaled HFS Plus volume … appears to be OK", exit 0.
//   * `-format UDZO`, i.e. zlib. The alternatives are ULFO (LZFSE) and ULMO
//     (LZMA), and the reader that would have to decode them is the OLD one:
//     ubuntu-24.04 ships 7-Zip 23.01, not this workstation's 26.02. zlib is the
//     method its `Dmg` handler has read since long before either.
//
// WHAT THIS PACKER DOES NOT PUT IN THE VOLUME: an `/Applications` symlink, the
// drag-here convention. `writePayload` writes regular files and nothing else —
// which is a property `tests/e2e/ship` and the `ship-stage` job both assert, and
// a symlink is also what `actions/upload-artifact` silently dereferences. The
// artifact is still draggable out of the mounted volume; what it lacks is the
// arrow. Unblocker: a staged-symlink concept with a reader that can see one, at
// which point the link and its oracle land together.

import { join } from 'node:path';

import { describeExit, spawnToCompletion } from '../spawn.js';
import type { PackSettings } from './types.js';

/** The tool this packer execs. One spelling, read by this module AND by the format row. */
export const DMG_TOOL = 'hdiutil';

/**
 * Characters an HFS+ volume name may not contain.
 *
 * The same pair `layout.ts` refuses in a bundle DIRECTORY name and for the same
 * measured reason: `/` is the POSIX separator and `:` is HFS+'s, and the Finder
 * shows a stored `:` as a `/` and vice versa. A volume called `Ship/Demo` mounts
 * as `Ship:Demo`, so the name a user is told to look for is not the name they
 * see. `\` is not in this set — it is a perfectly ordinary character on HFS+,
 * and `windowsProgramDirName` is where it is forbidden, for Windows' reasons.
 */
const VOLUME_NAME_FORBIDDEN = /[/:]/;

/**
 * What the mounted image is called in the Finder's sidebar.
 *
 * The DISPLAY name, like the `.app` inside it — the volume and the bundle are
 * the two things a user reads during the one interaction this format has, and
 * spelling them differently (`Ship Demo.app` inside `ship-demo-1.2.3`) makes the
 * window look like somebody else's download. The FILE keeps the versioned,
 * space-free name, because that one lands in a downloads folder beside others;
 * `FormatDescriptor.fileName` is where that split lives, exactly as it does for
 * the `.app` and its zip.
 *
 * EMPTY IS REFUSED, and it is not defensive: `resolveShipSettings` derives the
 * name as `metadata.name ?? titleCase(binaryName)` and `??` passes `''` straight
 * through — the same hole `windowsProgramDirName` documents. `hdiutil` answers an
 * empty `-volname` by calling the volume `untitled`, at exit 0, so the image
 * would build and mount under a name nothing in the project ever chose.
 */
export function dmgVolumeName(settings: PackSettings): string {
    const name = settings.name;
    if (name.trim() === '') {
        throw new Error(
            'gjsify ship: the macOS image has no name to call its volume — `gjsify.ship.name` (or the ' +
                'package name it is derived from) is empty. `hdiutil` would accept that and mount the ' +
                'image as `untitled`, which is the name every nameless disk image on the machine has.',
        );
    }
    if (VOLUME_NAME_FORBIDDEN.test(name)) {
        throw new Error(
            `gjsify ship: the macOS image would mount a volume called "${name}", and HFS+ cannot hold it: ` +
                'the Finder shows a stored ":" as a "/" and a stored "/" as a ":", so the volume would not ' +
                'be the one this project named. Set `gjsify.ship.name` to the display name you want.',
        );
    }
    return name;
}

export interface DmgCreateInput {
    /** The volume label — see {@link dmgVolumeName}. */
    volumeName: string;
    /** The directory whose CONTENTS become the volume root; it holds `<App>.app` and nothing else. */
    sourceDir: string;
    /** Absolute path the finished `.dmg` is written to. */
    target: string;
}

/**
 * The exact `hdiutil` invocation, as data.
 *
 * Pure, so every flag is unit-testable from Linux — which is the only kind of
 * host this project's contributors and its `e2e` job have. Same split as
 * `renderShipFlatpakManifest`: what the tool is TOLD is checkable everywhere,
 * what the tool DOES is checkable on the one OS that has it, and the two are not
 * the same test.
 *
 * `-srcfolder` and not `-srcdevice`/`-size`: the folder's contents become the
 * volume root, so `hdiutil` sizes the image itself. Passing a `-size` instead is
 * how a `.dmg` build starts failing on the day the payload grows past a number
 * somebody typed once.
 */
export function hdiutilCreateArgs(input: DmgCreateInput): string[] {
    return [
        'create',
        // Read-only + zlib. See the header: the alternatives are decodable only
        // by a newer 7-Zip than the reader leg has.
        '-format',
        'UDZO',
        // HFS+ EXPLICITLY, because the default is the thing the reader chain
        // cannot read. See the header.
        '-fs',
        'HFS+J',
        '-volname',
        input.volumeName,
        '-srcfolder',
        input.sourceDir,
        // hdiutil REFUSES an existing target rather than replacing it, and
        // `packOne` writes into `out/` which a previous run may have filled. The
        // failure without this is a pack that dies on its second invocation only.
        '-ov',
        // Progress on a TTY is a spinner; in a CI log it is thousands of lines.
        '-quiet',
        input.target,
    ];
}

export interface DmgPackInput extends DmgCreateInput {
    settings: PackSettings;
    verbose: boolean;
    /** Working root, so the log can name the directory that became the volume. */
    workDir: string;
}

/**
 * Build the image at `input.target`.
 *
 * The second packer in this tree that execs anything, and — unlike the Flatpak
 * one — the tool cannot be installed where it is missing: `hdiutil` ships with
 * macOS and exists nowhere else. So the `notFound` branch does not say "install
 * it"; it says which host this belongs on and how the payload gets there, which
 * is the same two-phase sentence `assertHostCanFinish` prints one step earlier.
 * Reaching this branch at all means `process.platform` said darwin and `hdiutil`
 * was still absent, so the honest advice is "this macOS installation is broken",
 * not a package name.
 */
export async function buildDmgImage(input: DmgPackInput): Promise<void> {
    const args = hdiutilCreateArgs(input);
    if (input.verbose) console.log(`[gjsify ship] ${DMG_TOOL} ${args.join(' ')}`);
    // `completion: 'return'`, matching the Flatpak packer: `ship` packs the
    // remaining formats and prints the artifact list afterwards, so it cannot end
    // in `process.exit()`. Under GJS that selects the blocking path, which
    // captures the child's output and re-emits it — the documented cost of a
    // spawn a caller has to return from (`utils/spawn.ts`), and why `--verbose`
    // prints the invocation before the silence starts.
    const result = await spawnToCompletion(DMG_TOOL, args, {
        completion: 'return',
        cwd: input.workDir,
        stdio: 'inherit',
        notFound: () =>
            new Error(
                `gjsify ship: ${DMG_TOOL} is not on PATH. It ships with macOS and cannot be installed ` +
                    'anywhere else, so this is either a broken macOS installation or a host that is not ' +
                    'macOS at all. A `.dmg` is packed on darwin (ADR 0024 § A1); from anywhere else the ' +
                    'route is `gjsify ship darwin --stage` here and `gjsify ship --from-stage <dir> ' +
                    '--target macos-app-dmg` there.',
            ),
    });
    if (result.code !== 0) {
        throw new Error(`gjsify ship: ${DMG_TOOL} failed with ${describeExit(result)}.`);
    }
}

/**
 * Where the volume is assembled before `hdiutil` turns it into an image.
 *
 * A directory of its own under the run's output root, never `out/` itself: the
 * volume root holds the `.app` and NOTHING ELSE, because `-srcfolder` copies
 * whatever it finds — a stray sibling would ride into the image, and the reader
 * that would catch it is the same listing comparison that would then have to be
 * relaxed to allow it.
 */
export function dmgVolumeDir(outRoot: string): string {
    return join(outRoot, 'dmg', 'volume');
}
