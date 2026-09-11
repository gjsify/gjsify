// The AppImage packer — ADR 0024 § A24, issue JumpLink/Learn6502#93.
//
// ADR 0024 § 9 DEFERRED this format, and the deferral is what this module has to
// answer rather than quietly outlive. Its argument: an AppImage promises *one
// file, no install, any distro*, and that promise holds only if the file carries
// everything the target is not guaranteed to have — for a GJS application that is
// GTK4, libadwaita, GJS itself and the typelibs. No relocatable Linux closure
// exists (`packages/node-gi/gtk-runtime-*` covers darwin and win32 and
// deliberately not linux, because on Linux GTK has always come from the distro),
// so a file built today takes its runtime from the host. § 9 called that "a
// tarball with a launcher, wearing the name of something that promises more".
//
// WHAT CHANGED IS NOT THE CLOSURE, IT IS WHAT THE ARTIFACT SAYS ABOUT ITSELF.
// Two of the three promises hold with no closure at all — *no install* and *no
// root* — and they are the two a `.deb`, an `.rpm` and a Flatpak between them
// cannot make on a machine whose distro is not yours and whose sudo you do not
// have. The third is the one that would be a lie if it were silent, so it is not
// silent: {@link appImageHostRequirements} derives what the file does NOT carry
// from the same scan the `.deb` beside it derives its `Depends:` from, `ship`
// PRINTS it at pack time, and {@link renderAppRun} puts the interpreter half
// inside the artifact as a refusal that names the missing runtime before the app
// dies on its first import. The day `@gjsify/gtk-runtime-linux-<arch>` exists the
// list shrinks to nothing and nothing else here changes — which is exactly the
// shape § 9 said would unblock it.
//
// THE TOOL IS THE HOST'S, and that is the repository's existing line rather than
// a new one. `.deb` and `.rpm` are written by this tree because they are
// containers — a table of contents over bytes already in hand. An AppImage is an
// ELF runtime with a squashfs filesystem concatenated onto it, and a filesystem
// writer is what ADR 0024 § A6 rejects by name for the `.dmg`: a project rather
// than a target, every mistake silent. So `appimagetool` is required on PATH, the
// way `flatpak-builder` is for a Flatpak and WiX is for an `.msi` on Windows —
// including the part of that precedent that looks unattractive, since neither
// Fedora nor Debian packages `appimagetool` and the install hint has to name a
// GitHub release. VENDORING IT IS REFUSED for the reason ADR 0023 refuses a
// from-source GTK: a binary in this tree is this tree's to license, to update and
// to have audited, and appimagetool is GPL-3.0 while gjsify is MIT in 185
// manifests. DOWNLOADING THE TOOL AT PACK TIME is refused for a different one:
// every other packer here runs offline, and a pack step that fetches is a release
// step that fails when GitHub does. The tool fetches its RUNTIME on its own
// account, which nearly made that refusal untrue in practice — see the first
// measurement below, and the pin that answers it.
//
// MEASURED ON appimagetool 1.9.1 (build 296, 2025-12-04), because three of its
// behaviours decide this file and none of them are in its `--help`:
//
//   * IT FETCHES THE RUNTIME — it does NOT embed one, which the first draft of
//     this header recorded as measured and which is the opposite of what it does.
//     Re-measured on the version `.docker/ci-fedora.Dockerfile` pins (1.9.1, build
//     296, git 8c8c91f): every invocation prints `Downloading runtime file from
//     …/type2-runtime/releases/download/continuous/runtime-<arch>` BEFORE
//     "Embedding ELF…", for the host's own architecture as much as for a foreign
//     one, caching nothing — four consecutive packs, four downloads. With the
//     network blocked it exits 1 having written no file, naming `--runtime-file`.
//     So the ~940 KB of ELF a user DOWNLOADS AND EXECUTES came from a ROLLING tag
//     with no digest behind it while the Dockerfile pinned the tool that fetched
//     it by SHA-256 — a pin with a hole under it — and two packs of one build
//     agreed only because `continuous` had not moved between them. It moves:
//     `continuous`'s `runtime-x86_64` and the dated `20251108` release's are the
//     same 944632 bytes and different content.
//     SO THE RUNTIME IS PINNED TOO ({@link findPinnedRuntime},
//     {@link appImageToolArgs}) and an architecture without one is ANNOUNCED
//     rather than refused ({@link appImageRuntimeNotice}) — declare rather than
//     imply, the rule {@link appImageHostRequirements} already follows. Measured
//     with a pin: the pack succeeds with the network blocked and two packs are
//     byte-identical.
//   * IT CANNOT GUESS OUR ARCHITECTURE. appimagetool reads the AppDir's binaries
//     to decide, and a `--app gjs` payload is JavaScript and a `/bin/sh`
//     launcher: there is no ELF to read. `ARCH` in the environment is therefore
//     REQUIRED here, not a hint — see {@link appImageToolEnv}.
//   * IT IS REPRODUCIBLE, GIVEN mtimes. Two builds a second apart are
//     byte-identical (measured, sha256), and the squashfs superblock's creation
//     time is already pinned to epoch 0 — but `touch`ing the AppDir changes the
//     output, because mksquashfs stores per-file mtimes. `ship` promises
//     byte-identical artifacts from one build, so {@link stampAppDirTimes} sets
//     every path in the AppDir to the run's `mtime`, the same value `deb.ts`, `rpm.ts`
//     and `zip.ts` write into their own headers.
//
// FUSE IS THE CLASSIC TRAP AND IT IS TWO TRAPS, on opposite sides of the pack:
//
//   * BUILDING. `appimagetool` is itself distributed as an AppImage, so running
//     it mounts a squashfs through libfuse — which a CI container without
//     `/dev/fuse` cannot do, and the failure is `dlopen(): libfuse.so.2` or a
//     bare exit 1 rather than anything about FUSE. {@link appImageToolEnv} sets
//     `APPIMAGE_EXTRACT_AND_RUN=1` unconditionally: the AppImage runtime reads it
//     and extracts itself to a temp directory instead of mounting, and a native
//     `appimagetool` binary ignores an environment variable it does not read. So
//     the FUSE-less path is the DEFAULT here rather than something a CI author
//     has to know.
//   * RUNNING. The artifact this writes mounts itself the same way, so a user on
//     a FUSE-less host needs `--appimage-extract-and-run` (or
//     `--appimage-extract`). That is the runtime's own flag and nothing here can
//     remove it; what this file can do is make sure nobody reads the resulting
//     silence as a broken build, which is why {@link buildAppImage}'s failure
//     names FUSE and both escape hatches.

