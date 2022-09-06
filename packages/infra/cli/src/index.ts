#!/usr/bin/env node
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { buildCommand as build } from './commands/index.js'
import { APP_NAME } from './constants.js'

void yargs(hideBin(process.argv))
    .scriptName(APP_NAME)
    .strict()
    // .usage(Config.usage)
    .command(build.command, build.description, build.builder, build.handler)
    .demandCommand(1)
    .help().argv
