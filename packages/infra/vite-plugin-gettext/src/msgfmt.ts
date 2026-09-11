import { type Plugin } from 'vite';
import { execa } from 'execa';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { MsgfmtPluginOptions, MsgfmtFormat } from './types.js';
import { GettextGuardError } from './guards.js';
import { planCatalogNames } from './catalog-names.js';
import { checkDependencies, findAvailableLanguages, ensureDirectory } from './utils.js';

/**
 * Remove XML comments from a file content
 * @param content The XML content as string
 * @returns The content with comments removed
 */
function removeXmlComments(content: string): string {
    // Remove XML comments <!-- ... -->
    return content.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Build msgfmt command arguments
 * @param baseArgs Base arguments for msgfmt
 * @param options Plugin options
 * @returns Complete argument array
 */
function buildMsgfmtArgs(baseArgs: string[], options: { msgfmtOptions?: string[] }): string[] {
    const args = [...baseArgs];

    if (options.msgfmtOptions && options.msgfmtOptions.length > 0) {
        args.push(...options.msgfmtOptions);
    }

    return args;
}

/**
 * Get output file extension based on the format
 * @param format The output format
 * @returns The file extension for the given format
 */
function getOutputExtension(format: MsgfmtFormat): string {
    switch (format) {
        case 'mo':
            return '.mo';
        case 'java':
        case 'java2':
            return '.class';
        case 'csharp':
            return '.dll';
        case 'csharp-resources':
            return '.resources.dll';
        case 'tcl':
            return '.msg';
        case 'desktop':
            return '.desktop';
        case 'xml':
            return '.xml';
        case 'json':
            return '.json';
        case 'qt':
            return '.qm';
        default:
            return '.mo';
    }
}

/**
 * Creates a Vite plugin that compiles PO translation files to various formats
 * Supports metainfo files with special processing
 * @param options Configuration options for the plugin
 * @returns A Vite plugin that handles PO compilation
 */
export function msgfmtPlugin(options: MsgfmtPluginOptions): Plugin {
    const {
        poDirectory,
        outputDirectory,
        domain = 'messages',
        format = 'mo',
        templateFile,
        verbose = false,
        msgfmtOptions = [],
        useLocaleStructure = true,
        removeComments = true,
        localeNames,
    } = options;

    const pluginName = 'vite-plugin-msgfmt';

    async function compilePoFiles() {
        try {
            // Ensure the PO directory exists (mkdir -p — a missing directory
            // is CREATED, not an error); only EACCES/ENOTDIR-class failures
            // can land in the catch.
            try {
                await ensureDirectory(poDirectory);
            } catch {
                if (verbose) {
                    console.log(`[${pluginName}] PO directory ${poDirectory} not creatable, skipping compilation`);
                }
                return;
            }

            // Create output directory
            await ensureDirectory(outputDirectory);

            // For XML format, we can use the bulk mode if a template is provided
            if (format === 'xml' && templateFile) {
                // Use bulk mode for XML format
                const outputFile = path.join(
                    outputDirectory,
                    options.filename || `${domain}${getOutputExtension(format)}`,
                );

                if (verbose) {
                    console.log(`[${pluginName}] Compiling all languages to ${outputFile} using bulk mode`);
                }

                // Build arguments for bulk mode
                const baseArgs = [
                    '--output-file=' + outputFile,
                    '--xml',
                    '--template=' + templateFile,
                    '-d',
                    poDirectory,
                ];
                const args = buildMsgfmtArgs(baseArgs, { msgfmtOptions });

                if (verbose) {
                    console.log(`[${pluginName}] Running msgfmt with: ${args.join(' ')}`);
                }

                await execa('msgfmt', args);

                // Remove comments from XML output if requested
                if (removeComments !== false) {
                    try {
                        const content = await fs.readFile(outputFile, 'utf-8');
                        const cleanedContent = removeXmlComments(content);
                        await fs.writeFile(outputFile, cleanedContent, 'utf-8');

                        if (verbose) {
                            console.log(`[${pluginName}] Removed comments from ${outputFile}`);
                        }
                    } catch (error) {
                        if (verbose) {
                            console.warn(`[${pluginName}] Failed to remove comments: ${error}`);
                        }
                    }
                }
            } else {
                // Find available languages for individual processing
                const languages = await findAvailableLanguages(poDirectory, pluginName, verbose);

                if (languages.length === 0) {
                    if (verbose) {
                        console.log(`[${pluginName}] No translation files found`);
                    }
                    return;
                }

                // Only the gettext locale structure is looked up by glibc, so
                // only it needs POSIX names. The flat `<outputDirectory>/<lang>`
                // layout is read by whatever the project points at it, and
                // renaming there would break a consumer to fix nobody.
                const usesLocaleLookup = useLocaleStructure && format === 'mo';
                const plans = usesLocaleLookup
                    ? planCatalogNames(languages, { pluginName, namespace: 'posix', localeNames })
                    : languages.map((catalog) => ({ catalog, posix: [catalog], bcp47: '' }));

                // Process each language individually for other formats
                for (const plan of plans) {
                    const poFile = path.join(poDirectory, `${plan.catalog}.po`);

                    for (const name of plan.posix) {
                        const outputPath = usesLocaleLookup
                            ? path.join(outputDirectory, 'locale', name, 'LC_MESSAGES')
                            : path.join(outputDirectory, name);
                        const outputFile = path.join(
                            outputPath,
                            options.filename || `${domain}${getOutputExtension(format)}`,
                        );

                        // Create the directory structure
                        await ensureDirectory(outputPath);

                        if (verbose) {
                            console.log(`[${pluginName}] Compiling ${poFile} to ${outputFile}`);
                        }

                        // Build arguments for individual processing
                        const baseArgs = ['--output-file=' + outputFile, `--${format}`, poFile];
                        const args = buildMsgfmtArgs(baseArgs, { msgfmtOptions });

                        if (verbose) {
                            console.log(`[${pluginName}] Running msgfmt with: ${args.join(' ')}`);
                        }

                        await execa('msgfmt', args);
                    }
                }
            }
        } catch (error) {
            // A guard's message IS the guard — wrapping it buries the
            // instruction that makes it useful.
            if (error instanceof GettextGuardError) {
                throw error;
            }
            throw new Error(`Failed to compile files: ${error}`);
        }
    }

    return {
        name: pluginName,

        async buildStart() {
            await checkDependencies('msgfmt', pluginName, verbose);
            await compilePoFiles();
        },

        configureServer(server) {
            server.watcher.add(poDirectory);

            server.watcher.on('change', async (file) => {
                if (file.endsWith('.po')) {
                    if (verbose) {
                        console.log(`[${pluginName}] PO file changed: ${file}, recompiling`);
                    }
                    await compilePoFiles();
                }
            });
        },
    };
}
