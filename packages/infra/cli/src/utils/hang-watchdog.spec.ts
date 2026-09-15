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
import {
    DEFAULT_GRACE_MS,
    createHangWatchdog,
    formatHangReport,
    hangGraceMs,
    heartbeatEnv,
    parseHeartbeat,
} from './hang-watchdog.js';

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

        await it('says a backtrace is MISSING rather than leaving it out', () => {
            // `eu-stack` is elfutils; it is not on the macOS or Windows runners at all and was
            // absent from this repo's own Fedora image until it was added on purpose. A report
            // that just omits the section reads as "the guard had nothing to add" — the one
            // artefact a killed process cannot be asked for twice has to be missed out loud.
            const report = formatHangReport({ label: LABEL, overdueMs: 1_000, pid: 1 });
            expect(report).toContain('no native backtrace');
            expect(report).toContain('eu-stack');
        });

        await it('hands the reader the knob that would clear a false positive', () => {
            // The grace is a policy, not an inference: a body that blocks the loop past its own
            // timeout and then returns PASSES today. Whoever reads this report is the only one
            // who can tell that case from a wedge, so the variable travels with the accusation.
            const report = formatHangReport({ label: LABEL, overdueMs: 1_000, pid: 1, graceMs: 30_000 });
            expect(report).toContain('GJSIFY_HANG_GRACE_MS');
            expect(report).toContain('30000 ms');
        });
    });

    await describe('hangGraceMs', async () => {
        await it('defaults when unset, and takes a number when set', () => {
            expect(hangGraceMs({})).toBe(DEFAULT_GRACE_MS);
            expect(hangGraceMs({ GJSIFY_HANG_GRACE_MS: '5000' })).toBe(5_000);
            expect(hangGraceMs({ GJSIFY_HANG_GRACE_MS: '0' })).toBe(0);
        });

        await it('reads a BLANK value as the default, not as zero', () => {
            // `Number('')` is 0, and 0 disables the guard. A workflow that writes
            // `GJSIFY_HANG_GRACE_MS: ${{ inputs.grace }}` with no input passes exactly this,
            // so the empty string must not be able to switch the guard off silently.
            expect(hangGraceMs({ GJSIFY_HANG_GRACE_MS: '' })).toBe(DEFAULT_GRACE_MS);
            expect(hangGraceMs({ GJSIFY_HANG_GRACE_MS: '   ' })).toBe(DEFAULT_GRACE_MS);
        });

        await it('falls back rather than trusting a value it cannot read', () => {
            expect(hangGraceMs({ GJSIFY_HANG_GRACE_MS: 'soon' })).toBe(DEFAULT_GRACE_MS);
            expect(hangGraceMs({ GJSIFY_HANG_GRACE_MS: '-1' })).toBe(DEFAULT_GRACE_MS);
        });
    });

    await describe('heartbeatEnv', async () => {
        await it('names the file this spawn minted', () => {
            const env = heartbeatEnv({ PATH: '/usr/bin' }, '/tmp/gjsify-hb-x/unit.heartbeat');
            expect(env.GJSIFY_UNIT_HEARTBEAT).toBe('/tmp/gjsify-hb-x/unit.heartbeat');
            expect(env.PATH).toBe('/usr/bin');
        });

        await it('REMOVES an inherited one when this spawn minted none', () => {
            // The variable is inherited. A spawn that mints no file (grace 0, or a `/tmp` that
            // refused) used to pass an OUTER run's path straight through: the inner run wrote
            // its own deadlines into the outer run's file, and the outer watchdog judged them
            // against the outer child's pid — killing a healthy process, or disarming itself on
            // the inner run's closing `0\t<run finished>` line.
            const env = heartbeatEnv({ GJSIFY_UNIT_HEARTBEAT: '/tmp/outer/unit.heartbeat' }, undefined);
            expect('GJSIFY_UNIT_HEARTBEAT' in env).toBeFalsy();
        });

        await it('leaves the caller env it was handed alone', () => {
            const base = { GJSIFY_UNIT_HEARTBEAT: '/tmp/outer/unit.heartbeat' };
            heartbeatEnv(base, undefined);
            expect(base.GJSIFY_UNIT_HEARTBEAT).toBe('/tmp/outer/unit.heartbeat');
        });
    });
};
