// `gjsify blueprint` — yargs subcommand-group dispatcher, the same shape as `flatpak/`.
//
// A directory rather than one file because `check-website-cli-reference.mjs` reads every
// `command:` in a top-level file as a top-level command; a group's subcommands live beside
// its `index.ts` and are documented as `#### gjsify blueprint <sub>`.

import type { Command } from '../../types/index.js';
import { blueprintTypesCommand } from './types.js';

export { blueprintTypesCommand };

export const blueprintCommand: Command = {
    command: 'blueprint <subcommand>',
    description: 'Blueprint (.blp) tooling: generate the TypeScript type sidecars a .blp exports (ADR 0088).',
    builder: (yargs) =>
        yargs
            .command(
                blueprintTypesCommand.command as string,
                blueprintTypesCommand.description,
                blueprintTypesCommand.builder!,
                blueprintTypesCommand.handler!,
            )
            .demandCommand(1)
            .strict(),
};
