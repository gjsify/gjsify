// The llama.cpp engine's pure parts and its availability, against a made-up
// machine and a temporary store. node-llama-cpp is never loaded here.

import { describe, expect, it } from '@gjsify/unit';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MachineProbe } from '@gjsify/machine-fit';
import { ModelStore, validateManifest } from '@gjsify/model-store';
import { requireCatalogEntry } from '@gjsify/model-store/catalog';

import { createLlamaEmbeddings, type LlamaEmbeddingsOptions, type NodeLlamaCpp } from './llama-engine.js';
import { backendCandidates, currentTarget, hasPrebuiltBins } from './llama-bins.js';
import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_MODELS, type EmbeddingModelEntry } from './llama-models.js';
import { documentPrompt, fitTokens, queryPrompt } from './llama-prompts.js';
import { runningOnGjs } from './llama-runtime.js';

const GIB = 1024 ** 3;

/** A machine with no GPU in sysfs; `files` makes paths exist. */
function machine(init: { platform?: string; arch?: string; freemem?: number; files?: string[] } = {}): MachineProbe {
    const files = init.files ?? [];
    return {
        env: {},
        platform: init.platform ?? 'linux',
        arch: init.arch ?? 'x64',
        exists: (path: string) => files.some((file) => file === path || file.startsWith(`${path}/`)),
        list: (dir: string) =>
            files.filter((file) => file.startsWith(`${dir}/`)).map((file) => file.slice(dir.length + 1).split('/')[0]),
        read: () => undefined,
        run: () => undefined,
        totalmem: () => 16 * GIB,
        freemem: () => init.freemem ?? 8 * GIB,
    };
}

const vulkanMachine = machine({
    files: ['/usr/lib64/libvulkan.so.1', '/usr/share/vulkan/icd.d/radeon_icd.x86_64.json'],
});

/** availability() never reaches node-llama-cpp; any call into it is a bug. */
const noNodeLlamaCpp = new Proxy(
    {},
    {
        get: () => {
            throw new Error('node-llama-cpp touched');
        },
    },
) as NodeLlamaCpp;
const llamaEmbeddings = (options: LlamaEmbeddingsOptions) => createLlamaEmbeddings(noNodeLlamaCpp, options);

const gemma = EMBEDDING_MODELS.find((entry) => entry.id === DEFAULT_EMBEDDING_MODEL) as EmbeddingModelEntry;

