export type CosmiconfigResult<C = unknown> = {
    config: C;
    filepath: string;
    isEmpty?: boolean;
} | null;
