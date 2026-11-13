import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

// `index.js` first: it imports `edge.js` and reads `createEdgeBackend` while it
// evaluates, so entering the cycle from `edge.js` would hit the TDZ.
import {
    createStoreBackend,
    isIdempotentSkip,
    StoreApiError,
    StoreInReviewError,
    StoreVersionAlreadyThereError,
    STORES,
    type StoreBackend,
} from './index.js';
import { createEdgeBackend, operationIdFrom } from './edge.js';

const CANARY = 'gjsify-canary-9f3c1b7a';
const CLIENT = 'gjsify-client-4d2e8a10';
const PRODUCT = 'd34f98f5-f9b7-42b1-bebb-98707202b21d';
const CREDENTIALS = {
    EDGE_ADDONS_PRODUCT_ID: PRODUCT,
    EDGE_ADDONS_CLIENT_ID: CLIENT,
    EDGE_ADDONS_API_KEY: CANARY,
};
const ROOT = `https://api.addons.microsoftedge.microsoft.com/v1/products/${PRODUCT}`;

interface Seen {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
}

interface Reply {
    status: number;
    body?: string;
    headers?: Record<string, string>;
}

/** A fetch that answers from a queue and records what it was asked. */
function fakeFetch(replies: Reply[]): { fetchImpl: typeof fetch; seen: Seen[] } {
    const seen: Seen[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
        seen.push({
            url,
            method: String(init.method),
            headers: init.headers as Record<string, string>,
            body: init.body,
        });
        const reply = replies.shift();
        if (reply === undefined) throw new Error('unexpected request');
        return new Response(reply.body ?? null, { status: reply.status, headers: reply.headers });
    }) as unknown as typeof fetch;
    return { fetchImpl, seen };
}

function backendWith(replies: Reply[], logs?: string[]): { backend: StoreBackend; seen: Seen[] } {
    const { fetchImpl, seen } = fakeFetch(replies);
    const backend = createEdgeBackend(CREDENTIALS, { fetchImpl, log: logs ? (m) => logs.push(m) : undefined });
    return { backend, seen };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a rejection');
}

const op = (status: string, extra: Record<string, unknown> = {}): Reply => ({
    status: 200,
    body: JSON.stringify({ id: 'op1', status, message: null, errorCode: null, errors: null, ...extra }),
});

