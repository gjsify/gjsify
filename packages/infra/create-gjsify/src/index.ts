#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createProject, PACKAGE_MANAGERS, type PackageManager } from './create.js';
import { discoverTemplates } from './discover-templates.js';
import { promptTemplate } from './prompt-template.js';

const templates = discoverTemplates();
const templateChoices = templates.map((t) => t.name);

void yargs(hideBin(process.argv))
    .scriptName('@gjsify/create-app')
    .usage(
        '$0 [project-name]',
        'Create a new Gjsify project',
        (yargs) => {
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
                    describe: 'Install dependencies after scaffolding',
                    type: 'boolean',
                    default: false,
                })
                .option('package-manager', {
                    alias: 'p',
                    describe:
                        'Package manager to install with, and to name in the printed next steps. `gjsify` is the only one that works on a host with no Node.js.',
                    type: 'string',
                    choices: PACKAGE_MANAGERS,
                    default: 'npm' as PackageManager,
                });
        },
        async (argv) => {
            const projectName = argv['project-name'] as string;
            let template = argv['template'] as string | undefined;

            if (!template) {
                if (!process.stdin.isTTY) {
                    const list = templateChoices.join(', ');
                    console.error(
                        `Error: --template is required in non-interactive mode. Available templates: ${list || '(none)'}`,
                    );
                    // `return` — the deferred GJS exit otherwise fell through
                    // into the interactive template prompt on a non-TTY.
                    return process.exit(1);
                }
                const picked = await promptTemplate(templates);
                template = picked.name;
            }

            await createProject({
                projectName,
                template,
                force: argv['force'] as boolean,
                install: argv['install'] as boolean,
                packageManager: argv['package-manager'] as PackageManager,
            });
        },
    )
    .help().argv;

export {
    createProject,
    sanitizeProjectName,
    applicationIdFor,
    PACKAGE_MANAGERS,
    type CreateProjectOptions,
    type PackageManager,
} from './create.js';
export { discoverTemplates, findTemplate, type TemplateInfo } from './discover-templates.js';
