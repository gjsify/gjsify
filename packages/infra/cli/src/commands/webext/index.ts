// `gjsify webext` — yargs subcommand-group dispatcher (ADR 0077).
//
// Wires {build, zip, dev, listing, submit}; each is a self-contained `Command<>` in `subcommands.ts`,
// the same composition `flatpak/index.ts` uses.

import type { Command } from '../../types/index.js';
import {
    webextBuildCommand,
    webextDevCommand,
    webextListingCommand,
    webextSubmitCommand,
    webextZipCommand,
} from './subcommands.js';

export const webextCommand: Command = {
    command: 'webext <subcommand>',
    description:
        'Browser extensions: build, zip and develop one WebExtension for Chrome, Edge, Firefox, Opera and Safari.',
    builder: (yargs) =>
        yargs
            .command(
                webextBuildCommand.command as string,
                webextBuildCommand.description,
                webextBuildCommand.builder!,
                webextBuildCommand.handler!,
            )
            .command(
                webextZipCommand.command as string,
                webextZipCommand.description,
                webextZipCommand.builder!,
                webextZipCommand.handler!,
            )
            .command(
                webextDevCommand.command as string,
                webextDevCommand.description,
                webextDevCommand.builder!,
                webextDevCommand.handler!,
            )
            .command(
                webextListingCommand.command as string,
                webextListingCommand.description,
                webextListingCommand.builder!,
                webextListingCommand.handler!,
            )
            .command(
                webextSubmitCommand.command as string,
                webextSubmitCommand.description,
                webextSubmitCommand.builder!,
                webextSubmitCommand.handler!,
            )
            .demandCommand(1)
            .strict(),
};
