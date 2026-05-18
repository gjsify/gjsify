// `gjsify flatpak` — yargs subcommand-group dispatcher.
//
// Wires {init, build, deps, ci, check}. Each subcommand is a self-contained
// `Command<>` so it composes the same way as `gresource` / `gettext` /
// `gsettings` at the top level.

import type { Command } from '../../types/index.js';
import { flatpakInitCommand } from './init.js';
import { flatpakBuildCommand } from './build.js';
import { flatpakDepsCommand } from './deps.js';
import { flatpakCiCommand } from './ci.js';
import { flatpakCheckCommand } from './check.js';

export const flatpakCommand: Command = {
    command: 'flatpak <subcommand>',
    description:
        'Flatpak toolchain: init/build/deps/ci/check subcommands for shipping GJS apps and CLIs as Flatpaks.',
    builder: (yargs) => {
        return yargs
            .command(
                flatpakInitCommand.command as string,
                flatpakInitCommand.description,
                flatpakInitCommand.builder!,
                flatpakInitCommand.handler!,
            )
            .command(
                flatpakBuildCommand.command as string,
                flatpakBuildCommand.description,
                flatpakBuildCommand.builder!,
                flatpakBuildCommand.handler!,
            )
            .command(
                flatpakDepsCommand.command as string,
                flatpakDepsCommand.description,
                flatpakDepsCommand.builder!,
                flatpakDepsCommand.handler!,
            )
            .command(
                flatpakCiCommand.command as string,
                flatpakCiCommand.description,
                flatpakCiCommand.builder!,
                flatpakCiCommand.handler!,
            )
            .command(
                flatpakCheckCommand.command as string,
                flatpakCheckCommand.description,
                flatpakCheckCommand.builder!,
                flatpakCheckCommand.handler!,
            )
            .demandCommand(1)
            .strict();
    },
};

export {
    flatpakInitCommand,
    flatpakBuildCommand,
    flatpakDepsCommand,
    flatpakCiCommand,
    flatpakCheckCommand,
};
