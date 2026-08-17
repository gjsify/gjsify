#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createProject, supportedRuntimes } from './create.js';
import { discoverTemplates, type TemplateInfo } from './discover-templates.js';
import { isCancelled, promptSetup, promptTemplate } from './prompt-template.js';
import { PACKAGE_MANAGERS, type PackageManager } from './runtimes.js';

const templates = discoverTemplates();
const templateChoices = templates.map((t) => t.name);

/**
 * The `--runtime` values this build can actually serve: every runtime any shipped
 * template declares, in first-declaration order.
 *
 * DERIVED, never a second copy of the CLI's `EXAMPLE_RUNTIMES`. Accepting
 * `--runtime deno` is a claim that some template runs there, and the templates
 * are the only thing that can make that claim.
 */
const runtimeChoices = [...new Set(templates.flatMap((t) => supportedRuntimes(t)))];

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
        async (argv) => {
            const projectName = argv['project-name'] as string;
            const interactive = Boolean(process.stdin.isTTY);
            let template = argv['template'] as string | undefined;

            if (!template) {
                if (!interactive) {
                    const list = templateChoices.join(', ');
                    console.error(
                        `Error: --template is required in non-interactive mode. Available templates: ${list || '(none)'}`,
                    );
                    // `return` — the deferred GJS exit otherwise fell through
                    // into the interactive template prompt on a non-TTY.
                    return process.exit(1);
                }
                // Ctrl+C here is an abort, not a crash. Without the guard the
                // rejection escapes into yargs, which answers it with a stack
                // trace and the whole `--help`.
                const picked = await promptTemplate(templates).catch((error: unknown) => {
                    if (!isCancelled(error)) throw error;
                    console.error('Cancelled.');
                    return undefined;
                });
                if (picked === undefined) return process.exit(1);
                template = picked.name;
            }

            const info = templates.find((t) => t.name === template) as TemplateInfo | undefined;

            const setup = await promptSetup({
                offered: info ? supportedRuntimes(info) : [],
                runtime: argv['runtime'] as string | undefined,
                packageManager: argv['package-manager'] as PackageManager | undefined,
                install: argv['install'] as boolean,
                interactive,
            });
            if (setup === undefined) return process.exit(1);

            await createProject({
                projectName,
                template,
                runtime: setup.runtime,
                force: argv['force'] as boolean,
                install: argv['install'] as boolean,
                packageManager: setup.packageManager,
            });
        },
    )
    .help().argv;

export {
    createProject,
    sanitizeProjectName,
    applicationIdFor,
    supportedRuntimes,
    PACKAGE_MANAGERS,
    RUNTIME_PACKAGE_MANAGERS,
    packageManagersForRuntime,
    isKnownRuntime,
    hostRuntime,
    defaultRuntimeFor,
    runScriptCommand,
    startScriptFor,
    type CreateProjectOptions,
    type PackageManager,
} from './create.js';
export { selectRuntime, selectPackageManager, type Selection } from './select.js';
export { discoverTemplates, findTemplate, type TemplateInfo } from './discover-templates.js';
