import { type Plugin } from 'vite';
import { execa } from 'execa';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import glob from 'fast-glob';
import {
    activeMsgids,
    assertCatalogsSurviveMerge,
    assertEverySourcePatternMatched,
    EmptySourcePatternError,
    GettextGuardError,
} from './guards.js';
import type { XGettextPluginOptions } from './types.js';
import { checkDependencies, ensureDirectory, processFilename } from './utils.js';

// Add GLib preset constants
// From https://github.com/mesonbuild/meson/blob/467da051c859ba3112803b035e317bddadd756ef/mesonbuild/modules/i18n.py
const GLIB_PRESET_ARGS = [
    '--from-code=UTF-8',
    '--add-comments',
    // https://developer.gnome.org/glib/stable/glib-I18N.html
    '--keyword=_',
    '--keyword=N_',
    '--keyword=C_:1c,2',
    '--keyword=NC_:1c,2',
    '--keyword=g_dcgettext:2',
    '--keyword=g_dngettext:2,3',
    '--keyword=g_dpgettext2:2c,3',
    '--flag=N_:1:pass-c-format',
    '--flag=C_:2:pass-c-format',
    '--flag=NC_:2:pass-c-format',
    '--flag=g_dngettext:2:pass-c-format',
    '--flag=g_strdup_printf:1:c-format',
    '--flag=g_string_printf:2:c-format',
    '--flag=g_string_append_printf:2:c-format',
    '--flag=g_error_new:3:c-format',
    '--flag=g_set_error:4:c-format',
    '--flag=g_markup_printf_escaped:1:c-format',
    '--flag=g_log:3:c-format',
    '--flag=g_print:1:c-format',
    '--flag=g_printerr:1:c-format',
    '--flag=g_printf:1:c-format',
    '--flag=g_fprintf:2:c-format',
    '--flag=g_sprintf:2:c-format',
    '--flag=g_snprintf:3:c-format',
];

/**
 * Build command arguments with common options
 * @param baseArgs Base arguments for the command
 * @param options Options to add to arguments
 * @returns Complete argument array
 */
function buildCommandArgs(
    baseArgs: string[],
    options: {
        noLocation?: boolean;
        noWrap?: boolean;
        sortOutput?: boolean;
        additionalOptions?: string[];
    },
): string[] {
    const args = [...baseArgs];

    // Check if additional options already contain the flags to avoid duplicates
    const additionalOptions = options.additionalOptions || [];
    const hasNoLocation = additionalOptions.includes('--no-location');
    const hasNoWrap = additionalOptions.includes('--no-wrap');
    const hasSortOutput = additionalOptions.includes('--sort-output');

    if (options.noLocation && !hasNoLocation) {
        args.push('--no-location');
    }

    if (options.noWrap && !hasNoWrap) {
        args.push('--no-wrap');
    }

    if (options.sortOutput && !hasSortOutput) {
        args.push('--sort-output');
    }

    if (additionalOptions.length > 0) {
        args.push(...additionalOptions);
    }

    return args;
}

/**
 * Creates a Vite plugin that extracts translatable strings from source files
 * Uses GNU xgettext to generate a POT template file that can be used as basis for translations
 * @param options Configuration options for the plugin
 * @returns A Vite plugin that handles string extraction
 */
export function xgettextPlugin(options: XGettextPluginOptions): Plugin {
    const pluginName = 'vite-plugin-xgettext';

    return {
        name: pluginName,

        async buildStart() {
            await checkDependencies('xgettext', pluginName, options.verbose ?? false);
            const files = await resolveSources(options, pluginName);
            await extractStrings(files, options, pluginName);
        },

        configureServer(server) {
            server.watcher.add(options.sources);

            server.watcher.on('change', async (file) => {
                // Membership in the RESOLVED set, not `file.match(pattern)`: that
                // compiled the glob as a regular expression, and any `**` in it is
                // `Nothing to repeat`, so every change event threw a SyntaxError
                // before it could decide anything. Re-extraction in `vite dev` had
                // never run, which is also why the guards below had never been
                // reached from here.
                const files = await resolveSources(options, pluginName);
                const changed = path.resolve(file);
                if (!files.some((candidate) => path.resolve(candidate) === changed)) {
                    return;
                }
                if (options.verbose) {
                    console.log(`[${pluginName}] Source file changed: ${file}, re-running extraction`);
                }
                await extractStrings(files, options, pluginName);
            });
        },
    };
}

