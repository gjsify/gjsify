import { createProject } from '@gjsify/create-app';
import type { Command } from '../types/index.js';

interface CreateOptions {
    'project-name': string;
}

export const createCommand: Command<any, CreateOptions> = {
    command: 'create [project-name]',
    description: 'Scaffold a new Gjsify project in a new directory.',
    builder: (yargs) => {
        return yargs.positional('project-name', {
            describe: 'Name of the project directory to create',
            type: 'string',
            default: 'my-gjs-app',
        });
    },
    handler: async (args) => {
        await createProject(args['project-name']);
    },
};
