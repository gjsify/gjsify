// The version-level hold: do not ship a package pinning a version nobody can install.
//
// v0.59.x shipped adwaita-web and adwaita-nativescript pinning adwaita-fonts
// versions that were stuck in "Validating"; the name-level guard passed because
// older versions of the name exist. Rows below fix that: a served pin passes, an
// unserved one holds, a terminal status holds without waiting, a late one is
// waited for, and the ledger carries a verdict from one sweep process to the next.

import { describe, expect, it } from '@gjsify/unit';
import {
    findUnavailablePins,
    holdsPublish,
    pinVersion,
    readLedger,
    appendLedger,
    renderLedgerSummary,
    pendingEntries,
    markHeldPublished,
    settleUnserved,
    type LedgerEntry,
} from './utils/publish-hold.js';
import type { WorkspacePin } from './utils/publish-pins.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REGISTRY = 'https://r.example';

function pin(name: string, spec: string, block: WorkspacePin['block'] = 'dependencies'): WorkspacePin {
    return { name, spec, block } as WorkspacePin;
}

interface FakeOptions {
    /** `name@version` strings the packument serves, from the Nth packument request on. */
    servedAfter?: { key: string; afterRequests: number };
    served?: string[];
    status?: string;
}

function fakeRegistry(opts: FakeOptions): {
    fetchImpl: typeof fetch;
    packumentGets: () => number;
    statusGets: () => number;
} {
    let packument = 0;
    let statusCalls = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        const json = { 'content-type': 'application/json' };
        if (url.includes('/-/package/')) {
            statusCalls++;
            return new Response(JSON.stringify({ status: opts.status ?? 'validating' }), {
                status: 200,
                headers: json,
            });
        }
        packument++;
        const name = decodeURIComponent(url.replace(REGISTRY + '/', '').split('?')[0] ?? '');
        const served = [...(opts.served ?? [])];
        if (opts.servedAfter && packument > opts.servedAfter.afterRequests) served.push(opts.servedAfter.key);
        const versions: Record<string, unknown> = {};
        for (const key of served) {
            const at = key.lastIndexOf('@');
            if (key.slice(0, at) === name) {
                const v = key.slice(at + 1);
                versions[v] = {
                    version: v,
                    dist: { shasum: 'x', tarball: `${REGISTRY}/${name}/-/${v}.tgz` },
                };
            }
        }
        if (Object.keys(versions).length === 0) return new Response('{}', { status: 404, headers: json });
        return new Response(JSON.stringify({ name, versions }), {
            status: 200,
            headers: json,
        });
    }) as typeof fetch;
    return {
        fetchImpl,
        packumentGets: () => packument,
        statusGets: () => statusCalls,
    };
}

function clock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
    let t = 1_000;
    return { now: () => t, sleep: async (ms) => void (t += ms) };
}

