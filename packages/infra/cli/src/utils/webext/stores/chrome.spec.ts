import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

import { createChromeBackend } from './chrome.js';
import {
    createStoreBackend,
    isIdempotentSkip,
    StoreApiError,
    StoreInReviewError,
    StoreVersionAlreadyThereError,
    STORES,
} from './index.js';

const CANARY_SECRET = 'gjsify-canary-client-secret-1f2e';
const CANARY_REFRESH = 'gjsify-canary-refresh-token-77aa';
const CANARY_ACCESS = 'gjsify-canary-access-token-c0de';

const CREDENTIALS = {
    CHROME_WEB_STORE_PUBLISHER_ID: 'pub123',
    CHROME_WEB_STORE_ITEM_ID: 'abcdefghijklmnopabcdefghijklmnop',
    CHROME_WEB_STORE_CLIENT_ID: 'client-id.apps.example',
    CHROME_WEB_STORE_CLIENT_SECRET: CANARY_SECRET,
    CHROME_WEB_STORE_REFRESH_TOKEN: CANARY_REFRESH,
};

interface Call {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
}

type Reply = { status?: number; json?: unknown; text?: string };
type Router = (call: Call) => Reply | undefined;

/** A fetch that answers from `route` and records every call; an unrouted URL fails the test loudly. */
function fakeFetch(route: Router): { fetchImpl: typeof fetch; calls: Call[] } {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
        const call: Call = {
            url,
            method: init.method ?? 'GET',
            headers: (init.headers ?? {}) as Record<string, string>,
            body: init.body,
        };
        calls.push(call);
        const reply = route(call) ?? { status: 500, text: `unrouted ${call.method} ${url}` };
        const status = reply.status ?? 200;
        const text = reply.text ?? JSON.stringify(reply.json ?? {});
        return new Response(text, { status });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
}

const tokenOk: Reply = { json: { access_token: CANARY_ACCESS, expires_in: 3600 } };
const isToken = (c: Call) => c.url === 'https://oauth2.googleapis.com/token';
const isStatus = (c: Call) => c.url.endsWith(':fetchStatus');
const isUpload = (c: Call) => c.url.includes('/upload/v2/') && c.url.endsWith(':upload');
const isPublish = (c: Call) => c.url.endsWith(':publish');

const NAME = 'publishers/pub123/items/abcdefghijklmnopabcdefghijklmnop';

const revision = (state: string, crxVersion: string) => ({
    state,
    distributionChannels: [{ deployPercentage: 100, crxVersion }],
});

function zipFile(): string {
    const root = join(homedir(), '.cache', 'gjsify-store-chrome-spec');
    mkdirSync(root, { recursive: true });
    const path = join(mkdtempSync(join(root, 'run-')), 'ext.zip');
    writeFileSync(path, 'PK-not-a-real-zip');
    return path;
}

