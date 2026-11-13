// A deterministic `.tar.gz` of the Linux payload, in-tree, execing nothing.
//
// Same argument as the hand-written `.deb` and `.rpm` (ADR 0024 § A3): a format
// this tree writes itself needs no tool on the packing host, which keeps GNU
// `tar` an independent reader. Backs `linux-tar` and `linux-tar-flatpak` (ADR 0142).

import { posix } from 'node:path';

import { createTarball, type TarWriteEntry } from '@gjsify/tar';

import { gzipDeterministic } from './gzip.js';
import type { PayloadEntry } from './payload.js';
import type { PackSettings } from './types.js';

/** The single top directory: `<binaryName>-<version>-linux-<arch>`. */
export function tarballTopDir(settings: PackSettings, archLabel: string): string {
    return `${settings.binaryName}-${settings.version}-linux-${archLabel}`;
}

/**
 * Refuse a payload that carries what a release archive must never hold.
 *
 * The payload is the staged closure, so these are guards against a stage that
 * grew something nobody meant to publish — a `.env`, a `.git`, a log — rather
 * than checks a normal build trips. `node_modules` is legitimate exactly when
 * the app runs on Node and the stage copied its closure; for `--app gjs` there
 * is no reason for one to exist.
 */
export function assertTarballHygiene(payload: readonly PayloadEntry[], settings: PackSettings): void {
    const problems: string[] = [];
    for (const entry of payload) {
        const segments = entry.path.split('/');
        const base = segments[segments.length - 1] as string;
        if (base === '.env' || base.startsWith('.env.')) problems.push(`${entry.path} (environment file)`);
        else if (segments.includes('.git')) problems.push(`${entry.path} (version-control data)`);
        else if (base.endsWith('.log')) problems.push(`${entry.path} (log file)`);
        else if (segments.includes('node_modules') && settings.app !== 'node')
            problems.push(`${entry.path} (node_modules in a non-Node payload)`);
    }
    if (problems.length === 0) return;
    throw new Error(
        `gjsify ship: refusing to pack a tarball that would contain ${problems.slice(0, 5).join(', ')}` +
            `${problems.length > 5 ? ` and ${problems.length - 5} more` : ''}.`,
    );
}

/**
 * The archive: one directory entry per ancestor, then the payload, all under
 * {@link tarballTopDir}. The file list is the payload's and nothing else — the
 * stage's own sidecar was never payload.
 */
export async function buildLinuxTarball(input: {
    settings: PackSettings;
    payload: readonly PayloadEntry[];
    archLabel: string;
    mtime: number;
}): Promise<Uint8Array> {
    assertTarballHygiene(input.payload, input.settings);
    const top = tarballTopDir(input.settings, input.archLabel);

    const directories = new Set<string>([`${top}/`]);
    for (const entry of input.payload) {
        const dir = posix.dirname(entry.path);
        const parts = dir === '.' ? [] : dir.split('/');
        let current = top;
        for (const part of parts) {
            current = `${current}/${part}`;
            directories.add(`${current}/`);
        }
    }

    const entries: TarWriteEntry[] = [
        ...[...directories]
            .sort()
            .map((name) => ({ name, mode: 0o755, mtime: input.mtime, directory: true as const })),
        ...input.payload.map((entry) => ({
            name: `${top}/${entry.path}`,
            body: entry.data,
            mode: entry.mode,
            mtime: input.mtime,
        })),
    ];
    return gzipDeterministic(createTarball(entries));
}
