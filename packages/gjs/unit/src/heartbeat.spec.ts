// The breadcrumb, held against the reader that has to parse it.
//
// `@gjsify/cli`'s `utils/hang-watchdog.ts` splits this on the FIRST tab and reads one line, so
// the format is a contract between two packages that never import each other. Both sides carry
// a spec; this is the writing half.

import type GLib from '@girs/glib-2.0';
import { describe, expect, it } from '@gjsify/unit';
import { createHeartbeat, formatHeartbeat } from './heartbeat.js';

interface _GjsImports {
    imports?: { gi?: { GLib?: typeof GLib } };
}
const glib = (): typeof GLib | undefined => (globalThis as unknown as _GjsImports).imports?.gi?.GLib;

export default async () => {
    await describe('formatHeartbeat', async () => {
        await it('is <deadline>\\t<label>', () => {
            expect(formatHeartbeat(1700000000000, 'a suite › a test')).toBe('1700000000000\ta suite › a test');
        });

        await it('strips the separators out of the label', () => {
            // A test name is free text. A tab in it would move the reader's split point and a
            // newline would truncate the label — both silently.
            expect(formatHeartbeat(1, 'with\ta tab\nand a newline')).toBe('1\twith a tab and a newline');
        });

        await it('rounds, and never emits a negative deadline', () => {
            // The reader rejects a negative deadline as "not a claim", so a clock skew must
            // not be able to produce one.
            expect(formatHeartbeat(1.7, 'x')).toBe('2\tx');
            expect(formatHeartbeat(-5, 'x')).toBe('0\tx');
        });
    });

    await describe('createHeartbeat', async () => {
        await it('is inert, and throws nothing, when no file was named', () => {
            // The default for every consumer's run. If this could throw, a guard nobody asked
            // for would be able to fail a run it is not even watching.
            const hb = createHeartbeat({}, 5_000);
            hb.noteInFlight('a suite › a test', 5_000);
            hb.noteSettled();
            hb.stop();
            expect(true).toBeTruthy();
        });

        const GLibNs = glib();
        if (GLibNs) {
            await it('puts the in-flight test where the supervisor reads it', () => {
                // The GJS half of the same contract. Node has no writer at all (the module
                // header says why), so this half can only be asserted where GLib is.
                const path = `${GLibNs.get_tmp_dir()}/gjsify-unit-heartbeat-spec-${Date.now()}`;
                const hb = createHeartbeat({ GJSIFY_UNIT_HEARTBEAT: path }, 120_000);
                const readBack = (): string => {
                    const [, bytes] = GLibNs.file_get_contents(path);
                    return new TextDecoder().decode(bytes);
                };
                try {
                    hb.noteInFlight('a suite › a test', 5_000);
                    const text = readBack();
                    expect(text).toContain('a suite › a test');
                    // Its own 5 s budget, not the run's 120 s: the per-test deadline is what
                    // makes the guard fire in seconds rather than minutes.
                    const deadline = Number(text.split('\t')[0]);
                    expect(deadline > Date.now()).toBeTruthy();
                    expect(deadline <= Date.now() + 5_000).toBeTruthy();

                    // Settling hands the deadline back to the run, so the gap BETWEEN tests is
                    // never reported as a hung test.
                    hb.noteSettled();
                    expect(readBack()).toContain('<test run>');
                } finally {
                    hb.stop();
                    GLibNs.unlink(path);
                }
            });
        }
    });
};