async function rejected(run: () => Promise<unknown>): Promise<Error> {
    try {
        await run();
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected the call to reject');
}

function noSecrets(text: string): void {
    for (const secret of [CANARY_SECRET, CANARY_REFRESH, CANARY_ACCESS]) expect(text.includes(secret)).toBe(false);
}

export default async () => {
    await describe('webext stores: chrome token exchange', async () => {
        await it('exchanges the refresh token as a form post and sends the bearer on the API call', async () => {
            const { fetchImpl, calls } = fakeFetch((c) =>
                isToken(c) ? tokenOk : isStatus(c) ? { json: {} } : undefined,
            );
            const backend = createChromeBackend(CREDENTIALS, { fetchImpl });
            await backend.status();
            const token = calls[0]!;
            expect(token.method).toBe('POST');
            expect(token.headers['content-type']).toBe('application/x-www-form-urlencoded');
            const form = new URLSearchParams(token.body as string);
            expect(form.get('grant_type')).toBe('refresh_token');
            expect(form.get('refresh_token')).toBe(CANARY_REFRESH);
            expect(form.get('client_id')).toBe('client-id.apps.example');
            expect(calls[1]!.headers['authorization']).toBe(`Bearer ${CANARY_ACCESS}`);
            expect(calls[1]!.url).toBe(`https://chromewebstore.googleapis.com/v2/${NAME}:fetchStatus`);
        });

        await it('mints the access token once per backend', async () => {
            const { fetchImpl, calls } = fakeFetch((c) => (isToken(c) ? tokenOk : { json: {} }));
            const backend = createChromeBackend(CREDENTIALS, { fetchImpl });
            await backend.status();
            await backend.status();
            expect(calls.filter(isToken).length).toBe(1);
        });

        await it('names where to recreate the client and refresh token on a 401, without a secret', async () => {
            const { fetchImpl } = fakeFetch(() => ({
                status: 401,
                json: { error: 'invalid_client', error_description: `bad secret ${CANARY_SECRET}` },
            }));
            const error = await rejected(() => createChromeBackend(CREDENTIALS, { fetchImpl }).status());
            expect(error instanceof StoreApiError).toBe(true);
            expect((error as StoreApiError).httpStatus).toBe(401);
            expect(error.message).toContain('Google Cloud Console');
            expect(error.message).toContain('CHROME_WEB_STORE_REFRESH_TOKEN');
            noSecrets(error.message);
        });

        await it('reports a 400 invalid_grant with the same hint', async () => {
            const { fetchImpl } = fakeFetch(() => ({ status: 400, json: { error: 'invalid_grant' } }));
            const error = await rejected(() => createChromeBackend(CREDENTIALS, { fetchImpl }).status());
            expect(error.message).toContain('invalid_grant');
            expect(error.message).toContain('refresh token');
        });

        await it('refuses a token answer without an access_token', async () => {
            const { fetchImpl } = fakeFetch(() => ({ json: { expires_in: 1 } }));
            const error = await rejected(() => createChromeBackend(CREDENTIALS, { fetchImpl }).status());
            expect(error.message).toContain('without an access_token');
        });

        await it('turns a network failure into a StoreApiError without a status', async () => {
            const fetchImpl = (async () => {
                throw new Error(`connect failed for ${CANARY_REFRESH}`);
            }) as unknown as typeof fetch;
            const error = await rejected(() => createChromeBackend(CREDENTIALS, { fetchImpl }).status());
            expect(error instanceof StoreApiError).toBe(true);
            expect((error as StoreApiError).httpStatus).toBe(undefined);
            noSecrets(error.message);
        });
    });

    await describe('webext stores: chrome upload', async () => {
        await it('posts the zip as the body of the /upload/ URI', async () => {
            const { fetchImpl, calls } = fakeFetch((c) => {
                if (isToken(c)) return tokenOk;
                if (isStatus(c)) return { json: { publishedItemRevisionStatus: revision('PUBLISHED', '1.0.0') } };
                if (isUpload(c)) return { json: { name: NAME, crxVersion: '1.1.0', uploadState: 'SUCCEEDED' } };
                return undefined;
            });
            const result = await createChromeBackend(CREDENTIALS, { fetchImpl }).upload({
                zipPath: zipFile(),
                version: '1.1.0',
            });
            expect(result.ingested).toBe(true);
            expect(result.operationId).toBe(NAME);
            const upload = calls.find(isUpload)!;
            expect(upload.url).toBe(`https://chromewebstore.googleapis.com/upload/v2/${NAME}:upload`);
            expect(upload.method).toBe('POST');
            expect(upload.headers['content-type']).toBe('application/zip');
            expect(upload.body !== undefined).toBe(true);
        });

        await it('returns IN_PROGRESS as a not-yet-ingested result and does not poll', async () => {
            const { fetchImpl, calls } = fakeFetch((c) => {
                if (isToken(c)) return tokenOk;
                if (isStatus(c)) return { json: {} };
                if (isUpload(c)) return { json: { name: NAME, uploadState: 'IN_PROGRESS' } };
                return undefined;
            });
            const result = await createChromeBackend(CREDENTIALS, { fetchImpl }).upload({
                zipPath: zipFile(),
                version: '1.1.0',
            });
            expect(result.ingested).toBe(false);
            expect(result.detail).toContain('IN_PROGRESS');
            expect(calls.filter(isStatus).length).toBe(1);
        });

        await it('fails on uploadState FAILED and on a state it does not know', async () => {
            for (const uploadState of ['FAILED', 'SOMETHING_NEW']) {
                const { fetchImpl } = fakeFetch((c) => {
                    if (isToken(c)) return tokenOk;
                    if (isStatus(c)) return { json: {} };
                    return { json: { uploadState } };
                });
                const error = await rejected(() =>
                    createChromeBackend(CREDENTIALS, { fetchImpl }).upload({ zipPath: zipFile(), version: '1.1.0' }),
                );
                expect(error instanceof StoreApiError).toBe(true);
                expect(error.message).toContain(uploadState === 'FAILED' ? 'FAILED' : 'SOMETHING_NEW');
            }
        });

        await it('reports the same version as StoreVersionAlreadyThereError before sending a byte', async () => {
            const { fetchImpl, calls } = fakeFetch((c) =>
                isToken(c) ? tokenOk : { json: { publishedItemRevisionStatus: revision('PUBLISHED', '1.1.0') } },
            );
            const error = await rejected(() =>
                createChromeBackend(CREDENTIALS, { fetchImpl }).upload({ zipPath: zipFile(), version: '1.1.0' }),
            );
            expect(error instanceof StoreVersionAlreadyThereError).toBe(true);
            expect(isIdempotentSkip(error)).toBe(true);
            expect(calls.some(isUpload)).toBe(false);
        });

        await it('reports a submission in review as StoreInReviewError', async () => {
            const { fetchImpl, calls } = fakeFetch((c) =>
                isToken(c) ? tokenOk : { json: { submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.0.5') } },
            );
            const error = await rejected(() =>
                createChromeBackend(CREDENTIALS, { fetchImpl }).upload({ zipPath: zipFile(), version: '1.1.0' }),
            );
            expect(error instanceof StoreInReviewError).toBe(true);
            expect(error.message).toContain('1.0.5');
            expect(calls.some(isUpload)).toBe(false);
        });

        await it('carries the status code of a 5xx and the vendor message, redacted', async () => {
            const { fetchImpl } = fakeFetch((c) => {
                if (isToken(c)) return tokenOk;
                if (isStatus(c)) return { json: {} };
                return { status: 503, json: { error: { message: `backend down, saw ${CANARY_ACCESS}` } } };
            });
            const error = await rejected(() =>
                createChromeBackend(CREDENTIALS, { fetchImpl }).upload({ zipPath: zipFile(), version: '1.1.0' }),
            );
            expect((error as StoreApiError).httpStatus).toBe(503);
            expect(error.message).toContain('HTTP 503');
            expect(error.message).toContain('backend down');
            noSecrets(error.message);
        });
    });

    await describe('webext stores: chrome publish', async () => {
        await it('posts an empty body for a full rollout', async () => {
            const { fetchImpl, calls } = fakeFetch((c) => {
                if (isToken(c)) return tokenOk;
                if (isStatus(c)) return { json: {} };
                if (isPublish(c)) return { json: { state: 'PENDING_REVIEW' } };
                return undefined;
            });
            const result = await createChromeBackend(CREDENTIALS, { fetchImpl }).publish({ version: '1.1.0' });
            expect(result.state).toBe('in-review');
            const publish = calls.find(isPublish)!;
            expect(publish.url).toBe(`https://chromewebstore.googleapis.com/v2/${NAME}:publish`);
            expect(JSON.parse(publish.body as string)).toStrictEqual({});
        });

        await it('sends deployInfos only for a staged percentage below 100', async () => {
            const { fetchImpl, calls } = fakeFetch((c) => {
                if (isToken(c)) return tokenOk;
                if (isStatus(c)) return { json: {} };
                return { json: { state: 'PENDING_REVIEW' } };
            });
            await createChromeBackend(CREDENTIALS, { fetchImpl }).publish({ version: '1.1.0', deployPercentage: 10 });
            expect(JSON.parse(calls.find(isPublish)!.body as string)).toStrictEqual({
                deployInfos: [{ deployPercentage: 10 }],
            });
        });

        await it('does not re-submit while a revision is pending review', async () => {
            const { fetchImpl, calls } = fakeFetch((c) =>
                isToken(c) ? tokenOk : { json: { submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.1.0') } },
            );
            const error = await rejected(() =>
                createChromeBackend(CREDENTIALS, { fetchImpl }).publish({ version: '1.1.0' }),
            );
            expect(error instanceof StoreInReviewError).toBe(true);
            expect(calls.some(isPublish)).toBe(false);
        });

        await it('names the manual dashboard publish when the API refuses after a visibility change', async () => {
            const { fetchImpl } = fakeFetch((c) => {
                if (isToken(c)) return tokenOk;
                if (isStatus(c)) return { json: {} };
                return { status: 400, json: { error: { message: 'FAILED_PRECONDITION: visibility mismatch' } } };
            });
            const error = await rejected(() =>
                createChromeBackend(CREDENTIALS, { fetchImpl }).publish({ version: '1.1.0' }),
            );
            expect(error instanceof StoreApiError).toBe(true);
            expect(error.message).toContain('einmal im Dashboard von Hand veröffentlichen');
            expect(error.message).toContain('HTTP 400');
        });

        await it('does not blame the visibility on a 5xx', async () => {
            const { fetchImpl } = fakeFetch((c) => {
                if (isToken(c)) return tokenOk;
                if (isStatus(c)) return { json: {} };
                return { status: 502, text: 'bad gateway' };
            });
            const error = await rejected(() =>
                createChromeBackend(CREDENTIALS, { fetchImpl }).publish({ version: '1.1.0' }),
            );
            expect(error.message).toContain('HTTP 502');
            expect(error.message.includes('Dashboard von Hand')).toBe(false);
        });
    });

    await describe('webext stores: chrome status', async () => {
        const statusOf = async (body: unknown) => {
            const { fetchImpl } = fakeFetch((c) => (isToken(c) ? tokenOk : { json: body }));
            return createChromeBackend(CREDENTIALS, { fetchImpl }).status();
        };

        await it('classifies the submitted revision first', async () => {
            const r = await statusOf({
                submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.1.0'),
                publishedItemRevisionStatus: revision('PUBLISHED', '1.0.0'),
            });
            expect(r.state).toBe('in-review');
            expect(r.version).toBe('1.1.0');
        });

        await it('maps every ItemState to a state', async () => {
            const expected: Record<string, string> = {
                PENDING_REVIEW: 'in-review',
                STAGED: 'draft',
                PUBLISHED: 'published',
                PUBLISHED_TO_TESTERS: 'published',
                REJECTED: 'rejected',
                CANCELLED: 'draft',
                ITEM_STATE_UNSPECIFIED: 'unknown',
            };
            for (const [itemState, state] of Object.entries(expected)) {
                const r = await statusOf({ submittedItemRevisionStatus: revision(itemState, '2.0.0') });
                expect(r.state).toBe(state);
            }
        });

        await it('falls back to the published revision', async () => {
            const r = await statusOf({ publishedItemRevisionStatus: revision('PUBLISHED', '1.0.0') });
            expect(r.state).toBe('published');
            expect(r.version).toBe('1.0.0');
        });

        await it('reports an upload still running as unknown and ingesting', async () => {
            const r = await statusOf({ lastAsyncUploadState: 'IN_PROGRESS' });
            expect(r.state).toBe('unknown');
            expect(r.ingesting).toBe(true);
        });

        await it('reports a failed async upload as rejected', async () => {
            const r = await statusOf({ lastAsyncUploadState: 'FAILED' });
            expect(r.state).toBe('rejected');
        });

        await it('reports a taken-down item as rejected', async () => {
            const r = await statusOf({ takenDown: true, publishedItemRevisionStatus: revision('PUBLISHED', '1.0.0') });
            expect(r.state).toBe('rejected');
            expect(r.detail).toContain('takenDown');
        });

        await it('does not invent a state when the store reports none (the 24 h window)', async () => {
            const r = await statusOf({ lastAsyncUploadState: 'NOT_FOUND' });
            expect(r.state).toBe('unknown');
            expect(r.ingesting).toBe(undefined);
        });

        await it('fails with the status code when fetchStatus answers 403', async () => {
            const { fetchImpl } = fakeFetch((c) =>
                isToken(c)
                    ? tokenOk
                    : { status: 403, json: { error: { message: 'The caller does not have permission' } } },
            );
            const error = await rejected(() => createChromeBackend(CREDENTIALS, { fetchImpl }).status());
            expect((error as StoreApiError).httpStatus).toBe(403);
            expect(error.message).toContain('does not have permission');
        });

        await it('fails when fetchStatus answers something that is not JSON', async () => {
            const { fetchImpl } = fakeFetch((c) => (isToken(c) ? tokenOk : { text: '<html>' }));
            const error = await rejected(() => createChromeBackend(CREDENTIALS, { fetchImpl }).status());
            expect(error instanceof StoreApiError).toBe(true);
        });
    });

    await describe('webext stores: chrome secrets and registration', async () => {
        await it('never logs a credential or the bearer token', async () => {
            const lines: string[] = [];
            const { fetchImpl } = fakeFetch((c) => (isToken(c) ? tokenOk : { json: {} }));
            await createChromeBackend(CREDENTIALS, { fetchImpl, log: (line) => lines.push(line) }).status();
            expect(lines.length).toBe(2);
            for (const line of lines) noSecrets(line);
            expect(lines[1]).toContain('<redacted>');
        });

        await it('keeps every canary out of an error raised mid-flight', async () => {
            const { fetchImpl } = fakeFetch((c) =>
                isToken(c)
                    ? tokenOk
                    : {
                          status: 500,
                          text: `echo ${CANARY_SECRET} ${CANARY_REFRESH} Bearer ${CANARY_ACCESS}`,
                      },
            );
            const error = await rejected(() => createChromeBackend(CREDENTIALS, { fetchImpl }).status());
            noSecrets(error.message);
            expect(error.message).toContain('<redacted>');
        });

        await it('is registered for createStoreBackend and marked implemented', async () => {
            expect(STORES.chrome.implemented).toBe(true);
            const { fetchImpl } = fakeFetch(() => undefined);
            const backend = createStoreBackend('chrome', CREDENTIALS, { fetchImpl });
            expect(backend.store).toBe('chrome');
        });

        await it('asks for all five variables through resolveStoreCredentials', async () => {
            let message = '';
            try {
                createStoreBackend('chrome', {});
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('5 environment variable(s)');
        });
    });
};
