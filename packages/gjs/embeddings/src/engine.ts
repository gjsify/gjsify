// The engine interface (ADR 0132 § 3): what gjsify's own engines implement,
// and what an app implements for a provider gjsify does not ship. `Embedder`
// wraps one and owns the checks every engine would otherwise repeat.

import type { CreateMonitorCallback } from '@gjsify/model-store';

export { checkVector, normalize, truncateVector } from './vectors.js';
export { embedAcross, type PoolResult } from './pool.js';

/** The WebML CG availability states. */
export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

/**
 * A document as an embedding model sees it. Title and text stay apart because
 * instruction-tuned models give the title its own prompt field.
 */
export interface EmbedDocument {
    readonly title?: string;
    readonly text: string;
}

/** Which engine runs, so a surface can say where the text goes (ADR 0132 § 3). */
export interface EngineInfo {
    readonly name: string;
    readonly locality: 'local' | 'remote';
}

export interface EmbedCallOptions {
    readonly signal?: AbortSignal;
}

/** A loaded model. Every method may be called again after the previous call settled. */
export interface EmbeddingEngine {
    readonly info: EngineInfo;
    /** What produced the vectors, recorded by an index next to them. */
    readonly modelId: string;
    readonly dimensions: number;
    /** Where the vectors are computed right now, when the engine knows; it can change mid-run. */
    readonly backend?: 'gpu' | 'cpu';
    embedQuery(text: string, options?: EmbedCallOptions): Promise<Float32Array>;
    embedDocuments(documents: readonly EmbedDocument[], options?: EmbedCallOptions): Promise<Float32Array[]>;
    destroy(): Promise<void>;
}

export interface EngineCreateOptions {
    readonly monitor?: CreateMonitorCallback;
    readonly signal?: AbortSignal;
}

/** How `Embedder` asks an engine whether it can run, and starts it. */
export interface EmbeddingEngineFactory {
    readonly info: EngineInfo;
    availability(): Promise<Availability>;
    create(options?: EngineCreateOptions): Promise<EmbeddingEngine>;
}
