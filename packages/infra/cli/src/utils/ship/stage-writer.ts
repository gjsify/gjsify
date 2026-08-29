// Writing the planned payload to disk, and reading it back for the packers.
//
// The round trip is the point. `gjsify ship --stage` writes `stage/`; a packer
// then reads `stage/` (plus the format's `overlay/`) rather than the planner's
// in-memory list, so "what the user inspected" and "what got packed" cannot
// diverge. It also makes the staged tree a legitimate deliverable on its own —
// which is what a Flatpak module's `cp -a stage/.` will consume once Flatpak
// moves under `ship` (ADR 0024 § 8), and what `gjsify ship --from-stage` packs
// on a host that has the tree and nothing else (ADR 0024 § A2).
//
// That second consumer is why {@link readStage} refuses rather than defaults.
// A stage now arrives from another machine, so "the tree and the plan disagree"
// stopped being impossible and became a transfer failure — and every way of
// papering over it produces an artifact that installs.

import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { listFilesRecursive } from './discover.js';
import type { PayloadEntry } from './payload.js';
import { STAGE_MANIFEST_FILE } from './stage-manifest.js';
import type { StagedFile, StagePlanEntry } from './types.js';

/**
 * Materialise a planned tree under `root`, replacing whatever was there.
 *
 * The directory is wiped first: a stale file from a previous run is otherwise
 * indistinguishable from a staged one, and would be packed.
 *
 * NEVER call this on a stage that ARRIVED — the wipe is unconditional, so
 * pointing it at a downloaded stage deletes the payload it was about to pack.
 * `gjsify ship --from-stage` writes only the format's own `overlay/` directory
 * for that reason.
 */
