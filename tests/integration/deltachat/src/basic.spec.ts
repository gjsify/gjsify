// SPDX-License-Identifier: MIT
// Ported from chatmail/core's deltachat-jsonrpc/typescript/test/basic.ts.
// Original: Copyright (c) 2023 chatmail / Delta Chat authors. MPL 2.0 (project license) / MIT (port).
// Rewritten for @gjsify/unit — behaviour preserved, assertion dialect adapted (chai → expect/toBe).
//
// Upstream uses chai + chai-as-promised + mocha hooks (before/after); we adapt
// to @gjsify/unit (no before/after lifecycle — the setup/teardown is inlined
// per `it`). The DeltaChat instance is shared across tests via a startup
// helper rather than via a mocha before-hook, so per-test isolation differs
// slightly: where upstream relies on cumulative state across `it` blocks
// (e.g. "should remove the account again" depends on the prior `it`), we
// rewrite the dependency chain into a single `it` block to keep tests order-
// independent.

import { describe, expect, it } from '@gjsify/unit';
import { startDeltaChat } from '@deltachat/stdio-rpc-server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withDeltaChat<T>(
    fn: (dc: ReturnType<typeof startDeltaChat>) => Promise<T>,
): Promise<T> {
    const accountsDir = await mkdtemp(join(tmpdir(), 'gjsify-deltachat-basic-'));
    const dc = startDeltaChat(accountsDir, { muteStdErr: true });
    try {
        return await fn(dc);
    } finally {
        dc.close();
        await rm(accountsDir, { recursive: true, force: true });
    }
}

