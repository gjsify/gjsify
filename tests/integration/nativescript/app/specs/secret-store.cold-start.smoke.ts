// SPDX-License-Identifier: MIT
// Cold-start half of the @gjsify/secret-store device proof (ADR 0152 §5 step 2). Needs a process
// death between the write and the read, which one run cannot provide — so scripts/run-on-device.mjs
// launches the app three times with `am start --es gjsify.phase <A|B|C>`, force-stopping it in
// between. Without the extra (the normal run) this spec does nothing.
//   A: write a fixed, non-secret marker.
//   B: after force-stop: the marker is still there; clear() (key dropped, the default); empty.
//   C: after another force-stop: the namespace still reads empty.
import { openSecretStore } from '@gjsify/secret-store';
import { Application } from '@nativescript/core';
import { describe, it, expect } from '../reporter.js';

const NAMESPACE = 'gjsify-smoke-cold';
const MARKER = 'gjsify-cold-start-marker-v1';
const EXTRA = 'gjsify.phase';

// The launching activity appears only after the main module has been evaluated, so wait for it.
async function requestedPhase(): Promise<string | null> {
    for (let i = 0; i < 100; i++) {
        const activity = Application.android?.foregroundActivity ?? Application.android?.startActivity;
        if (activity) return activity.getIntent()?.getStringExtra(EXTRA) ?? null;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
}

export default async function secretStoreColdStartSmoke(): Promise<void> {
    const phase = await requestedPhase();
    if (!phase) return;
    await describe('@gjsify/secret-store cold start', async () => {
        const store = await openSecretStore(NAMESPACE);
        if (phase === 'A') {
            await it('phase A writes the marker', async () => {
                await store.clear();
                expect(await store.get('marker')).toBe(null);
                await store.set('marker', MARKER);
                expect(await store.get('marker')).toBe(MARKER);
            });
        } else if (phase === 'B') {
            await it('phase B reads the marker after a force-stop, then clears', async () => {
                expect(await store.get('marker')).toBe(MARKER);
                expect((await store.keys()).join(',')).toBe('marker');
                await store.clear();
                expect(await store.get('marker')).toBe(null);
                expect((await store.keys()).length).toBe(0);
            });
        } else if (phase === 'C') {
            await it('phase C finds the namespace empty after a second force-stop', async () => {
                expect(await store.get('marker')).toBe(null);
                expect((await store.keys()).length).toBe(0);
                await store.set('after-clear', 'x');
                expect(await store.get('after-clear')).toBe('x');
                await store.clear();
            });
        } else {
            await it(`unknown phase ${phase}`, () => {
                throw new Error('gjsify.phase must be A, B or C');
            });
        }
    });
}
