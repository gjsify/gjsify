export type CosmiconfigResult<C = any> = {
    config: C;
    filepath: string;
    isEmpty?: boolean;
} | null;