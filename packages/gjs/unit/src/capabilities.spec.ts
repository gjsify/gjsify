// The two capability rules, checked against hosts this leg is not on.
//
// The bug they encode was invisible for exactly this reason: on Linux CI both
// rules answered correctly, and the wrong answers only existed on macOS and
// Windows, where the result was a clean SKIP that no leg reports.

import { describe, expect, it } from '@gjsify/unit';
import { canRealizeGl, canRealizeSurface, isDisplaylessBackend, type DisplayEnv } from './capabilities.js';
import type { TargetOs } from '@gjsify/utils/core';

const X11: DisplayEnv = { DISPLAY: ':0' };
const WAYLAND: DisplayEnv = { WAYLAND_DISPLAY: 'wayland-0' };
const HEADLESS: DisplayEnv = {};

/** Stand-in GL probes: the real one realizes a context, which this spec must not need. */
const YES = (): boolean => true;
const NO = (): boolean => false;

const CASES: Array<{ what: string; os: TargetOs | undefined; env: DisplayEnv; surface: boolean }> = [
    { what: 'Linux under X11', os: 'linux', env: X11, surface: true },
    { what: 'Linux under Wayland', os: 'linux', env: WAYLAND, surface: true },
    { what: 'Linux with no session (a CI container)', os: 'linux', env: HEADLESS, surface: false },
    // The regression this file exists for: GdkQuartz sets neither variable, so the
    // old rule read "no display" and skipped every GTK assertion on macOS forever.
    { what: 'macOS, which never sets DISPLAY', os: 'darwin', env: HEADLESS, surface: true },
    { what: 'Windows, which never sets DISPLAY', os: 'win32', env: HEADLESS, surface: true },
    // An unknown OS must not be assumed capable: "unknown" is not "not Linux".
    { what: 'an unrecognised OS', os: undefined, env: HEADLESS, surface: false },
    { what: 'an unrecognised OS with X11', os: undefined, env: X11, surface: true },
];

export default async (): Promise<void> => {
    await describe('host capabilities', async () => {
        for (const { what, os, env, surface } of CASES) {
            await it(`says surface=${surface} on ${what}`, async () => {
                expect(canRealizeSurface(os, env)).toBe(surface);
            });
        }

        // The OS never decides GL any more; the probe does. A host with a surface
        // is exactly as GL-capable as its probe says — on every OS, which is the
        // point: the old OS rule skipped a Mac that had GL.
        await it('answers GL from the probe wherever a surface exists', async () => {
            for (const { os, env, surface } of CASES) {
                expect(await canRealizeGl(os, env, NO)).toBe(false);
                expect(await canRealizeGl(os, env, YES)).toBe(surface);
            }
        });

        await it('never runs the probe where there is no surface', async () => {
            let asked = 0;
            const counting = (): boolean => {
                ++asked;
                return true;
            };
            for (const { os, env, surface } of CASES) {
                if (!surface) await canRealizeGl(os, env, counting);
            }
            expect(asked).toBe(0);
        });

        await it('never claims GL where it cannot claim a surface', async () => {
            for (const { os, env } of CASES) {
                if (await canRealizeGl(os, env, YES)) expect(canRealizeSurface(os, env)).toBe(true);
            }
        });

        await it('names the two displayless backends and no others', async () => {
            expect(isDisplaylessBackend('darwin')).toBe(true);
            expect(isDisplaylessBackend('win32')).toBe(true);
            expect(isDisplaylessBackend('linux')).toBe(false);
            expect(isDisplaylessBackend(undefined)).toBe(false);
        });
    });
};
