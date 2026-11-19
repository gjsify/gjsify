import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

// `index.js` first: it imports `amo.js` (import-cycle TDZ, as in edge.spec.ts).
import {
    createStoreBackend,
    StoreApiError,
    StoreVersionAlreadyThereError,
    STORES,
    type StoreBackend,
} from './index.js';
import { createAmoBackend, signJwt, validationLines } from './amo.js';

const SECRET = 'gjsify-canary-amo-secret-7e1';
const KEY = 'user:123:45';
const CREDENTIALS = { AMO_ADDON_ID: 'my-addon', AMO_WEB_EXT_API_KEY: KEY, AMO_WEB_EXT_API_SECRET: SECRET };
const ROOT = 'https://addons.mozilla.org/api/v5/addons';
const NOW = 1_700_000_000_000;

interface Seen {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
}
interface Reply {
    status: number;
    body?: string;
}

function backendWith(replies: Reply[], logs?: string[]): { backend: StoreBackend; seen: Seen[] } {
    const seen: Seen[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
        seen.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body });
        const reply = replies.shift();
        if (reply === undefined) throw new Error('unexpected request');
        return new Response(reply.body ?? null, { status: reply.status });
    }) as unknown as typeof fetch;
    const backend = createAmoBackend(CREDENTIALS, { fetchImpl, now: () => NOW, log: logs ? (m) => logs.push(m) : undefined });
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

const upload = (extra: Record<string, unknown>): Reply => ({ status: 200, body: JSON.stringify({ uuid: 'u-1', ...extra }) });

export default async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-amo-spec-'));
    const zipPath = join(dir, 'ext.zip');
    writeFileSync(zipPath, new Uint8Array([0x50, 0x4b, 3, 4]));

    await describe('webext stores: amo', async () => {
        await it('signs an HS256 JWT with iss, jti, iat and a short exp', async () => {
            const [h, p, s] = signJwt(KEY, SECRET, NOW).split('.') as [string, string, string];
            const dec = (x: string): Record<string, unknown> => JSON.parse(Buffer.from(x, 'base64url').toString());
            expect(JSON.stringify(dec(h))).toBe('{"alg":"HS256","typ":"JWT"}');
            const claims = dec(p) as { iss: string; jti: string; iat: number; exp: number };
            expect(claims.iss).toBe(KEY);
            expect(claims.iat).toBe(NOW / 1000);
            expect(claims.exp - claims.iat <= 300).toBe(true);
            expect(claims.jti.length > 8).toBe(true);
            expect(s).toBe(createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url'));
        });

        await it('uploads as listed, polls until processed and creates no version', async () => {
            const { backend, seen } = backendWith([
                { status: 404 },
                upload({ processed: false }),
                upload({ processed: false }),
                upload({ processed: true, valid: true }),
            ]);
            const result = await backend.upload({ zipPath, version: '1.0.0' });
            expect(result.ingested).toBe(false);
            expect(result.operationId).toBe('u-1');
            expect(seen[1]!.method).toBe('POST');
            expect(seen[1]!.url).toBe(`${ROOT}/upload/`);
            expect((seen[1]!.body as FormData).get('channel')).toBe('listed');
            expect(seen[0]!.headers['Authorization']!.startsWith('JWT ')).toBe(true);
            expect((await backend.operation!('upload', 'u-1', '1.0.0')).state).toBe('in-progress');
            expect((await backend.operation!('upload', 'u-1', '1.0.0')).state).toBe('succeeded');
            expect(seen.every((s) => !s.url.endsWith('/versions/') || s.method === 'GET')).toBe(true);
        });

        await it('turns a failed validation into an error with the reasons', async () => {
            const { backend } = backendWith([
                upload({ processed: true, valid: false, validation: { messages: [{ type: 'error', message: 'Bad manifest' }] } }),
            ]);
            const error = await rejection(backend.operation!('upload', 'u-1', '1.0.0'));
            expect(error instanceof StoreApiError).toBe(true);
            expect(error.message).toContain('Bad manifest');
        });

        await it('reads validation messages defensively', async () => {
            expect(validationLines(null).length).toBe(0);
            expect(validationLines({ messages: [{ type: 'warning', message: 'w' }, { message: 'e' }] }).join()).toBe('e');
        });

        await it('maps an existing version to "already there"', async () => {
            const { backend } = backendWith([{ status: 200, body: '{}' }]);
            const error = await rejection(backend.upload({ zipPath, version: '1.0.0' }));
            expect(error instanceof StoreVersionAlreadyThereError).toBe(true);
        });

        await it('creates the version on publish and attaches the source archive', async () => {
            const src = join(dir, 'src.zip');
            writeFileSync(src, 'src');
            const { backend, seen } = backendWith([
                { status: 404 },
                upload({ processed: true, valid: true }),
                { status: 201, body: JSON.stringify({ id: 77, version: '1.0.0' }) },
                { status: 200, body: '{}' },
            ]);
            await backend.upload({ zipPath, version: '1.0.0' });
            const result = await backend.publish({ version: '1.0.0', sourceZip: src });
            expect(result.state).toBe('in-review');
            expect(seen[2]!.url).toBe(`${ROOT}/addon/my-addon/versions/`);
            expect(String(seen[2]!.body)).toBe('{"upload":"u-1"}');
            expect(seen[3]!.method).toBe('PATCH');
            expect(seen[3]!.url).toBe(`${ROOT}/addon/my-addon/versions/77/`);
            expect((seen[3]!.body as FormData).get('source') !== null).toBe(true);
        });

        await it('dry-run is one authenticated GET', async () => {
            const { backend, seen } = backendWith([{ status: 200, body: '{}' }]);
            await backend.verifyCredentials!();
            expect(seen.length).toBe(1);
            expect(seen[0]!.method).toBe('GET');
            expect(seen[0]!.url).toBe(`${ROOT}/addon/my-addon/`);
        });

        await it('explains a 401 and keeps the secret out of messages and logs', async () => {
            const logs: string[] = [];
            const { backend } = backendWith([{ status: 401, body: `echo ${SECRET}` }], logs);
            const error = await rejection(backend.verifyCredentials!());
            expect(error.message).toContain('AMO_WEB_EXT_API_KEY');
            for (const text of [...logs, error.message]) expect(text.includes(SECRET)).toBe(false);
            expect(logs.join('\n').includes('JWT ')).toBe(false);
        });

        await it('is registered and names every missing variable', async () => {
            expect(STORES.amo.implemented).toBe(true);
            expect(createStoreBackend('amo', CREDENTIALS).store).toBe('amo');
            let message = '';
            try {
                createStoreBackend('amo', {});
            } catch (error) {
                message = (error as Error).message;
            }
            for (const name of ['AMO_ADDON_ID', 'AMO_WEB_EXT_API_KEY', 'AMO_WEB_EXT_API_SECRET']) {
                expect(message).toContain(name);
            }
        });
    });
};
