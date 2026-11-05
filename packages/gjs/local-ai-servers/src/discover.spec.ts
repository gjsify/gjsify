import { describe, it, expect } from '@gjsify/unit';
import {
    discoverLocalServers,
    llamaCppProbe,
    lmStudioProbe,
    loadedModels,
    ollamaOrigin,
    ollamaProbe,
    type FetchLike,
} from './index.js';

type Routes = Record<string, unknown | (() => Promise<unknown>)>;

/** Answers `routes[url]` as JSON; an unknown URL is a refused connection, as on a real machine. */
function fakeFetch(routes: Routes) {
    const asked: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
        asked.push(url);
        if (!(url in routes)) throw new TypeError(`connect ECONNREFUSED ${url}`);
        const route = routes[url];
        if (typeof route === 'function') {
            return await new Promise<Response>((resolve, reject) => {
                init.signal.addEventListener('abort', () => reject(new Error('aborted')));
                (route as () => Promise<unknown>)().then((body) => resolve(new Response(JSON.stringify(body))));
            });
        }
        if (route instanceof Response) return route;
        return new Response(JSON.stringify(route), { headers: { 'content-type': 'application/json' } });
    };
    return { asked, fetchFn };
}

const OLLAMA = 'http://127.0.0.1:11434';
const LM_STUDIO = 'http://127.0.0.1:1234';
const LLAMA_CPP = 'http://127.0.0.1:8080';
const GIB = 1024 ** 3;

const ollamaRoutes: Routes = {
    [`${OLLAMA}/api/tags`]: {
        models: [
            { name: 'qwen3:8b', size: 5 * GIB },
            { name: 'nomic-embed-text:latest', size: 0.3 * GIB },
        ],
    },
    [`${OLLAMA}/api/ps`]: { models: [{ name: 'qwen3:8b', size: 6 * GIB, size_vram: 6 * GIB }] },
};

