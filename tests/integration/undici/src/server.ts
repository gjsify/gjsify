// Shared local HTTP server used by undici's fetch / request specs. Each spec
// starts its own server bound to 127.0.0.1:0 to keep test cases independent
// (no port collisions across parallel suites) and tears it down at the end.
//
// Cross-platform: under Node the `node:http` import resolves to the native
// module; under GJS the bundler's alias layer routes it to `@gjsify/http`
// (Soup-backed). That's the entire point of the suite — undici is a pure-JS
// consumer of the runtime's outgoing HTTP surface, the server side is provided
// by the same gjsify polyfill any consumer would rely on.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestServer {
    readonly url: string;
    readonly port: number;
    close: () => Promise<void>;
    /** Captured per-request snapshot — most recent request received. */
    readonly lastRequest: () => RecordedRequest | undefined;
}

export interface RecordedRequest {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

export interface RouteHandler {
    (req: IncomingMessage, res: ServerResponse, body: string): void | Promise<void>;
}

/**
 * Starts a local http server with one or more routes keyed by `METHOD path`.
 * Falls back to a default 404 handler on unmatched routes. Returns once the
 * server is `listening` on a free port chosen by the OS.
 */
export async function startServer(routes: Record<string, RouteHandler> = {}): Promise<TestServer> {
    let recorded: RecordedRequest | undefined;

    const server: Server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer | string) => {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });
        req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            recorded = {
                method: req.method ?? 'GET',
                url: req.url ?? '/',
                headers: { ...req.headers },
                body,
            };

            const key = `${req.method} ${req.url}`;
            const handler = routes[key] ?? routes['*'] ?? defaultHandler;
            Promise.resolve(handler(req, res, body)).catch((err) => {
                if (!res.headersSent) {
                    res.statusCode = 500;
                    res.setHeader('content-type', 'text/plain');
                    res.end(String(err?.message ?? err));
                }
            });
        });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const addr = server.address() as AddressInfo;
    const port = addr.port;
    const url = `http://127.0.0.1:${port}`;

    return {
        url,
        port,
        async close() {
            await new Promise<void>((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            });
        },
        lastRequest: () => recorded,
    };
}

function defaultHandler(_req: IncomingMessage, res: ServerResponse, _body: string): void {
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain');
    res.end('not found');
}

/** Convenience: respond with JSON. */
export function respondJson(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
}

/** Convenience: respond with text. */
export function respondText(res: ServerResponse, status: number, body: string): void {
    res.statusCode = status;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(body);
}
