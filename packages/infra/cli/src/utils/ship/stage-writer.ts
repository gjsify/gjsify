// Writing the planned payload to disk, and reading it back for the packers.
//
// The round trip is the point. `gjsify ship --stage` writes `stage/`; a packer
// then reads `stage/` (plus the format's `overlay/`) rather than the planner's
// in-memory list, so "what the user inspected" and "what got packed" cannot
// diverge. It also makes the staged tree a legitimate deliverable on its own —
// which is what a Flatpak module's `cp -a stage/.` will consume once Flatpak
// moves under `ship` (ADR 0024 § 8).

import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { listFilesRecursive } from './discover.js';
import type { PayloadEntry } from './payload.js';
import type { StagedFile } from './types.js';

/**
 * Materialise a planned tree under `root`, replacing whatever was there.
 *
 * The directory is wiped first: a stale file from a previous run is otherwise
 * indistinguishable from a staged one, and would be packed.
 */
export function writeStage(root: string, files: readonly StagedFile[]): void {
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
 * Read a staged tree back as a payload.
 *
 * Modes come from the PLAN, not from `stat()`: a checked-out tree can carry
 * whatever umask the build host had, and an executable bit that survives on
 * one machine and not another is exactly the kind of difference that ships.
 */
export function readStage(roots: readonly string[], files: readonly StagedFile[]): PayloadEntry[] {
    const modes = new Map(files.map((file) => [file.path, file.mode]));
    const byPath = new Map<string, PayloadEntry>();
    for (const root of roots) {
        for (const rel of listFilesRecursive(root)) {
            byPath.set(rel, {
                path: rel,
                mode: modes.get(rel) ?? 0o644,
                data: new Uint8Array(readFileSync(join(root, rel.split('/').join(sep)))),
            });
        }
    }
    return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
