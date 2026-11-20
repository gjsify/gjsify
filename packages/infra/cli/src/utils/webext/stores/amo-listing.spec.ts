// A fake AMO that stores what is PATCHed and answers GETs from that state, so the read-back is a
// real comparison. No network, no credentials; `fetchImpl` is injected as everywhere in this seam.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

// `index.js` first: it imports `amo.js` (import-cycle TDZ, as in amo.spec.ts).
import { StoreApiError, type StoreBackend } from './index.js';
import { createAmoBackend } from './amo.js';
import { amoLocale } from './amo-listing.js';
import { runListingUpload } from '../listing-upload.js';

const SECRET = 'gjsify-canary-amo-listing-secret-3c9';
const CREDENTIALS = {
    AMO_ADDON_ID: 'my-addon',
    AMO_WEB_EXT_API_KEY: 'user:1:2',
    AMO_WEB_EXT_API_SECRET: SECRET,
};
const ADDON = 'https://addons.mozilla.org/api/v5/addons/addon/my-addon';

interface Seen {
    url: string;
    method: string;
    body: unknown;
}

interface FakeOptions {
    /** Store a different description than the one sent, to provoke a mismatch. */
    corruptDescription?: boolean;
    /** Answer GETs the way AMO does: bare URLs linkified, entities escaped. */
    linkify?: boolean;
    failPatchWith?: { status: number; body: string };
}

function fakeAmo(options: FakeOptions = {}): { backend: StoreBackend; seen: Seen[] } {
    const seen: Seen[] = [];
    const state = { description: {}, privacy_policy: {}, approval_notes: '' } as Record<string, unknown>;
    const fetchImpl = (async (url: string, init: RequestInit) => {
        const method = String(init.method);
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        seen.push({ url, method, body });
        const json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200 });
        if (method === 'PATCH') {
            if (options.failPatchWith) {
                return new Response(options.failPatchWith.body, { status: options.failPatchWith.status });
            }
            if (url === `${ADDON}/`) {
                state.description = options.corruptDescription ? { 'en-US': 'something else' } : body.description;
            } else if (url === `${ADDON}/eula_policy/`) state.privacy_policy = body.privacy_policy;
            else state.approval_notes = body.approval_notes;
            return json({});
        }
        const view = (v: unknown): unknown =>
            !options.linkify
                ? v
                : Object.fromEntries(
                      Object.entries(v as Record<string, string>).map(([k, t]) => [
                          k,
                          t
                              .replace(/&/g, '&amp;')
                              .replace(/</g, '&lt;')
                              .replace(/"/g, '&quot;')
                              .replace(
                                  /\b(jumplink\.eu\/\S+)/,
                                  '<a href="https://prod.outgoing.example/x" rel="nofollow">$1</a>',
                              ),
                      ]),
                  );
        if (url === `${ADDON}/`) return json({ description: view(state.description) });
        if (url === `${ADDON}/eula_policy/`) return json({ privacy_policy: view(state.privacy_policy) });
        return json({ approval_notes: state.approval_notes });
    }) as unknown as typeof fetch;
    return { backend: createAmoBackend(CREDENTIALS, { fetchImpl, now: () => 1_700_000_000_000 }), seen };
}

function listingDir(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-amo-listing-'));
    for (const [rel, text] of Object.entries(files)) {
        mkdirSync(join(root, 'amo', rel.split('/')[0]!), { recursive: true });
        writeFileSync(join(root, 'amo', rel), text);
    }
    return root;
}

const FILES = {
    'en/name.txt': 'Name\n',
    'en/summary.txt': 'English summary\n',
    'en/description.txt': 'English description\n',
    'en/privacy.txt': 'English privacy\n',
    'en/reviewer-notes.txt': 'English notes\n',
    'de/summary.txt': 'Deutsche Kurzfassung\n',
    'de/description.txt': 'Deutsche Beschreibung\n',
    'de/privacy.txt': 'Deutsche Datenschutzerklaerung\n',
};

