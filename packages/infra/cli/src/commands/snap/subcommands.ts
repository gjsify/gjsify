// `gjsify snap register|upload|status` — one self-contained Command each, composed in index.ts
// (the webext/subcommands.ts split). Building the .snap is `gjsify ship --target snap`.

import { resolve } from 'node:path';

import type { Command } from '../../types/index.js';
import {
    assertSnapCredentials,
    assertSnapFile,
    assertSnapNameForStore,
    parseChannels,
    runSnapcraft,
    snapRegisterArgs,
    snapStatusArgs,
    snapUploadArgs,
} from '../../utils/snap/store.js';

interface NameArgs {
    name?: string;
}

interface UploadArgs {
    file?: string;
    release: string[];
}

export const snapRegisterCommand: Command<unknown, NameArgs> = {
    command: 'register <name>',
    description: 'Claim a snap name in the Snap Store (snapcraft register). Needs an interactive `snapcraft login`.',
    builder: (yargs) => yargs.positional('name', { description: 'The store name.', type: 'string' }),
    handler: (args) => runSnapcraft('register', snapRegisterArgs(assertSnapNameForStore('register', args.name))),
};

export const snapUploadCommand: Command<unknown, UploadArgs> = {
    command: 'upload <file>',
    description: 'Upload a .snap to the Snap Store, optionally releasing it to channels (snapcraft upload).',
    builder: (yargs) =>
        yargs
            .positional('file', { description: 'The .snap that `gjsify ship --format snap` wrote.', type: 'string' })
            .option('release', {
                description: 'Release to these channels after the upload, e.g. edge or stable,candidate (repeatable).',
                type: 'string',
                array: true,
                default: [] as string[],
            })
            .epilog(
                'Credentials come from $SNAPCRAFT_STORE_CREDENTIALS only (create one with `snapcraft export-login`); ' +
                    'this command never reads or prints them.',
            ),
    handler: async (args) => {
        // Every refusal comes before snapcraft starts, so a typo costs no upload.
        const channels = parseChannels(args.release);
        const file = assertSnapFile(args.file === undefined ? undefined : resolve(process.cwd(), args.file));
        assertSnapCredentials(process.env);
        await runSnapcraft('upload', snapUploadArgs(file, channels));
    },
};

export const snapStatusCommand: Command<unknown, NameArgs> = {
    command: 'status <name>',
    description: 'Show the revisions and channels of a snap in the Snap Store (snapcraft status).',
    builder: (yargs) => yargs.positional('name', { description: 'The store name.', type: 'string' }),
    handler: (args) => runSnapcraft('status', snapStatusArgs(assertSnapNameForStore('status', args.name))),
};
