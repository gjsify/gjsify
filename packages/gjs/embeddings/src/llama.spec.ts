// The llama.cpp engine's pure parts and its availability, against a made-up
// machine and a temporary store. node-llama-cpp is never loaded here.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MachineProbe } from '@gjsify/machine-fit';
import { ModelStore, validateManifest } from '@gjsify/model-store';

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
                expect(entry.footprintBytes > entry.bytes).toBe(true);
            }
        });

        await it('keeps the modelId existing indexes recorded', async () => {
            expect(gemma.modelId).toBe('ggml-org/embeddinggemma-2-GGUF:Q8_0');
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

        rmSync(root, { recursive: true, force: true });
    });
};
