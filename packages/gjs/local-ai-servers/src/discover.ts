/**
 * Which local inference servers are running, and which models they have loaded (ADR 0136).
 *
 * An app that finds a model already loaded in Ollama, LM Studio or llama.cpp's server can use it
 * through that server's OpenAI-compatible endpoint instead of loading a second copy into the
 * same GPU. This module only FINDS them: it reads each server's listing endpoints and returns
 * where to send requests. Inference goes through the app's own OpenAI-compatible client
 * (ADR 0132 decision 6), never through this package.
 *
 * WHAT IT ASKS, AND WHAT IT NEVER DOES. Only the fixed loopback addresses these servers listen on
 * by default, plus `OLLAMA_HOST` when the user set it — never a port scan, never the LAN. Each
 * request has a short timeout, and a response that does not have the expected shape is "not that
 * server", so another program on port 8080 is not mistaken for one. Nothing here runs unless the
 * app calls it.
 */

export type LocalServerKind = 'ollama' | 'lm-studio' | 'llama-cpp' | 'openai-compatible';

export interface LocalModel {
    readonly id: string;
    /** In memory now; `undefined` when the server does not say. */
    readonly loaded: boolean | undefined;
    /** On-disk size, where the server reports it. */
    readonly sizeBytes?: number;
    /** GPU memory the loaded model holds (Ollama's `size_vram`). */
    readonly vramBytes?: number;
}

export interface LocalServer {
    readonly kind: LocalServerKind;
    /** `http://127.0.0.1:11434` — what was asked. */
    readonly origin: string;
    /** Base URL for an OpenAI-compatible client: `<origin>/v1`. */
    readonly openAiBaseUrl: string;
    readonly models: readonly LocalModel[];
}

export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** One kind of server at one address. */
export interface ServerProbe {
    readonly kind: LocalServerKind;
    readonly origin: string;
    detect(getJson: (path: string) => Promise<unknown>): Promise<LocalServer | undefined>;
}

export interface DiscoverOptions {
    readonly fetch?: FetchLike;
    readonly env?: Readonly<Record<string, string | undefined>>;
    /** Per request; a local server answers in milliseconds, a missing one should not cost more. */
    readonly timeoutMs?: number;
    /** Defaults to {@link defaultProbes} for `env`. */
    readonly probes?: readonly ServerProbe[];
}

export const DEFAULT_TIMEOUT_MS = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalBytes = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** `{ "object": "list", "data": [{ "id": … }] }` — the OpenAI model listing every server here has. */
function openAiModels(body: unknown): Record<string, unknown>[] | undefined {
    if (!isRecord(body) || !Array.isArray(body.data)) return undefined;
    const models = body.data.filter(isRecord);
    if (models.length !== body.data.length || !models.every((model) => typeof model.id === 'string')) {
        return undefined;
    }
    return models;
}

/**
 * The address Ollama's own CLI would talk to, read from `OLLAMA_HOST` the way Ollama reads it:
 * scheme optional (`http`), port 11434 unless a scheme is given without one. A server bound to
 * every interface (`0.0.0.0`, `::`) is reached on loopback.
 */
