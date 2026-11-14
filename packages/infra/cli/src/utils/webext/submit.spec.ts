// What this pins down: every refusal happens BEFORE a network call, the exit
// codes are poll.ts's table verbatim, and no credential reaches stdout/stderr.
// A fake backend and an injected clock stand in for the store: no network, no
// credentials, no real waiting.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { StoreApiError, StoreVersionAlreadyThereError, type StoreBackend } from './stores/index.js';
import { SUBMIT_EXIT_CODES } from './stores/poll.js';
import { defaultZipPath, isTagRef, preflightStoreJson, runSubmit, type SubmitProject } from './submit.js';

const CANARY = 'gjsify-submit-canary-5d2e8a41';

const CHROME_ENV = {
    CHROME_WEB_STORE_PUBLISHER_ID: 'pub',
    CHROME_WEB_STORE_ITEM_ID: 'item',
    CHROME_WEB_STORE_CLIENT_ID: 'client',
    CHROME_WEB_STORE_CLIENT_SECRET: CANARY,
    CHROME_WEB_STORE_REFRESH_TOKEN: `${CANARY}-refresh`,
};

const goodStoreJson = (store: string): string =>
    JSON.stringify({
        version: 1,
        app: 'x',
        store,
        label: 'L',
        languages: ['en'],
        fields: [
            { key: 'name', label: 'Name', required: true, status: 'derived' },
            { key: 'privacyUrl', label: 'Privacy', required: false, status: 'omitted' },
            { key: 'dataUsage', label: 'Data usage', required: true, status: 'manual' },
        ],
    });

interface Fixture {
    root: string;
    project: SubmitProject;
    zip: string;
    cleanup(): void;
}

function fixture(opts: { storeJson?: string | null; zip?: boolean } = {}): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-submit-'));
    const outDir = join(root, '.output');
    mkdirSync(outDir, { recursive: true });
    const zip = join(outDir, 'demo-1.2.3-chrome-mv3.zip');
    if (opts.zip !== false) writeFileSync(zip, 'zip');
    if (opts.storeJson !== null) {
        mkdirSync(join(root, 'dist/listing/cws'), { recursive: true });
        writeFileSync(join(root, 'dist/listing/cws/store.json'), opts.storeJson ?? goodStoreJson('cws'));
    }
    return {
        root,
        zip,
        project: {
            root,
            name: 'demo',
            version: '1.2.3',
            outDir,
            targets: [{ id: 'chrome-mv3', browser: 'chrome', manifestVersion: 3 }],
        },
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}

function backendWith(over: Partial<StoreBackend> & { calls?: string[] } = {}): StoreBackend {
    const calls = over.calls ?? [];
    return {
        store: 'chrome',
        upload: async () => {
            calls.push('upload');
            return { ingested: true, detail: 'uploadState SUCCEEDED' };
        },
        publish: async () => {
            calls.push('publish');
            return { state: 'in-review', detail: 'PENDING_REVIEW' };
        },
        status: async () => ({ state: 'draft', detail: 'draft' }),
        ...over,
    };
}

async function run(
    f: Fixture,
    extra: Partial<Parameters<typeof runSubmit>[0]> = {},
): Promise<{ code: number; out: string; err: string }> {
    const out: string[] = [];
    const err: string[] = [];
    let t = 0;
    const code = await runSubmit({
        store: 'chrome',
        dryRun: false,
        submit: false,
        project: f.project,
        env: CHROME_ENV,
        now: () => t,
        sleep: async (ms) => {
            t += ms;
        },
        out: (l) => out.push(l),
        err: (l) => err.push(l),
        ...extra,
    });
    return { code, out: out.join('\n'), err: err.join('\n') };
}