import { existsSync, utimesSync } from 'node:fs';
import { join, sep } from 'node:path';

import { describeExit, spawnToCompletion } from '../spawn.js';
import { encodeUtf8 } from './bytes.js';
import { DEFAULT_GJS_FLOOR, DEFAULT_NODE_FLOOR, hostProvidedNamespaces } from './depends.js';
import { LAYOUTS } from './layout.js';
import type { PayloadEntry } from './payload.js';
import { SHARE } from './share-dirs.js';
import type { PackSettings } from './types.js';

/** The tool this packer execs. One spelling, read by this module AND by the format row. */
export const APPIMAGE_TOOL = 'appimagetool';

/**
 * The environment variable the AppImage runtime reads to extract instead of mount.
 *
 * Named rather than inlined because two different programs read it for two
 * different reasons — `appimagetool` when this packer runs it, and the artifact
 * when a user runs that — and the spec asserts on the pair.
 */
export const EXTRACT_AND_RUN = 'APPIMAGE_EXTRACT_AND_RUN';

/**
 * Where a PINNED AppImage runtime is looked for, and the variable that moves it.
 *
 * THE RUNTIME IS THE HALF OF THE ARTIFACT THIS TREE DOES NOT WRITE, and until it
 * was pinned nothing pinned it: appimagetool fetches `runtime-<arch>` from
 * `type2-runtime`'s ROLLING `continuous` tag on every pack (module header), so
 * the ~940 KB of ELF a user downloads and executes arrived with no digest behind
 * it, while `.docker/ci-fedora.Dockerfile` carefully pinned the tool that fetched
 * it. Measured, and not a theoretical drift: `continuous`'s `runtime-x86_64` and
 * the dated `20251108` release's differ in content at the same 944632 bytes.
 *
 * A DIRECTORY AND AN ENVIRONMENT VARIABLE, rather than a download this packer
 * performs, because that is ADR 0024 § A25's rule applied one level down — a
 * pack step that fetches is a release step that fails when GitHub does. The CI
 * image puts a digest-checked file here; a workstation either does the same or
 * takes the announced path below. Arch-named, `runtime-<arch>`, which is
 * type2-runtime's own asset name, so pinning one is a copy and not a rename.
 */
export const APPIMAGE_RUNTIME_DIR_ENV = 'GJSIFY_APPIMAGE_RUNTIME_DIR';

/** The default home for {@link APPIMAGE_RUNTIME_DIR_ENV}, which the CI image fills. */
export const APPIMAGE_RUNTIME_DIR = '/usr/local/share/gjsify/appimage-runtime';

/** The directory name the AppImage specification gives the tree appimagetool packs. */
const APPDIR_NAME = 'AppDir';

/** The entry point the AppImage runtime execs inside the mounted image. */
const APPRUN_NAME = 'AppRun';

/**
 * The AppDir's thumbnail, and the reason this packer writes it rather than
 * letting appimagetool do it.
 *
 * MEASURED, AS A REPRODUCIBILITY DEFECT, and it is the kind only a byte
 * comparison finds: appimagetool creates `.DirIcon` as a SYMLINK to the root icon
 * when the AppDir does not already have one, and it does that AFTER
 * {@link stampAppDirTimes} has run — so the link carries the wall clock, the
 * AppDir root directory's own mtime moves with it, and mksquashfs stores both.
 * Two `gjsify ship --target appimage` runs over ONE build then differ in sha256
 * while every listing, mode, size and byte of content is identical (measured: 965
 * differing bytes, the first inside `.digest_md5`, because the embedded digest
 * follows the filesystem it covers). Four packs over the SAME AppDir are
 * byte-identical, which is what makes this a mutation of the tree rather than a
 * nondeterministic packer.
 *
 * A REGULAR FILE and not a symlink, for `dmg.ts`'s reason: `writePayload` writes
 * regular files and nothing else — a property `tests/e2e/ship` asserts, and one
 * `actions/upload-artifact` would silently dereference anyway. squashfs
 * deduplicates the second copy, so it costs an inode and no data.
 */