export default async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-edge-spec-'));
    const zipPath = join(dir, 'ext.zip');
    writeFileSync(zipPath, new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]));

    try {
        await describe('webext stores: edge upload and publish', async () => {
            await it('uploads the zip with the v1.1 headers and reads the operation id from Location', async () => {
                const { backend, seen } = backendWith([{ status: 202, headers: { Location: 'op-123' } }]);
                const result = await backend.upload({ zipPath, version: '1.2.3' });
                expect(result.operationId).toBe('op-123');
                expect(result.ingested).toBe(false);
                expect(seen.length).toBe(1);
                expect(seen[0]!.method).toBe('POST');
                expect(seen[0]!.url).toBe(`${ROOT}/submissions/draft/package`);
                expect(seen[0]!.headers['Authorization']).toBe(`ApiKey ${CANARY}`);
                expect(seen[0]!.headers['X-ClientID']).toBe(CLIENT);
                expect(seen[0]!.headers['Content-Type']).toBe('application/zip');
                expect((seen[0]!.body as Uint8Array).length).toBe(7);
                expect(result.detail.includes(CANARY)).toBe(false);
            });

            await it('keeps the last path segment of a Location that is a path or URL', async () => {
                expect(operationIdFrom('op-1')).toBe('op-1');
                expect(operationIdFrom(`/v1/products/${PRODUCT}/submissions/operations/op-2?x=1`)).toBe('op-2');
                expect(operationIdFrom(null)).toBe(null);
                expect(operationIdFrom('  ')).toBe(null);
            });

            await it('refuses a 202 without a Location header', async () => {
                const { backend } = backendWith([{ status: 202 }]);
                const error = await rejection(backend.upload({ zipPath, version: '1.0.0' }));
                expect(error instanceof StoreApiError).toBe(true);
                expect(error.message).toContain('no Location header');
            });

            await it('publishes the notes as JSON by default and returns the pending operation', async () => {
                const { backend, seen } = backendWith([{ status: 202, headers: { Location: 'pub-9' } }]);
                const result = await backend.publish({ version: '1.2.3', notes: 'fixed a bug' });
                expect(result.operationId).toBe('pub-9');
                expect(result.state).toBe('unknown');
                expect(seen[0]!.url).toBe(`${ROOT}/submissions`);
                expect(seen[0]!.headers['Content-Type']).toBe('application/json');
                expect(seen[0]!.body).toBe('{"notes":"fixed a bug"}');
            });
        });

        await describe('webext stores: edge operations', async () => {
            await it('reads an upload operation as in-progress, then succeeded', async () => {
                const { backend, seen } = backendWith([
                    op('InProgress'),
                    op('Succeeded', { message: 'Successfully updated package to ext.zip' }),
                ]);
                const first = await backend.operation!('upload', 'op-1');
                expect(first.state).toBe('in-progress');
                const second = await backend.operation!('upload', 'op-1');
                expect(second.state).toBe('succeeded');
                expect(second.detail).toContain('Successfully updated');
                expect(seen[0]!.url).toBe(`${ROOT}/submissions/draft/package/operations/op-1`);
                expect(seen[0]!.method).toBe('GET');
            });

            await it('reads a publish operation from the submissions path', async () => {
                const { backend, seen } = backendWith([op('Succeeded')]);
                await backend.operation!('publish', 'op-2');
                expect(seen[0]!.url).toBe(`${ROOT}/submissions/operations/op-2`);
            });

            await it('maps NoModulesUpdated to "already there" — an idempotent skip', async () => {
                const { backend } = backendWith([
                    op('Failed', { errorCode: 'NoModulesUpdated', message: 'nothing new' }),
                ]);
                const error = await rejection(backend.operation!('publish', 'op', '1.2.3'));
                expect(error instanceof StoreVersionAlreadyThereError).toBe(true);
                expect(error.message).toContain('1.2.3');
                expect(isIdempotentSkip(error)).toBe(true);
            });

            await it('maps InProgressSubmission to "in review" — an idempotent skip', async () => {
                const { backend } = backendWith([
                    op('Failed', { errorCode: 'InProgressSubmission', message: 'submission in progress' }),
                ]);
                const error = await rejection(backend.operation!('publish', 'op'));
                expect(error instanceof StoreInReviewError).toBe(true);
                expect(isIdempotentSkip(error)).toBe(true);
            });

            await it('maps SubmissionValidationError and ModuleStateUnPublishable to a real failure with the reasons', async () => {
                const validation = backendWith([
                    op('Failed', {
                        errorCode: 'SubmissionValidationError',
                        message: 'validation',
                        errors: ['icon too small'],
                    }),
                ]);
                const a = await rejection(validation.backend.operation!('publish', 'op'));
                expect(a instanceof StoreApiError).toBe(true);
                expect(a.message).toContain('SubmissionValidationError');
                expect(a.message).toContain('icon too small');
                expect(isIdempotentSkip(a)).toBe(false);

                const module = backendWith([
                    op('Failed', {
                        errorCode: 'ModuleStateUnPublishable',
                        errors: [{ message: 'Invalid module : Listing' }],
                    }),
                ]);
                const b = await rejection(module.backend.operation!('publish', 'op'));
                expect(b instanceof StoreApiError).toBe(true);
                expect(b.message).toContain('Invalid module : Listing');
            });

            await it('treats a failed operation without a reason, a non-JSON body and an unknown status as errors', async () => {
                const bare = backendWith([op('Failed')]);
                expect((await rejection(bare.backend.operation!('upload', 'op'))).message).toContain(
                    'without a reason',
                );
                const html = backendWith([{ status: 200, body: '<html>' }]);
                expect((await rejection(html.backend.operation!('upload', 'op'))).message).toContain('not JSON');
                const odd = backendWith([op('Weird')]);
                expect((await rejection(odd.backend.operation!('upload', 'op'))).message).toContain(
                    'unrecognised status',
                );
            });
        });

        await describe('webext stores: edge status', async () => {
            await it('says unknown when no publish ran in this backend — it invents no state', async () => {
                const { backend, seen } = backendWith([]);
                const result = await backend.status();
                expect(result.state).toBe('unknown');
                expect(seen.length).toBe(0);
            });

            await it('reads the last publish operation', async () => {
                const { backend } = backendWith([
                    { status: 202, headers: { Location: 'pub-1' } },
                    op('Succeeded', { message: 'Successfully created submission with ID 7' }),
                ]);
                await backend.publish({ version: '2.0.0' });
                const result = await backend.status();
                expect(result.state).toBe('in-review');
                expect(result.version).toBe('2.0.0');
            });
        });

        await describe('webext stores: edge http errors', async () => {
            await it('names the 72-day expiry and the renewal path on a 401, flagged as unverified', async () => {
                const { backend } = backendWith([{ status: 401, body: `bad key ${CANARY}` }]);
                const error = await rejection(backend.upload({ zipPath, version: '1.0.0' }));
                expect(error instanceof StoreApiError).toBe(true);
                expect(error.message).toContain('HTTP 401');
                expect(error.message).toContain('72 days');
                expect(error.message).toContain('unverified');
                expect(error.message).toContain('Create API credentials');
                expect(error.message).toContain('Publish API');
                expect(error.message.includes(CANARY)).toBe(false);
            });

            await it('explains a 404, a 429 and a 500', async () => {
                const e404 = await rejection(backendWith([{ status: 404 }]).backend.operation!('upload', 'x'));
                expect(e404.message).toContain('EDGE_ADDONS_PRODUCT_ID');
                const e429 = await rejection(backendWith([{ status: 429 }]).backend.operation!('upload', 'x'));
                expect(e429.message).toContain('throttled');
                const e500 = await rejection(
                    backendWith([{ status: 500, body: 'boom' }]).backend.operation!('upload', 'x'),
                );
                expect(e500.message).toContain('HTTP 500');
                expect(e500.message).toContain('boom');
            });

            await it('wraps a network failure and redacts anything it echoes', async () => {
                const fetchImpl = (async () => {
                    throw new Error(`connect failed for ApiKey ${CANARY} / ${CLIENT}`);
                }) as unknown as typeof fetch;
                const backend = createEdgeBackend(CREDENTIALS, { fetchImpl });
                const error = await rejection(backend.upload({ zipPath, version: '1.0.0' }));
                expect(error instanceof StoreApiError).toBe(true);
                expect(error.message).toContain('request failed');
                expect(error.message.includes(CANARY)).toBe(false);
                expect(error.message.includes(CLIENT)).toBe(false);
            });

            await it('keeps both credentials out of every message and every log line', async () => {
                const logs: string[] = [];
                const { backend } = backendWith(
                    [
                        { status: 202, headers: { Location: 'op' } },
                        { status: 400, body: `echo ${CANARY} ${CLIENT}` },
                    ],
                    logs,
                );
                await backend.upload({ zipPath, version: '1.0.0' });
                const error = await rejection(backend.publish({ version: '1.0.0' }));
                expect(logs.length > 0).toBe(true);
                for (const text of [...logs, error.message]) {
                    expect(text.includes(CANARY)).toBe(false);
                    expect(text.includes(CLIENT)).toBe(false);
                }
                expect(logs.join('\n')).toContain('<redacted>');
            });
        });

        await describe('webext stores: edge dry-run and registration', async () => {
            await it('treats a 404 on an unknown operation as a live key', async () => {
                const { backend, seen } = backendWith([{ status: 404 }]);
                await backend.verifyCredentials!();
                expect(seen[0]!.method).toBe('GET');
                expect(seen[0]!.url).toContain('/submissions/operations/');
            });

            await it('treats a 401 on an unknown operation as a dead key', async () => {
                const { backend } = backendWith([{ status: 401 }]);
                const error = await rejection(backend.verifyCredentials!());
                expect(error.message).toContain('Create API credentials');
            });

            await it('is registered, implemented and built from the environment', async () => {
                expect(STORES.edge.implemented).toBe(true);
                const backend = createStoreBackend('edge', CREDENTIALS);
                expect(backend.store).toBe('edge');
            });
        });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
};
