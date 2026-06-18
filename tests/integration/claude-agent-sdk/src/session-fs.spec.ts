// SPDX-License-Identifier: MIT
// Tests for the filesystem-backed session readers in @anthropic-ai/claude-agent-sdk:
//   - getSessionMessages(sessionId, { dir })
//   - getSessionInfo(sessionId, { dir })
//   - listSessions({ dir })
//
// These functions read the on-disk transcript store that Claude Code writes to:
//   <CLAUDE_CONFIG_DIR | ~/.claude>/projects/<sanitizedDir>/<sessionId>.jsonl
// where sanitizedDir = dir.replace(/[^a-zA-Z0-9]/g, '-')   (verified against the
// SDK bundle: `So(e) = e.replace(/[^a-zA-Z0-9]/g, "-")`).
//
// We point CLAUDE_CONFIG_DIR at a throwaway temp directory, write a faithful
// minimal transcript (matching the real Claude Code JSONL line shape), and read
// it back.  This exercises @gjsify's node:fs (readdir/readFile/stat/mkdir/
// writeFile), node:os (homedir/tmpdir), node:path and process.env end-to-end —
// the same I/O a future GNOME-native Claude agent UI would perform.
//
// No Claude API key or network access required.

import { describe, expect, it } from '@gjsify/unit';
import {
    getSessionInfo,
    getSessionMessages,
    listSessions,
} from '@anthropic-ai/claude-agent-sdk';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Replicates the SDK's project-dir → storage-key sanitization. */
function sanitizeDir(dir: string): string {
    return dir.replace(/[^a-zA-Z0-9]/g, '-');
}

/** A faithful, minimal transcript line (matches Claude Code's on-disk JSONL). */
function transcriptLine(
    type: 'user' | 'assistant',
    uuid: string,
    sessionId: string,
    text: string,
    parentUuid: string | null,
    cwd: string,
): string {
    return JSON.stringify({
        parentUuid,
        isSidechain: false,
        type,
        message: {
            role: type,
            content: type === 'user' ? text : [{ type: 'text', text }],
        },
        uuid,
        timestamp: '2024-01-01T00:00:00.000Z',
        userType: 'external',
        cwd,
        sessionId,
        version: '2.0.0',
    });
}

interface Fixture {
    configDir: string;
    projectDir: string;
    sessionId: string;
}

/**
 * Sets up a temp CLAUDE_CONFIG_DIR with one project + one session transcript,
 * runs `fn`, then restores env and cleans up.
 */
async function withSessionFixture<T>(fn: (fx: Fixture) => Promise<T>): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'gjsify-cas-'));
    const configDir = join(root, 'config');
    // Use a stable, non-git project dir so listSessions doesn't fan out to worktrees.
    const projectDir = join(root, 'myproject');
    const sessionId = '11111111-2222-3333-4444-555555555555';

    const projectsKeyDir = join(configDir, 'projects', sanitizeDir(projectDir));
    await mkdir(projectsKeyDir, { recursive: true });

    const transcript =
        transcriptLine('user', 'u-0001', sessionId, 'What is 2 + 2?', null, projectDir) +
        '\n' +
        transcriptLine('assistant', 'a-0001', sessionId, 'The answer is 4.', 'u-0001', projectDir) +
        '\n';
    await writeFile(join(projectsKeyDir, `${sessionId}.jsonl`), transcript, 'utf8');

    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    try {
        return await fn({ configDir, projectDir, sessionId });
    } finally {
        if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
        else process.env.CLAUDE_CONFIG_DIR = prevConfigDir;
        await rm(root, { recursive: true, force: true });
    }
}

export default async () => {
    await describe('filesystem session readers', async () => {
        await describe('getSessionMessages', async () => {
            await it('reads back the user + assistant turns from disk', async () => {
                await withSessionFixture(async ({ projectDir, sessionId }) => {
                    const messages = await getSessionMessages(sessionId, { dir: projectDir });
                    expect(Array.isArray(messages)).toBe(true);
                    expect(messages.length).toBe(2);

                    expect(messages[0].type).toBe('user');
                    expect(messages[0].uuid).toBe('u-0001');
                    expect(messages[0].session_id).toBe(sessionId);

                    expect(messages[1].type).toBe('assistant');
                    expect(messages[1].uuid).toBe('a-0001');
                });
            });

            await it('respects the limit option', async () => {
                await withSessionFixture(async ({ projectDir, sessionId }) => {
                    const messages = await getSessionMessages(sessionId, { dir: projectDir, limit: 1 });
                    expect(messages.length).toBe(1);
                    expect(messages[0].uuid).toBe('u-0001');
                });
            });

            await it('returns [] for an unknown session id', async () => {
                await withSessionFixture(async ({ projectDir }) => {
                    const messages = await getSessionMessages('does-not-exist', { dir: projectDir });
                    expect(Array.isArray(messages)).toBe(true);
                    expect(messages.length).toBe(0);
                });
            });
        });

        await describe('getSessionInfo', async () => {
            await it('returns metadata for an existing session', async () => {
                await withSessionFixture(async ({ projectDir, sessionId }) => {
                    const info = await getSessionInfo(sessionId, { dir: projectDir });
                    expect(info).toBeDefined();
                    expect(info!.sessionId).toBe(sessionId);
                    expect(typeof info!.lastModified).toBe('number');
                });
            });

            await it('returns undefined for an unknown session id', async () => {
                await withSessionFixture(async ({ projectDir }) => {
                    const info = await getSessionInfo('does-not-exist', { dir: projectDir });
                    expect(info).toBeUndefined();
                });
            });
        });

        await describe('listSessions', async () => {
            await it('lists the session for the project directory', async () => {
                await withSessionFixture(async ({ projectDir, sessionId }) => {
                    const sessions = await listSessions({ dir: projectDir });
                    expect(Array.isArray(sessions)).toBe(true);
                    const ids = sessions.map((s) => s.sessionId);
                    expect(ids).toContain(sessionId);
                });
            });

            await it('returns [] for a project directory with no sessions', async () => {
                await withSessionFixture(async ({ configDir }) => {
                    // A sibling project dir that was never written to.
                    const emptyProject = join(configDir, '..', 'empty-project');
                    const sessions = await listSessions({ dir: emptyProject });
                    expect(Array.isArray(sessions)).toBe(true);
                    expect(sessions.length).toBe(0);
                });
            });
        });
    });
};