export const DIR_ICON_NAME = '.DirIcon';

/**
 * The one directory the staged prefix goes under inside the AppDir.
 *
 * Exported because `stampAppDirTimes` and the e2e reader both address paths
 * through it, and a second `'usr'` literal is the kind that stays right until
 * somebody changes the first one.
 */
export const APPDIR_PREFIX_DIR = 'usr';

/**
 * The extensions an AppDir root icon may have — a SET, deliberately not an order.
 *
 * Which of two candidates wins is `rootIconRank`'s question and is answered by
 * the hicolor CONTEXT, not by the file type; the first draft of this constant
 * claimed "PNG before SVG" and the code below ranks a scalable SVG above every
 * raster, so the comment described a preference nothing implemented. Both are
 * accepted because both are what a GNOME application ships: `.xpm` and `.svgz`,
 * which appimagetool also reads, are absent because `plan.ts` stages neither.
 */
const ICON_EXTENSIONS = ['.png', '.svg'] as const;

/**
 * Where the AppDir is assembled, under the run's own output root.
 *
 * A directory of its own, never `out/`, for the reason `dmgVolumeDir` gives one
 * format over: appimagetool packs everything it finds in the AppDir, so a stray
 * sibling would ride into the image and the reader that would catch it is the
 * same listing comparison that would then have to be relaxed to allow it.
 */
export function appDirFor(outRoot: string): string {
    return join(outRoot, 'appimage', APPDIR_NAME);
}

/**
 * What the AppImage does NOT carry, derived from the payload rather than authored.
 *
 * THE HONEST HALF OF ADR 0024 § 9, as data. The same scan that gives the `.deb`
 * its `Depends: gir1.2-gtk-4.0` gives this its `Gtk-4.0`, so the two artifacts
 * built from one payload cannot disagree about what the host has to provide —
 * and the AppImage's version is distro-NEUTRAL on purpose, because there is no
 * distribution to name package names in. A user reading `Gtk-4.0` can find it on
 * any system; a user reading `gir1.2-gtk-4.0` on Fedora cannot.
 *
 * The interpreter is first and always present: it is the requirement that is
 * never satisfied by accident, and the one {@link renderAppRun} can check from a
 * shell script.
 */
export function appImageHostRequirements(input: {
    app: PackSettings['app'];
    minGjsVersion?: string;
    minNodeVersion?: string;
    namespaces: readonly string[];
    bundledTypelibs?: readonly string[];
}): string[] {
    const floor = interpreterFloor(input);
    return [
        `${input.app} (>= ${floor})`,
        ...hostProvidedNamespaces(input.namespaces, input.bundledTypelibs).map((ns) => `the ${ns} typelib`),
    ];
}

/**
 * The version this payload's interpreter must be at least, as the project declared it.
 *
 * ONE DECISION, TWO READERS, which is why it is a function and not two ternaries:
 * {@link appImageHostRequirements} PRINTS this floor and {@link renderAppRun}
 * CHECKS it, and an artifact whose message names 1.86 while its script compares
 * against something else is worse than one that does neither.
 */
export function interpreterFloor(input: {
    app: PackSettings['app'];
    minGjsVersion?: string;
    minNodeVersion?: string;
}): string {
    return input.app === 'node'
        ? (input.minNodeVersion ?? DEFAULT_NODE_FLOOR)
        : (input.minGjsVersion ?? DEFAULT_GJS_FLOOR);
}

