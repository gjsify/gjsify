// @gjsify/adwaita-app — the macOS accent reader and its watcher.
// GJS-only (`test.gtk.mts`): the subject is a real `Gio.Subprocess` and a real
// GLib timer. Each read drives a STAND-IN command, so the suite asserts the same
// thing on every host — the decision, not the machine's setting.

import { describe, expect, it } from '@gjsify/unit';

import type { AdwAccentColorName } from '@gjsify/adwaita-core';

import { APPLE_ACCENT_COLOR_ARGV, onMacosAccentColorChanged, readMacosAccentColor } from './system-accent.js';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default async () => {
    await describe('readMacosAccentColor', async () => {
        await it('reads `defaults read -g AppleAccentColor`', () => {
            expect(APPLE_ACCENT_COLOR_ARGV.join(' ')).toBe('defaults read -g AppleAccentColor');
        });

        await it('maps what the command prints', () => {
            expect(readMacosAccentColor({ argv: ['printf', '5\n'] })).toBe('purple');
            expect(readMacosAccentColor({ argv: ['printf', '%s\n', '-1'] })).toBe('slate');
        });

        await it('gives blue when the key is absent (Multicolor)', () => {
            const absent = `echo "Could not find key 'AppleAccentColor' in domain 'kCFPreferencesAnyApplication'." >&2; exit 1`;
            expect(readMacosAccentColor({ argv: ['sh', '-c', absent] })).toBe('blue');
        });

        await it('gives null for any other failure, an unknown value or no such command', () => {
            expect(readMacosAccentColor({ argv: ['sh', '-c', 'echo boom >&2; exit 1'] })).toBeNull();
            expect(readMacosAccentColor({ argv: ['printf', '9\n'] })).toBeNull();
            expect(readMacosAccentColor({ argv: ['/nonexistent/gjsify-defaults'] })).toBeNull();
        });
    });

    await describe('onMacosAccentColorChanged', async () => {
        await it('reports changes only, not the baseline or a repeat', async () => {
            // `timeout_add_seconds` fires the first tick anywhere in [1 s, 2 s) — GLib
            // aligns it to the process's second boundary — so 3.5 s is at least two
            // ticks: one to see the change, one to see it again and stay silent.
            const values: (AdwAccentColorName | null)[] = ['blue', 'purple'];
            let reads = 0;
            const seen: (AdwAccentColorName | null)[] = [];
            const stop = onMacosAccentColorChanged((accent) => seen.push(accent), {
                intervalSeconds: 1,
                read: () => values[Math.min(reads++, values.length - 1)],
            });
            await wait(3500);
            stop();
            expect(reads >= 3).toBe(true);
            expect(seen.join(',')).toBe('purple');
        });

        await it('stops reading once unsubscribed, and a second stop is a no-op', async () => {
            let reads = 0;
            const stop = onMacosAccentColorChanged(() => undefined, {
                intervalSeconds: 1,
                read: () => {
                    reads++;
                    return 'blue';
                },
            });
            stop();
            stop();
            await wait(1500);
            expect(reads).toBe(1);
        });
    });
};
