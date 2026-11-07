// The GGUF embedding models the llama.cpp engine can fetch (ADR 0132 § 5).
//
// `bytes` and `sha256` are measured from the pinned upstream file and are the
// whole verification; updating a model means re-measuring both. The URL pins a
// revision, so a re-upload under the same name fails the digest instead of
// changing the vectors under an existing index.

import type { ModelEntry } from '@gjsify/model-store';

export interface EmbeddingModelEntry extends ModelEntry {
    /**
     * What an index records next to the vectors (`Embedder.modelId`). Never
     * changes for an entry: a new value makes every existing index stale.
     */
    readonly modelId: string;
    /** Native vector size. */
    readonly dimensions: number;
    /** Sizes the model was trained to be truncated to (Matryoshka), largest first. */
    readonly truncations: readonly number[];
    /** The query prompt; `{text}` is replaced. */
    readonly queryTemplate: string;
    /** The document prompt; `{title}` and `{text}` are replaced. */
    readonly documentTemplate: string;
    /** What `{title}` becomes for a document without one. */
    readonly emptyTitle: string;
    /** Tokens per context. Longer input is cut to fit (`fitTokens`). */
    readonly contextTokens: number;
    /**
     * Memory one loaded copy needs, runtime included, for `checkFit`
     * (ADR 0136 § 6). Measured, not derived from the file size.
     */
    readonly footprintBytes: number;
}

export const DEFAULT_EMBEDDING_MODEL = 'embeddinggemma-2-q8_0';

export const EMBEDDING_MODELS: readonly EmbeddingModelEntry[] = [
    {
        id: DEFAULT_EMBEDDING_MODEL,
        file: 'embeddinggemma-2-Q8_0.gguf',
        url: 'https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/58faf90940886df2d62be555c8765d00dac362c5/embeddinggemma-2-Q8_0.gguf',
        bytes: 309855456,
        sha256: '2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135',
        license: 'Apache-2.0',
        redistributable: true,
        modelId: 'ggml-org/embeddinggemma-2-GGUF:Q8_0',
        description: 'EmbeddingGemma 2, Q8_0 (296 MiB): multilingual, 768 dimensions, truncatable to 256.',
        dimensions: 768,
        truncations: [768, 256],
        queryTemplate: 'task: search result | query: {text}',
        documentTemplate: 'title: {title} | text: {text}',
        emptyTitle: 'none',
        // Fixed, not llama.cpp's "auto", which sizes the KV cache by the machine's RAM
        // (gigabytes on a 64 GB box) for documents a few hundred tokens long.
        contextTokens: 512,
        // The whole embedding process held 0.85 GB flat over a 1500-document run with one
        // collection per batch (see `collectGarbage`), measured under GJS.
        footprintBytes: 850 * 1024 * 1024,
    },
];
