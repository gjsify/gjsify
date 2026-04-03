#!/usr/bin/env node
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { buildCommand as build, runCommand as run, infoCommand as info, checkCommand as check, showcaseCommand as showcase } from './commands/index.js'
import { APP_NAME } from './constants.js'

void yargs(hideBin(process.argv))
    .scriptName(APP_NAME)
    .strict()
    // .usage(Config.usage)
    .command(build.command, build.description, build.builder, build.handler)
    .command(run.command, run.description, run.builder, run.handler)
    .command(info.command, info.description, info.builder, info.handler)
    .command(check.command, check.description, check.builder, check.handler)
    .command(showcase.command, showcase.description, showcase.builder, showcase.handler)
    .demandCommand(1)
    .help().argv
