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
import {
    defaultZipPath,
    findReviewerNotes,
    isTagRef,
    preflightStoreJson,
    runSubmit,
    type SubmitProject,
} from './submit.js';

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

        await it('refuses --source for a store that takes none, and without --submit', async () => {
            const f = fixture();
            const calls: string[] = [];
            const chrome = await run(f, { sourceZip: '/tmp/src.zip', createBackend: () => backendWith({ calls }) });
            expect(chrome.code).toBe(1);
            expect(chrome.err.includes('AMO only')).toBe(true);
            expect(calls.length).toBe(0);
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

        await it('dry run on the real chrome backend says verified, with one token call and one read', async () => {
            const f = fixture();
            const urls: string[] = [];
            const fetchImpl = (async (url: string) => {
                urls.push(url);
                return new Response(url.includes('oauth2') ? JSON.stringify({ access_token: 'tok-abc' }) : '{}', {
                    status: 200,
                });
            }) as unknown as typeof fetch;
            const r = await run(f, { dryRun: true, fetchImpl });
            expect(r.code).toBe(0);
            expect(r.out.includes('credentials accepted')).toBe(true);
            expect(r.out.includes('unverified')).toBe(false);
            expect(urls.length).toBe(2);
            expect(urls[1]!.endsWith(':fetchStatus')).toBe(true);
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

    await describe('webext submit: reviewer notes', async () => {
        const EDGE_ENV = {
            EDGE_ADDONS_PRODUCT_ID: 'p',
            EDGE_ADDONS_CLIENT_ID: 'c',
            EDGE_ADDONS_API_KEY: CANARY,
            GITHUB_REF: 'refs/tags/v1.2.3',
        };
        const AMO_ENV = {
            AMO_ADDON_ID: 'a',
            AMO_WEB_EXT_API_KEY: 'user:1:2',
            AMO_WEB_EXT_API_SECRET: CANARY,
            GITHUB_REF: 'refs/tags/v1.2.3',
        };
        const setup = (store: 'edge' | 'amo', notes: Record<string, string>): Fixture => {
            const f = fixture({ storeJson: null });
            const dir = join(f.root, 'dist/listing', store);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'store.json'), goodStoreJson(store));
            for (const [lang, text] of Object.entries(notes)) {
                mkdirSync(join(dir, lang), { recursive: true });
                writeFileSync(join(dir, lang, 'reviewer-notes.txt'), text);
            }
            const zip = join(f.root, '.output', `demo-1.2.3-${store === 'edge' ? 'edge' : 'firefox'}-mv3.zip`);
            writeFileSync(zip, 'zip');
            f.project = {
                ...f.project,
                targets: [
                    {
                        id: `${store === 'edge' ? 'edge' : 'firefox'}-mv3`,
                        browser: store === 'edge' ? 'edge' : 'firefox',
                        manifestVersion: 3,
                    },
                ],
            };
            return f;
        };
        const publishSpy = (seen: unknown[]): StoreBackend =>
            backendWith({
                publish: async (input) => {
                    seen.push(input);
                    return { state: 'in-review', detail: 'PENDING_REVIEW' };
                },
            });

        await it('edge: the notes file reaches the publish input, en preferred', async () => {
            const f = setup('edge', { de: ' de notes ', en: ' en notes\n' });
            const seen: unknown[] = [];
            const r = await run(f, {
                store: 'edge',
                submit: true,
                env: EDGE_ENV,
                createBackend: () => publishSpy(seen),
            });
            expect(r.code).toBe(SUBMIT_EXIT_CODES.submitted);
            expect((seen[0] as { notes?: string }).notes).toBe('en notes');
            expect(r.err.includes('warning')).toBe(false);
            f.cleanup();
        });

        await it('amo: falls back to the first language with the file', async () => {
            const f = setup('amo', { de: 'de notes', fr: 'fr notes' });
            const seen: unknown[] = [];
            const r = await run(f, { store: 'amo', submit: true, env: AMO_ENV, createBackend: () => publishSpy(seen) });
            expect(r.code).toBe(SUBMIT_EXIT_CODES.submitted);
            expect((seen[0] as { notes?: string }).notes).toBe('de notes');
            f.cleanup();
        });

        await it('edge without a notes file: no notes and a warning', async () => {
            const f = setup('edge', {});
            const seen: unknown[] = [];
            const r = await run(f, {
                store: 'edge',
                submit: true,
                env: EDGE_ENV,
                createBackend: () => publishSpy(seen),
            });
            expect(r.code).toBe(SUBMIT_EXIT_CODES.submitted);
            expect((seen[0] as { notes?: string }).notes).toBe(undefined);
            expect(r.err.includes('Edge reviewers expect')).toBe(true);
            f.cleanup();
        });

        await it('amo without a notes file: no notes, no warning', async () => {
            const f = setup('amo', {});
            const seen: unknown[] = [];
            const r = await run(f, { store: 'amo', submit: true, env: AMO_ENV, createBackend: () => publishSpy(seen) });
            expect((seen[0] as { notes?: string }).notes).toBe(undefined);
            expect(r.err).toBe('');
            f.cleanup();
        });

        await it('dry run names the notes file and its length', async () => {
            const f = setup('edge', { en: 'twelve chars' });
            const r = await run(f, {
                store: 'edge',
                submit: true,
                dryRun: true,
                env: EDGE_ENV,
                createBackend: () => backendWith({ verifyCredentials: async () => undefined }),
            });
            expect(r.code).toBe(0);
            expect(r.out.includes('reviewer-notes.txt: 12 chars')).toBe(true);
            f.cleanup();
        });

        await it('findReviewerNotes is undefined for a missing dir', async () => {
            expect(findReviewerNotes('/nonexistent-gjsify', 'edge')).toBe(undefined);
        });
    });
};
