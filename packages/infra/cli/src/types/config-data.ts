import type { BuildOptions as EsbuildOptions} from 'esbuild';
import type { ConfigDataLibrary } from './index.js';

export interface ConfigData {
    esbuild?: EsbuildOptions;
    library?: ConfigDataLibrary;
}