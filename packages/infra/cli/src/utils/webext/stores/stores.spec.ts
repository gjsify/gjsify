import { describe, expect, it } from '@gjsify/unit';

import {
    asStoreId,
    createStoreBackend,
    isIdempotentSkip,
    redactHeaders,
    redactSecrets,
    resolveStoreCredentials,
    secretValuesOf,
    StoreApiError,
    StoreInReviewError,
    STORE_BACKENDS,
    STORE_CREDENTIALS,
    STORE_IDS,
    StoreVersionAlreadyThereError,
    type StoreBackend,
    type StoreCredentials,
} from './index.js';

/** The message a call throws, or null. Same helper as `webext.spec.ts`. */
function thrown(run: () => unknown): string | null {
    try {
        run();
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/**
 * One value planted everywhere a credential travels. Nothing in a log, a dump or
 * a thrown message may contain it — that is the whole assertion of this file.
 */
const CANARY = 'gjsify-canary-9f3c1b7a';

export default async () => {
    await describe('webext stores: redaction', async () => {
        await it('replaces authorising header values and keeps the rest', async () => {
            const redacted = redactHeaders({
                Authorization: `ApiKey ${CANARY}`,
                'X-ClientID': CANARY,
                'Content-Type': 'application/zip',
            });
            expect(redacted['authorization']).toBe('<redacted>');
            expect(redacted['x-clientid']).toBe('<redacted>');
            expect(redacted['content-type']).toBe('application/zip');
            expect(JSON.stringify(redacted).includes(CANARY)).toBe(false);
        });

        await it('redacts a header a later backend adds, by name shape alone', async () => {
            const redacted = redactHeaders({ 'X-Refresh-Token': CANARY, 'X-Request-Id': 'abc' });
            expect(redacted['x-refresh-token']).toBe('<redacted>');
            expect(redacted['x-request-id']).toBe('abc');
        });

        await it('replaces every secret in a message, longest first', async () => {
            const long = `${CANARY}-extra`;
            const text = `store said: ${long} and ${CANARY}`;
            const out = redactSecrets(text, [CANARY, long]);
            expect(out.includes(CANARY)).toBe(false);
            expect(out).toBe('store said: <redacted> and <redacted>');
        });

        await it('leaves a one-character value alone — redacting it says nothing', async () => {
            expect(redactSecrets('a draft with 3 warnings', ['3', ''])).toBe('a draft with 3 warnings');
        });

        await it('keeps the canary out of every message a store error carries', async () => {
            const messages = [
                new StoreApiError('edge', 400, redactSecrets(`rejected: ApiKey ${CANARY}`, [CANARY])).message,
                new StoreInReviewError('chrome', redactSecrets(`token ${CANARY} saw a review`, [CANARY])).message,
                new StoreVersionAlreadyThereError('chrome', '1.2.3').message,
            ];
            for (const message of messages) expect(message.includes(CANARY)).toBe(false);
            expect(messages[0]).toContain('HTTP 400');
            expect(messages[2]).toContain('nothing to submit');
        });
    });

    await describe('webext stores: credentials', async () => {
        await it('resolves a full environment and nothing else from it', async () => {
            const credentials = resolveStoreCredentials('edge', {
                EDGE_ADDONS_PRODUCT_ID: 'p',
                EDGE_ADDONS_CLIENT_ID: 'c',
                EDGE_ADDONS_API_KEY: CANARY,
                EDGE_ADDONS_SOMETHING_ELSE: 'ignored',
            });
            expect(Object.keys(credentials).sort()).toStrictEqual([
                'EDGE_ADDONS_API_KEY',
                'EDGE_ADDONS_CLIENT_ID',
                'EDGE_ADDONS_PRODUCT_ID',
            ]);
            expect(secretValuesOf('edge', credentials)).toStrictEqual([CANARY]);
        });

        await it('names every missing variable at once, and never a value', async () => {
            const message = thrown(() =>
                resolveStoreCredentials('chrome', {
                    CHROME_WEB_STORE_PUBLISHER_ID: CANARY,
                    CHROME_WEB_STORE_ITEM_ID: '',
                }),
            );
            expect(message).toContain('CHROME_WEB_STORE_ITEM_ID');
            expect(message).toContain('CHROME_WEB_STORE_CLIENT_SECRET');
            expect(message).toContain('CHROME_WEB_STORE_REFRESH_TOKEN');
            expect(message).toContain('4 environment variable(s)');
            expect(message?.includes(CANARY)).toBe(false);
        });

        await it('gives every known store a credential row', async () => {
            for (const store of STORE_IDS) expect(STORE_CREDENTIALS[store].length > 0).toBe(true);
        });
    });

    await describe('webext stores: backends', async () => {
        await it('knows its own ids and refuses a stranger', async () => {
            expect(asStoreId('chrome')).toBe('chrome');
            expect(asStoreId('opera')).toBe(null);
        });

        await it('refuses AMO by name before asking for a credential', async () => {
            const message = thrown(() => createStoreBackend('amo', {}));
            expect(message).toContain('not implemented');
            expect(message).toContain('webext sign');
            expect(message?.includes('WEB_EXT_API_KEY')).toBe(false);
        });

        await it('hands a registered factory its credentials and options', async () => {
            let seen: StoreCredentials | null = null;
            let sawFetch = false;
            const backend: StoreBackend = {
                store: 'edge',
                upload: async () => ({ ingested: true, detail: 'fake' }),
                publish: async () => ({ state: 'in-review', detail: 'fake' }),
                status: async () => ({ state: 'draft', detail: 'fake' }),
            };
            const original = STORE_BACKENDS.edge;
            STORE_BACKENDS.edge = (credentials, options) => {
                seen = credentials;
                sawFetch = options?.fetchImpl !== undefined;
                return backend;
            };
            try {
                const made = createStoreBackend(
                    'edge',
                    { EDGE_ADDONS_PRODUCT_ID: 'p', EDGE_ADDONS_CLIENT_ID: 'c', EDGE_ADDONS_API_KEY: CANARY },
                    { fetchImpl: (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch },
                );
                expect(made).toBe(backend);
                expect(sawFetch).toBe(true);
                expect(seen?.['EDGE_ADDONS_API_KEY']).toBe(CANARY);
            } finally {
                STORE_BACKENDS.edge = original;
            }
        });

        await it('separates the two idempotent outcomes from a real failure', async () => {
            expect(isIdempotentSkip(new StoreVersionAlreadyThereError('chrome', '1.0.0'))).toBe(true);
            expect(isIdempotentSkip(new StoreInReviewError('edge', 'operation InProgress'))).toBe(true);
            expect(isIdempotentSkip(new StoreApiError('edge', 500, 'gateway'))).toBe(false);
            expect(isIdempotentSkip(new Error('anything else'))).toBe(false);
        });
    });
};
