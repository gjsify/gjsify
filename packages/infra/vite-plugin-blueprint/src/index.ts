import { type Plugin } from 'vite';
import { execa } from 'execa';
import minifyXML from 'minify-xml';
import {
    BlueprintCompileError,
    BlueprintCompilerNotFoundError,
    type ResolvedBlueprintCompiler,
    resolveBlueprintCompiler,
} from './resolve-compiler.js';

export interface BlueprintPluginOptions {
    minify?: boolean;
    verbose?: boolean;
}

export {
    BlueprintCompileError,
    BlueprintCompilerNotFoundError,
    type BlueprintHost,
    currentBlueprintHost,
    formatMissingBlueprintCompiler,
    type ResolvedBlueprintCompiler,
    resolveBlueprintCompiler,
} from './resolve-compiler.js';

export default function blueprintPlugin(options: BlueprintPluginOptions = {}): Plugin {
    const { minify = false, verbose = false } = options;

    // Cached only on SUCCESS, so the PATH walk costs one probe per plugin
    // instance instead of one per `.blp`. A MISS is deliberately re-probed:
    // installing the compiler and saving the file is how a watch session is
    // meant to recover, and caching "absent" would make that need a restart.
    let compiler: ResolvedBlueprintCompiler | null = null;

    return {
        name: 'vite-plugin-blueprint',

        async load(id) {
            if (id.endsWith('.blp')) {
                compiler ??= resolveBlueprintCompiler();
                if (!compiler) {
                    // Names the `.blp` that wanted it, so the diagnostic points at
                    // a file the reader recognises rather than at the plugin.
                    throw new BlueprintCompilerNotFoundError(id);
                }
                const resolved = compiler;

                try {
                    // Compile .blp file and get XML output directly
                    const { stdout } = await execa(resolved.file, [...resolved.prefixArgs, 'compile', id], {
                        // Only ever an overlay (an MSYS2 PATH prepend); undefined
                        // inherits the environment unchanged.
                        env: resolved.env,
                    });
                    if (verbose) console.log(`Compiled ${id} (blueprint-compiler via ${resolved.source})`);

                    let xmlContent = stdout;

                    // Minify XML if option is enabled
                    if (minify) {
                        xmlContent = minifyXML(xmlContent);
                        if (verbose) console.log(`Minified XML for ${id}`);
                    }

                    // Return the XML content as a string
                    return `export default ${JSON.stringify(xmlContent)};`;
                } catch (error) {
                    const detail =
                        error instanceof Error ? (error as { stderr?: string }).stderr || error.message : String(error);
                    throw new BlueprintCompileError(id, resolved.file, detail);
                }
            }
        },
    };
}
