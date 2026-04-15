#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createProject } from './create.js';
import { discoverTemplates } from './discover-templates.js';
import { promptTemplate } from './prompt-template.js';

const templates = discoverTemplates();
const templateChoices = templates.map((t) => t.name);

void yargs(hideBin(process.argv))
    .scriptName('@gjsify/create-app')
    .usage('$0 [project-name]', 'Create a new Gjsify project', (yargs) => {
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
            });
    }, async (argv) => {
        const projectName = argv['project-name'] as string;
        let template = argv['template'] as string | undefined;

        if (!template) {
            if (!process.stdin.isTTY) {
                const list = templateChoices.join(', ');
                console.error(
                    `Error: --template is required in non-interactive mode. Available templates: ${list || '(none)'}`,
                );
                process.exit(1);
            }
            const picked = await promptTemplate(templates);
            template = picked.name;
        }

        await createProject({ projectName, template });
    })
    .help()
    .argv;

export { createProject, type CreateProjectOptions } from './create.js';
export { discoverTemplates, findTemplate, type TemplateInfo } from './discover-templates.js';