/**
 * Resolves `sources` to files, globbing each POSITIVE pattern separately under
 * the negative ones.
 *
 * The union `glob(options.sources)` used to return cannot say WHICH pattern came
 * up empty, and in the incident `guards.ts` records only one of several did — so
 * the union was non-empty and there was nothing left to notice. Per-pattern is
 * what makes the guard able to name the offender.
 *
 * The negative patterns have to stay a property of the WHOLE set, though.
 * fast-glob reads a leading `!` as an ignore filter over the other patterns, and
 * returns nothing at all for a list that is only negations — so globbing one on
 * its own yields zero files, which the guard would report as a missing source
 * group, and silencing that with `optionalSources` would then extract the very
 * files the `!` was there to keep out. They are lifted into `ignore` instead,
 * which is what fast-glob does with them internally.
 */
async function resolveSources(options: XGettextPluginOptions, pluginName: string): Promise<string[]> {
    const included = options.sources.filter((pattern) => !pattern.startsWith('!'));
    const ignore = options.sources.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1));
    const perPattern = await Promise.all(included.map((pattern) => glob(pattern, { ignore })));

    assertEverySourcePatternMatched(
        included.map((pattern, index) => ({ pattern, fileCount: perPattern[index].length })),
        { pluginName, cwd: process.cwd(), optionalSources: options.optionalSources, ignore },
    );

    // Two patterns may legitimately reach the same file; xgettext would then scan
    // it twice and msgcat would have to fold the duplicate back out.
    const files = [...new Set(perPattern.flat())];

    // The one hole the per-pattern guard leaves: no positive pattern at all, or
    // every pattern declared optional and every one empty. Extraction would run
    // over nothing, write an empty POT and prune every catalog against it — the
    // incident again, reached by a different route.
    if (files.length === 0) {
        throw new EmptySourcePatternError(
            `[${pluginName}] no source file to extract from: ${options.sources.length} pattern(s) resolved to ` +
                `nothing under ${process.cwd()}.\n` +
                'Extracting anyway writes an empty POT, and with autoUpdatePo that empties every catalog.',
            options.sources,
        );
    }

    return files;
}

async function generatePotfiles(files: string[], outputDir: string, pluginName: string, verbose = false) {
    // Group files by extension
    const fileGroups = new Map<string, string[]>();

    files.forEach((file) => {
        const filename = path.basename(file);
        const group = getFileGroup(filename);
        if (!fileGroups.has(group)) {
            fileGroups.set(group, []);
        }
        fileGroups.get(group)?.push(file);
    });

    // Generate POTFILES for each group
    const potFiles: string[] = [];

    for (const [group, groupFiles] of fileGroups) {
        const potfilePath = path.join(outputDir, `${group}.POTFILES`);
        const content = groupFiles.join('\n');

        // Deliberately unguarded. A caught write failure used to leave the group
        // out of `potFiles`, so xgettext never ran for it and the whole group left
        // the POT — the incident in `guards.ts`, reached without any pattern being
        // wrong. Nothing here can be recovered from; it has to end the build.
        await fs.writeFile(potfilePath, content);
        potFiles.push(potfilePath);
        if (verbose) {
            console.log(`[${pluginName}] Generated ${group}.POTFILES with ${groupFiles.length} source files`);
        }
    }

    return potFiles;
}

function getFileGroup(fullFilename: string): string {
    // Process filename to handle .in extension
    const { filename, extension } = processFilename(fullFilename);

    // Special handling for metainfo.xml files
    if (filename.endsWith('.metainfo.xml') || filename.endsWith('.appdata.xml')) {
        return 'metainfo';
    }

    switch (extension) {
        case '.ts':
        case '.js':
        case '.tsx':
            return 'js';
        case '.ui':
        case '.xml':
            return 'ui';
        case '.blp':
            return 'blp';
        case '.desktop':
            return 'desktop';
        default:
            return 'other';
    }
}

