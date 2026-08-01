// SPDX-License-Identifier: MIT
// Tests for foldSessionSummary from @anthropic-ai/claude-agent-sdk.
//
// foldSessionSummary is the incremental state reducer that SessionStore
// adapters call inside append() to maintain a SessionSummaryEntry sidecar.
// It is a pure function (no I/O), making it safe to test on both runtimes
// without any external dependencies.
//
// No Claude API key or filesystem access required.

import { describe, expect, it } from '@gjsify/unit';
import {
    foldSessionSummary,
    type SessionKey,
    type SessionStoreEntry,
    type SessionSummaryEntry,
} from '@anthropic-ai/claude-agent-sdk';

const PROJECT_KEY = 'test-project';
const SESSION_ID = 'test-session-summary-1';

function makeKey(): SessionKey {
    return { projectKey: PROJECT_KEY, sessionId: SESSION_ID };
}

function makeEntries(...types: string[]): SessionStoreEntry[] {
    return types.map((type, i) => ({
        type,
        uuid: `uuid-${i + 1}`,
        timestamp: `2024-01-01T00:00:0${i}.000Z`,
    }));
}

export default async () => {
    await describe('foldSessionSummary', async () => {
        await describe('initial fold (prev = undefined)', async () => {
            await it('returns a SessionSummaryEntry', async () => {
                const key = makeKey();
                const entries = makeEntries('user', 'assistant');

                const summary = foldSessionSummary(undefined, key, entries, { mtime: 1000 });

                expect(typeof summary).toBe('object');
                expect(summary).not.toBeNull();
            });

            await it('summary.sessionId matches the key', async () => {
                const key = makeKey();
                const entries = makeEntries('user');

                const summary = foldSessionSummary(undefined, key, entries, { mtime: 2000 });

                expect(summary.sessionId).toBe(SESSION_ID);
            });

            await it('summary.mtime equals the provided mtime option', async () => {
                const key = makeKey();
                const entries = makeEntries('user');

                const summary = foldSessionSummary(undefined, key, entries, { mtime: 9999 });

                expect(summary.mtime).toBe(9999);
            });

            await it('summary.data is a plain object', async () => {
                const key = makeKey();
                const entries = makeEntries('user');

                const summary = foldSessionSummary(undefined, key, entries, { mtime: 1 });

                expect(typeof summary.data).toBe('object');
                expect(summary.data).not.toBeNull();
            });
        });

        await describe('incremental fold (prev set)', async () => {
            await it('sessionId is preserved across folds', async () => {
                const key = makeKey();
                const first = foldSessionSummary(undefined, key, makeEntries('user'), { mtime: 1 });
                const second = foldSessionSummary(first, key, makeEntries('assistant'), { mtime: 2 });

                expect(second.sessionId).toBe(SESSION_ID);
            });

            await it('mtime is updated on each fold when provided', async () => {
                const key = makeKey();
                const first = foldSessionSummary(undefined, key, makeEntries('user'), { mtime: 100 });
                const second = foldSessionSummary(first, key, makeEntries('assistant'), { mtime: 200 });

                expect(second.mtime).toBe(200);
            });

            await it('mtime is preserved when option is omitted', async () => {
                const key = makeKey();
                const first = foldSessionSummary(undefined, key, makeEntries('user'), { mtime: 500 });
                const second = foldSessionSummary(first, key, makeEntries('assistant'));

                // Per the JSDoc: when mtime omitted, previous summary's mtime is preserved.
                expect(second.mtime).toBe(500);
            });
        });

        await describe('entry variety', async () => {
            await it('works with an empty entries array', async () => {
                const key = makeKey();
                const summary = foldSessionSummary(undefined, key, [], { mtime: 1 });
                expect(summary.sessionId).toBe(SESSION_ID);
                expect(typeof summary.data).toBe('object');
            });

            await it('works with entries that have no uuid field', async () => {
                const key = makeKey();
                const entries: SessionStoreEntry[] = [{ type: 'title' }, { type: 'tag', tag: 'important' }];
                const summary = foldSessionSummary(undefined, key, entries, { mtime: 1 });
                expect(summary.sessionId).toBe(SESSION_ID);
            });

            await it('works with a large batch of entries', async () => {
                const key = makeKey();
                const entries: SessionStoreEntry[] = Array.from({ length: 100 }, (_, i) => ({
                    type: i % 2 === 0 ? 'user' : 'assistant',
                    uuid: `batch-uuid-${i}`,
                }));
                const summary = foldSessionSummary(undefined, key, entries, { mtime: 1 });
                expect(summary.sessionId).toBe(SESSION_ID);
            });
        });
    });
};
