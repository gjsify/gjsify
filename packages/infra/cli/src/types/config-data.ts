import type { BuildOptions as EsbuildOptions} from 'esbuild';
import type { ConfigDataLibrary, ConfigDataTypescript } from './index.js';

export interface ConfigData {
    esbuild?: EsbuildOptions;
    library?: ConfigDataLibrary;
    typescript?: ConfigDataTypescript;
}