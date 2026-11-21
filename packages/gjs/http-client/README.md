# @gjsify/http-client

A small JSON-over-HTTP client for REST adapters. Plain `fetch`, so it runs on GJS (gjsify's Soup fetch) and Node.

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003)**: tested against a fake `fetch`, not yet against live servers.

## Installation

```bash
gjsify install @gjsify/http-client
```

## Usage

```ts
import { HttpClient, paginateAll } from '@gjsify/http-client';

const client = new HttpClient({
    baseUrl: 'https://cloud.example.org/index.php/apps/deck/api/v1.1/',
    auth: { type: 'app-password', username: 'user@example.org', password }, // or basic / bearer / header
});
const result = await client.getJson<Board[]>('boards', { etag }); // ok | unchanged (304)
const cards = await paginateAll<Card>(client, 'cards', { style: 'offset', pageSize: 50 });
```

- `HttpClient`: base URL, auth (basic, app-password, bearer, or a named header), per-request `timeoutMs` (AbortController), `getJson` with `If-None-Match`; a 304 returns `{ status: 'unchanged' }`. `postJson` and `sendJson` send a JSON body (no ETag revalidation).
- Errors extend `@gjsify/pim`'s `BackendError` (`domain: 'http'`, status in `code`): `UnauthorizedError` (a `BackendAuthError`), `ForbiddenError`, `NotFoundError`, `RateLimitedError` (`retryAfterMs` from `Retry-After`), `ServerError`, `TimeoutError`, `NetworkError`, `ResponseFormatError`.
- `paginate` / `paginateAll`: `Link: rel="next"` (never leaves the origin) and offset/pageSize (`offsetUnit: 'pages'` when the offset is a page number), with a page cap.
- `HostLimiter`: per-host concurrency (default 2) and optional minimum interval.
- Credentials never appear in messages, `toJSON`, or URLs; a request off the base origin is refused.

## What it does not do

No retries (a 401/403 is a decision, a 429 or timeout is the caller's schedule), no robots.txt or compliance gate. The name is `@gjsify/http-client` to stay clear of the Node `http` polyfill (`@gjsify/http`).

## License

MIT
