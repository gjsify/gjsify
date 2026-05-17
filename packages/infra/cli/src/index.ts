#!/usr/bin/env node
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import {
    buildCommand as build,
    runCommand as run,
    infoCommand as info,
    checkCommand as check,
    showcaseCommand as showcase,
    createCommand as create,
    gresourceCommand as gresource,
    gettextCommand as gettext,
    gsettingsCommand as gsettings,
    flatpakCommand as flatpak,
    dlxCommand as dlx,
    installCommand as install,
    foreachCommand as foreach,
    workspaceCommand as workspace,
    packCommand as pack,
    publishCommand as publish,
    selfUpdateCommand as selfUpdate,
    generateInstallerCommand as generateInstaller,
} from './commands/index.js'
import { APP_NAME } from './constants.js'

// `parseAsync()` instead of `.argv` so the top-level await keeps the
// process alive until command handlers complete. Under Node this is
// cosmetic — the event loop holds the process up — but under GJS the
// script ends as soon as the top-level synchronous flow finishes, and
// fire-and-forget handlers silently exit before any async work runs.
await yargs(hideBin(process.argv))
    .scriptName(APP_NAME)
    .strict()
    .command(create.command, create.description, create.builder, create.handler)
    .command(install.command, install.description, install.builder, install.handler)
    .command(build.command, build.description, build.builder, build.handler)
    .command(run.command, run.description, run.builder, run.handler)
    .command(dlx.command, dlx.description, dlx.builder, dlx.handler)
    .command(info.command, info.description, info.builder, info.handler)
    .command(check.command, check.description, check.builder, check.handler)
    .command(showcase.command, showcase.description, showcase.builder, showcase.handler)
    .command(gresource.command, gresource.description, gresource.builder, gresource.handler)
    .command(gettext.command, gettext.description, gettext.builder, gettext.handler)
    .command(gsettings.command, gsettings.description, gsettings.builder, gsettings.handler)
    .command(flatpak.command, flatpak.description, flatpak.builder, flatpak.handler)
    .command(foreach.command, foreach.description, foreach.builder, foreach.handler)
    .command(workspace.command, workspace.description, workspace.builder, workspace.handler)
    .command(pack.command, pack.description, pack.builder, pack.handler)
    .command(publish.command, publish.description, publish.builder, publish.handler)
    .command(selfUpdate.command, selfUpdate.description, selfUpdate.builder, selfUpdate.handler)
    .command(generateInstaller.command, generateInstaller.description, generateInstaller.builder, generateInstaller.handler)
    .demandCommand(1)
    .help()
    .parseAsync()