export default async () => {
    await describe('webext submit: pure helpers', async () => {
        await it('accepts only refs/tags/<name> as a tag', async () => {
            expect(isTagRef('refs/tags/v1.0.0')).toBe(true);
            expect(isTagRef('refs/heads/main')).toBe(false);
            expect(isTagRef('refs/tags/')).toBe(false);
            expect(isTagRef(undefined)).toBe(false);
        });

        await it('derives the zip from the store target, as webext zip names it', async () => {
            const f = fixture();
            expect(defaultZipPath(f.project, 'chrome')).toBe(f.zip);
            let message = '';
            try {
                defaultZipPath(f.project, 'edge');
            } catch (e) {
                message = (e as Error).message;
            }
            expect(message.includes('no edge target')).toBe(true);
            f.cleanup();
        });

        await it('preflight: a missing required field is a problem, a manual one is only listed', async () => {
            const bad = JSON.stringify({
                version: 1,
                store: 'cws',
                fields: [
                    { key: 'icon', label: 'Icon', required: true, status: 'missing' },
                    { key: 'd', label: 'Data usage', required: true, status: 'manual' },
                ],
            });
            const r = preflightStoreJson(bad, 'cws', 'p');
            expect(r.problems.length).toBe(1);
            expect(r.problems[0]?.includes('Icon')).toBe(true);
            expect(r.manual[0]).toBe('Data usage');
        });

        await it('preflight: rejects invalid JSON and the wrong store', async () => {
            expect(preflightStoreJson('{', 'cws', 'p').problems.length).toBe(1);
            expect(preflightStoreJson(goodStoreJson('edge'), 'cws', 'p').problems.length).toBe(1);
        });
    });

    await describe('webext submit: refusals before any network call', async () => {
        await it('refuses --submit off a tag', async () => {
            const f = fixture();
            const calls: string[] = [];
            const r = await run(f, {
                submit: true,
                env: { ...CHROME_ENV, GITHUB_REF: 'refs/heads/main' },
                createBackend: () => backendWith({ calls }),
            });
            expect(r.code).toBe(1);
            expect(r.err.includes('refs/tags/')).toBe(true);
            expect(calls.length).toBe(0);
            f.cleanup();
        });

        await it('refuses AMO by name', async () => {
            const f = fixture();
            const r = await run(f, { store: 'amo' });
            expect(r.code).toBe(1);
            expect(r.err.includes('not implemented')).toBe(true);
            f.cleanup();
        });

        await it('stops when store.json is absent', async () => {
            const f = fixture({ storeJson: null });
            const calls: string[] = [];
            const r = await run(f, { createBackend: () => backendWith({ calls }) });
            expect(r.code).toBe(1);
            expect(r.err.includes('store.json')).toBe(true);
            expect(calls.length).toBe(0);
            f.cleanup();
        });

        await it('stops on a store.json with a missing required field', async () => {
            const f = fixture({
                storeJson: JSON.stringify({
                    version: 1,
                    store: 'cws',
                    fields: [{ key: 'icon', label: 'Icon', required: true, status: 'missing' }],
                }),
            });
            const calls: string[] = [];
            const r = await run(f, { createBackend: () => backendWith({ calls }) });
            expect(r.code).toBe(1);
            expect(r.err.includes('Icon')).toBe(true);
            expect(calls.length).toBe(0);
            f.cleanup();
        });

        await it('names every missing credential and sends nothing', async () => {
            const f = fixture();
            let fetched = 0;
            const r = await run(f, {
                env: {},
                fetchImpl: (async () => {
                    fetched++;
                    return new Response('{}');
                }) as typeof fetch,
            });
            expect(r.code).toBe(1);
            expect(r.err.includes('CHROME_WEB_STORE_CLIENT_SECRET')).toBe(true);
            expect(r.err.includes('CHROME_WEB_STORE_ITEM_ID')).toBe(true);
            expect(fetched).toBe(0);
            f.cleanup();
        });

        await it('stops when the zip is missing', async () => {
            const f = fixture({ zip: false });
            const r = await run(f, { createBackend: () => backendWith() });
            expect(r.code).toBe(1);
            expect(r.err.includes('webext zip')).toBe(true);
            f.cleanup();
        });
    });

    await describe('webext submit: dry run and drive', async () => {
        await it('dry run verifies credentials once and uploads nothing', async () => {
            const f = fixture();
            const calls: string[] = [];
            const r = await run(f, {
                dryRun: true,
                createBackend: () =>
                    backendWith({
                        calls,
                        verifyCredentials: async () => {
                            calls.push('verify');
                        },
                    }),
            });
            expect(r.code).toBe(0);
            expect(calls.join(',')).toBe('verify');
            f.cleanup();
        });

        await it('dry run with dead credentials exits 1 and leaks nothing', async () => {
            const f = fixture();
            const r = await run(f, {
                dryRun: true,
                createBackend: () =>
                    backendWith({
                        verifyCredentials: async () => {
                            throw new StoreApiError('chrome', 401, `denied for ${CANARY}`);
                        },
                    }),
            });
            expect(r.code).toBe(1);
            expect(`${r.out}${r.err}`.includes(CANARY)).toBe(false);
            f.cleanup();
        });

        await it('default uploads a draft and does not publish', async () => {
            const f = fixture();
            const calls: string[] = [];
            const r = await run(f, { createBackend: () => backendWith({ calls }) });
            expect(r.code).toBe(SUBMIT_EXIT_CODES.uploaded);
            expect(calls.join(',')).toBe('upload');
            expect(r.out.includes('NOT submitted')).toBe(true);
            f.cleanup();
        });

        await it('--submit on a tag uploads, then publishes', async () => {
            const f = fixture();
            const calls: string[] = [];
            const r = await run(f, {
                submit: true,
                env: { ...CHROME_ENV, GITHUB_REF: 'refs/tags/v1.2.3' },
                createBackend: () => backendWith({ calls }),
            });
            expect(r.code).toBe(SUBMIT_EXIT_CODES.submitted);
            expect(calls.join(',')).toBe('upload,publish');
            f.cleanup();
        });

        await it('the same version again exits 0', async () => {
            const f = fixture();
            const r = await run(f, {
                createBackend: () =>
                    backendWith({
                        upload: async () => {
                            throw new StoreVersionAlreadyThereError('chrome', '1.2.3');
                        },
                    }),
            });
            expect(r.code).toBe(0);
            expect(r.out.includes('already-there')).toBe(true);
            f.cleanup();
        });

        await it('a rejection exits 1 and a vendor-echoed secret is redacted', async () => {
            const f = fixture();
            const r = await run(f, {
                createBackend: () =>
                    backendWith({
                        upload: async () => {
                            throw new StoreApiError('chrome', 400, `bad request, secret ${CANARY} echoed`);
                        },
                    }),
            });
            expect(r.code).toBe(SUBMIT_EXIT_CODES.rejected);
            expect(`${r.out}${r.err}`.includes(CANARY)).toBe(false);
            f.cleanup();
        });

        await it('an upload that never resolves exits 3', async () => {
            const f = fixture();
            const r = await run(f, {
                timeoutSeconds: 10,
                createBackend: () =>
                    backendWith({
                        upload: async () => ({ ingested: false, detail: 'IN_PROGRESS' }),
                        status: async () => ({ state: 'unknown', ingesting: true, detail: 'ingesting' }),
                    }),
            });
            expect(r.code).toBe(SUBMIT_EXIT_CODES.unresolved);
            f.cleanup();
        });

        await it('a rejected timeout value is a refusal', async () => {
            const f = fixture();
            const r = await run(f, { timeoutSeconds: -1, createBackend: () => backendWith() });
            expect(r.code).toBe(1);
            expect(r.err.includes('--timeout')).toBe(true);
            f.cleanup();
        });
    });
};
