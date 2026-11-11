// Shared catalog entries for text-embedding models.
//
// These entries hold only the measured file facts and metadata that belong in
// the shared catalog. Capability-specific runtime behaviour (modelId,
// dimensions, truncations, prompt templates, contextTokens, footprintBytes) is
// composed on top in the embeddings package.

import type { CatalogEntry } from './index.js';

export const EMBEDDING_MODELS: readonly CatalogEntry[] = [
    {
        id: 'embeddinggemma-2-q8_0',
        capability: 'embeddings',
        files: [
            {
                file: 'embeddinggemma-2-Q8_0.gguf',
                url: 'https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/58faf90940886df2d62be555c8765d00dac362c5/embeddinggemma-2-Q8_0.gguf',
                bytes: 309855456,
                sha256: '2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135',
            },
        ],
        license: 'Apache-2.0',
        redistributable: true,
        description: 'EmbeddingGemma 2, Q8_0 (296 MiB): multilingual, 768 dimensions, truncatable to 256.',
    },
];