export function ollamaOrigin(env: Readonly<Record<string, string | undefined>> = {}): string {
    const raw = (env.OLLAMA_HOST ?? '').trim();
    if (raw === '') return 'http://127.0.0.1:11434';
    let scheme = 'http';
    let rest = raw;
    let defaultPort = '11434';
    const separator = raw.indexOf('://');
    if (separator >= 0) {
        scheme = raw.slice(0, separator).toLowerCase();
        rest = raw.slice(separator + 3);
        if (scheme === 'http') defaultPort = '80';
        if (scheme === 'https') defaultPort = '443';
    }
    rest = rest.split('/')[0];
    let host = rest;
    let port = defaultPort;
    const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(rest);
    if (bracketed) {
        host = bracketed[1];
        port = bracketed[2] ?? defaultPort;
    } else if (/^[^:]*:\d*$/.test(rest)) {
        [host, port] = rest.split(':');
        if (port === '') port = defaultPort;
    }
    if (host === '' || host === '0.0.0.0') host = '127.0.0.1';
    if (host === '::') host = '::1';
    return `${scheme}://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

export function ollamaProbe(origin: string): ServerProbe {
    return {
        kind: 'ollama',
        origin,
        async detect(getJson) {
            const tags = await getJson('/api/tags');
            if (!isRecord(tags) || !Array.isArray(tags.models)) return undefined;
            const installed = tags.models.filter(isRecord).filter((model) => typeof model.name === 'string');
            // `/api/ps` is what is in memory now; a server too old for it still lists its models.
            const running = await getJson('/api/ps').catch(() => undefined);
            const loaded =
                isRecord(running) && Array.isArray(running.models)
                    ? new Map(
                          running.models
                              .filter(isRecord)
                              .filter((model) => typeof model.name === 'string')
                              .map((model) => [model.name as string, model]),
                      )
                    : undefined;
            const models: LocalModel[] = installed.map((model) => {
                const live = loaded?.get(model.name as string);
                return {
                    id: model.name as string,
                    loaded: loaded === undefined ? undefined : live !== undefined,
                    sizeBytes: optionalBytes(model.size),
                    vramBytes: live === undefined ? undefined : optionalBytes(live.size_vram),
                };
            });
            return { kind: 'ollama', origin, openAiBaseUrl: `${origin}/v1`, models };
        },
    };
}

export function lmStudioProbe(origin = 'http://127.0.0.1:1234'): ServerProbe {
    return {
        kind: 'lm-studio',
        origin,
        async detect(getJson) {
            // LM Studio's own REST API says which models are loaded; `/v1/models` alone does not.
            const native = await getJson('/api/v0/models').catch(() => undefined);
            const nativeModels = openAiModels(native);
            if (nativeModels?.every((model) => typeof model.state === 'string')) {
                const models = nativeModels.map((model) => ({
                    id: model.id as string,
                    loaded: model.state === 'loaded',
                }));
                return { kind: 'lm-studio', origin, openAiBaseUrl: `${origin}/v1`, models };
            }
            // Older versions have only the OpenAI listing, which any server on this port could give.
            const listed = openAiModels(await getJson('/v1/models'));
            if (listed === undefined) return undefined;
            const models = listed.map((model) => ({ id: model.id as string, loaded: undefined }));
            return { kind: 'openai-compatible', origin, openAiBaseUrl: `${origin}/v1`, models };
        },
    };
}

/**
 * llama.cpp's `llama-server`, recognised by `owned_by: "llamacpp"` in its listing. Anything else
 * answering the OpenAI listing on the same port is reported as `openai-compatible` — usable the
 * same way, without the claim about which program it is.
 */
export function llamaCppProbe(origin = 'http://127.0.0.1:8080'): ServerProbe {
    return {
        kind: 'llama-cpp',
        origin,
        async detect(getJson) {
            const listed = openAiModels(await getJson('/v1/models'));
            if (listed === undefined) return undefined;
            const isLlamaCpp = listed.length > 0 && listed.every((model) => model.owned_by === 'llamacpp');
            const models = listed.map((model) => {
                // Router mode lists models it can load, each with its own status.
                const status = isRecord(model.status) ? model.status.value : undefined;
                return {
                    id: model.id as string,
                    loaded: typeof status === 'string' ? status === 'loaded' : isLlamaCpp ? true : undefined,
                };
            });
            return {
                kind: isLlamaCpp ? 'llama-cpp' : 'openai-compatible',
                origin,
                openAiBaseUrl: `${origin}/v1`,
                models,
            };
        },
    };
}

export function defaultProbes(env: Readonly<Record<string, string | undefined>> = {}): ServerProbe[] {
    return [ollamaProbe(ollamaOrigin(env)), lmStudioProbe(), llamaCppProbe()];
}

function jsonGetter(origin: string, fetchFn: FetchLike, timeoutMs: number) {
    return async (path: string): Promise<unknown> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchFn(`${origin}${path}`, { signal: controller.signal });
            if (!response.ok) throw new Error(`${origin}${path}: HTTP ${response.status}`);
            return await response.json();
        } finally {
            clearTimeout(timer);
        }
    };
}

/**
 * Ask every probe at once and return the servers that answered as themselves, in probe order.
 * A server that is down, slow or something else is left out, never an error.
 */
export async function discoverLocalServers(options: DiscoverOptions = {}): Promise<LocalServer[]> {
    const fetchFn = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const probes = options.probes ?? defaultProbes(options.env ?? globalThis.process?.env ?? {});
    const found = await Promise.all(
        probes.map((probe) => probe.detect(jsonGetter(probe.origin, fetchFn, timeoutMs)).catch(() => undefined)),
    );
    return found.filter((server): server is LocalServer => server !== undefined);
}

/** Every loaded model across `servers`, with the server to reach it through. */
export function loadedModels(servers: readonly LocalServer[]): { server: LocalServer; model: LocalModel }[] {
    return servers.flatMap((server) =>
        server.models.filter((model) => model.loaded === true).map((model) => ({ server, model })),
    );
}
