// SPDX-License-Identifier: MIT
// DeltaChat / chatmail core integration smoke test for GJS.
//
// Architecture under test:
//   gjsify app
//     ↓ (pure JS)
//   @deltachat/jsonrpc-client.StdioDeltaChat
//     ↓ (spawn + bidirectional stdio)
//   @deltachat/stdio-rpc-server (Node wrapper)
//     ↓ (child_process.spawn)
//   deltachat-rpc-server (Rust binary, ~27 MB static-PIE ELF)
//     ↳ talks JSON-RPC over its own stdin/stdout
//
// What this exercises on the GJS side:
//   - @gjsify/child_process.spawn → Gio.Subprocess
//   - bidirectional stdio piping (the Rust server reads stdin + writes stdout
//     newline-delimited JSON; the client speaks the same)
//   - @gjsify/fs.statSync (for binary-exists check)
//   - @gjsify/module.createRequire (binary path resolution)
//   - @gjsify/os.arch + globalThis.process.platform (for picking the
//     platform-specific @deltachat/stdio-rpc-server-<os>-<arch> subpackage)

import { describe, expect, it } from '@gjsify/unit';
import { startDeltaChat } from '@deltachat/stdio-rpc-server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default async () => {
    await describe('@deltachat/stdio-rpc-server — Rust core over JSON-RPC/stdio', async () => {
        await it('starts the deltachat-rpc-server subprocess + responds to getSystemInfo', async () => {
            const accountsDir = await mkdtemp(join(tmpdir(), 'gjsify-deltachat-smoke-'));
            const dc = startDeltaChat(accountsDir, { muteStdErr: true });
            try {
                const info = await dc.rpc.getSystemInfo();
                expect(info).toBeTruthy();
                expect(typeof info).toBe('object');
                // The server returns a record with at least a 'deltachat_core_version' key
                expect(info.deltachat_core_version).toBeDefined();
                expect(typeof info.deltachat_core_version).toBe('string');
            } finally {
                dc.close();
                await rm(accountsDir, { recursive: true, force: true });
            }
        });

        await it('checkEmailValidity returns true for a well-formed address', async () => {
            const accountsDir = await mkdtemp(join(tmpdir(), 'gjsify-deltachat-smoke-'));
            const dc = startDeltaChat(accountsDir, { muteStdErr: true });
            try {
                const valid = await dc.rpc.checkEmailValidity('test@example.com');
                expect(valid).toBe(true);
                const invalid = await dc.rpc.checkEmailValidity('not-an-email');
                expect(invalid).toBe(false);
            } finally {
                dc.close();
                await rm(accountsDir, { recursive: true, force: true });
            }
        });

        await it('getAllAccountIds returns [] on a fresh accounts dir', async () => {
            const accountsDir = await mkdtemp(join(tmpdir(), 'gjsify-deltachat-smoke-'));
            const dc = startDeltaChat(accountsDir, { muteStdErr: true });
            try {
                const ids = await dc.rpc.getAllAccountIds();
                expect(Array.isArray(ids)).toBe(true);
                expect(ids.length).toBe(0);
            } finally {
                dc.close();
                await rm(accountsDir, { recursive: true, force: true });
            }
        });

        await it('addAccount returns a positive integer account id, listed by getAllAccountIds', async () => {
            const accountsDir = await mkdtemp(join(tmpdir(), 'gjsify-deltachat-smoke-'));
            const dc = startDeltaChat(accountsDir, { muteStdErr: true });
            try {
                const id = await dc.rpc.addAccount();
                expect(typeof id).toBe('number');
                expect(id).toBeGreaterThan(0);
                const allIds = await dc.rpc.getAllAccountIds();
                expect(allIds).toContain(id);
            } finally {
                dc.close();
                await rm(accountsDir, { recursive: true, force: true });
            }
        });

        await it('removeAccount removes the previously-added account', async () => {
            const accountsDir = await mkdtemp(join(tmpdir(), 'gjsify-deltachat-smoke-'));
            const dc = startDeltaChat(accountsDir, { muteStdErr: true });
            try {
                const id = await dc.rpc.addAccount();
                expect(await dc.rpc.getAllAccountIds()).toContain(id);
                await dc.rpc.removeAccount(id);
                const after = await dc.rpc.getAllAccountIds();
                expect(after).not.toContain(id);
            } finally {
                dc.close();
                await rm(accountsDir, { recursive: true, force: true });
            }
        });

        await it('getProviderInfo for a known email resolves to a provider record', async () => {
            const accountsDir = await mkdtemp(join(tmpdir(), 'gjsify-deltachat-smoke-'));
            const dc = startDeltaChat(accountsDir, { muteStdErr: true });
            try {
                const id = await dc.rpc.addAccount();
                // gmail.com is in the bundled provider database
                const provider = await dc.rpc.getProviderInfo(id, 'gmail.com');
                expect(provider).toBeTruthy();
                // The fields include `id`, `status`, `before_login_hint`, etc.
                expect(typeof provider!.id).toBe('string');
                await dc.rpc.removeAccount(id);
            } finally {
                dc.close();
                await rm(accountsDir, { recursive: true, force: true });
            }
        });

        await it('sleep(50) resolves after ~50ms on the server side', async () => {
            const accountsDir = await mkdtemp(join(tmpdir(), 'gjsify-deltachat-smoke-'));
            const dc = startDeltaChat(accountsDir, { muteStdErr: true });
            try {
                const start = Date.now();
                await dc.rpc.sleep(0.05);
                const elapsed = Date.now() - start;
                expect(elapsed).toBeGreaterThan(40);
                // Generous upper bound — accounts for spawn warmup + RPC latency
                expect(elapsed).toBeLessThan(2000);
            } finally {
                dc.close();
                await rm(accountsDir, { recursive: true, force: true });
            }
        });
    });
};