/**
 * The `AppRun` the AppImage runtime execs, and the one check it makes first.
 *
 * IT EXECS THE STAGED LAUNCHER AND ADDS NOTHING TO IT. `bin/<name>` already
 * resolves its own prefix — `readlink -f "$0"` then two `dirname`s
 * (`renderPrefixLauncher`) — and exports `XDG_DATA_DIRS`, `GI_TYPELIB_PATH`,
 * `GJSIFY_LOCALE_DIR` and `GJSIFY_FONT_DIR` relative to it. Inside a mounted
 * image that resolves to `/tmp/.mount_xxxx/usr`, measured, so every locator the
 * `.deb` sets up is already correct here. Re-exporting any of them from AppRun
 * would be a second answer to a question the payload answers, and the copy that
 * drifts is the one nothing tests: `tests/e2e/ship-layout` compares the staged
 * trees, not this script.
 *
 * WHAT IT DOES ADD is the refusal ADR 0024 § 9 asks for. An AppImage whose
 * interpreter is missing exits with the loader's own message — `gjs: not found`
 * from a shell, or nothing at all when a desktop launches it — and the user
 * concludes the download is broken. `command -v` costs one fork and turns that
 * into a sentence naming the runtime, this file's promise and the escape hatch.
 * The typelib half is deliberately NOT checked here: girepository's search path
 * is not a shell-visible thing, and GJS's own "Typelib file for namespace 'Gtk'
 * not found" is already precise. Listing them in the refusal is what this file
 * can honestly do — checking them would be a probe that guesses.
 *
 * AND THE FLOOR IS CHECKED, FAIL-OPEN, which is the one design decision in this
 * script. `command -v gjs` alone accepted GJS 1.70 while the message beside it
 * said `gjs (>= 1.86)` — a floor the `.deb` enforces through `Depends:` and this
 * artifact merely printed, so the failure it exists to prevent came back one
 * import later. The check costs the same fork `command -v` already cost.
 *
 * FAIL-OPEN IS THE POINT AND NOT A HEDGE. A version comparison in `/bin/sh` that
 * gets it wrong REFUSES A WORKING SYSTEM, which is strictly worse than not
 * checking: the user cannot argue with an artifact. So the refusal fires only on
 * two integers that were actually parsed out of the interpreter's own
 * `--version`, and every other outcome — no output, a spelling this `sed` does
 * not match, a distro build that prints something else entirely — RUNS THE
 * APPLICATION. `gjs --version` prints `gjs 1.88.1` and `node --version` prints
 * `v24.19.0`; both reduce to a major and a minor, and a floor with no minor
 * (`24`) compares as `24.0`.
 *
 * EXIT 126 AND NOT 127 for the too-old case, because the shell's own vocabulary
 * already separates them: 127 is "not found", 126 is "found and cannot be run".
 * A wrapper script that wants to tell the two apart can, and the message says
 * which it is either way.
 */
export function renderAppRun(settings: PackSettings, hostRequirements: readonly string[]): string {
    // `LAYOUTS.linux.dirs()` and not the literal `bin`: this path and the one
    // `place()` stages the launcher at are ONE decision, and a second spelling here
    // would break the day the layout map moves it — silently, because the AppDir
    // would still build and only the mounted image would 127.
    const launcherDir = LAYOUTS.linux.dirs(settings).launcher;
    const floor = interpreterFloor(settings);
    const [floorMajor = '0', floorMinor = '0'] = floor.split('.');
    return [
        '#!/bin/sh',
        '# Generated by `gjsify ship` — do not edit.',
        'set -e',
        'here=$(dirname "$(readlink -f "$0")")',
        `if ! command -v ${settings.app} >/dev/null 2>&1; then`,
        `    echo "${shellSafe(settings.name)} needs ${settings.app}, and this system has none." >&2`,
        '    echo "This AppImage carries the application, not its runtime. It needs:" >&2',
        ...hostRequirements.map((need) => `    echo "  - ${shellSafe(need)}" >&2`),
        '    exit 127',
        'fi',
        // The first `<major>.<minor>` anywhere in the interpreter's own version
        // output. `2>/dev/null` and `|| true` because `set -e` is on and an
        // interpreter that fails its own `--version` must not kill the launcher —
        // that is the fail-open path, reached before any comparison.
        `found=$(${settings.app} --version 2>/dev/null | sed -n 's/[^0-9]*\\([0-9][0-9]*\\)\\.\\([0-9][0-9]*\\).*/\\1 \\2/p' | head -n 1 || true)`,
        'major=${found% *}',
        'minor=${found#* }',
        // THE FAIL-OPEN GATE, and it is this ONE test because the `sed` above can
        // only ever emit two runs of digits or nothing at all — both captures are
        // `[0-9][0-9]*`. A `case "$major$minor" in ""|*[!0-9]*)` stood here first
        // and was deleted after the mutation that should have red it stayed green:
        // it guarded a state nothing can produce, which is a guard that cannot
        // fail. What DOES reach here is the empty parse, and that is what this
        // sees.
        'if [ -n "$major" ]; then',
        `    if [ "$major" -lt ${floorMajor} ] || { [ "$major" -eq ${floorMajor} ] && [ "$minor" -lt ${floorMinor} ]; }; then`,
        `        echo "${shellSafe(settings.name)} needs ${settings.app} ${floor} or newer, and this system has $major.$minor." >&2`,
        '        echo "This AppImage carries the application, not its runtime. It needs:" >&2',
        ...hostRequirements.map((need) => `        echo "  - ${shellSafe(need)}" >&2`),
        '        exit 126',
        '    fi',
        'fi',
        `exec "$here/usr/${launcherDir}/${settings.binaryName}" "$@"`,
        '',
    ].join('\n');
}

/**
 * A string that is safe between double quotes in `/bin/sh`.
 *
 * Narrow on purpose: the three characters the shell still expands inside double
 * quotes, plus the quote itself. `settings.name` is a display name a project
 * chose and `hostRequirements` is derived from GI namespaces, so neither is
 * hostile — but a name containing `$` would otherwise produce a message with a
 * variable expansion in it, and an AppRun is the one file here nobody reads
 * until it has already failed.
 */
