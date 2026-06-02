// oxlint-disable typescript/no-explicit-any -- spec inspects DNS callback/promise error .code on the browser stub
// SPDX-License-Identifier: MIT
// Browser-target conformance spec for @gjsify/dns.
//
// Imports the browser implementation directly (`./browser.js`) rather than
// `node:dns` — the package's `exports` map has no `browser` condition, so a
// bare `node:dns` import would not select the stub. Importing the file under
// test directly also keeps the bundle free of the GJS impl's `gi://*` deps.
//
// Locks in the current honest browser behavior (slot: browser:partial):
//   - IP literals (v4/v6) + `localhost` resolve via lookup (callback + promise).
//   - Real names report a structured ENOTSUP through the error channel — no
//     crash, no lying loopback answer.
//   - Every `resolve*` / `reverse` (callback + promise) reports ENOTSUP.

import { describe, it, expect } from '@gjsify/unit';
import {
    lookup,
    resolve4,
    reverse,
    promises,
    NOTFOUND,
    CONNREFUSED,
} from './browser.js';

export default async () => {
    await describe('dns (browser)', async () => {
        await describe('constants', async () => {
            await it('re-exports the canonical error-code strings', async () => {
                expect(NOTFOUND).toBe('ENOTFOUND');
                expect(CONNREFUSED).toBe('ECONNREFUSED');
            });
        });

        await describe('lookup — callback', async () => {
            await it('resolves an IPv4 literal to itself', async () => {
                await new Promise<void>((res, rej) => {
                    lookup('127.0.0.1', (err, address, family) => {
                        try {
                            expect(err).toBeNull();
                            expect(address).toBe('127.0.0.1');
                            expect(family).toBe(4);
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                });
            });

            await it('resolves an IPv6 literal to itself', async () => {
                await new Promise<void>((res, rej) => {
                    lookup('::1', (err, address, family) => {
                        try {
                            expect(err).toBeNull();
                            expect(address).toBe('::1');
                            expect(family).toBe(6);
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                });
            });

            await it('resolves localhost to IPv4 loopback by default', async () => {
                await new Promise<void>((res, rej) => {
                    lookup('localhost', (err, address, family) => {
                        try {
                            expect(err).toBeNull();
                            expect(address).toBe('127.0.0.1');
                            expect(family).toBe(4);
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                });
            });

            await it('resolves localhost to IPv6 loopback when family is 6', async () => {
                await new Promise<void>((res, rej) => {
                    lookup('localhost', { family: 6 }, (err, address, family) => {
                        try {
                            expect(err).toBeNull();
                            expect(address).toBe('::1');
                            expect(family).toBe(6);
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                });
            });

            await it('reports ENOTSUP for a real name instead of crashing or lying', async () => {
                await new Promise<void>((res, rej) => {
                    lookup('example.com', (err, _address, _family) => {
                        try {
                            expect(err).toBeDefined();
                            expect((err as any).code).toBe('ENOTSUP');
                            expect((err as any).syscall).toBe('lookup');
                            expect((err as any).hostname).toBe('example.com');
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                });
            });
        });

        await describe('resolve* / reverse — callback', async () => {
            await it('resolve4 reports ENOTSUP via callback', async () => {
                await new Promise<void>((res, rej) => {
                    resolve4('example.com', (err) => {
                        try {
                            expect(err).toBeDefined();
                            expect((err as any).code).toBe('ENOTSUP');
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                });
            });

            await it('reverse reports ENOTSUP via callback', async () => {
                await new Promise<void>((res, rej) => {
                    reverse('8.8.8.8', (err) => {
                        try {
                            expect(err).toBeDefined();
                            expect((err as any).code).toBe('ENOTSUP');
                            res();
                        } catch (e) {
                            rej(e);
                        }
                    });
                });
            });
        });

        await describe('promises surface', async () => {
            await it('lookup resolves an IPv4 literal', async () => {
                const result = (await promises.lookup('10.0.0.1')) as { address: string; family: number };
                expect(result.address).toBe('10.0.0.1');
                expect(result.family).toBe(4);
            });

            await it('lookup resolves localhost', async () => {
                const result = (await promises.lookup('localhost')) as { address: string; family: number };
                expect(result.address).toBe('127.0.0.1');
                expect(result.family).toBe(4);
            });

            await it('lookup rejects a real name with ENOTSUP', async () => {
                let code: string | undefined;
                try {
                    await promises.lookup('example.com');
                } catch (e) {
                    code = (e as any).code;
                }
                expect(code).toBe('ENOTSUP');
            });

            await it('resolve4 rejects with ENOTSUP', async () => {
                let code: string | undefined;
                try {
                    await promises.resolve4('example.com');
                } catch (e) {
                    code = (e as any).code;
                }
                expect(code).toBe('ENOTSUP');
            });
        });
    });
};