export default async () => {
    await describe('DeltaChat basic tests (ported from chatmail/core upstream)', async () => {
        await it('check email address validity — accepts well-formed and yggmail addresses', async () => {
            await withDeltaChat(async (dc) => {
                const validAddresses = [
                    'email@example.com',
                    '36aa165ae3406424e0c61af17700f397cad3fe8ab83d682d0bddf3338a5dd52e@yggmail@yggmail',
                ];
                const invalidAddresses = ['email@', 'example.com', 'emai221'];

                const validResults = await Promise.all(
                    validAddresses.map((email) => dc.rpc.checkEmailValidity(email)),
                );
                expect(validResults).not.toContain(false);

                const invalidResults = await Promise.all(
                    invalidAddresses.map((email) => dc.rpc.checkEmailValidity(email)),
                );
                expect(invalidResults).not.toContain(true);
            });
        });

        await it('system info contains arch, num_cpus, deltachat_core_version, sqlite_version', async () => {
            await withDeltaChat(async (dc) => {
                const info = await dc.rpc.getSystemInfo();
                expect(info).toBeTruthy();
                expect(typeof info).toBe('object');
                // Required keys per upstream contract
                expect(info.arch).toBeDefined();
                expect(info.num_cpus).toBeDefined();
                expect(info.deltachat_core_version).toBeDefined();
                expect(info.sqlite_version).toBeDefined();
                // All values are stringified (the RPC returns Record<string, string>)
                expect(typeof info.arch).toBe('string');
                expect(typeof info.deltachat_core_version).toBe('string');
            });
        });

        await describe('account management', async () => {
            await it('addAccount + getAllAccountIds + removeAccount lifecycle', async () => {
                await withDeltaChat(async (dc) => {
                    // Fresh state: zero accounts
                    expect((await dc.rpc.getAllAccountIds()).length).toBe(0);
                    // Add one
                    await dc.rpc.addAccount();
                    expect((await dc.rpc.getAllAccountIds()).length).toBe(1);
                    // Remove it
                    await dc.rpc.removeAccount((await dc.rpc.getAllAccountIds())[0]);
                    expect((await dc.rpc.getAllAccountIds()).length).toBe(0);
                });
            });

            await it('should create multiple accounts', async () => {
                await withDeltaChat(async (dc) => {
                    await dc.rpc.addAccount();
                    await dc.rpc.addAccount();
                    await dc.rpc.addAccount();
                    await dc.rpc.addAccount();
                    expect((await dc.rpc.getAllAccountIds()).length).toBe(4);
                });
            });
        });

        await describe('contact management', async () => {
            await it('should block and unblock contact', async () => {
                await withDeltaChat(async (dc) => {
                    const accountId = await dc.rpc.addAccount();
                    // Cannot send sync messages to self as we do not have a self address (upstream comment).
                    await dc.rpc.setConfig(accountId, 'sync_msgs', '0');

                    const contactId = await dc.rpc.createContact(
                        accountId,
                        'example@delta.chat',
                        null,
                    );
                    expect((await dc.rpc.getContact(accountId, contactId)).isBlocked).toBe(false);
                    await dc.rpc.blockContact(accountId, contactId);
                    expect((await dc.rpc.getContact(accountId, contactId)).isBlocked).toBe(true);
                    expect((await dc.rpc.getBlockedContacts(accountId)).length).toBe(1);
                    await dc.rpc.unblockContact(accountId, contactId);
                    expect((await dc.rpc.getContact(accountId, contactId)).isBlocked).toBe(false);
                    expect((await dc.rpc.getBlockedContacts(accountId)).length).toBe(0);
                });
            });
        });

        await describe('configuration', async () => {
            await it('set and retrieve a core config key (addr)', async () => {
                await withDeltaChat(async (dc) => {
                    const accountId = await dc.rpc.addAccount();
                    await dc.rpc.setConfig(accountId, 'addr', 'valid@email');
                    expect(await dc.rpc.getConfig(accountId, 'addr')).toBe('valid@email');
                });
            });

            await it('set an invalid key throws', async () => {
                await withDeltaChat(async (dc) => {
                    const accountId = await dc.rpc.addAccount();
                    let threw = false;
                    try {
                        await dc.rpc.setConfig(accountId, 'invalid_key', 'some value');
                    } catch {
                        threw = true;
                    }
                    expect(threw).toBe(true);
                });
            });

            await it('get an invalid key throws', async () => {
                await withDeltaChat(async (dc) => {
                    const accountId = await dc.rpc.addAccount();
                    let threw = false;
                    try {
                        await dc.rpc.getConfig(accountId, 'invalid_key');
                    } catch {
                        threw = true;
                    }
                    expect(threw).toBe(true);
                });
            });

            await it('set and retrieve a ui.* config key', async () => {
                await withDeltaChat(async (dc) => {
                    const accountId = await dc.rpc.addAccount();
                    await dc.rpc.setConfig(accountId, 'ui.chat_bg', 'color:red');
                    expect(await dc.rpc.getConfig(accountId, 'ui.chat_bg')).toBe('color:red');
                });
            });

            await it('batchSetConfig + batchGetConfig round-trip for core keys', async () => {
                await withDeltaChat(async (dc) => {
                    const accountId = await dc.rpc.addAccount();
                    const config = { addr: 'valid@email', mail_pw: '1234' };
                    await dc.rpc.batchSetConfig(accountId, config);
                    const retrieved = await dc.rpc.batchGetConfig(accountId, Object.keys(config));
                    expect(retrieved).toStrictEqual(config);
                });
            });

            await it('batchSetConfig + batchGetConfig round-trip for ui.* keys', async () => {
                await withDeltaChat(async (dc) => {
                    const accountId = await dc.rpc.addAccount();
                    const config = {
                        'ui.chat_bg': 'color:green',
                        'ui.enter_key_sends': 'true',
                    };
                    await dc.rpc.batchSetConfig(accountId, config);
                    const retrieved = await dc.rpc.batchGetConfig(accountId, Object.keys(config));
                    expect(retrieved).toStrictEqual(config);
                });
            });

            await it('batchSetConfig + batchGetConfig round-trip for mixed core + ui keys', async () => {
                await withDeltaChat(async (dc) => {
                    const accountId = await dc.rpc.addAccount();
                    const config = {
                        'ui.chat_bg': 'color:yellow',
                        'ui.enter_key_sends': 'false',
                        addr: 'valid2@email',
                        mail_pw: '123456',
                    };
                    await dc.rpc.batchSetConfig(accountId, config);
                    const retrieved = await dc.rpc.batchGetConfig(accountId, Object.keys(config));
                    expect(retrieved).toStrictEqual(config);
                });
            });
        });
    });
};