function shellSafe(text: string): string {
    return text.replace(/(["$`\\])/g, '\\$1');
}

/**
 * The icon appimagetool needs at the AppDir root, chosen from the payload.
 *
 * AN APPIMAGE NEEDS TWO FILES THE PREFIX ALREADY HAS, AT A PLACE IT DOES NOT:
 * appimagetool refuses an AppDir without a `.desktop` at its root, and the file
 * named by that entry's `Icon=` must sit beside it. `plan.ts` stages both — the
 * entry at `share/applications/<appId>.desktop` and every icon renamed to
 * `<appId>` under `share/icons/hicolor/…` — so this function is a SELECTION over
 * the payload rather than anything new in the stage, which is ADR 0024 § 2's
 * "one payload, a handful of layouts" holding for a fourth format.
 *
 * LARGEST RASTER WINS, and the size comes from the hicolor directory rather than
 * from reading the file: `share/icons/hicolor/256x256/apps/<id>.png` says 256 in
 * its path, and a PNG header read would be a decoder this packer would then own.
 * `scalable` sorts above every raster size as the SVG fallback and `symbolic` is
 * excluded outright — its staged name is `<appId>-symbolic`, which is not what
 * the desktop entry's `Icon=` says, so shipping it as the root icon installs an
 * icon nothing ever looks up (`plan.ts` documents the same rule for the theme).
 */
/**
 * The pinned runtime for this architecture, or `undefined` when none is staged here.
 *
 * PURE APART FROM ONE INJECTED PROBE, so both answers are testable on a host that
 * has neither — the split {@link appImageToolArgs} draws for the flags. `exists`
 * is a parameter for exactly that reason and defaults to the real one.
 */
export function findPinnedRuntime(
    archLabel: string,
    env: NodeJS.ProcessEnv = process.env,
    exists: (path: string) => boolean = existsSync,
): string | undefined {
    const dir = env[APPIMAGE_RUNTIME_DIR_ENV] || APPIMAGE_RUNTIME_DIR;
    const file = join(dir, `runtime-${archLabel}`);
    return exists(file) ? file : undefined;
}

/**
 * What this pack is about to do about the runtime, as ONE sentence `ship` prints
 * unconditionally.
 *
 * DECLARE RATHER THAN IMPLY — {@link appImageHostRequirements}'s rule, applied to
 * the other half of the artifact. With a pin the claim is checkable: no network,
 * and two packs of one build agree because the embedded bytes are fixed. Without
 * one the pack still works and still produces a correct-architecture container —
 * so refusing would cost the three architectures nothing here pins, for a
 * property they never had. What it must not do is happen silently: an AppImage
 * built this way carries bytes from a rolling tag that nothing in this tree can
 * name, and the person who can fix that is the one reading this line.
 */
export function appImageRuntimeNotice(archLabel: string, runtimeFile: string | undefined): string {
    if (runtimeFile !== undefined) {
        return `the AppImage runtime is pinned: ${runtimeFile} — this pack needs no network`;
    }
    return (
        `NO pinned AppImage runtime for ${archLabel}: appimagetool will fetch runtime-${archLabel} from ` +
        "type2-runtime's rolling `continuous` tag, so this pack NEEDS A NETWORK and the ~940 KB of runtime " +
        `it embeds carries no digest from this tree. Pin one at ${APPIMAGE_RUNTIME_DIR}/runtime-${archLabel} ` +
        `(or point ${APPIMAGE_RUNTIME_DIR_ENV} at a directory holding it).`
    );
}

export function selectAppDirIcon(payload: readonly PayloadEntry[], appId: string): PayloadEntry | undefined {
    let best: { entry: PayloadEntry; rank: number } | undefined;
    for (const entry of payload) {
        const rank = rootIconRank(entry.path, appId);
        if (rank === undefined) continue;
        if (best === undefined || rank > best.rank) best = { entry, rank };
    }
    return best?.entry;
}

/**
 * How good a candidate a staged path is for the AppDir root icon, or `undefined`
 * when it is not a candidate at all.
 *
 * Scalable outranks every raster because an SVG is every size; among rasters the
 * pixel count decides. Both are ranks rather than a sort key so the caller stays
 * a single pass — and so the `undefined` arm is the ONLY place a path is
 * rejected, instead of a filter here and a guard there.
 */
function rootIconRank(path: string, appId: string): number | undefined {
    const extension = ICON_EXTENSIONS.find((candidate) => path.endsWith(`${appId}${candidate}`));
    if (extension === undefined) return undefined;
    if (!path.startsWith(`${SHARE.icons}/`)) return undefined;
    // `scalable` and `symbolic` are contexts, not sizes — and only the first is
    // wanted. `symbolic` cannot reach here anyway (its staged basename carries the
    // suffix, so the `endsWith` above misses it), and the explicit refusal stays
    // because the day a project names a plain icon `.../symbolic/apps/<id>.svg` is
    // the day the implicit version silently ships a 16px monochrome glyph as the
    // application's face.
    if (path.includes('/symbolic/')) return undefined;
    if (path.includes('/scalable/')) return Number.MAX_SAFE_INTEGER;
    const size = /\/(\d+)x\1\//.exec(path);
    return size === null ? 1 : Number(size[1]);
}

/**
 * Refuse a payload that cannot become an AppImage, naming the missing half.
 *
 * BEFORE appimagetool RATHER THAN THROUGH IT, and the two refusals it replaces
 * are why: a `kind: 'cli'` project stages no desktop entry at all, and
 * appimagetool answers that with `Desktop file not found, aborting` — true, and
 * about a file the author never wrote and cannot find. Same for the icon. Both
 * failures are decided by the project's OWN configuration (`gjsify.ship.kind`,
 * `gjsify.ship.icon`), so the message that helps is the one that names the key.
 *
 * Separate from `assertToolsInstalled` and `assertHostCanFinish` for the reason
 * those two are separate from each other (ADR 0024 § A3): three failures, three
 * different fixes — a different machine, a package, or a line in package.json.
 */
export function assertAppImageIsPackable(payload: readonly PayloadEntry[], settings: PackSettings): void {
    const desktopEntry = `${SHARE.applications}/${settings.appId}.desktop`;
    if (!payload.some((entry) => entry.path === desktopEntry)) {
        throw new Error(
            `gjsify ship: an AppImage needs a desktop entry and this payload has no ${desktopEntry}. ` +
                'appimagetool refuses an AppDir without one, and the AppImage runtime has nothing to tell a ' +
                'desktop about the application it just mounted. A `kind: "cli"` project stages no entry by ' +
                'design — set `gjsify.ship.kind` to "app" if this is a GUI application, or ship it as a `.deb`, ' +
                'an `.rpm` or a Flatpak, none of which need one.',
        );
    }
    if (selectAppDirIcon(payload, settings.appId) === undefined) {
        throw new Error(
            `gjsify ship: an AppImage needs an icon called ${settings.appId} beside its desktop entry, and ` +
                `this payload stages none under ${SHARE.icons}/. The entry's \`Icon=\` names the app id, so a ` +
                'file keeping its own basename is an icon nothing looks up — point `gjsify.ship.icon` at a PNG ' +
                'or an SVG and it is renamed into the theme for you.',
        );
    }
}

/**
 * The whole AppDir as one payload: the prefix under `usr/`, plus the three files
 * at its root.
 *
 * PURE, AND ONE LIST RATHER THAN A WRITER, which is the shape `msi.ts` and
 * `dmg.ts` already have — `packOne` owns the single `writePayload` call for every
 * format, and the packer module owns what goes in it. Two calls here would be two
 * wipes, and the second would not clean the first: an AppDir root still holding
 * the PREVIOUS app id's `.desktop` and icon is an AppDir appimagetool packs
 * without complaint, because it looks for *a* desktop file and finds two.
 *
 * `usr/` AND NOT THE APPDIR ROOT — that prefix is the whole layout difference
 * between this format and the `.deb` beside it, and it is why
 * `FormatDescriptor.prefix` can stay `/usr`. The staged launcher walks up two
 * directories from its own resolved path, so under a mount it computes
 * `<mount>/usr` and every locator it exports is already right. A payload written
 * at the root would make it compute the MOUNTPOINT, and the app would look for
 * its schemas one directory too high — at exit 0, until the first
 * `Gio.Settings.new()`.
 */
export function appDirPayload(
    settings: PackSettings,
    payload: readonly PayloadEntry[],
    hostRequirements: readonly string[],
): PayloadEntry[] {
    assertAppImageIsPackable(payload, settings);
    // Non-null by construction: the assertion above refuses a payload with
    // neither, and both reads are the SAME selection it made.
    const icon = selectAppDirIcon(payload, settings.appId) as PayloadEntry;
    const desktopPath = `${SHARE.applications}/${settings.appId}.desktop`;
    const desktop = payload.find((entry) => entry.path === desktopPath) as PayloadEntry;
    return [
        ...payload.map((entry) => ({ ...entry, path: `${APPDIR_PREFIX_DIR}/${entry.path}` })),
        { path: APPRUN_NAME, mode: 0o755, data: encodeUtf8(renderAppRun(settings, hostRequirements)) },
        // THE SAME BYTES, TWICE, and that is the AppImage specification rather
        // than a duplication to lift: the entry under `usr/share/applications` is
        // what a desktop reads after an install, and the copy at the AppDir root
        // is what appimagetool reads to name the image. Rendering it a second
        // time is what would drift; copying the staged bytes cannot.
        { path: `${settings.appId}.desktop`, mode: 0o644, data: desktop.data },
        { path: icon.path.slice(icon.path.lastIndexOf('/') + 1), mode: 0o644, data: icon.data },
        // THE THIRD COPY OF THE SAME BYTES, and the one that is here to keep
        // appimagetool from writing it — see {@link DIR_ICON_NAME}.
        { path: DIR_ICON_NAME, mode: 0o644, data: icon.data },
    ];
}

/**
 * The argument vector, as data.
 *
 * Pure, so every flag is unit-testable on a host with no `appimagetool` — the
 * same split `hdiutilCreateArgs` draws for `hdiutil` and `renderShipFlatpakManifest`
 * for `flatpak-builder`: what the tool is TOLD is checkable everywhere, what the
 * tool DOES needs the tool.
 *
 * `--no-appstream` IS A DECISION AND NOT A DEFAULT. appimagetool otherwise runs
 * `appstreamcli validate-tree` over the AppDir, which would make the pack succeed
 * or fail depending on whether a package unrelated to packaging is installed —
 * green on a workstation with `appstream` and red in a container without it, over
 * a payload that is byte-identical. A validator whose presence changes the
 * outcome is the class this repository calls green-CI-that-checked-nothing, read
 * backwards. The MetaInfo is still validated, by the tool that exists for it:
 * `gjsify flatpak check --appstream` runs `appstreamcli validate --strict` on
 * demand, where a missing `appstreamcli` is the point of the command rather than
 * a surprise inside another one.
 *
 * `--comp zstd` is pinned for `hdiutilCreateArgs`' reason one format over: it is
 * 1.9.1's current default, and a default is a thing that changes. The reader the
 * oracle leg runs is `unsquashfs` from squashfs-tools, which needs its zstd
 * support compiled in — measured present on Fedora 44 (4.6.1) and on
 * ubuntu-24.04's 4.6.1. Pinning means the day appimagetool switches to something
 * newer, this file changes and the reader is considered, instead of the reader
 * silently losing the ability to open what we ship.
 *
 * `--runtime-file` IS PASSED WHEN THERE IS ONE TO PASS, and its absence is the
 * only thing in this vector that is not a decision — see
 * {@link findPinnedRuntime}. With it, the pack embeds bytes this tree pinned and
 * needs no network (measured: the whole pack succeeds with the network blocked,
 * and two packs are byte-identical). Without it appimagetool fetches its own, the
 * pack is announced as doing so, and the artifact is still correct — just built
 * from something nothing here can name.
 */
export function appImageToolArgs(input: { appDir: string; target: string; runtimeFile?: string }): string[] {
    return [
        '--no-appstream',
        '--comp',
        'zstd',
        ...(input.runtimeFile === undefined ? [] : ['--runtime-file', input.runtimeFile]),
        input.appDir,
        input.target,
    ];
}

/**
 * The environment appimagetool is run with — both entries REQUIRED, neither a hint.
 *
 * `ARCH` because appimagetool derives the architecture from the ELF binaries it
 * finds in the AppDir, and a `--app gjs` payload has none: it is JavaScript and a
 * `/bin/sh` launcher. Without this the tool exits 1 with "Could not determine
 * architecture automatically", on a payload that is perfectly fine. The value is
 * the format row's `archName`, so the architecture inside the file and the one in
 * its name are one decision.
 *
 * `APPIMAGE_EXTRACT_AND_RUN` because appimagetool is itself an AppImage and
 * mounts itself through libfuse to start — see the module header. Set
 * unconditionally: a native `appimagetool` build ignores it, so there is no host
 * for which this is wrong and no flag for a CI author to discover.
 */
export function appImageToolEnv(archLabel: string): Record<string, string> {
    return { ARCH: archLabel, [EXTRACT_AND_RUN]: '1' };
}

/**
 * What a non-zero `appimagetool` exit is, in the order a host actually hits them.
 *
 * PURE, so the one message a user reads at the worst moment is assertable without
 * a container — the same split {@link appImageToolArgs} draws. It was inline until
 * the list was found to be missing its FIRST entry, which is the shape a message
 * that nothing reads back tends to have.
 *
 * THE FIRST CAUSE DEPENDS ON WHETHER A RUNTIME WAS PINNED, and getting that
 * wrong is what this function existed to fix in the first place: with no pin the
 * download is where an offline host fails (measured — exit 1, no file, `Failed to
 * download runtime file`), and with one there is no download to fail, so naming
 * it would send a reader with a working network to debug their firewall. So the
 * pinned branch names the pinned FILE instead, which is the thing that is new in
 * that configuration and the only one this tree chose.
 */
export function appImageToolFailureMessage(exit: string, runtimeFile?: string): string {
    const first =
        runtimeFile === undefined
            ? 'the AppImage RUNTIME could not be downloaded — ' +
              `${APPIMAGE_TOOL} fetches it from github.com/AppImage/type2-runtime when no runtime is pinned, ` +
              'so this pack needs a network and an offline host fails here having written nothing; or '
            : `the pinned runtime at ${runtimeFile} is not an AppImage runtime — it is passed through to ` +
              '`--runtime-file` unread, so a truncated or wrong-architecture file fails here; or ';
    return (
        `gjsify ship: ${APPIMAGE_TOOL} failed with ${exit}. ` +
        `Four causes, measured in this order: ${first}` +
        '`file` is not installed — ' +
        `${APPIMAGE_TOOL} requires file(1) and says so, even though this pack already tells it the ` +
        'architecture; or FUSE is unavailable and the tool on PATH is a wrapper that dropped ' +
        `${EXTRACT_AND_RUN}=1, which this pack sets so the extract path is taken instead of a mount; ` +
        'or the work directory is full — the AppDir is copied into a squashfs image beside it.'
    );
}

export interface AppImagePackInput {
    appDir: string;
    target: string;
    archLabel: string;
    verbose: boolean;
    /** The pinned runtime to embed, or `undefined` to let appimagetool fetch one. */
    runtimeFile?: string;
    /** Working root, so the log can name the directory that became the image. */
    workDir: string;
}

/**
 * Run appimagetool over the AppDir.
 *
 * THE FAILURE PATHS ARE THE POINT. A packer that execs a foreign tool inherits
 * that tool's silence, and appimagetool's container failures were MEASURED on
 * `fedora:44` rather than guessed. Without `APPIMAGE_EXTRACT_AND_RUN=1` it exits
 * **127** pointing at the AppImageKit FUSE wiki — which is why
 * {@link appImageToolEnv} sets that variable and this branch should never see it.
 * Without `file(1)` it exits **1** with "file command is missing but required",
 * EVEN with `ARCH` set, which is the failure a minimal image really hits and
 * which says nothing about packaging. And without a network it exits **1** having
 * written nothing, because the runtime is fetched rather than embedded — see the
 * module header. {@link appImageToolFailureMessage} names all four.
 *
 * AND THE ARTIFACT IS VERIFIED TO EXIST. appimagetool prints "Success" and a
 * request to submit to AppImageHub; it does not guarantee the destination was
 * written, and a packer whose contract is "there is a file at `target`" must not
 * hand `statSync` a path that is not there and report the ENOENT as a `ship` bug.
 */
export async function buildAppImage(input: AppImagePackInput): Promise<void> {
    const args = appImageToolArgs(input);
    const env = appImageToolEnv(input.archLabel);
    if (input.verbose) {
        console.log(
            `[gjsify ship] ${Object.entries(env)
                .map(([key, value]) => `${key}=${value}`)
                .join(' ')} ${APPIMAGE_TOOL} ${args.join(' ')}`,
        );
    }
    // `completion: 'return'`, matching the Flatpak and `.dmg` packers: `ship` packs
    // the remaining formats and prints the artifact list afterwards, so it cannot
    // end in `process.exit()`.
    const result = await spawnToCompletion(APPIMAGE_TOOL, args, {
        completion: 'return',
        cwd: input.workDir,
        stdio: 'inherit',
        env: { ...process.env, ...env },
        notFound: () =>
            new Error(
                `gjsify ship: ${APPIMAGE_TOOL} is not on PATH. Unlike flatpak-builder and msitools it is not ` +
                    'packaged by Fedora or Debian: take the release from ' +
                    'https://github.com/AppImage/appimagetool/releases, `chmod +x` it and put it on PATH as ' +
                    `\`${APPIMAGE_TOOL}\`. \`gjsify ship linux --stage\` needs none of this — the payload is ` +
                    'assembled by this CLI and only the container needs the tool.',
            ),
    });
    if (result.code !== 0) {
        throw new Error(appImageToolFailureMessage(describeExit(result), input.runtimeFile));
    }
    if (!existsSync(input.target)) {
        throw new Error(
            `gjsify ship: ${APPIMAGE_TOOL} exited 0 and wrote no file at ${input.target}. ` +
                'An exit code is not an artifact — re-run with `--verbose` to see what it was told.',
        );
    }
}

/**
 * Every path an AppDir holding this payload has, files and the directories above
 * them, deepest LAST.
 *
 * Pure and separate from the stamping, so the "which paths" half is testable with
 * no filesystem at all — and so the answer comes from the payload rather than
 * from a directory walk, which would read back whatever the writer happened to
 * leave rather than what it was told to write.
 */
export function appDirPaths(payload: readonly PayloadEntry[]): string[] {
    const directories = new Set<string>();
    for (const entry of payload) {
        const parts = entry.path.split('/');
        for (let depth = 1; depth < parts.length; depth++) directories.add(parts.slice(0, depth).join('/'));
    }
    return [...[...directories].sort(), ...payload.map((entry) => entry.path)];
}

/**
 * Give every path in the AppDir one mtime.
 *
 * See the module header: this is the single difference between two packs of one
 * build, measured by sha256. `utimesSync` on a directory is legal and is where a
 * squashfs directory inode's time comes from, so directories are stamped as well
 * — `writePayload`'s `mkdir` gives them the wall clock and nothing else would
 * take it away.
 */
export function stampAppDirTimes(appDir: string, payload: readonly PayloadEntry[], mtime: number): void {
    for (const rel of appDirPaths(payload)) {
        utimesSync(join(appDir, rel.split('/').join(sep)), mtime, mtime);
    }
    utimesSync(appDir, mtime, mtime);
}
