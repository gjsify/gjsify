import { type Plugin } from 'vite';
import { execa } from 'execa';
import minifyXML from 'minify-xml';
import { formatMissingBlueprintCompiler, resolveBlueprintCompiler } from './resolve-compiler.js';

export interface BlueprintPluginOptions {
    minify?: boolean;
    verbose?: boolean;
}

export { resolveBlueprintCompiler, formatMissingBlueprintCompiler } from './resolve-compiler.js';

export default function blueprintPlugin(options: BlueprintPluginOptions = {}): Plugin {
    const { minify = false, verbose = false } = options;

    return {
        name: 'vite-plugin-blueprint',

        async load(id) {
            if (id.endsWith('.blp')) {
                // Resolved per load rather than once at plugin construction, so a
                // compiler installed mid-watch is picked up without a restart —
                // and so the "missing" diagnostic names the .blp that wanted it.
                const compiler = resolveBlueprintCompiler();
                if (!compiler) {
                    throw new Error(`${id}: ${formatMissingBlueprintCompiler()}`);
                }

                try {
                    // Compile .blp file and get XML output directly
                    const { stdout } = await execa(compiler.file, [...compiler.prefixArgs, 'compile', id], {
                        // Only ever an overlay (an MSYS2 PATH prepend); undefined
                        // inherits the environment unchanged.
                        env: compiler.env,
                    });
                    if (verbose) console.log(`Compiled ${id} (blueprint-compiler via ${compiler.source})`);

                    let xmlContent = stdout;

                    // Minify XML if option is enabled
                    if (minify) {
                        xmlContent = minifyXML(xmlContent);
                        if (verbose) console.log(`Minified XML for ${id}`);
                    }

                    // Return the XML content as a string
                    return `export default ${JSON.stringify(xmlContent)};`;
                } catch (error) {
                    // The compiler EXISTS and refused the file, so this is a
                    // blueprint syntax/type error and its own stderr is the
                    // useful part — surface that, not an install hint the reader
                    // has already satisfied.
                    const detail =
                        error instanceof Error ? (error as { stderr?: string }).stderr || error.message : String(error);
                    throw new Error(`${id}: blueprint-compiler failed (${compiler.file})\n${detail}`);
                }
            }
        },
    };
}
