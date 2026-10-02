// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/fs — exercises the OPFS persistence bridge
// against a real browser's Origin Private File System (Playwright/Firefox).
//
// The browser fs implementation is self-contained pure-TS (an in-memory
// `Volume` + an OPFS write-behind layer). It pulls in NO `@girs/*` / `gi://`
// bindings, so importing the browser-entry modules directly here is safe — it
// does not drag GJS-specific code into the browser bundle.
//
// OPFS round-trips are guarded by `hasOpfs()` feature detection so the suite
// passes cleanly on engines/contexts without OPFS (the fallback contract).

import { run, describe, it, expect } from '@gjsify/unit';
import { Volume, __defaultVolume } from './browser/volume.js';
import { enableOpfsPersistence, hasOpfs } from './browser/opfs.js';
import { createReadStream } from './browser/stream.js';

// Unique sub-directory per run so parallel test files / reruns don't collide.
const TEST_ROOT = 'gjsify-fs-test-' + Math.random().toString(36).slice(2, 10);

run({
    async FsBrowserOpfsTest() {
        await describe('hasOpfs()', async () => {
            await it('returns a boolean reflecting navigator.storage.getDirectory', async () => {
                expect(typeof hasOpfs()).toBe('boolean');
            });
        });

        await describe('createReadStream listener aliases', async () => {
            // npm code subscribes with either spelling (`@xmpp/events`' onoff()
            // resolves `addEventListener ?? addListener`), so a stream missing
            // `addListener` throws instead of streaming. `createReadStream` reads
            // the process-wide volume, not a fresh one.
            it('streams through addListener("data")', async () => {
                __defaultVolume.writeFileSync('/stream.txt', new TextEncoder().encode('streamed'));
                const chunks: Uint8Array[] = [];
                await new Promise<void>((resolve, reject) => {
                    const s = createReadStream('/stream.txt');
                    s.addListener('data', (c: unknown) => chunks.push(c as Uint8Array));
                    s.on('end', () => resolve());
                    s.on('error', reject);
                });
                expect(chunks.length).toBe(1);
                expect(new TextDecoder().decode(chunks[0])).toBe('streamed');
            });

            it('unsubscribes through removeListener', async () => {
                __defaultVolume.writeFileSync('/off.txt', new TextEncoder().encode('bye'));
                const seen: string[] = [];
                await new Promise<void>((resolve) => {
                    const s = createReadStream('/off.txt');
                    const handler = (c: unknown): void => {
                        seen.push(new TextDecoder().decode(c as Uint8Array));
                    };
                    s.addListener('data', handler);
                    s.removeListener('data', handler);
                    s.on('end', () => resolve());
                });
                expect(seen.length).toBe(0);
            });
        });

        await describe('enableOpfsPersistence — fallback contract', async () => {
            await it('always resolves to a controller (never throws)', async () => {
                const vol = new Volume();
                const ctl = await enableOpfsPersistence({ volume: vol, rootDir: TEST_ROOT + '-fallback' });
                expect(typeof ctl.enabled).toBe('boolean');
                expect(typeof ctl.flush).toBe('function');
                expect(typeof ctl.disable).toBe('function');
                // flush() + disable() are safe regardless of availability.
                await ctl.flush();
                ctl.disable();
            });

            await it('keeps the volume working in-memory irrespective of OPFS', async () => {
                const vol = new Volume();
                const ctl = await enableOpfsPersistence({ volume: vol, rootDir: TEST_ROOT + '-mem' });
                vol.writeFileSync('/hello.txt', new TextEncoder().encode('hi'));
                expect(new TextDecoder().decode(vol.readFileSync('/hello.txt'))).toBe('hi');
                ctl.disable();
            });
        });

        if (hasOpfs()) {
            await describe('OPFS persistence — round-trip', async () => {
                await it('hydrates a fresh volume from a previously flushed one', async () => {
                    const rootDir = TEST_ROOT + '-roundtrip';

                    // Session 1: write + persist.
                    const volA = new Volume();
                    const ctlA = await enableOpfsPersistence({ volume: volA, rootDir });
                    expect(ctlA.enabled).toBe(true);
                    volA.mkdirSync('/data', { recursive: true });
                    volA.writeFileSync('/data/note.txt', new TextEncoder().encode('persisted'));
                    volA.writeFileSync('/top.txt', new TextEncoder().encode('root-level'));
                    await ctlA.flush();
                    ctlA.disable();

                    // Session 2: a brand-new volume hydrates from OPFS.
                    const volB = new Volume();
                    const ctlB = await enableOpfsPersistence({ volume: volB, rootDir });
                    expect(ctlB.enabled).toBe(true);
                    expect(volB.existsSync('/data/note.txt')).toBe(true);
                    expect(new TextDecoder().decode(volB.readFileSync('/data/note.txt'))).toBe('persisted');
                    expect(new TextDecoder().decode(volB.readFileSync('/top.txt'))).toBe('root-level');
                    ctlB.disable();
                });

                await it('round-trips nested empty directories', async () => {
                    const rootDir = TEST_ROOT + '-emptydirs';

                    const volA = new Volume();
                    const ctlA = await enableOpfsPersistence({ volume: volA, rootDir });
                    volA.mkdirSync('/nested/empty', { recursive: true });
                    await ctlA.flush();
                    ctlA.disable();

                    const volB = new Volume();
                    const ctlB = await enableOpfsPersistence({ volume: volB, rootDir });
                    expect(volB.existsSync('/nested')).toBe(true);
                    expect(volB.existsSync('/nested/empty')).toBe(true);
                    expect(volB.statSync('/nested/empty').kind).toBe('dir');
                    ctlB.disable();
                });

                await it('propagates deletions to OPFS on flush', async () => {
                    const rootDir = TEST_ROOT + '-delete';

                    const volA = new Volume();
                    const ctlA = await enableOpfsPersistence({ volume: volA, rootDir });
                    volA.writeFileSync('/keep.txt', new TextEncoder().encode('keep'));
                    volA.writeFileSync('/drop.txt', new TextEncoder().encode('drop'));
                    await ctlA.flush();
                    volA.unlinkSync('/drop.txt');
                    await ctlA.flush();
                    ctlA.disable();

                    const volB = new Volume();
                    const ctlB = await enableOpfsPersistence({ volume: volB, rootDir });
                    expect(volB.existsSync('/keep.txt')).toBe(true);
                    expect(volB.existsSync('/drop.txt')).toBe(false);
                    ctlB.disable();
                });

                await it('debounced mutation flush eventually persists without explicit flush()', async () => {
                    const rootDir = TEST_ROOT + '-auto';

                    const volA = new Volume();
                    const ctlA = await enableOpfsPersistence({ volume: volA, rootDir, flushDelayMs: 5 });
                    volA.writeFileSync('/auto.txt', new TextEncoder().encode('auto'));
                    // Wait past the debounce window for the write-behind flush.
                    await new Promise((r) => setTimeout(r, 60));
                    ctlA.disable();

                    const volB = new Volume();
                    const ctlB = await enableOpfsPersistence({ volume: volB, rootDir });
                    expect(volB.existsSync('/auto.txt')).toBe(true);
                    expect(new TextDecoder().decode(volB.readFileSync('/auto.txt'))).toBe('auto');
                    ctlB.disable();
                });
            });
        }
    },
});
