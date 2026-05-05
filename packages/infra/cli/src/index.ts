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
    dlxCommand as dlx,
    installCommand as install,
} from './commands/index.js'
import { APP_NAME } from './constants.js'

void yargs(hideBin(process.argv))
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
    .demandCommand(1)
    .help().argv