export function writeStage(root: string, files: readonly StagedFile[]): void {
    for (const file of files) {
        // The stage root carries exactly one file that is not payload, and this
        // is its name. A planned file with the same path (reachable through
        // `gjsify.ship.extraFiles`) would shadow the manifest: the tree would
        // then either pack the manifest as payload or lose the closure that
        // makes the tree packable somewhere else.
        if (file.path === STAGE_MANIFEST_FILE) {
            throw new Error(
                `gjsify ship: a payload file may not be called \`${STAGE_MANIFEST_FILE}\` — that name belongs ` +
                    'to the stage manifest, which sits at the stage root beside the payload and carries what ' +
                    'the packing host needs (ADR 0024 § A2). Rename the `gjsify.ship.extraFiles` destination.',
            );
        }
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    mkdirSync(root, { recursive: true });
    for (const file of files) {
        const target = join(root, file.path.split('/').join(sep));
        mkdirSync(dirname(target), { recursive: true });
        const data =
            file.source.kind === 'text' ? new TextEncoder().encode(file.source.text) : readFileSync(file.source.path);
        writeFileSync(target, data);
        chmodSync(target, file.mode);
    }
}

/**
 * Read a staged tree back as a payload, and refuse a tree that is not the
 * planned one.
 *
 * Modes come from the PLAN, not from `stat()`: a checked-out tree can carry
 * whatever umask the build host had, and an executable bit that survives on
 * one machine and not another is exactly the kind of difference that ships.
 * A CI artifact is the sharpest case — `actions/upload-artifact` stores no
 * POSIX mode at all, so a stage that made the trip has 0644 on its launcher
 * and the plan is the only surviving record that it should be 0755.
 *
 * That same trip is why a disagreement is now an error in BOTH directions:
 *
 *  - a path in the tree the plan does not name used to be packed at `?? 0o644`.
 *    That default is a guess about a file nobody planned; if it is a program it
 *    installs unrunnable, and the package is otherwise perfect.
 *  - a path in the plan the tree does not hold used to be silently absent from
 *    the payload. `.deb` and `.rpm` both accept that happily and the result is
 *    a package that installs and cannot start — this project's most expensive
 *    failure class.
 *
 * `bytes` is compared when the plan carries it (i.e. when the plan came from a
 * stage manifest). It catches the truncated transfer that the file-set check
 * cannot see: a half-written upload leaves every path in place. It is a SIZE
 * and not a digest on purpose — ADR 0024 § A4 measured that the darwin finish
 * leg has to re-sign all 106 Mach-O images inside the stage, so a per-file
 * sha256 would have to be relaxed to exempt them and would then be checking
 * nothing.
 */
export function readStage(roots: readonly string[], plan: readonly StagePlanEntry[]): PayloadEntry[] {
    const planned = new Map(plan.map((entry) => [entry.path, entry]));
    const byPath = new Map<string, PayloadEntry>();
    for (const root of roots) {
        for (const rel of listFilesRecursive(root)) {
            if (rel === STAGE_MANIFEST_FILE) continue;
            const entry = planned.get(rel);
            if (entry === undefined) {
                throw new Error(
                    `gjsify ship: ${join(root, rel.split('/').join(sep))} is in the stage and not in its ` +
                        'manifest, so nothing knows what mode to give it. Every payload file takes its mode ' +
                        'from the plan, never from the filesystem, so a file that arrived some other way would ' +
                        'be packed 0644 — unrunnable if it is a program. Remove it, or add it through ' +
                        '`gjsify.ship.extraFiles` and re-run the `--stage` phase.',
                );
            }
            const data = new Uint8Array(readFileSync(join(root, rel.split('/').join(sep))));
            if (entry.bytes !== undefined && entry.bytes !== data.byteLength) {
                throw new Error(
                    `gjsify ship: ${rel} is ${data.byteLength} bytes in the stage and ${entry.bytes} in its ` +
                        'manifest. The stage arrived truncated or was edited after it was assembled. ' +
                        'Re-upload it, or re-run the `--stage` phase.',
                );
            }
            byPath.set(rel, { path: rel, mode: entry.mode, data });
        }
    }
    const missing = plan.filter((entry) => !byPath.has(entry.path)).map((entry) => entry.path);
    if (missing.length > 0) {
        throw new Error(
            `gjsify ship: the stage manifest lists ${missing.length} file(s) the stage does not contain: ` +
                `${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}. ` +
                'A payload has to be complete before it is packed — both formats would pack the rest without ' +
                'complaint and install a package that cannot start. Re-run the `--stage` phase, and check that ' +
                'whatever moved the stage between hosts copied every file (an artifact upload that drops empty ' +
                'files or dotfiles is the usual cause).',
        );
    }
    return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Materialise a PAYLOAD — bytes already in hand — under `root`, replacing it.
 *
 * The twin of {@link writeStage}, and the difference is what each takes.
 * `writeStage` writes a PLAN, whose sources are paths on the assembling host or
 * strings; this writes what {@link readStage} handed back, which is the only shape
 * available on a host that has the stage and nothing else.
 *
 * It exists for the one artifact in `FORMATS` that is a DIRECTORY: a `<App>.app`
 * is not a container around the payload, it IS the payload plus the format's own
 * overlay, laid out on disk. Writing it through this function rather than by
 * copying the stage directory keeps the same two properties every other packer
 * has — the modes come from the plan (`readStage` has already applied them, and
 * the artifact upload that flattens them cannot reach in between), and the
 * stage's own `.gjsify-ship-stage.json` stays out, because it was never in the
 * payload.
 *
 * `root` is WIPED first, exactly as `writeStage` wipes: a `.app` left over from a
 * previous run with a file the current payload no longer names would otherwise be
 * signed, zipped and shipped.
 *
 * `stripPrefix` is what makes it the ARTIFACT rather than a directory holding
 * one, and leaving it out produced exactly that: every staged darwin path already
 * begins with `<App>.app/` — that is what `Layout.root` means — so writing them
 * verbatim under an artifact called `<App>.app` gave
 * `out/Ship Demo.app/Ship Demo.app/Contents/…`. The Finder shows the outer
 * directory as a plain folder, so the failure is a bundle that is not one, and it
 * is invisible to every reader that walks the tree looking for `Contents/`.
 * Measured on the WIP this replaces; the discriminator is the depth assertion in
 * `tests/e2e/ship-macos`.
 *
 * A path OUTSIDE `stripPrefix` throws rather than being written somewhere near
 * the artifact. The alternative — pass it through — would put a file beside the
 * bundle instead of inside it, which is the shape ADR 0024 § A4 records
 * `codesign` refusing, and it would be silent.
 */
export function writePayload(root: string, payload: readonly PayloadEntry[], stripPrefix: string): void {
    // `''` means "the payload is already artifact-relative"; anything else is a
    // directory name and gets its separator here rather than at three call sites.
    const strip = stripPrefix === '' ? '' : `${stripPrefix}/`;
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    mkdirSync(root, { recursive: true });
    for (const entry of payload) {
        if (!entry.path.startsWith(strip)) {
            throw new Error(
                `gjsify ship: ${entry.path} is outside ${stripPrefix || 'the artifact'}, which this artifact ` +
                    'IS — so there is nowhere inside it for the file to go. A payload file that escaped the ' +
                    'bundle would ship beside it, unsigned and unfound.',
            );
        }
        const target = join(root, entry.path.slice(strip.length).split('/').join(sep));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, entry.data);
        chmodSync(target, entry.mode);
    }
}

/**
 * Total bytes of the regular files under `root`.
 *
 * What `packOne` reports for a `FormatDescriptor.artifactKind: 'directory'`.
 * `statSync` on a directory answers the directory ENTRY's size — 4096 on ext4 —
 * so a `.app` carrying a 20 MiB bundle would be printed as "4096 bytes", which is
 * not a rounding error but a different number. Directory entries themselves are
 * deliberately not counted: what a user wants to know is how much payload they
 * are about to move.
 */
export function directorySize(root: string): number {
    let total = 0;
    for (const rel of listFilesRecursive(root)) total += statSync(join(root, rel.split('/').join(sep))).size;
    return total;
}