export default async () => {
    await describe('pinVersion', async () => {
        await it('reads exact, caret and tilde single versions', async () => {
            expect(pinVersion('0.59.1')).toBe('0.59.1');
            expect(pinVersion('^0.59.1')).toBe('0.59.1');
            expect(pinVersion('~1.2.3-beta.1')).toBe('1.2.3-beta.1');
        });
        await it('declines ranges, tags and URLs', async () => {
            expect(pinVersion('>=1.0.0')).toBeUndefined();
            expect(pinVersion('latest')).toBeUndefined();
            expect(pinVersion('^1.0.0 || ^2.0.0')).toBeUndefined();
            expect(pinVersion('file:../x')).toBeUndefined();
        });
    });

    await describe('findUnavailablePins', async () => {
        await it('passes a served pin after one probe', async () => {
            const reg = fakeRegistry({ served: ['@gjsify/a@1.0.0'] });
            const c = clock();
            const reasons = await findUnavailablePins({
                registry: REGISTRY,
                pins: [pin('@gjsify/a', '^1.0.0')],
                ledger: [],
                waitBudgetMs: 300_000,
                fetchImpl: reg.fetchImpl,
                ...c,
            });
            expect(reasons.length).toBe(0);
            expect(reg.statusGets()).toBe(0);
        });

        await it('reports an optional pin that is not served but does not hold on it', async () => {
            const reg = fakeRegistry({ status: 'validating' });
            const c = clock();
            const reasons = await findUnavailablePins({
                registry: REGISTRY,
                pins: [pin('@gjsify/opt', '^1.0.0', 'optionalDependencies')],
                ledger: [],
                waitBudgetMs: 300_000,
                fetchImpl: reg.fetchImpl,
                ...c,
            });
            expect(reasons.length).toBe(1);
            expect(reasons[0]?.block).toBe('optionalDependencies');
            expect(reasons.filter(holdsPublish).length).toBe(0);
            expect(c.now() < 60_000).toBe(true);
        });

        await it('holds on a terminal status without waiting', async () => {
            const reg = fakeRegistry({ status: 'blocked' });
            const c = clock();
            const reasons = await findUnavailablePins({
                registry: REGISTRY,
                pins: [pin('@gjsify/adwaita-fonts', '^0.59.1')],
                ledger: [],
                statusToken: 't',
                waitBudgetMs: 300_000,
                fetchImpl: reg.fetchImpl,
                ...c,
            });
            expect(reasons.length).toBe(1);
            expect(reasons[0]?.cls).toBe('blocked');
            expect(reg.packumentGets() <= 3).toBe(true);
        });

        await it('waits for a validating pin and holds when it never arrives', async () => {
            const reg = fakeRegistry({ status: 'validating' });
            const c = clock();
            const reasons = await findUnavailablePins({
                registry: REGISTRY,
                pins: [pin('@gjsify/adwaita-fonts', '0.59.1')],
                ledger: [],
                statusToken: 't',
                waitBudgetMs: 60_000,
                fetchImpl: reg.fetchImpl,
                ...c,
            });
            expect(reasons[0]?.cls).toBe('validating');
            expect(c.now() - 1_000 >= 30_000).toBe(true);
        });

        await it('does not hold a pin that turns up during the wait', async () => {
            const reg = fakeRegistry({
                servedAfter: { key: '@gjsify/a@1.0.0', afterRequests: 3 },
            });
            const c = clock();
            const reasons = await findUnavailablePins({
                registry: REGISTRY,
                pins: [pin('@gjsify/a', '1.0.0')],
                ledger: [],
                waitBudgetMs: 300_000,
                fetchImpl: reg.fetchImpl,
                ...c,
            });
            expect(reasons.length).toBe(0);
        });

        await it('takes a terminal ledger entry as the answer, without any request', async () => {
            const reg = fakeRegistry({ served: ['@gjsify/a@1.0.0'] });
            const ledger: LedgerEntry[] = [
                {
                    ev: 'unserved',
                    name: '@gjsify/a',
                    version: '1.0.0',
                    cls: 'staged',
                    detail: 'pending',
                },
            ];
            const reasons = await findUnavailablePins({
                registry: REGISTRY,
                pins: [pin('@gjsify/a', '^1.0.0')],
                ledger,
                waitBudgetMs: 300_000,
                fetchImpl: reg.fetchImpl,
                ...clock(),
            });
            expect(reasons[0]?.cls).toBe('staged');
            expect(reg.packumentGets()).toBe(0);
        });

        await it('re-probes a non-terminal ledger entry and does not hold once served', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-ledger-'));
            try {
                const ledgerPath = join(dir, 'l.jsonl');
                const reg = fakeRegistry({ served: ['@gjsify/a@1.0.0'] });
                const ledger: LedgerEntry[] = [
                    { ev: 'unserved', name: '@gjsify/a', version: '1.0.0', cls: 'validating', detail: 'pending' },
                ];
                const reasons = await findUnavailablePins({
                    registry: REGISTRY,
                    pins: [pin('@gjsify/a', '^1.0.0')],
                    ledger,
                    ledgerPath,
                    waitBudgetMs: 300_000,
                    fetchImpl: reg.fetchImpl,
                    ...clock(),
                });
                expect(reasons.length).toBe(0);
                expect(reg.packumentGets()).toBe(1);
                const written = readLedger(ledgerPath);
                expect(written.length).toBe(1);
                expect(written[0]?.ev).toBe('served');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('waits for a non-terminal ledger entry that turns up during the wait', async () => {
            const reg = fakeRegistry({ servedAfter: { key: '@gjsify/a@1.0.0', afterRequests: 3 } });
            const ledger: LedgerEntry[] = [
                { ev: 'unserved', name: '@gjsify/a', version: '1.0.0', cls: 'validating', detail: 'pending' },
            ];
            const reasons = await findUnavailablePins({
                registry: REGISTRY,
                pins: [pin('@gjsify/a', '1.0.0')],
                ledger,
                waitBudgetMs: 300_000,
                fetchImpl: reg.fetchImpl,
                ...clock(),
            });
            expect(reasons.length).toBe(0);
        });

        await it('lets a later served entry supersede an unserved one', async () => {
            const reg = fakeRegistry({});
            const ledger: LedgerEntry[] = [
                { ev: 'unserved', name: '@gjsify/a', version: '1.0.0', cls: 'blocked', detail: 'd' },
                { ev: 'served', name: '@gjsify/a', version: '1.0.0' },
            ];
            const reasons = await findUnavailablePins({
                registry: REGISTRY,
                pins: [pin('@gjsify/a', '1.0.0')],
                ledger,
                waitBudgetMs: 300_000,
                fetchImpl: reg.fetchImpl,
                ...clock(),
            });
            expect(reasons.length).toBe(0);
            expect(reg.packumentGets()).toBe(0);
        });

        await it('holds at once on a terminal ledger entry', async () => {
            const reg = fakeRegistry({ served: ['@gjsify/a@1.0.0'] });
            const ledger: LedgerEntry[] = [
                { ev: 'unserved', name: '@gjsify/a', version: '1.0.0', cls: 'blocked', detail: 'failed' },
            ];
            const reasons = await findUnavailablePins({
                registry: REGISTRY,
                pins: [pin('@gjsify/a', '^1.0.0')],
                ledger,
                waitBudgetMs: 300_000,
                fetchImpl: reg.fetchImpl,
                ...clock(),
            });
            expect(reasons[0]?.cls).toBe('blocked');
            expect(reg.packumentGets()).toBe(0);
        });

        await it('holds a dependent of a held package', async () => {
            const reg = fakeRegistry({});
            const ledger: LedgerEntry[] = [{ ev: 'held', name: '@gjsify/web', version: '2.0.0', reasons: [] }];
            const reasons = await findUnavailablePins({
                registry: REGISTRY,
                pins: [pin('@gjsify/web', '^2.0.0', 'peerDependencies')],
                ledger,
                waitBudgetMs: 300_000,
                fetchImpl: reg.fetchImpl,
                ...clock(),
            });
            expect(reasons[0]?.cls).toBe('held');
            expect(reasons[0]?.block).toBe('peerDependencies');
        });

        await it('skips a pin that names no single version', async () => {
            const reg = fakeRegistry({});
            const reasons = await findUnavailablePins({
                registry: REGISTRY,
                pins: [pin('@gjsify/a', '>=1.0.0')],
                ledger: [],
                waitBudgetMs: 0,
                fetchImpl: reg.fetchImpl,
                ...clock(),
            });
            expect(reasons.length).toBe(0);
            expect(reg.packumentGets()).toBe(0);
        });
    });

    await describe('ledger', async () => {
        await it('round-trips entries and skips a torn line', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-ledger-'));
            try {
                const path = join(dir, 'l.jsonl');
                expect(readLedger(path).length).toBe(0);
                appendLedger(path, {
                    ev: 'unserved',
                    name: 'a',
                    version: '1.0.0',
                    cls: 'blocked',
                    detail: 'd',
                });
                appendLedger(path, {
                    ev: 'held',
                    name: 'b',
                    version: '1.0.0',
                    reasons: [],
                });
                const { appendFileSync } = await import('node:fs');
                appendFileSync(path, '{"ev":"hel');
                expect(readLedger(path).length).toBe(2);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
        await it('is a no-op without a path', async () => {
            appendLedger(undefined, {
                ev: 'held',
                name: 'b',
                version: '1.0.0',
                reasons: [],
            });
            expect(readLedger(undefined).length).toBe(0);
        });
    });

    await describe('renderLedgerSummary', async () => {
        await it('says nothing for an empty ledger', async () => {
            expect(renderLedgerSummary([], 'v1.0.0')).toBeUndefined();
        });
        await it('lists held packages and the exact recovery command', async () => {
            const md = renderLedgerSummary(
                [
                    {
                        ev: 'unserved',
                        name: '@gjsify/adwaita-fonts',
                        version: '0.59.1',
                        cls: 'blocked',
                        detail: 'd',
                    },
                    {
                        ev: 'held',
                        name: '@gjsify/adwaita-web',
                        version: '0.59.1',
                        reasons: [
                            {
                                name: '@gjsify/adwaita-fonts',
                                version: '0.59.1',
                                block: 'dependencies',
                                cls: 'blocked',
                                detail: 'd',
                            },
                        ],
                    },
                    {
                        ev: 'held',
                        name: '@gjsify/adwaita-nativescript',
                        version: '0.59.1',
                        reasons: [],
                    },
                ],
                'v0.59.1',
            ) as string;
            expect(
                md.includes(
                    "gh workflow run release.yml --ref v0.59.1 -f skip_publish=false -f only='@gjsify/adwaita-web @gjsify/adwaita-nativescript'",
                ),
            ).toBe(true);
            expect(md.includes('spent number')).toBe(true);
        });
    });

    await describe('second pass', async () => {
        const held = (name: string): LedgerEntry => ({ ev: 'held', name, version: '1.0.0', reasons: [] });
        const unserved = (name: string): LedgerEntry => ({
            ev: 'unserved',
            name,
            version: '1.0.0',
            cls: 'validating',
            detail: 'd',
        });

        await it('a later served entry supersedes held and unserved', async () => {
            const p = pendingEntries([held('a'), unserved('b'), { ev: 'served', name: 'a', version: '1.0.0' }]);
            expect(p.held.length).toBe(0);
            expect(p.unserved.length).toBe(1);
        });

        await it('markHeldPublished clears a held name, ignores others', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
            const path = join(dir, 'l.jsonl');
            try {
                appendLedger(path, held('a'));
                markHeldPublished(path, 'a', '1.0.0');
                markHeldPublished(path, 'never-held', '1.0.0');
                const p = pendingEntries(readLedger(path));
                expect(p.held.length).toBe(0);
                expect(readLedger(path).length).toBe(2);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('held then served: the dependent no longer holds on it', async () => {
            const reg = fakeRegistry({});
            const ledger: LedgerEntry[] = [held('@gjsify/a'), { ev: 'served', name: '@gjsify/a', version: '1.0.0' }];
            const reasons = await findUnavailablePins({
                registry: REGISTRY,
                pins: [pin('@gjsify/a', '^1.0.0')],
                ledger,
                waitBudgetMs: 0,
                fetchImpl: reg.fetchImpl,
                ...clock(),
            });
            expect(reasons.length).toBe(0);
        });

        await it('settleUnserved confirms a version that appears and records served', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
            const path = join(dir, 'l.jsonl');
            try {
                const entries = [unserved('@gjsify/a')];
                for (const e of entries) appendLedger(path, e);
                const reg = fakeRegistry({ servedAfter: { key: '@gjsify/a@1.0.0', afterRequests: 2 } });
                const done = await settleUnserved({
                    entries,
                    ledgerPath: path,
                    registryFor: () => REGISTRY,
                    budgetMs: 600_000,
                    fetchImpl: reg.fetchImpl,
                    ...clock(),
                });
                expect(done.length).toBe(1);
                const p = pendingEntries(readLedger(path));
                expect(p.unserved.length).toBe(0);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('settleUnserved leaves a never-served and a terminal entry pending', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
            const path = join(dir, 'l.jsonl');
            try {
                const terminal: LedgerEntry = { ...unserved('@gjsify/t'), cls: 'blocked' } as LedgerEntry;
                const entries = [unserved('@gjsify/a'), terminal, held('@gjsify/h')];
                for (const e of entries) appendLedger(path, e);
                const reg = fakeRegistry({});
                const done = await settleUnserved({
                    entries,
                    ledgerPath: path,
                    registryFor: () => REGISTRY,
                    budgetMs: 1000,
                    fetchImpl: reg.fetchImpl,
                    ...clock(),
                });
                expect(done.length).toBe(0);
                const p = pendingEntries(readLedger(path));
                expect(p.unserved.length).toBe(2);
                expect(p.held.length).toBe(1);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });
};
