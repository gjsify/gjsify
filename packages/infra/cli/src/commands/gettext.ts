import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Command } from '../types/index.js';

const execFileAsync = promisify(execFile);

type GettextFormat = 'mo' | 'xml' | 'desktop' | 'json';

interface GettextOptions {
    poDir: string;
    outDir: string;
    domain: string;
    format?: GettextFormat;
    metainfo?: string;
    filename?: string;
    removeXmlComments?: boolean;
    verbose?: boolean;
}

async function listLanguages(poDir: string): Promise<string[]> {
    const entries = await readdir(poDir);
    return entries
        .filter((name) => name.endsWith('.po') && !name.startsWith('.'))
        .map((name) => name.slice(0, -3))
        .sort();
}

function stripXmlComments(source: string): string {
    return source.replace(/<!--[\s\S]*?-->/g, '');
}

async function ensureDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

async function compileBulkXml(opts: {
    poDir: string;
    outDir: string;
    domain: string;
    template: string;
    filename: string;
    removeXmlComments: boolean;
    verbose: boolean;
}): Promise<void> {
    const outputFile = join(opts.outDir, opts.filename);
    await ensureDir(opts.outDir);

    const args = [
        `--output-file=${outputFile}`,
        '--xml',
        `--template=${opts.template}`,
        '-d',
        opts.poDir,
    ];

    if (opts.verbose) {
        console.log(`[gjsify gettext] msgfmt ${args.join(' ')}`);
    }

    await execFileAsync('msgfmt', args);

    if (opts.removeXmlComments) {
        const content = await readFile(outputFile, 'utf-8');
        await writeFile(outputFile, stripXmlComments(content));
    }

    if (opts.verbose) {
        console.log(`[gjsify gettext] wrote ${outputFile}`);
    }
}

async function compilePerLanguage(opts: {
    poDir: string;
    outDir: string;
    domain: string;
    format: GettextFormat;
    filename: string;
    verbose: boolean;
}): Promise<void> {
    const languages = await listLanguages(opts.poDir);
    if (languages.length === 0) {
        console.warn(`[gjsify gettext] no .po files found in ${opts.poDir}`);
        return;
    }

    for (const lang of languages) {
        const poFile = join(opts.poDir, `${lang}.po`);
        const langDir =
            opts.format === 'mo'
                ? join(opts.outDir, lang, 'LC_MESSAGES')
                : join(opts.outDir, lang);
        await ensureDir(langDir);
        const outputFile = join(langDir, opts.filename);

        // msgfmt produces the binary .mo format by default — there is no
        // `--mo` flag (only --xml, --desktop, --properties-output, ...).
        const args = [`--output-file=${outputFile}`];
        if (opts.format !== 'mo') {
            args.push(`--${opts.format}`);
        }
        args.push(poFile);

        if (opts.verbose) {
            console.log(`[gjsify gettext] msgfmt ${args.join(' ')}`);
        }

        await execFileAsync('msgfmt', args);
    }

    if (opts.verbose) {
        console.log(
            `[gjsify gettext] compiled ${languages.length} language(s) into ${opts.outDir}`,
        );
    }
}

function defaultFilename(domain: string, format: GettextFormat, metainfoTemplate?: string): string {
    switch (format) {
        case 'mo':
            return `${domain}.mo`;
        case 'json':
            return `${domain}.json`;
        case 'desktop':
            return `${domain}.desktop`;
        case 'xml': {
            // Mirror the template filename but without the trailing `.in` (convention for
            // pre-processed metainfo templates: `org.foo.Bar.metainfo.xml.in`).
            if (metainfoTemplate) {
                const base = metainfoTemplate.replace(/\.in$/, '');
                const slash = base.lastIndexOf('/');
                return slash >= 0 ? base.slice(slash + 1) : base;
            }
            return `${domain}.xml`;
        }
    }
}

export const gettextCommand: Command<any, GettextOptions> = {
    command: 'gettext <poDir> <outDir>',
    description:
        'Compile gettext .po files to .mo (per-language locale tree) or substitute a metainfo template via msgfmt --xml.',
    builder: (yargs) => {
        return yargs
            .positional('poDir', {
                description: 'Directory containing <lang>.po files',
                type: 'string',
                normalize: true,
                demandOption: true,
            })
            .positional('outDir', {
                description:
                    'Output directory (locale tree for --format=mo, plain dir for xml/desktop/json)',
                type: 'string',
                normalize: true,
                demandOption: true,
            })
            .option('domain', {
                description: 'Text domain / application ID (e.g. `org.pixelrpg.maker`)',
                type: 'string',
                normalize: true,
                demandOption: true,
            })
            .option('format', {
                description: 'Output format',
                type: 'string',
                choices: ['mo', 'xml', 'desktop', 'json'] as const,
                default: 'mo' as const,
            })
            .option('metainfo', {
                description:
                    'For --format=xml: path to the template (`.metainfo.xml.in`) used as msgfmt --template',
                type: 'string',
                normalize: true,
            })
            .option('filename', {
                description: 'Override the output filename (defaults to <domain>.<ext>)',
                type: 'string',
                normalize: true,
            })
            .option('remove-xml-comments', {
                description: 'For --format=xml: strip XML comments from the compiled output',
                type: 'boolean',
                default: true,
            })
            .option('verbose', {
                description: 'Print each msgfmt invocation',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const poDir = resolve(args.poDir as string);
        const outDir = resolve(args.outDir as string);
        const domain = args.domain as string;
        const format = (args.format as GettextFormat | undefined) ?? 'mo';
        const metainfo = args.metainfo ? resolve(args.metainfo as string) : undefined;
        const filename = args.filename ?? defaultFilename(domain, format, metainfo);
        const verbose = !!args.verbose;
        const removeXmlComments = !!args['remove-xml-comments'];

        if (!(await fileExists(poDir))) {
            console.error(`[gjsify gettext] PO directory does not exist: ${poDir}`);
            process.exitCode = 1;
            return;
        }

        try {
            if (format === 'xml' && metainfo) {
                await compileBulkXml({
                    poDir,
                    outDir,
                    domain,
                    template: metainfo,
                    filename,
                    removeXmlComments,
                    verbose,
                });
            } else {
                if (format === 'xml') {
                    console.warn(
                        '[gjsify gettext] --format=xml without --metainfo: falling back to per-language XML files',
                    );
                }
                await compilePerLanguage({
                    poDir,
                    outDir,
                    domain,
                    format,
                    filename,
                    verbose,
                });
            }
        } catch (err: any) {
            if (err?.code === 'ENOENT') {
                console.error(
                    '[gjsify gettext] msgfmt not found. Install it via your distro (package: gettext).',
                );
            } else {
                if (err?.stderr) process.stderr.write(err.stderr);
                console.error(
                    `[gjsify gettext] msgfmt failed${err?.code !== undefined ? ` (exit ${err.code})` : ''}`,
                );
            }
            process.exitCode = typeof err?.code === 'number' ? err.code : 1;
        }
    },
};
