import type { TSConfig } from 'pkg-types';

export interface ConfigDataTypescript extends TSConfig {
    /** Enables TypeScript types on runtime using Deepkit's type compiler */
    reflection?: boolean;
}
