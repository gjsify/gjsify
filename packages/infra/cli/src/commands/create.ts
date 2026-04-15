import { createProject, discoverTemplates } from '@gjsify/create-app';
import { promptTemplate } from '@gjsify/create-app/prompt';
import type { Command } from '../types/index.js';

interface CreateOptions {
    'project-name': string;
    template?: string;
    force: boolean;
    install: boolean;
}

export const createCommand: Command<any, CreateOptions> = {
    command: 'create [project-name]',
    description: 'Scaffold a new Gjsify project in a new directory.',
    builder: (yargs) => {
        const templates = discoverTemplates();
        const templateChoices = templates.map((t) => t.name);
        return yargs
            .positional('project-name', {
                describe: 'Name of the project directory to create',
                type: 'string',
                default: 'my-gjs-app',
            })
            .option('template', {
                alias: 't',
                describe: 'Template to scaffold from',
                type: 'string',
                choices: templateChoices.length > 0 ? templateChoices : undefined,
            })
            .option('force', {
                alias: 'f',
                describe: 'Scaffold into a non-empty directory',
                type: 'boolean',
                default: false,
            })
            .option('install', {
                describe: 'Run npm install after scaffolding',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        let template = args.template;
        if (!template) {
            const templates = discoverTemplates();
            if (!process.stdin.isTTY) {
                const list = templates.map((t) => t.name).join(', ');
                console.error(
                    `Error: --template is required in non-interactive mode. Available templates: ${list || '(none)'}`,
                );
                process.exit(1);
            }
            const picked = await promptTemplate(templates);
            template = picked.name;
        }
        await createProject({
            projectName: args['project-name'],
            template,
            force: args.force,
            install: args.install,
        });
    },
};
