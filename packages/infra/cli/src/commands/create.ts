import { createProject, discoverTemplates, PACKAGE_MANAGERS, supportedRuntimes } from '@gjsify/create-app';
import type { PackageManager } from '@gjsify/create-app';
import { isCancelled, promptSetup, promptTemplate } from '@gjsify/create-app/prompt';
import type { Command } from '../types/index.js';

interface CreateOptions {
    'project-name': string;
    template?: string;
    runtime?: string;
    'package-manager'?: PackageManager;
    force: boolean;
    install: boolean;
}

export const createCommand: Command<unknown, CreateOptions> = {
    command: 'create [project-name]',
    description: 'Scaffold a new Gjsify project in a new directory.',
    builder: (yargs) => {
        const templates = discoverTemplates();
        const templateChoices = templates.map((t) => t.name);
        // DERIVED from the shipped templates, never a hand-written list:
        // accepting `--runtime deno` is a claim that some template runs there,
        // and only the templates can make it.
        const runtimeChoices = [...new Set(templates.flatMap((t) => supportedRuntimes(t)))];
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
            .option('runtime', {
                alias: 'r',
                describe:
                    'Runtime to set the project up for. Decides which package managers are offered and which start script the next steps name.',
                type: 'string',
                choices: runtimeChoices.length > 0 ? runtimeChoices : undefined,
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
                    'Package manager to install with, and to name in the printed next steps. Must be one the chosen runtime can install for. `gjsify` is the only one that works on a host with no Node.js.',
                type: 'string',
                choices: PACKAGE_MANAGERS,
            });
    },
    handler: async (args) => {
        const interactive = Boolean(process.stdin.isTTY);
        const templates = discoverTemplates();
        let template = args.template;
        if (!template) {
            if (!interactive) {
                const list = templates.map((t) => t.name).join(', ');
                console.error(
                    `Error: --template is required in non-interactive mode. Available templates: ${list || '(none)'}`,
                );
                // `return` — the deferred GJS exit otherwise fell through into
                // the interactive template prompt on a non-TTY.
                return process.exit(1);
            }
            // Ctrl+C is an abort, not a crash.
            const picked = await promptTemplate(templates).catch((error: unknown) => {
                if (!isCancelled(error)) throw error;
                console.error('Cancelled.');
                return undefined;
            });
            if (picked === undefined) return process.exit(1);
            template = picked.name;
        }

        // The SAME decision layer `npm create @gjsify/app` runs, not a second
        // one. Wired late: this command used to pass neither runtime nor package
        // manager, so `createProject` fell back to the host runtime and the first
        // manager for it — meaning `gjsify create --install` on a Node host ran
        // `npm install` without ever saying so, the one default that reaches the
        // user's disk and the one the standalone bin refuses to guess.
        const info = templates.find((t) => t.name === template);
        const setup = await promptSetup({
            offered: info ? supportedRuntimes(info) : [],
            runtime: args.runtime,
            packageManager: args['package-manager'],
            install: args.install,
            interactive,
        });
        if (setup === undefined) return process.exit(1);

        await createProject({
            projectName: args['project-name'],
            template,
            runtime: setup.runtime,
            force: args.force,
            install: args.install,
            packageManager: setup.packageManager,
        });
    },
};
