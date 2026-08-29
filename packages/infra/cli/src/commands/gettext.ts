import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Command } from '../types/index.js';
import { mergeCatalogues } from '../utils/msgfmt-merge.js';

const execFileAsync = promisify(execFile);

type GettextFormat = 'mo' | 'xml' | 'desktop';

interface GettextOptions {
    poDir: string;
    outDir: string;
    domain: string;
    format?: GettextFormat;
    template?: string;
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

/**
 * Fold every catalogue into ONE template.
 *
 * The chain, and the four measured msgfmt constraints that shape it, live in
 * `utils/msgfmt-merge.ts` — `gjsify ship` folds the catalogues it stages into the
 * metadata it generates through the same function, and a second copy of those
 * constraints here would be the copy that drifts.
 *
 * What is local to this command: the output keeps the CALLER's filename. That
 * matters for `--format xml` because msgfmt finds its ITS rules by filename
 * pattern, so `--filename app.xml` for an AppStream component fails where
 * `app.metainfo.xml` succeeds (constraint 4 over there).
 */
async function compileMerged(opts: {
    poDir: string;
    outDir: string;
    format: 'xml' | 'desktop';
    template: string;
    filename: string;
    removeXmlComments: boolean;
    verbose: boolean;
}): Promise<void> {
    const languages = await listLanguages(opts.poDir);
    if (languages.length === 0) {
        console.warn(`[gjsify gettext] no .po files found in ${opts.poDir}`);
        return;
    }

    const outputFile = join(opts.outDir, opts.filename);
    await ensureDir(opts.outDir);

    const workDir = await mkdtemp(join(tmpdir(), 'gjsify-gettext-'));
    try {
        const merged = await readFile(
            mergeCatalogues({
                mode: `--${opts.format}`,
                template: opts.template,
                // `basename`, so an intermediate stays inside `workDir` even when the
                // caller's `--filename` carries a directory part.
                extension: `-${basename(opts.filename)}`,
                catalogues: languages.map((lang) => ({ locale: lang, po: join(opts.poDir, `${lang}.po`) })),
                workDir,
                onCall: opts.verbose ? (args) => console.log(`[gjsify gettext] msgfmt ${args.join(' ')}`) : undefined,
            }),
            'utf-8',
        );
        await writeFile(
            outputFile,
            opts.removeXmlComments && opts.format === 'xml' ? stripXmlComments(merged) : merged,
        );
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }

    if (opts.verbose) {
        console.log(`[gjsify gettext] merged ${languages.length} language(s) into ${outputFile}`);
    }
}

/**
 * Compile each `<lang>.po` into `<outDir>/<lang>/LC_MESSAGES/<filename>`.
 *
 * `mo` only. The other two formats SUBSTITUTE a template rather than producing a
 * catalogue, and there is no per-language file for them to write — which is the
 * defect this signature now makes unrepresentable: the old shared loop passed
 * `--desktop`/`--xml` with no `--template`, and msgfmt refuses that outright
 * (`--desktop requires a "--template template" specification`, exit 1). Every
 * `gjsify gettext --format=desktop` invocation had therefore always failed; the
 * only e2e coverage passes `--format mo`, so nothing ever ran the other branch.
 */
async function compileCatalogues(opts: {
    poDir: string;
    outDir: string;
    filename: string;
    verbose: boolean;
}): Promise<void> {
    const languages = await listLanguages(opts.poDir);
    if (languages.length === 0) {
        console.warn(`[gjsify gettext] no .po files found in ${opts.poDir}`);
        return;
    }

    for (const lang of languages) {
        const langDir = join(opts.outDir, lang, 'LC_MESSAGES');
        await ensureDir(langDir);

        // msgfmt produces the binary .mo format by default — there is no `--mo`
        // flag (only --xml, --desktop, --properties-output, ...).
        const args = [`--output-file=${join(langDir, opts.filename)}`, join(opts.poDir, `${lang}.po`)];

        if (opts.verbose) {
            console.log(`[gjsify gettext] msgfmt ${args.join(' ')}`);
        }

        await execFileAsync('msgfmt', args);
    }

    if (opts.verbose) {
        console.log(`[gjsify gettext] compiled ${languages.length} language(s) into ${opts.outDir}`);
    }
}

function defaultFilename(domain: string, format: GettextFormat, template?: string): string {
    switch (format) {
        case 'mo':
            return `${domain}.mo`;
        case 'desktop':
            return `${domain}.desktop`;
        case 'xml': {
            // Mirror the template filename but without the trailing `.in` (convention for
            // pre-processed metainfo templates: `org.foo.Bar.metainfo.xml.in`).
            if (template) {
                // `basename`, not a hand-rolled `lastIndexOf('/')`: this is a path the USER
                // passed, and on win32 it separates with `\`, which the slice read as part
                // of the name (#1143). `node:path` is the right owner for host tooling —
                // though it only answers correctly under Node until #1146 makes
                // `@gjsify/path` select win32 per host.
                return basename(template.replace(/\.in$/, ''));
            }
            return `${domain}.xml`;
        }
    }
}

export const gettextCommand: Command<unknown, GettextOptions> = {
    command: 'gettext <poDir> <outDir>',
    description:
        'Compile gettext .po files to .mo (per-language locale tree), or merge every catalogue into a ' +
        '.desktop / AppStream template via msgfmt --desktop / --xml.',
    builder: (yargs) => {
        return yargs
            .positional('poDir', {
                description: 'Directory containing <lang>.po files',
                type: 'string',
                normalize: true,
                demandOption: true,
            })
            .positional('outDir', {
                description: 'Output directory (locale tree for --format=mo, plain dir for xml/desktop)',
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
                choices: ['mo', 'xml', 'desktop'] as const,
                default: 'mo' as const,
            })
            .option('template', {
                description:
                    'Required for --format=xml|desktop: the file msgfmt substitutes into. Its SUFFIX matters — ' +
                    'msgfmt --xml finds its ITS rules by filename pattern, so an AppStream template must be ' +
                    'named `*.metainfo.xml[.in]`.',
                type: 'string',
                normalize: true,
            })
            .option('metainfo', {
                description: 'Deprecated alias for --template.',
                type: 'string',
                normalize: true,
                hidden: true,
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
        // `--metainfo` predates the option being useful for `.desktop` too. Kept as a
        // hidden alias rather than removed: it is the spelling `cli-reference.md`
        // documented, so removing it would break the invocation the docs taught.
        const templateArg = (args.template as string | undefined) ?? (args.metainfo as string | undefined);
        const template = templateArg ? resolve(templateArg) : undefined;
        const filename = args.filename ?? defaultFilename(domain, format, template);
        const verbose = !!args.verbose;
        const removeXmlComments = !!args['remove-xml-comments'];

        if (!(await fileExists(poDir))) {
            console.error(`[gjsify gettext] PO directory does not exist: ${poDir}`);
            process.exitCode = 1;
            return;
        }

        // REFUSED, not worked around. `--xml` and `--desktop` substitute into a
        // template, and msgfmt rejects both without one (`--desktop requires a
        // "--template template" specification`, exit 1). The old code fell back to a
        // per-language loop that passed no template at all, so the fallback could only
        // ever reproduce that same error one layer further down — with the user's
        // `--format` reported as the thing that failed rather than the missing template.
        if (format !== 'mo' && template === undefined) {
            console.error(
                `[gjsify gettext] --format=${format} needs a template to substitute into: pass ` +
                    '`--template <file>`. msgfmt has no way to produce this format from .po files alone.' +
                    (format === 'xml'
                        ? ' Name it `*.metainfo.xml[.in]` — msgfmt --xml finds its ITS rules by filename pattern.'
                        : ''),
            );
            process.exitCode = 1;
            return;
        }

        try {
            if (format === 'mo') {
                await compileCatalogues({ poDir, outDir, filename, verbose });
            } else {
                await compileMerged({
                    poDir,
                    outDir,
                    format,
                    // Narrowed by the refusal above.
                    template: template as string,
                    filename,
                    removeXmlComments,
                    verbose,
                });
            }
        } catch (err: unknown) {
            const e = err as { code?: unknown; stderr?: string | Buffer };
            if (e?.code === 'ENOENT') {
                console.error('[gjsify gettext] msgfmt not found. Install it via your distro (package: gettext).');
            } else {
                if (e?.stderr) process.stderr.write(e.stderr);
                console.error(`[gjsify gettext] msgfmt failed${e?.code !== undefined ? ` (exit ${e.code})` : ''}`);
            }
            process.exitCode = typeof e?.code === 'number' ? e.code : 1;
        }
    },
};
