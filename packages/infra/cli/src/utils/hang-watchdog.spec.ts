// SPDX-License-Identifier: MIT
// The hang watchdog, driven on a fake clock.
//
// Both halves of this guard are failure paths that never run on a healthy CI: a green run
// never writes a late heartbeat, so nothing here is exercised by using the tool. The two
// properties worth holding are symmetric and opposite — it FIRES on a missed deadline and
// names the test, and it stays SILENT for every shape that is not one. The second half is the
// one that decides whether the guard survives contact with a repo: a watchdog that kills a
// healthy process gets switched off, and then the next 90-minute hang is silent again.

import { describe, expect, it } from '@gjsify/unit';
import { createHangWatchdog, formatHangReport, parseHeartbeat } from './hang-watchdog.js';

const LABEL = 'Multi-PC fan-out › track gets a tee multiplexer after second addTrack';

/** Drive `tick()` by hand against a clock the test owns; no timers, no files. */
function harness(lines: Array<string | null>, graceMs = 30_000) {
    let clock = 1_000_000;
    let read = 0;
    const fired: Array<{ label: string; overdueMs: number }> = [];
    const watchdog = createHangWatchdog({
        read: () => lines[Math.min(read++, lines.length - 1)] ?? null,
        now: () => clock,
        graceMs,
        onHang: (hb, overdueMs) => fired.push({ label: hb.label, overdueMs }),
    });
    return {
        fired,
        advance: (ms: number) => {
            clock += ms;
        },
        at: () => clock,
        tick: () => watchdog.tick(),
    };
}

export default async () => {
    await describe('parseHeartbeat', async () => {
        await it('reads the deadline and the label', () => {
            const hb = parseHeartbeat(`1700000000000\t${LABEL}`);
            expect(hb?.deadlineMs).toBe(1700000000000);
            expect(hb?.label).toBe(LABEL);
        });

        await it('keeps the separators inside a label out of the split', () => {
            // The writer strips tabs and newlines, so a label containing "›" or spaces must
            // survive whole — the first tab is the ONLY separator.
            const hb = parseHeartbeat('42\ta › b  (c)');
            expect(hb?.label).toBe('a › b  (c)');
        });

        await it('returns null for everything that is not a claim', () => {
            // Each of these is a real state: no file yet, a bundle that is not a test run, a
            // read that caught the atomic rename mid-flight, a cleared heartbeat.
            for (const bad of [null, undefined, '', 'no tab here', '\t', 'NaN\tx', '-1\tx']) {
                expect(parseHeartbeat(bad)).toBeNull();
            }
        });
    });

    await describe('createHangWatchdog', async () => {
        await it('fires past the deadline plus the grace, naming the test', () => {
            const h = harness([`${1_000_000 + 5_000}\t${LABEL}`]);
            h.advance(5_000 + 30_000 + 1);
            h.tick();
            expect(h.fired.length).toBe(1);
            expect(h.fired[0]?.label).toBe(LABEL);
            // Reported overdue is measured from the deadline, not from the grace — the grace
            // is this guard's own caution and does not belong in the number a reader acts on.
            expect(h.fired[0]?.overdueMs).toBe(30_001);
        });

        await it('stays silent while the test is merely slow', () => {
            const h = harness([`${1_000_000 + 5_000}\t${LABEL}`]);
            h.advance(5_000 + 29_999);
            h.tick();
            expect(h.fired.length).toBe(0);
        });

        await it('stays silent for a bundle that writes no heartbeat', () => {
            // A GUI launched through `gjsify run` lives for hours and claims nothing. This is
            // the case that lets the watchdog be on by default.
            const h = harness([null]);
            h.advance(24 * 60 * 60 * 1000);
            h.tick();
            expect(h.fired.length).toBe(0);
        });

        await it('honours a deadline the harness declined to set', () => {
            // `it(name, fn, { timeout: 0 })` disables the per-test timeout on purpose.
            const h = harness(['0\t<test run>']);
            h.advance(24 * 60 * 60 * 1000);
            h.tick();
            expect(h.fired.length).toBe(0);
        });

        await it('fires once, not once per poll', () => {
            const h = harness([`${1_000_000 + 1}\t${LABEL}`]);
            h.advance(60_000);
            h.tick();
            h.tick();
            h.tick();
            expect(h.fired.length).toBe(1);
        });
    });

    await describe('formatHangReport', async () => {
        await it('names the test and says why the run could not', () => {
            const report = formatHangReport({ label: LABEL, overdueMs: 35_000, pid: 4242 });
            expect(report).toContain(LABEL);
            expect(report).toContain('4242');
            expect(report).toContain('35s');
        });

        await it('indents the backtrace under its own heading', () => {
            const report = formatHangReport({
                label: LABEL,
                overdueMs: 1_000,
                pid: 1,
                backtrace: 'TID 1:\n#0 gst_pad_push',
            });
            expect(report).toContain('native backtrace');
            expect(report).toContain('    #0 gst_pad_push');
        });
    });
};
