import type { BuildOptions as EsbuildOptions} from 'esbuild';
import type { ConfigDataLibrary, ConfigDataTypescript } from './index.js';

export interface ConfigData {
    /** Switch on the verbose mode */
    verbose?: boolean;
    esbuild?: EsbuildOptions;
    library?: ConfigDataLibrary;
    typescript?: ConfigDataTypescript;
    /** An array of glob patterns to exclude matches and aliases */
    exclude?: string[];
    /**
     * Inject a console shim into GJS builds for clean output (no GLib prefix, ANSI colors work).
     * Only applies to GJS app builds. Default: true.
     */
    consoleShim?: boolean;
}