async function extractStrings(files: string[], options: XGettextPluginOptions, pluginName: string) {
    const { output, domain = 'messages', keywords = [], preset, verbose = false } = options;

    const noWrap = options.noWrap || false;

    try {
        const outputDir = path.dirname(output);
        await ensureDirectory(outputDir);

        // Read existing POT-Creation-Date from previous POT if present (for preservation)
        let prevPotCreationDate: string | undefined;
        try {
            const existingPot = await fs.readFile(output, 'utf-8');
            const m = existingPot.match(/"POT-Creation-Date:\s*([^\n]+)\\n"/);
            if (m && m[1]) {
                prevPotCreationDate = m[1];
                if (verbose) {
                    console.log(`[${pluginName}] Found previous POT-Creation-Date '${prevPotCreationDate}'`);
                }
            }
        } catch {
            // No previous POT available
        }

        // Generate grouped POTFILES
        const potFiles = await generatePotfiles(files, outputDir, pluginName, verbose);

        // Create temporary POT files for each group
        const tempPotFiles: string[] = [];

        for (const potFile of potFiles) {
            const group = path.basename(potFile).split('.')[0];
            const tempOutput = path.join(outputDir, `temp_${group}.pot`);

            // Build base arguments
            const baseArgs = [
                '--package-name=' + domain,
                options.version ? '--package-version=' + options.version : '',
                '--output=' + tempOutput,
                '--files-from=' + potFile,
                '--from-code=UTF-8',
                '--add-comments',
            ].filter(Boolean);

            // Add bug report address if specified
            if (options.msgidBugsAddress) {
                baseArgs.push('--msgid-bugs-address=' + options.msgidBugsAddress);
            }

            // Add copyright holder if specified
            if (options.copyrightHolder) {
                baseArgs.push('--copyright-holder=' + options.copyrightHolder);
            }

            // Add language-specific settings
            switch (group) {
                case 'js':
                // Blueprint deliberately shares the JavaScript lexer: xgettext has no Blueprint
                // parser at all (0.26 rejects `--language=Blueprint` outright), and Blueprint's
                // `_("…")` / `C_("ctx", "…")` are lexically calls, which is exactly what the
                // JavaScript scanner looks for. Measured on a .blp: all marked strings come out,
                // unmarked literals stay out.
                case 'blp':
                    baseArgs.push('--language=JavaScript');
                    baseArgs.push(...keywords.map((k) => `--keyword=${k}`));
                    if (preset === 'glib') {
                        baseArgs.push(...GLIB_PRESET_ARGS);
                    }
                    break;
                case 'ui':
                    baseArgs.push('--language=Glade');
                    break;
                case 'metainfo':
                    // Find the first existing metainfo.its file
                    const metainfoItsPath = await findMetainfoItsPath();

                    if (!metainfoItsPath) {
                        console.warn('Warning: Could not find metainfo.its in any of the expected locations');
                        // Continue without the ITS file
                    } else {
                        baseArgs.push(`--its=${metainfoItsPath}`);
                    }
                    break;
                case 'desktop':
                    baseArgs.push('--language=Desktop');
                    break;
            }

            // Build final arguments with options handling
            const args = buildCommandArgs(baseArgs, {
                noLocation: options.noLocation,
                noWrap,
                additionalOptions: options.xgettextOptions,
            });

            if (verbose) {
                console.log(`[${pluginName}] Running xgettext for ${group}:`, args.join(' '));
            }

            // Enforce deterministic timestamps if requested
            const env = { ...process.env };
            if (options.deterministic) {
                const epoch = typeof options.sourceDateEpoch === 'number' ? options.sourceDateEpoch : 0;
                env.SOURCE_DATE_EPOCH = String(epoch);
            }

            await execa('xgettext', args, { env });

            // Check if file exists before adding to tempPotFiles
            try {
                await fs.access(tempOutput);
                tempPotFiles.push(tempOutput);
                if (verbose) {
                    console.log(`[${pluginName}] Successfully created temporary POT file: ${tempOutput}`);
                }
            } catch (_error) {
                console.warn(`[${pluginName}] Failed to create temporary POT file: ${tempOutput}`);
            }
        }

        // Combine all temporary POT files using msgcat
        if (tempPotFiles.length > 0) {
            const baseMsgcatArgs = ['--use-first', '-o', output, ...tempPotFiles];
            const msgcatArgs = buildCommandArgs(baseMsgcatArgs, {
                noLocation: options.noLocation,
                sortOutput: options.sortOutput,
                noWrap,
                additionalOptions: options.msgcatOptions,
            });

            const env = { ...process.env };
            if (options.deterministic) {
                const epoch = typeof options.sourceDateEpoch === 'number' ? options.sourceDateEpoch : 0;
                env.SOURCE_DATE_EPOCH = String(epoch);
            }

            await execa('msgcat', msgcatArgs, { env });

            // Clean up temporary files
            for (const tempFile of tempPotFiles) {
                await fs.unlink(tempFile);
            }
            for (const potFile of potFiles) {
                await fs.unlink(potFile);
            }
        }

        // Optionally normalize POT-Creation-Date header to a fixed or preserved value
        if (options.fixedCreationDate || options.preserveCreationDate || options.deterministic) {
            try {
                let normalizedDate: string | undefined = undefined;

                if (options.fixedCreationDate) {
                    normalizedDate = options.fixedCreationDate;
                } else if (options.preserveCreationDate) {
                    if (prevPotCreationDate) {
                        normalizedDate = prevPotCreationDate;
                        if (verbose) {
                            console.log(`[${pluginName}] Preserving existing POT-Creation-Date '${normalizedDate}'`);
                        }
                    }
                }

                if (!normalizedDate && options.deterministic) {
                    normalizedDate = formatSourceDateEpoch(
                        typeof options.sourceDateEpoch === 'number' ? options.sourceDateEpoch : 0,
                    );
                }

                if (normalizedDate) {
                    const content = await fs.readFile(output, 'utf-8');
                    const replaced = content.replace(
                        /^"POT-Creation-Date: .*\\n"$/m,
                        `"POT-Creation-Date: ${normalizedDate}\\n"`,
                    );
                    if (replaced !== content) {
                        await fs.writeFile(output, replaced);
                        if (verbose) {
                            console.log(`[${pluginName}] Normalized POT-Creation-Date to '${normalizedDate}'`);
                        }
                    }
                }
            } catch (e) {
                console.warn(`[${pluginName}] Failed to normalize POT-Creation-Date header:`, e);
            }
        }

        if (options.autoUpdatePo) {
            await assertCatalogsSurviveNextMerge(options, pluginName);
            await updatePoFiles(options.output, pluginName, options.verbose || false, options);
        }
    } catch (error) {
        // A guard's message IS the guard — wrapping it in "Failed to extract
        // translations: Error: …" buries the instruction that makes it useful.
        if (error instanceof GettextGuardError) {
            throw error;
        }
        throw new Error(`Failed to extract translations: ${error}`);
    }
}

