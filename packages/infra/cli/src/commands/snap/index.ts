// `gjsify snap` — Snap Store helpers (ADR 0149), the `gjsify webext` shape (ADR 0148):
// a yargs subcommand group over `snapcraft`.

import type { Command } from '../../types/index.js';
import { snapRegisterCommand, snapStatusCommand, snapUploadCommand } from './subcommands.js';

export const snapCommand: Command = {
    command: 'snap <subcommand>',
    description: 'Snap Store helpers: register a name, upload a .snap, show channel status.',
    builder: (yargs) =>
        yargs
            .command(
                snapRegisterCommand.command as string,
                snapRegisterCommand.description,
                snapRegisterCommand.builder!,
                snapRegisterCommand.handler!,
            )
            .command(
                snapUploadCommand.command as string,
                snapUploadCommand.description,
                snapUploadCommand.builder!,
                snapUploadCommand.handler!,
            )
            .command(
                snapStatusCommand.command as string,
                snapStatusCommand.description,
                snapStatusCommand.builder!,
                snapStatusCommand.handler!,
            )
            .demandCommand(1)
            .strict(),
};
