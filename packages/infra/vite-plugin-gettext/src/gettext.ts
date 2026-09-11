import { type Plugin } from 'vite';
import { execa } from 'execa';
import path from 'node:path';
import type { GettextPluginOptions } from './types.js';
import { GettextGuardError } from './guards.js';
import { planCatalogNames } from './catalog-names.js';
import { checkDependencies, findAvailableLanguages, generateLinguasFile, ensureDirectory } from './utils.js';

/**
 * Creates a Vite plugin that compiles PO translation files to binary MO format
 * The MO files are placed in the standard gettext directory structure:
 * {moDirectory}/locale/{lang}/LC_MESSAGES/messages.mo
 *
 * The directory is the catalog's POSIX locale name, which is NOT always the
 * `.po` basename — a Weblate `zh_Hans.po` is installed as `zh_CN`, because
 * `zh_Hans` is a name glibc never probes. See `catalog-names.ts`.
 * @param options Configuration options for the plugin
 * @returns A Vite plugin that handles PO compilation
 */
export function gettextPlugin(options: GettextPluginOptions): Plugin {
    const { poDirectory, moDirectory, filename = 'messages.mo', verbose = false, localeNames } = options;

    const pluginName = 'vite-plugin-gettext';

    async function compileMoFiles() {
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

            // Find available languages
            const languages = await findAvailableLanguages(poDirectory, pluginName, verbose);

            if (languages.length === 0) {
                if (verbose) {
                    console.log(`[${pluginName}] No translation files found`);
                }
                return;
            }

            // Generate LINGUAS file
            await generateLinguasFile(languages, poDirectory, verbose);

            // Resolve every catalog's locale directories BEFORE compiling any of
            // them, so a name nobody can place stops the build instead of
            // leaving a half-written tree that looks complete.
            const plans = planCatalogNames(languages, { pluginName, namespace: 'posix', localeNames });

            // Create MO directory
            await ensureDirectory(path.join(moDirectory, 'locale'));

            for (const plan of plans) {
                const poFile = path.join(poDirectory, `${plan.catalog}.po`);

                for (const localeDir of plan.posix) {
                    const moPath = path.join(moDirectory, 'locale', localeDir, 'LC_MESSAGES');
                    const moFile = path.join(moPath, filename);

                    await ensureDirectory(moPath);

                    if (verbose) {
                        console.log(`[${pluginName}] Compiling ${poFile} to ${moFile}`);
                    }

                    await execa('msgfmt', ['--output-file=' + moFile, poFile]);
                }
            }
        } catch (error) {
            // A guard's message IS the guard — wrapping it in "Failed to compile
            // MO files: Error: …" buries the instruction that makes it useful.
            if (error instanceof GettextGuardError) {
                throw error;
            }
            throw new Error(`Failed to compile MO files: ${error}`);
        }
    }

    return {
        name: pluginName,

        async buildStart() {
            await checkDependencies('msgfmt', pluginName, verbose);
            await compileMoFiles();
        },

        configureServer(server) {
            server.watcher.add(poDirectory);

            server.watcher.on('change', async (file) => {
                if (file.endsWith('.po')) {
                    if (verbose) {
                        console.log(`[${pluginName}] PO file changed: ${file}, recompiling`);
                    }
                    await compileMoFiles();
                }
            });
        },
    };
}
