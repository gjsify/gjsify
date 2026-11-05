// The local engine: a GGUF embedding model through node-llama-cpp, on Node and
// on GJS.
//
// Its own subpath, imported only by an app that wants it: node-llama-cpp and
// its prebuilt binaries are optional peers, and the root of this package must
// bundle without them. Evaluating this module loads no addon and no model;
// that happens in `create()`.
//
// The import is static on purpose. Bundled for GJS, a dynamic
// `import('node-llama-cpp')` never settles: its modules with top-level await
// become lazy async initialisers, and the import hangs without an error.
//
// An app bundle for GJS needs one alias, `ipull` → `ipull/node`: gjsify
// resolves with the `browser` condition, and ipull's browser build lacks the
// `downloadFile` node-llama-cpp's model downloader imports. This engine never
// downloads through it, but the barrel has to link.

// @ts-ignore TS2307: an optional peer, not installed in this repository
import * as nodeLlamaCpp from 'node-llama-cpp';

import type { EmbeddingEngineFactory } from './engine.js';
import { createLlamaEmbeddings, type LlamaEmbeddingsOptions, type NodeLlamaCpp } from './llama-engine.js';

export { DEFAULT_GPU_CONTEXTS, DEFAULT_THREADS, LLAMA_ENGINE, type LlamaEmbeddingsOptions } from './llama-engine.js';
export { DEFAULT_EMBEDDING_MODEL, EMBEDDING_MODELS, type EmbeddingModelEntry } from './llama-models.js';
export { collectGarbage } from './llama-runtime.js';

/** The llama.cpp engine factory, for `Embedder.availability()` and `Embedder.create()`. */
export function llamaEmbeddings(options: LlamaEmbeddingsOptions = {}): EmbeddingEngineFactory {
    return createLlamaEmbeddings(nodeLlamaCpp as unknown as NodeLlamaCpp, options);
}
