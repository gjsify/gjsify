// `gjsify snap register|upload|status` — thin wrappers over `snapcraft` (ADR 0149).
//
// Not a second Snap Store client: the argument vectors are pure functions, the refusals come
// before the process starts, and the credential never passes through this code. snapcraft reads
// `SNAPCRAFT_STORE_CREDENTIALS` from the inherited environment itself; we only check that it is
// set, and no message below ever contains its value.

import { existsSync, statSync } from 'node:fs';

import { SNAP_TOOL, isSnapName } from '../ship/snap.js';
import { describeExit, spawnToCompletion } from '../spawn.js';

/** The one way in. A file in the tree would be one `git add` from a leaked store login. */
export const SNAP_CREDENTIALS_ENV = 'SNAPCRAFT_STORE_CREDENTIALS';

/** `stable`, `latest/edge`, `stable/hotfix`: track/risk/branch, each part lowercase. */
const CHANNEL = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){0,2}$/;

export function snapRegisterArgs(name: string): string[] {
    return ['register', name];
}

export function snapStatusArgs(name: string): string[] {
    return ['status', name];
}

/** `--release` takes the channels comma-separated, as one value. */
export function snapUploadArgs(file: string, releases: readonly string[]): string[] {
    const args = ['upload'];
    if (releases.length > 0) args.push(`--release=${releases.join(',')}`);
    args.push(file);
    return args;
}

/** Split `--release a,b` (repeatable) into channels; refuses what the store would. */
export function parseChannels(values: readonly string[]): string[] {
    const channels = values
        .flatMap((value) => value.split(','))
        .map((c) => c.trim())
        .filter((c) => c !== '');
    for (const channel of channels) {
        if (!CHANNEL.test(channel)) {
            throw new Error(`gjsify snap upload: "${channel}" is not a channel (e.g. stable, latest/edge).`);
        }
    }
    return channels;
}

export function assertSnapNameForStore(command: string, name: string | undefined): string {
    if (name === undefined || name === '') {
        throw new Error(`gjsify snap ${command}: pass the snap name (the store name, e.g. hello-app).`);
    }
    if (!isSnapName(name)) {
        throw new Error(
            `gjsify snap ${command}: "${name}" is not a snap name (lowercase letters, digits, single hyphens).`,
        );
    }
    return name;
}

export function assertSnapCredentials(env: NodeJS.ProcessEnv): void {
    if (env[SNAP_CREDENTIALS_ENV] === undefined || env[SNAP_CREDENTIALS_ENV] === '') {
        throw new Error(
            `gjsify snap upload: ${SNAP_CREDENTIALS_ENV} is not set. Create one with ` +
                `\`${SNAP_TOOL} export-login --snaps=<name> --acls=package_access,package_push,package_release -\` ` +
                'and pass it through the environment (a CI secret); it is never read from a file.',
        );
    }
}

export function assertSnapFile(file: string | undefined): string {
    if (file === undefined || file === '') throw new Error('gjsify snap upload: pass the .snap file.');
    if (!file.endsWith('.snap')) throw new Error(`gjsify snap upload: "${file}" is not a .snap file.`);
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`gjsify snap upload: no such file: ${file}.`);
    return file;
}

/** Run snapcraft with the terminal attached; a non-zero exit becomes the error. */
export async function runSnapcraft(command: string, args: readonly string[]): Promise<void> {
    const result = await spawnToCompletion(SNAP_TOOL, args, {
        completion: 'return',
        stdio: 'inherit',
        notFound: () =>
            new Error(
                `gjsify snap ${command}: ${SNAP_TOOL} not found. Install it with \`sudo snap install snapcraft --classic\`.`,
            ),
    });
    if (result.code !== 0) {
        throw new Error(`gjsify snap ${command}: ${SNAP_TOOL} failed with ${describeExit(result)}.`);
    }
}
