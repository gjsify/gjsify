import type { TsConfigJsonResolved } from 'get-tsconfig';

export interface ConfigDataTypescript extends TsConfigJsonResolved {
    /** Enables TypeScript types on runtime using Deepkit's type compiler */
    reflection?: boolean;
}