/** The catalogs LINGUAS declares beside a POT. */
async function listCatalogs(potFile: string): Promise<Array<{ language: string; file: string }>> {
    const directory = path.dirname(potFile);
    const linguas = await readTextOrEmpty(path.join(directory, 'LINGUAS'));

    return linguas
        .split('\n')
        .filter(Boolean)
        .map((language) => ({ language, file: path.join(directory, `${language}.po`) }));
}

/**
 * A file that is not there yet reads as empty rather than as a failure: a project
 * with no LINGUAS has no translations, and a language named in LINGUAS before its
 * catalog exists holds no entries. Both are states a first run is legitimately
 * in, and neither is something a merge can destroy.
 */
async function readTextOrEmpty(file: string): Promise<string> {
    try {
        return await fs.readFile(file, 'utf-8');
    } catch (error) {
        // ONLY "not there yet" reads as empty. A permission or I/O error must not:
        // an unreadable catalog counted as holding nothing is the guard talking
        // itself out of firing.
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
            return '';
        }
        throw error;
    }
}

/**
 * Reads what `msgmerge` is about to rewrite and hands the counts to the pure
 * check.
 *
 * Called from `extractStrings` BEFORE `updatePoFiles` and outside that function's
 * catch — a refusal that became one more `console.error` beside a zero exit code
 * would be the exact silence this guards against.
 */