export default async () => {
    await describe('EMBEDDING_MODELS', async () => {
        await it('is a valid manifest whose default exists', async () => {
            validateManifest(EMBEDDING_MODELS);
            expect(gemma).toBeDefined();
        });

        await it('lists the native size first among the truncations', async () => {
            for (const entry of EMBEDDING_MODELS) {
                expect(entry.truncations[0]).toBe(entry.dimensions);
                const modelBytes = entry.files.reduce((sum, file) => sum + file.bytes, 0);
                expect(entry.footprintBytes > modelBytes).toBe(true);
            }
        });

        await it('keeps the modelId existing indexes recorded', async () => {
            expect(gemma.modelId).toBe('ggml-org/embeddinggemma-2-GGUF:Q8_0');
        });

        await it('keeps the measured file facts of the releases that cached them', async () => {
            const gemmaFile = gemma.files[0];
            expect(gemmaFile.file).toBe('embeddinggemma-2-Q8_0.gguf');
            expect(gemmaFile.bytes).toBe(309855456);
            expect(gemmaFile.sha256).toBe('2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135');
            expect(gemmaFile.url).toBe(
                'https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/58faf90940886df2d62be555c8765d00dac362c5/embeddinggemma-2-Q8_0.gguf',
            );
        });

        await it('keeps file facts identical to the shared catalog', async () => {
            for (const entry of EMBEDDING_MODELS) {
                const catalog = requireCatalogEntry('embeddings', entry.id);
                expect(entry.files).toStrictEqual(catalog.files);
                expect(entry.license).toBe(catalog.license);
                expect(entry.redistributable).toBe(catalog.redistributable);
                expect(entry.description).toBe(catalog.description);
            }
        });
    });

    await describe('prompts', async () => {
        await it('formats a query and a document the way EmbeddingGemma was trained', async () => {
            expect(queryPrompt(gemma, 'cats')).toBe('task: search result | query: cats');
            expect(documentPrompt(gemma, { title: 'Pets', text: 'cats' })).toBe('title: Pets | text: cats');
        });

        await it('uses the empty-title word for a missing or blank title', async () => {
            expect(documentPrompt(gemma, { text: 'x' })).toBe('title: none | text: x');
            expect(documentPrompt(gemma, { title: '  ', text: 'x' })).toBe('title: none | text: x');
        });

        await it('inserts text literally, $-patterns included', async () => {
            expect(queryPrompt(gemma, "$& $' $1")).toBe("task: search result | query: $& $' $1");
        });

        await it('cuts input to the context by tokens', async () => {
            const tokenizer = {
                tokenize: (text: string) => [...text].map((char) => char.charCodeAt(0)),
                detokenize: (tokens: readonly number[]) => String.fromCharCode(...tokens),
            };
            expect(fitTokens(tokenizer, 'short', 512)).toBe('short');
            expect(fitTokens(tokenizer, 'x'.repeat(600), 512).length).toBe(504);
        });
    });

    await describe('prebuilt binaries', async () => {
        await it('names the target as node-llama-cpp does', async () => {
            expect(currentTarget(machine({ platform: 'linux', arch: 'arm64' }))).toBe('linux-arm64');
        });

        await it('answers per runtime', async () => {
            expect(hasPrebuiltBins('linux-x64', true)).toBe(true);
            expect(hasPrebuiltBins('darwin-arm64', true)).toBe(false);
            expect(hasPrebuiltBins('darwin-arm64', false)).toBe(true);
            expect(hasPrebuiltBins('freebsd-x64', false)).toBe(false);
        });

        await it('tries Vulkan first only where it is usable', async () => {
            expect(backendCandidates('linux-x64', 'auto', vulkanMachine)).toStrictEqual([
                'linux-x64-vulkan',
                'linux-x64',
            ]);
            expect(backendCandidates('linux-x64', 'auto', machine())).toStrictEqual(['linux-x64']);
            expect(backendCandidates('linux-x64', 'on', machine())).toStrictEqual(['linux-x64-vulkan', 'linux-x64']);
            expect(backendCandidates('linux-x64', 'off', vulkanMachine)).toStrictEqual(['linux-x64']);
            expect(backendCandidates('linux-arm64', 'on', vulkanMachine)).toStrictEqual(['linux-arm64']);
        });
    });

    await describe('runningOnGjs', async () => {
        await it('needs both imports and a GJS version', async () => {
            expect(runningOnGjs({ imports: {}, process: { versions: { gjs: '1.86' } } })).toBe(true);
            expect(runningOnGjs({ imports: {}, process: { versions: {} } })).toBe(false);
            expect(runningOnGjs({ process: { versions: { gjs: '1.86' } } })).toBe(false);
        });
    });

    await describe('llamaEmbeddings', async () => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-embeddings-'));
        const store = new ModelStore({
            capability: 'embeddings',
            models: EMBEDDING_MODELS,
            defaultModel: DEFAULT_EMBEDDING_MODEL,
            root,
            fetch: async () => {
                throw new Error('no network in tests');
            },
        });

        await it('refuses a size the model was not trained for', async () => {
            expect(() => llamaEmbeddings({ store, dimensions: 300 })).toThrow(/768 or 256/);
            expect(() => llamaEmbeddings({ store, model: 'nope' })).toThrow();
        });

        await it('is downloadable on a machine that fits and lacks the file', async () => {
            const engine = llamaEmbeddings({ store, dimensions: 256, probe: machine() });
            expect(engine.info).toStrictEqual({ name: 'llama.cpp', locality: 'local' });
            expect(await engine.availability()).toBe('downloadable');
        });

        await it('is unavailable without binaries or without the memory', async () => {
            const freebsd = machine({ platform: 'freebsd' });
            expect(await llamaEmbeddings({ store, probe: freebsd }).availability()).toBe('unavailable');
            const tight = machine({ freemem: 100 * 1024 * 1024 });
            expect(await llamaEmbeddings({ store, probe: tight }).availability()).toBe('unavailable');
        });

        await it('treats modelPath as a directory, not a file', async () => {
            const modelDir = mkdtempSync(join(tmpdir(), 'gjsify-embeddings-modelpath-'));
            const cacheRoot = mkdtempSync(join(tmpdir(), 'gjsify-embeddings-root-'));
            try {
                const payload = new TextEncoder().encode('tiny model');
                const digest = createHash('sha256').update(payload).digest('hex');
                const tinyEntry: EmbeddingModelEntry = {
                    id: 'tiny',
                    files: [
                        {
                            file: 'tiny.gguf',
                            url: 'https://example.org/tiny.gguf',
                            bytes: payload.length,
                            sha256: digest,
                        },
                    ],
                    license: 'MIT',
                    redistributable: true,
                    modelId: 'tiny',
                    dimensions: 256,
                    truncations: [256],
                    queryTemplate: '{text}',
                    documentTemplate: '{text}',
                    emptyTitle: 'none',
                    contextTokens: 512,
                    footprintBytes: 1024,
                };
                writeFileSync(join(modelDir, 'tiny.gguf'), payload);
                const tinyStore = new ModelStore<EmbeddingModelEntry>({
                    capability: 'embeddings',
                    models: [tinyEntry],
                    defaultModel: 'tiny',
                    root: cacheRoot,
                });
                const engine = llamaEmbeddings({
                    store: tinyStore,
                    modelPath: modelDir,
                    dimensions: 256,
                    probe: machine(),
                });
                expect(await engine.availability()).toBe('available');
                const filePath = join(modelDir, 'tiny.gguf');
                expect(() => llamaEmbeddings({ store: tinyStore, modelPath: filePath, dimensions: 256 })).toThrow(
                    /directory/,
                );
            } finally {
                rmSync(modelDir, { recursive: true, force: true });
                rmSync(cacheRoot, { recursive: true, force: true });
            }
        });

        rmSync(root, { recursive: true, force: true });
    });
};
