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
}