async function assertCatalogsSurviveNextMerge(options: XGettextPluginOptions, pluginName: string): Promise<void> {
    const catalogs = await listCatalogs(options.output);
    const sizes = await Promise.all(
        catalogs.map(async ({ language, file }) => ({
            language,
            msgids: activeMsgids(await readTextOrEmpty(file)),
        })),
    );

    assertCatalogsSurviveMerge({
        potMsgids: activeMsgids(await readTextOrEmpty(options.output)),
        catalogs: sizes,
        potFile: options.output,
        pluginName,
        maxEntryLoss: options.maxCatalogEntryLoss,
    });
}

/**
 * Merges the POT into every catalog LINGUAS declares.
 *
 * Deliberately unguarded, like `generatePotfiles`. A caught error here used to be
 * one `console.error` beside exit 0 — and by then `msgmerge --update` may already
 * have rewritten the catalogs it got to, so "an error was printed" and "the
 * catalogs are intact" were unrelated facts.
 */
async function updatePoFiles(potFile: string, pluginName: string, verbose: boolean, options: XGettextPluginOptions) {
    for (const { file: poFile } of await listCatalogs(potFile)) {
        if (verbose) {
            console.log(`[${pluginName}] Updating ${poFile}`);
        }
        const baseMsgmergeArgs = ['--update', '--backup=none', poFile, potFile];
        const args = buildCommandArgs(baseMsgmergeArgs, {
            noLocation: options.noLocation,
            noWrap: options.noWrap,
        });

        const env = { ...process.env };
        if (options.deterministic) {
            const epoch = typeof options.sourceDateEpoch === 'number' ? options.sourceDateEpoch : 0;
            env.SOURCE_DATE_EPOCH = String(epoch);
        }

        await execa('msgmerge', args, { env });

        // Post-process with msgcat to unwrap existing wrapped lines
        if (options.noWrap) {
            const tempFile = poFile + '.tmp';
            const msgcatArgs = ['--width=0', '--no-wrap', '-o', tempFile, poFile];
            await execa('msgcat', msgcatArgs, { env });
            await fs.rename(tempFile, poFile);
            if (verbose) {
                console.log(`[${pluginName}] Unwrapped lines in ${poFile}`);
            }
        }
    }
}

/**
 * Formats a date in gettext header format using an epoch (seconds) in UTC timezone
 * Example output: 1970-01-01 00:00+0000
 */
function formatSourceDateEpoch(epochSeconds: number): string {
    const date = new Date(epochSeconds * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const year = date.getUTCFullYear();
    const month = pad(date.getUTCMonth() + 1);
    const day = pad(date.getUTCDate());
    const hours = pad(date.getUTCHours());
    const minutes = pad(date.getUTCMinutes());
    return `${year}-${month}-${day} ${hours}:${minutes}+0000`;
}

/**
 * Finds the first existing metainfo.its file from installed gettext versions
 * @returns The path to the metainfo.its file if found, otherwise undefined
 */
async function findMetainfoItsPath(): Promise<string | undefined> {
    // Default path
    const defaultPath = '/usr/share/gettext/its/metainfo.its';

    // Check default path first
    if (existsSync(defaultPath)) {
        return defaultPath;
    }

    try {
        // Use glob to find all potential gettext version directories
        const getTextDirs = await glob('/usr/share/gettext-*');

        // Sort by version (newest first) if possible
        getTextDirs.sort((a, b) => {
            const versionA = a.replace('/usr/share/gettext-', '');
            const versionB = b.replace('/usr/share/gettext-', '');
            return versionB.localeCompare(versionA);
        });

        // Add specific version paths we know about
        const metainfoItsPaths = getTextDirs.map((dir) => `${dir}/its/metainfo.its`);

        // Find first existing path
        return metainfoItsPaths.find((path) => existsSync(path));
    } catch (error) {
        console.warn('Error searching for metainfo.its:', error);
        return undefined;
    }
}