export default async () => {
    await describe('webext stores: amo listing', async () => {
        await it('maps generator languages onto AMO locale codes', async () => {
            expect(amoLocale('en')).toBe('en-US');
            expect(amoLocale('de')).toBe('de');
            expect(amoLocale('pt_BR')).toBe('pt-BR');
            expect(amoLocale('zh-cn')).toBe('zh-CN');
            expect(amoLocale('xx')).toBe(null);
        });

        await it('sends description to the addon, privacy to eula_policy, never name or summary', async () => {
            const { backend, seen } = fakeAmo();
            const lines: string[] = [];
            const code = await runListingUpload({
                listingRoot: listingDir(FILES),
                dryRun: false,
                backend: () => backend,
                out: (l) => lines.push(l),
            });
            expect(code).toBe(0);
            const addonPatch = seen.find((s) => s.method === 'PATCH' && s.url === `${ADDON}/`)!;
            const body = addonPatch.body as Record<string, Record<string, string>>;
            expect(Object.keys(body).sort().join(',')).toBe('description');
            expect(body.description!['en-US']).toBe('English description');
            expect(body.description!['de']).toBe('Deutsche Beschreibung');
            expect('en' in body.description!).toBe(false);
            expect(seen.some((s) => String(JSON.stringify(s.body)).includes('summary'))).toBe(false);
            const policyPatch = seen.find((s) => s.url === `${ADDON}/eula_policy/` && s.method === 'PATCH')!;
            expect((policyPatch.body as Record<string, Record<string, string>>).privacy_policy!['en-US']).toBe(
                'English privacy',
            );
            expect(seen.some((s) => String(JSON.stringify(s.body)).includes('Name'))).toBe(false);
            // No reviewer notes without a version.
            expect(seen.some((s) => s.url.includes('/versions/'))).toBe(false);
            expect(lines.join('\n')).toContain('all match');
        });

        await it('sends approval_notes only for a given version, as a plain string', async () => {
            const { backend, seen } = fakeAmo();
            const code = await runListingUpload({
                listingRoot: listingDir(FILES),
                dryRun: false,
                notesVersion: '4242',
                backend: () => backend,
                out: () => {},
            });
            expect(code).toBe(0);
            const patch = seen.find((s) => s.url === `${ADDON}/versions/4242/` && s.method === 'PATCH')!;
            expect(JSON.stringify(patch.body)).toBe('{"approval_notes":"English notes"}');
        });

        await it('makes no request and builds no backend on --dry-run', async () => {
            let built = false;
            const lines: string[] = [];
            const code = await runListingUpload({
                listingRoot: listingDir(FILES),
                dryRun: true,
                notesVersion: '1.2.3',
                backend: () => {
                    built = true;
                    throw new Error('must not be called');
                },
                out: (l) => lines.push(l),
            });
            expect(code).toBe(0);
            expect(built).toBe(false);
            const text = lines.join('\n');
            expect(text).toContain('description [en-US]: 19 chars');
            expect(text).toContain('privacy_policy (eula_policy) [de]');
            expect(text).toContain('approval_notes (version 1.2.3): 13 chars');
            expect(text).not.toContain('English description');
            expect(text.includes('would send summary')).toBe(false);
        });

        await it("reads AMO's linkified, entity-escaped text back as a match", async () => {
            const { backend } = fakeAmo({ linkify: true });
            const lines: string[] = [];
            const code = await runListingUpload({
                listingRoot: listingDir({
                    'en/description.txt': 'Use <b>it</b> & see "docs" at jumplink.eu/beifahrer\n',
                    'en/privacy.txt': 'Policy: jumplink.eu/privacy?a=1&b=2\n',
                }),
                dryRun: false,
                backend: () => backend,
                out: (l) => lines.push(l),
            });
            expect(lines.join('\n')).toContain('description [en-US]: match');
            expect(lines.join('\n')).toContain('privacy_policy [en-US]: match');
            expect(code).toBe(0);
        });

        await it('reports a read-back mismatch as a failure', async () => {
            const { backend } = fakeAmo({ corruptDescription: true });
            const lines: string[] = [];
            const code = await runListingUpload({
                listingRoot: listingDir(FILES),
                dryRun: false,
                backend: () => backend,
                out: (l) => lines.push(l),
            });
            expect(code).toBe(1);
            const text = lines.join('\n');
            expect(text).toContain('description [en-US]: mismatch');
            expect(text).toContain('NOT confirmed');
        });

        await it('keeps credentials out of a failed PATCH message', async () => {
            const { backend } = fakeAmo({ failPatchWith: { status: 400, body: `bad request, token ${SECRET}` } });
            let message = '';
            try {
                await runListingUpload({
                    listingRoot: listingDir(FILES),
                    dryRun: false,
                    backend: () => backend,
                    out: () => {},
                });
            } catch (error) {
                expect(error instanceof StoreApiError).toBe(true);
                message = (error as Error).message;
            }
            expect(message).toContain('HTTP 400');
            expect(message.includes(SECRET)).toBe(false);
        });

        await it('names every problem in one error: unknown language, empty description', async () => {
            let message = '';
            try {
                await runListingUpload({
                    listingRoot: listingDir({ 'xx/description.txt': 's', 'de/description.txt': '' }),
                    dryRun: true,
                    backend: () => {
                        throw new Error('unreachable');
                    },
                    out: () => {},
                });
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('"xx" has no AMO locale');
            expect(message).toContain('de/description.txt is missing or empty');
        });
    });
};