export default async () => {
    await describe('ollamaOrigin', async () => {
        await it('defaults to loopback on 11434', async () => {
            expect(ollamaOrigin({})).toBe('http://127.0.0.1:11434');
            expect(ollamaOrigin({ OLLAMA_HOST: '' })).toBe('http://127.0.0.1:11434');
        });
        await it('reads host, port and scheme the way Ollama does', async () => {
            expect(ollamaOrigin({ OLLAMA_HOST: 'localhost:11500' })).toBe('http://localhost:11500');
            expect(ollamaOrigin({ OLLAMA_HOST: 'box.lan' })).toBe('http://box.lan:11434');
            expect(ollamaOrigin({ OLLAMA_HOST: 'https://box.lan' })).toBe('https://box.lan:443');
            expect(ollamaOrigin({ OLLAMA_HOST: 'http://box.lan:9000/' })).toBe('http://box.lan:9000');
        });
        await it('reaches a server bound to every interface on loopback', async () => {
            expect(ollamaOrigin({ OLLAMA_HOST: '0.0.0.0' })).toBe('http://127.0.0.1:11434');
            expect(ollamaOrigin({ OLLAMA_HOST: '0.0.0.0:11434' })).toBe('http://127.0.0.1:11434');
            expect(ollamaOrigin({ OLLAMA_HOST: '[::]:11434' })).toBe('http://[::1]:11434');
            expect(ollamaOrigin({ OLLAMA_HOST: '::1' })).toBe('http://[::1]:11434');
        });
    });

    await describe('discoverLocalServers', async () => {
        await it('finds nothing when nothing listens, and asks only the loopback defaults', async () => {
            const { asked, fetchFn } = fakeFetch({});
            expect(await discoverLocalServers({ fetch: fetchFn, env: {} })).toStrictEqual([]);
            for (const url of asked) expect(url.startsWith('http://127.0.0.1:')).toBe(true);
        });

        await it('reports Ollama with its loaded models and their VRAM', async () => {
            const { fetchFn } = fakeFetch(ollamaRoutes);
            const [server] = await discoverLocalServers({ fetch: fetchFn, env: {} });
            expect(server.kind).toBe('ollama');
            expect(server.openAiBaseUrl).toBe(`${OLLAMA}/v1`);
            expect(server.models).toStrictEqual([
                { id: 'qwen3:8b', loaded: true, sizeBytes: 5 * GIB, vramBytes: 6 * GIB },
                { id: 'nomic-embed-text:latest', loaded: false, sizeBytes: 0.3 * GIB, vramBytes: undefined },
            ]);
        });

        await it('honours OLLAMA_HOST', async () => {
            const { asked, fetchFn } = fakeFetch({});
            await discoverLocalServers({ fetch: fetchFn, env: { OLLAMA_HOST: '127.0.0.1:11500' } });
            expect(asked.includes('http://127.0.0.1:11500/api/tags')).toBe(true);
            expect(asked.includes(`${OLLAMA}/api/tags`)).toBe(false);
        });

        await it('keeps an Ollama without /api/ps, with loaded unknown', async () => {
            const { fetchFn } = fakeFetch({ [`${OLLAMA}/api/tags`]: ollamaRoutes[`${OLLAMA}/api/tags`] });
            const [server] = await discoverLocalServers({ fetch: fetchFn, env: {} });
            expect(server.models[0].loaded).toBe(undefined);
        });

        await it('reads which LM Studio models are loaded', async () => {
            const { fetchFn } = fakeFetch({
                [`${LM_STUDIO}/api/v0/models`]: {
                    object: 'list',
                    data: [
                        { id: 'qwen2.5-7b-instruct', state: 'loaded' },
                        { id: 'gemma-3-4b', state: 'not-loaded' },
                    ],
                },
            });
            const [server] = await discoverLocalServers({ fetch: fetchFn, env: {} });
            expect(server.kind).toBe('lm-studio');
            expect(server.models.map((model) => model.loaded)).toStrictEqual([true, false]);
        });

        await it('names a plain OpenAI listing on 1234 openai-compatible, not LM Studio', async () => {
            const { fetchFn } = fakeFetch({
                [`${LM_STUDIO}/v1/models`]: { object: 'list', data: [{ id: 'some-model' }] },
            });
            const [server] = await discoverLocalServers({ fetch: fetchFn, env: {} });
            expect(server.kind).toBe('openai-compatible');
            expect(server.models[0].loaded).toBe(undefined);
        });

        await it('recognises llama-server by owned_by', async () => {
            const { fetchFn } = fakeFetch({
                [`${LLAMA_CPP}/v1/models`]: {
                    object: 'list',
                    data: [{ id: 'gemma-3-4b-it-Q4_K_M.gguf', owned_by: 'llamacpp' }],
                },
            });
            const [server] = await discoverLocalServers({ fetch: fetchFn, env: {} });
            expect(server.kind).toBe('llama-cpp');
            expect(server.models[0].loaded).toBe(true);
        });

        await it('ignores a program on a known port that answers something else', async () => {
            const { fetchFn } = fakeFetch({
                [`${LLAMA_CPP}/v1/models`]: { status: 'ok', version: 3 },
                [`${OLLAMA}/api/tags`]: '<html>admin panel</html>',
                [`${LM_STUDIO}/api/v0/models`]: new Response('not json'),
            });
            expect(await discoverLocalServers({ fetch: fetchFn, env: {} })).toStrictEqual([]);
        });

        await it('treats an HTTP error as no server', async () => {
            const { fetchFn } = fakeFetch({ [`${LLAMA_CPP}/v1/models`]: new Response('', { status: 404 }) });
            expect(await discoverLocalServers({ fetch: fetchFn, env: {} })).toStrictEqual([]);
        });

        await it('gives up on a server that does not answer within the timeout', async () => {
            const { fetchFn } = fakeFetch({
                [`${OLLAMA}/api/tags`]: () => new Promise(() => undefined),
            });
            const started = Date.now();
            const found = await discoverLocalServers({
                fetch: fetchFn,
                timeoutMs: 50,
                probes: [ollamaProbe(OLLAMA)],
            });
            expect(found).toStrictEqual([]);
            expect(Date.now() - started < 2000).toBe(true);
        });

        await it('returns servers in probe order', async () => {
            const { fetchFn } = fakeFetch({
                ...ollamaRoutes,
                [`${LLAMA_CPP}/v1/models`]: { object: 'list', data: [{ id: 'm', owned_by: 'llamacpp' }] },
            });
            const found = await discoverLocalServers({
                fetch: fetchFn,
                probes: [llamaCppProbe(), lmStudioProbe(), ollamaProbe(OLLAMA)],
            });
            expect(found.map((server) => server.kind)).toStrictEqual(['llama-cpp', 'ollama']);
        });
    });

    await describe('loadedModels', async () => {
        await it('lists only models known to be loaded, with their server', async () => {
            const { fetchFn } = fakeFetch(ollamaRoutes);
            const loaded = loadedModels(await discoverLocalServers({ fetch: fetchFn, env: {} }));
            expect(loaded.map(({ server, model }) => `${server.kind}:${model.id}`)).toStrictEqual(['ollama:qwen3:8b']);
        });
    });
};
