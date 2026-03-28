#!/usr/bin/env node
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { createProject } from './create.js'

void yargs(hideBin(process.argv))
    .scriptName('create-gjsify')
    .usage('$0 [project-name]', 'Create a new Gjsify project', (yargs) => {
        return yargs.positional('project-name', {
            describe: 'Name of the project directory to create',
            type: 'string',
            default: 'my-gjs-app'
        })
    }, async (argv) => {
        const projectName = argv['project-name'] as string
        await createProject(projectName)
    })
    .help()
    .argv
