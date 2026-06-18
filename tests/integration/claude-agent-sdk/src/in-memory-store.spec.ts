// SPDX-License-Identifier: MIT
// Tests for InMemorySessionStore from @anthropic-ai/claude-agent-sdk.
//
// InMemorySessionStore is explicitly documented as an in-process implementation
// for testing and development (see `@alpha` tag in sdk.d.ts).  It is the
// canonical API surface for validating that session-store round-trips work
// correctly on a given runtime — we exercise all public methods.
//
// No Claude API key or filesystem access required.

import { describe, expect, it } from '@gjsify/unit';
import {
    InMemorySessionStore,
    type SessionKey,
    type SessionStoreEntry,
} from '@anthropic-ai/claude-agent-sdk';

function makeKey(projectKey: string, sessionId: string): SessionKey {
    return { projectKey, sessionId };
}

function makeEntry(type: string, uuid: string): SessionStoreEntry {
    return { type, uuid, timestamp: '2024-01-01T00:00:00.000Z' };
}

export default async () => {
    await describe('InMemorySessionStore', async () => {
        await describe('initial state', async () => {
            await it('starts with size 0', async () => {
                const store = new InMemorySessionStore();
                expect(store.size).toBe(0);
            });

            await it('load on an unknown key returns null', async () => {
                const store = new InMemorySessionStore();
                const result = await store.load(makeKey('project', 'unknown-session'));
                expect(result).toBeNull();
            });

            await it('listSessions on an empty store returns []', async () => {
                const store = new InMemorySessionStore();
                const sessions = await store.listSessions('any-project');
                expect(Array.isArray(sessions)).toBe(true);
                expect(sessions.length).toBe(0);
            });
        });

        await describe('append + load round-trip', async () => {
            await it('appended entries are loaded back verbatim', async () => {
                const store = new InMemorySessionStore();
                const key = makeKey('proj', 'session-A');
                const entries: SessionStoreEntry[] = [
                    makeEntry('user', 'uuid-1'),
                    makeEntry('assistant', 'uuid-2'),
                ];

                await store.append(key, entries);
                const loaded = await store.load(key);

                expect(loaded).not.toBeNull();
                expect(loaded!.length).toBe(2);
                expect(loaded![0].type).toBe('user');
                expect(loaded![0].uuid).toBe('uuid-1');
                expect(loaded![1].type).toBe('assistant');
                expect(loaded![1].uuid).toBe('uuid-2');
            });

            await it('multiple appends accumulate entries in order', async () => {
                const store = new InMemorySessionStore();
                const key = makeKey('proj', 'session-B');

                await store.append(key, [makeEntry('user', 'u1')]);
                await store.append(key, [makeEntry('assistant', 'u2'), makeEntry('user', 'u3')]);

                const loaded = await store.load(key);
                expect(loaded!.length).toBe(3);
                expect(loaded![0].uuid).toBe('u1');
                expect(loaded![1].uuid).toBe('u2');
                expect(loaded![2].uuid).toBe('u3');
            });

            await it('entries with extra fields are preserved', async () => {
                const store = new InMemorySessionStore();
                const key = makeKey('proj', 'session-C');
                const entry: SessionStoreEntry = {
                    type: 'user',
                    uuid: 'uuid-extra',
                    timestamp: '2024-06-01T12:00:00.000Z',
                    custom_field: 'hello',
                    nested: { a: 1, b: [2, 3] },
                };

                await store.append(key, [entry]);
                const loaded = await store.load(key);

                expect(loaded![0]).toStrictEqual(entry);
            });
        });

        await describe('size tracking', async () => {
            await it('size increases after appending to new sessions', async () => {
                const store = new InMemorySessionStore();
                await store.append(makeKey('p', 's1'), [makeEntry('user', 'u1')]);
                expect(store.size).toBe(1);
                await store.append(makeKey('p', 's2'), [makeEntry('user', 'u2')]);
                expect(store.size).toBe(2);
            });

            await it('appending to the same session does not increase size', async () => {
                const store = new InMemorySessionStore();
                const key = makeKey('p', 'same');
                await store.append(key, [makeEntry('user', 'u1')]);
                await store.append(key, [makeEntry('assistant', 'u2')]);
                expect(store.size).toBe(1);
            });
        });

        await describe('listSessions', async () => {
            await it('returns the correct sessionId for each stored session', async () => {
                const store = new InMemorySessionStore();
                await store.append(makeKey('proj', 'ses-1'), [makeEntry('user', 'u1')]);
                await store.append(makeKey('proj', 'ses-2'), [makeEntry('user', 'u2')]);

                const sessions = await store.listSessions('proj');
                expect(sessions.length).toBe(2);

                const ids = sessions.map((s) => s.sessionId).sort();
                expect(ids).toStrictEqual(['ses-1', 'ses-2']);
            });

            await it('sessions from a different projectKey are not returned', async () => {
                const store = new InMemorySessionStore();
                await store.append(makeKey('projectA', 'ses-1'), [makeEntry('user', 'u1')]);
                await store.append(makeKey('projectB', 'ses-2'), [makeEntry('user', 'u2')]);

                const sessionsA = await store.listSessions('projectA');
                expect(sessionsA.length).toBe(1);
                expect(sessionsA[0].sessionId).toBe('ses-1');

                const sessionsB = await store.listSessions('projectB');
                expect(sessionsB.length).toBe(1);
                expect(sessionsB[0].sessionId).toBe('ses-2');
            });

            await it('each entry has numeric mtime', async () => {
                const store = new InMemorySessionStore();
                await store.append(makeKey('p', 's1'), [makeEntry('user', 'u1')]);
                const sessions = await store.listSessions('p');
                expect(typeof sessions[0].mtime).toBe('number');
            });
        });

        await describe('delete', async () => {
            await it('delete removes the session and decrements size', async () => {
                const store = new InMemorySessionStore();
                const key = makeKey('p', 'to-delete');
                await store.append(key, [makeEntry('user', 'u1')]);
                expect(store.size).toBe(1);

                await store.delete(key);
                expect(store.size).toBe(0);

                const loaded = await store.load(key);
                expect(loaded).toBeNull();
            });

            await it('deleting a non-existent key is a no-op', async () => {
                const store = new InMemorySessionStore();
                // Should not throw
                await store.delete(makeKey('p', 'ghost'));
                expect(store.size).toBe(0);
            });
        });

        await describe('getEntries (test helper)', async () => {
            await it('returns live entries for a key', async () => {
                const store = new InMemorySessionStore();
                const key = makeKey('p', 'get-entries-test');
                const e1 = makeEntry('user', 'u1');
                await store.append(key, [e1]);

                const entries = store.getEntries(key);
                expect(entries.length).toBe(1);
                expect(entries[0]).toStrictEqual(e1);
            });

            await it('returns [] for an unknown key', async () => {
                const store = new InMemorySessionStore();
                const entries = store.getEntries(makeKey('p', 'unknown'));
                expect(Array.isArray(entries)).toBe(true);
                expect(entries.length).toBe(0);
            });
        });

        await describe('clear (test helper)', async () => {
            await it('resets size to 0 and loses all data', async () => {
                const store = new InMemorySessionStore();
                await store.append(makeKey('p', 's1'), [makeEntry('user', 'u1')]);
                await store.append(makeKey('p', 's2'), [makeEntry('user', 'u2')]);
                expect(store.size).toBe(2);

                store.clear();
                expect(store.size).toBe(0);

                const loaded = await store.load(makeKey('p', 's1'));
                expect(loaded).toBeNull();
            });
        });

        await describe('listSubkeys', async () => {
            await it('returns [] when no subkeys exist', async () => {
                const store = new InMemorySessionStore();
                const key = makeKey('p', 'main-session');
                await store.append(key, [makeEntry('user', 'u1')]);

                const subkeys = await store.listSubkeys({ projectKey: 'p', sessionId: 'main-session' });
                expect(Array.isArray(subkeys)).toBe(true);
            });

            await it('returns subpath keys appended under a session', async () => {
                const store = new InMemorySessionStore();
                const mainKey: SessionKey = { projectKey: 'p', sessionId: 'ses', subpath: undefined };
                const subKey: SessionKey = { projectKey: 'p', sessionId: 'ses', subpath: 'agent-007' };

                await store.append(mainKey, [makeEntry('user', 'u1')]);
                await store.append(subKey, [makeEntry('tool_result', 'u2')]);

                const subkeys = await store.listSubkeys({ projectKey: 'p', sessionId: 'ses' });
                expect(subkeys).toContain('agent-007');
            });
        });
    });
};
