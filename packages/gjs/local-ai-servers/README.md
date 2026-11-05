# @gjsify/local-ai-servers

Find the local inference servers that are running (Ollama, LM Studio, llama.cpp's `llama-server`) and the models they have loaded, so an app can reuse a loaded model through the server's OpenAI-compatible endpoint instead of loading a second copy into the same GPU.

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003)**: tested against mocked server responses, not yet against live servers. Design: ADR 0136.

## Installation

```bash
gjsify install @gjsify/local-ai-servers
```

## Usage

```typescript
import { discoverLocalServers, loadedModels } from '@gjsify/local-ai-servers';

const servers = await discoverLocalServers();
const [first] = loadedModels(servers);
if (first) {
    // Hand the endpoint to your own OpenAI-compatible client.
    client.connect({ baseUrl: first.server.openAiBaseUrl, model: first.model.id });
}
```

## What it asks, and what it never does

- Only fixed loopback addresses: Ollama on `127.0.0.1:11434` (or `OLLAMA_HOST`), LM Studio on `127.0.0.1:1234`, `llama-server` on `127.0.0.1:8080`. Never a port scan, never the LAN.
- Only listing endpoints (`/api/tags`, `/api/ps`, `/api/v0/models`, `/v1/models`), each with a 500 ms timeout. Never inference.
- A response with the wrong shape means "not that server". A program that answers the OpenAI listing without identifying itself is reported as `openai-compatible`.
- Nothing runs until the app calls it.

## Options

- `fetch`: injectable; defaults to the runtime's global `fetch`.
- `env`: where `OLLAMA_HOST` is read from; defaults to `process.env`.
- `timeoutMs`: per request.
- `probes`: replace the defaults, for example `[ollamaProbe('http://127.0.0.1:11500')]`.

Each model carries `loaded` (`true`, `false`, or `undefined` when the server does not say) and, for Ollama, `sizeBytes` and `vramBytes`.

## License

MIT
