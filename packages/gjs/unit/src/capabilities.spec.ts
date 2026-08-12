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

const CASES: Array<{ what: string; os: TargetOs | undefined; env: DisplayEnv; surface: boolean; gl: boolean }> = [
    { what: 'Linux under X11', os: 'linux', env: X11, surface: true, gl: true },
    { what: 'Linux under Wayland', os: 'linux', env: WAYLAND, surface: true, gl: true },
    { what: 'Linux with no session (a CI container)', os: 'linux', env: HEADLESS, surface: false, gl: false },
    // The regression this file exists for: GdkQuartz sets neither variable, so the
    // old rule read "no display" and skipped every GTK assertion on macOS forever.
    { what: 'macOS, which never sets DISPLAY', os: 'darwin', env: HEADLESS, surface: true, gl: false },
    { what: 'Windows, which never sets DISPLAY', os: 'win32', env: HEADLESS, surface: true, gl: false },
    // An unknown OS must not be assumed capable: "unknown" is not "not Linux".
    { what: 'an unrecognised OS', os: undefined, env: HEADLESS, surface: false, gl: false },
    { what: 'an unrecognised OS with X11', os: undefined, env: X11, surface: true, gl: false },
];

export default async (): Promise<void> => {
    await describe('host capabilities', async () => {
        for (const { what, os, env, surface, gl } of CASES) {
            await it(`says surface=${surface} gl=${gl} on ${what}`, async () => {
                expect(canRealizeSurface(os, env)).toBe(surface);
                expect(canRealizeGl(os, env)).toBe(gl);
            });
        }

        await it('never claims GL where it cannot claim a surface', async () => {
            for (const { os, env } of CASES) {
                if (canRealizeGl(os, env)) expect(canRealizeSurface(os, env)).toBe(true);
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
