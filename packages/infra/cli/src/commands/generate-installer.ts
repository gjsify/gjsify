// `gjsify generate-installer [target]` — scaffold an `install.mjs` for any
// GJS-runnable npm package, modeled on gjsify's own installer.
//
// The generated `install.mjs` is a verbatim copy of gjsify's root `install.mjs`
// with three constants substituted:
//
//   DEFAULT_TARGET      → the consumer's npm package name
//   DEFAULT_BIN_NAME    → the consumer's bin name (key of `gjsify.bin` or `bin`)
//   DEFAULT_BOOTSTRAP_URL → URL of a gjsify `cli.gjs.mjs` bootstrap bundle
//
// End-user workflow:
//   cd my-gjs-app
//   gjsify generate-installer
//   git add install.mjs && git commit
//   # README:
//   #   curl -fsSL https://github.com/me/my-gjs-app/raw/main/install.mjs \
//   #     -o /tmp/i.mjs && gjs -m /tmp/i.mjs && rm /tmp/i.mjs
//
// The template is read at build time (static-read-inliner inlines the file
// contents into the bundled CLI), so the runtime cost is just a string
// replace + write.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from '../types/index.js';

interface GenerateInstallerOptions {
    target?: string;
    'bin-name'?: string;
    'bootstrap-url'?: string;
    output: string;
    force: boolean;
}

// Lazy load. Reading at the top level breaks `gjsify run copy-templates`
// (the bootstrap step that ships the template into `lib/templates/` after
// `tsc`): the run script must first import this module to dispatch into
// itself, which would then ENOENT on the not-yet-copied template file.
// The static-read-inliner can still detect this shape inside the handler.
function loadInstallerTemplate(): string {
    return readFileSync(
        new URL('../templates/install.mjs.tmpl', import.meta.url),
        'utf-8',
    );
}

const DEFAULT_BOOTSTRAP_URL =
    'https://github.com/gjsify/gjsify/releases/latest/download/cli.gjs.mjs';

export const generateInstallerCommand: Command<any, GenerateInstallerOptions> = {
    command: 'generate-installer [target]',
    description:
        'Scaffold an install.mjs in the current directory for a GJS-runnable npm package.',
    builder: (yargs) =>
        yargs
            .positional('target', {
                description:
                    'Npm package name to install (default: current package.json name).',
                type: 'string',
            })
            .option('bin-name', {
                description:
                    'Bin name produced by the installer (default: first key of `gjsify.bin` or `bin`).',
                type: 'string',
            })
            .option('bootstrap-url', {
                description:
                    'Override the cli.gjs.mjs bootstrap bundle URL (default: gjsify GitHub releases/latest).',
                type: 'string',
            })
            .option('output', {
                description: 'Where to write the generated installer.',
                type: 'string',
                default: 'install.mjs',
            })
            .option('force', {
                description: 'Overwrite an existing output file.',
                type: 'boolean',
                default: false,
            }) as any,
    handler: (args: GenerateInstallerOptions) => {
        const outputPath = resolve(process.cwd(), args.output);
        if (existsSync(outputPath) && !args.force) {
            console.error(`${args.output} already exists. Re-run with --force to overwrite.`);
            process.exit(1);
            return;
        }

        const pkgJsonPath = resolve(process.cwd(), 'package.json');
        let pkgJson: Record<string, unknown> | null = null;
        if (existsSync(pkgJsonPath)) {
            try {
                pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
            } catch {
                /* no pkg.json or unparsable — fall back to flags */
            }
        }

        const target = args.target ?? (pkgJson?.name as string | undefined);
        if (!target) {
            console.error(
                'No target package: pass `gjsify generate-installer <pkg>` or run inside a directory with a package.json.',
            );
            process.exit(1);
            return;
        }

        const binName = args['bin-name'] ?? pickDefaultBinName(pkgJson, target);
        const bootstrapUrl = args['bootstrap-url'] ?? DEFAULT_BOOTSTRAP_URL;

        const rendered = loadInstallerTemplate()
            .replace(
                /const DEFAULT_TARGET = '[^']+';/,
                `const DEFAULT_TARGET = ${JSON.stringify(target)};`,
            )
            .replace(
                /const DEFAULT_BIN_NAME = '[^']+';/,
                `const DEFAULT_BIN_NAME = ${JSON.stringify(binName)};`,
            )
            .replace(
                /const DEFAULT_BOOTSTRAP_URL =\s*'[^']+';/,
                `const DEFAULT_BOOTSTRAP_URL = ${JSON.stringify(bootstrapUrl)};`,
            );

        writeFileSync(outputPath, rendered, { mode: 0o755 });
        console.log(`Wrote ${args.output} (target=${target}, bin=${binName}).`);
        console.log('');
        console.log('Install one-liner for your README:');
        console.log(
            `  curl -fsSL https://github.com/<you>/<repo>/raw/main/${args.output} -o /tmp/i.mjs \\`,
        );
        console.log('    && gjs -m /tmp/i.mjs && rm /tmp/i.mjs');
    },
};

function pickDefaultBinName(pkgJson: Record<string, unknown> | null, target: string): string {
    const gjsifyBin = (pkgJson?.gjsify as { bin?: Record<string, string> } | undefined)?.bin;
    if (gjsifyBin && typeof gjsifyBin === 'object') {
        const first = Object.keys(gjsifyBin)[0];
        if (first) return first;
    }
    const npmBin = pkgJson?.bin;
    if (npmBin && typeof npmBin === 'object') {
        const first = Object.keys(npmBin as Record<string, string>)[0];
        if (first) return first;
    }
    if (typeof npmBin === 'string') {
        return target.startsWith('@') ? target.slice(target.indexOf('/') + 1) : target;
    }
    return target.startsWith('@') ? target.slice(target.indexOf('/') + 1) : target;
}
