import { describe, expect, it } from '@gjsify/unit';
import { createWindowCache, expand, type Occurrence } from './index.js';

/**
 * Every fixture here is invented. `@gjsify/unit`'s `toEqual` is `==`, so results are compared
 * field by field or as a joined string, never as an object.
 */

const BERLIN_VTIMEZONE = [
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Berlin',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
];

/** Wrap component lines into a VCALENDAR, so a fixture only states what it is about. */
function calendar(...lines: string[]): string {
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//gjsify tests//EN', ...lines, 'END:VCALENDAR'].join('\r\n');
}

function vevent(...lines: string[]): string[] {
    return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
}

const starts = (occurrences: Occurrence[]) => occurrences.map((o) => o.start).join(' ');

export default async () => {
    await describe('recurrence: RFC 5545 rules', async () => {
        await it('expands a daily COUNT series and stops at COUNT, not at the window', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:daily',
                    'DTSTART:20260601T090000Z',
                    'DTEND:20260601T100000Z',
                    'RRULE:FREQ=DAILY;COUNT=3',
                    'SUMMARY:standup',
                ),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-07-01' });
            expect(starts(result.occurrences)).toBe('2026-06-01T09:00:00Z 2026-06-02T09:00:00Z 2026-06-03T09:00:00Z');
            expect(result.occurrences[0].summary).toBe('standup');
            expect(result.occurrences[0].end).toBe('2026-06-01T10:00:00Z');
            expect(result.cuts.length).toBe(0);
        });

        await it('honours UNTIL as the last possible instance, inclusive', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:until',
                    'DTSTART:20260601T090000Z',
                    'DTEND:20260601T093000Z',
                    'RRULE:FREQ=WEEKLY;UNTIL=20260615T090000Z',
                ),
            );
            const result = expand(ical, { from: '2026-05-01', to: '2026-08-01' });
            expect(starts(result.occurrences)).toBe('2026-06-01T09:00:00Z 2026-06-08T09:00:00Z 2026-06-15T09:00:00Z');
        });

        await it('expands the RFC 5545 §3.8.5.3 example: the last Sunday of the month', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:bysetpos',
                    'DTSTART:20260125T100000Z',
                    'DTEND:20260125T110000Z',
                    'RRULE:FREQ=MONTHLY;BYDAY=-1SU;COUNT=4',
                ),
            );
            const result = expand(ical, { from: '2026-01-01', to: '2026-06-01' });
            expect(starts(result.occurrences)).toBe(
                '2026-01-25T10:00:00Z 2026-02-22T10:00:00Z 2026-03-29T10:00:00Z 2026-04-26T10:00:00Z',
            );
        });

        await it('merges RDATE into the rule and keeps the result ordered', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:rdate',
                    'DTSTART:20260601T090000Z',
                    'DTEND:20260601T100000Z',
                    'RRULE:FREQ=WEEKLY;COUNT=2',
                    'RDATE:20260604T140000Z',
                ),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-07-01' });
            expect(starts(result.occurrences)).toBe('2026-06-01T09:00:00Z 2026-06-04T14:00:00Z 2026-06-08T09:00:00Z');
        });

        await it('returns only the instances that overlap the window, bounds included and excluded', async () => {
            const ical = calendar(
                ...vevent('UID:win', 'DTSTART:20260601T000000Z', 'DTEND:20260601T010000Z', 'RRULE:FREQ=DAILY;COUNT=10'),
            );
            const result = expand(ical, { from: '2026-06-03T00:00:00Z', to: '2026-06-05T00:00:00Z' });
            // `from` is inclusive, `to` exclusive: the 5th is out even though it starts exactly at `to`.
            expect(starts(result.occurrences)).toBe('2026-06-03T00:00:00Z 2026-06-04T00:00:00Z');
        });

        await it('keeps an instance that starts before the window but reaches into it', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:long',
                    'DTSTART:20260601T080000Z',
                    'DTEND:20260605T080000Z',
                    'RRULE:FREQ=MONTHLY;COUNT=2',
                ),
            );
            const result = expand(ical, { from: '2026-06-03T00:00:00Z', to: '2026-06-04T00:00:00Z' });
            expect(result.occurrences.length).toBe(1);
            expect(result.occurrences[0].start).toBe('2026-06-01T08:00:00Z');
        });

        await it('rejects a window whose end precedes its start', async () => {
            const ical = calendar(...vevent('UID:x', 'DTSTART:20260601T080000Z', 'DTEND:20260601T090000Z'));
            expect(() => expand(ical, { from: '2026-06-10', to: '2026-06-01' })).toThrow();
            expect(() => expand(ical, { from: 'soon', to: '2026-06-01' })).toThrow();
        });
    });

    await describe('recurrence: EXDATE', async () => {
        await it('drops an instance named by an EXDATE in DATE-TIME form', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:exdt',
                    'DTSTART:20260601T090000Z',
                    'DTEND:20260601T100000Z',
                    'RRULE:FREQ=DAILY;COUNT=4',
                    'EXDATE:20260602T090000Z',
                ),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-07-01' });
            expect(starts(result.occurrences)).toBe('2026-06-01T09:00:00Z 2026-06-03T09:00:00Z 2026-06-04T09:00:00Z');
        });

        await it('drops an all-day instance named by an EXDATE in DATE form', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:exdate',
                    'DTSTART;VALUE=DATE:20260601',
                    'DTEND;VALUE=DATE:20260602',
                    'RRULE:FREQ=DAILY;COUNT=4',
                    'EXDATE;VALUE=DATE:20260603',
                ),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-07-01' });
            expect(starts(result.occurrences)).toBe('2026-06-01 2026-06-02 2026-06-04');
            expect(result.occurrences[0].allDay).toBe(true);
            expect(result.occurrences[0].end).toBe('2026-06-02');
        });

        await it('matches an EXDATE written in UTC against a DTSTART written with a TZID', async () => {
            // The same instant in two notations. Compared as text these never meet, so this is the case
            // that silently shows a cancelled appointment if slots are keyed by their written form.
            const ical = calendar(
                ...BERLIN_VTIMEZONE,
                ...vevent(
                    'UID:exmixed',
                    'DTSTART;TZID=Europe/Berlin:20260601T090000',
                    'DTEND;TZID=Europe/Berlin:20260601T100000',
                    'RRULE:FREQ=DAILY;COUNT=3',
                    'EXDATE:20260602T070000Z',
                ),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-07-01' });
            expect(starts(result.occurrences)).toBe('2026-06-01T07:00:00Z 2026-06-03T07:00:00Z');
        });
    });

    await describe('recurrence: all-day', async () => {
        await it('gives an all-day series dates, not instants, and a default length of one day', async () => {
            const ical = calendar(
                ...vevent('UID:allday', 'DTSTART;VALUE=DATE:20260601', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:bin day'),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-07-01' });
            expect(starts(result.occurrences)).toBe('2026-06-01 2026-06-08 2026-06-15');
            expect(result.occurrences.map((o) => o.end).join(' ')).toBe('2026-06-02 2026-06-09 2026-06-16');
            expect(result.occurrences.every((o) => o.allDay)).toBe(true);
            expect(result.occurrences.every((o) => o.floating === false)).toBe(true);
        });

        await it('keeps a multi-day all-day run intact', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:holiday',
                    'DTSTART;VALUE=DATE:20260601',
                    'DTEND;VALUE=DATE:20260604',
                    'RRULE:FREQ=MONTHLY;COUNT=2',
                ),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-08-01' });
            expect(result.occurrences.map((o) => `${o.start}/${o.end}`).join(' ')).toBe(
                '2026-06-01/2026-06-04 2026-07-01/2026-07-04',
            );
        });
    });

    await describe('recurrence: time zones and DST', async () => {
        await it('holds the wall clock across the spring-forward switch in Europe/Berlin', async () => {
            // 2026-03-29: 02:00 becomes 03:00. A 09:00 series keeps 09:00 local, so its UTC instant moves.
            const ical = calendar(
                ...BERLIN_VTIMEZONE,
                ...vevent(
                    'UID:spring',
                    'DTSTART;TZID=Europe/Berlin:20260327T090000',
                    'DTEND;TZID=Europe/Berlin:20260327T100000',
                    'RRULE:FREQ=DAILY;COUNT=4',
                ),
            );
            const result = expand(ical, { from: '2026-03-01', to: '2026-04-15' });
            expect(starts(result.occurrences)).toBe(
                '2026-03-27T08:00:00Z 2026-03-28T08:00:00Z 2026-03-29T07:00:00Z 2026-03-30T07:00:00Z',
            );
            expect(result.occurrences[0].tzid).toBe('Europe/Berlin');
            expect(result.occurrences[0].floating).toBe(false);
        });

        await it('holds the wall clock across the autumn switch in Europe/Berlin', async () => {
            const ical = calendar(
                ...BERLIN_VTIMEZONE,
                ...vevent(
                    'UID:autumn',
                    'DTSTART;TZID=Europe/Berlin:20261023T090000',
                    'DTEND;TZID=Europe/Berlin:20261023T100000',
                    'RRULE:FREQ=DAILY;COUNT=4',
                ),
            );
            const result = expand(ical, { from: '2026-10-01', to: '2026-11-15' });
            expect(starts(result.occurrences)).toBe(
                '2026-10-23T07:00:00Z 2026-10-24T07:00:00Z 2026-10-25T08:00:00Z 2026-10-26T08:00:00Z',
            );
        });

        await it('places a 02:30 instance on the spring-forward day, where that wall clock does not exist', async () => {
            // 2026-03-29 02:30 Europe/Berlin is skipped by the clock. libical's rule takes the offset
            // AFTER the change, which puts it at the same instant as 03:30 would have been before it.
            const ical = calendar(
                ...BERLIN_VTIMEZONE,
                ...vevent(
                    'UID:gap',
                    'DTSTART;TZID=Europe/Berlin:20260327T023000',
                    'DTEND;TZID=Europe/Berlin:20260327T033000',
                    'RRULE:FREQ=DAILY;COUNT=4',
                ),
            );
            const result = expand(ical, { from: '2026-03-01', to: '2026-04-15' });
            expect(starts(result.occurrences)).toBe(
                '2026-03-27T01:30:00Z 2026-03-28T01:30:00Z 2026-03-29T00:30:00Z 2026-03-30T00:30:00Z',
            );
        });

        await it('resolves a TZID through the host when the item ships no VTIMEZONE', async () => {
            // Same series as the gap case, without the table: step 2 of the order must reach the same
            // instants as step 1 did, to the second.
            const ical = calendar(
                ...vevent(
                    'UID:gap-intl',
                    'DTSTART;TZID=Europe/Berlin:20260327T023000',
                    'DTEND;TZID=Europe/Berlin:20260327T033000',
                    'RRULE:FREQ=DAILY;COUNT=4',
                ),
            );
            const result = expand(ical, { from: '2026-03-01', to: '2026-04-15' });
            expect(starts(result.occurrences)).toBe(
                '2026-03-27T01:30:00Z 2026-03-28T01:30:00Z 2026-03-29T00:30:00Z 2026-03-30T00:30:00Z',
            );
            expect(result.unresolvedZones.length).toBe(0);
        });

        await it('reads a libical-style TZID path as the IANA zone inside it', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:tzpath',
                    'DTSTART;TZID=/freeassociation.sourceforge.net/Tzfile/Europe/Berlin:20260701T090000',
                    'DTEND;TZID=/freeassociation.sourceforge.net/Tzfile/Europe/Berlin:20260701T100000',
                    'RRULE:FREQ=DAILY;COUNT=2',
                ),
            );
            const result = expand(ical, { from: '2026-07-01', to: '2026-08-01' });
            expect(starts(result.occurrences)).toBe('2026-07-01T07:00:00Z 2026-07-02T07:00:00Z');
            expect(result.unresolvedZones.length).toBe(0);
        });

        await it('leaves an unknown TZID floating and names it, instead of guessing a zone', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:unknown-tz',
                    'DTSTART;TZID=Mars/Olympus:20260701T090000',
                    'DTEND;TZID=Mars/Olympus:20260701T100000',
                    'RRULE:FREQ=DAILY;COUNT=2',
                ),
            );
            const result = expand(ical, { from: '2026-07-01', to: '2026-08-01' });
            expect(starts(result.occurrences)).toBe('2026-07-01T09:00:00 2026-07-02T09:00:00');
            expect(result.occurrences.every((o) => o.floating)).toBe(true);
            expect(result.occurrences[0].tzid).toBe('Mars/Olympus');
            expect(result.unresolvedZones.join(',')).toBe('Mars/Olympus');
        });

        await it('keeps a floating series floating: wall clocks, no zone, no marker', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:floating',
                    'DTSTART:20260701T090000',
                    'DTEND:20260701T100000',
                    'RRULE:FREQ=DAILY;COUNT=2',
                ),
            );
            const result = expand(ical, { from: '2026-07-01', to: '2026-08-01' });
            expect(starts(result.occurrences)).toBe('2026-07-01T09:00:00 2026-07-02T09:00:00');
            expect(result.occurrences.every((o) => o.floating)).toBe(true);
            expect(result.occurrences[0].tzid).toBe(null);
            expect(result.unresolvedZones.length).toBe(0);
        });

        await it('does not leak one calendar\u2019s VTIMEZONE into the next expansion', async () => {
            // A table that claims Europe/Berlin is permanently UTC+05. If it survived the call, the
            // plain-Intl expansion after it would inherit it.
            const odd = [
                'BEGIN:VTIMEZONE',
                'TZID:Europe/Berlin',
                'BEGIN:STANDARD',
                'TZOFFSETFROM:+0500',
                'TZOFFSETTO:+0500',
                'TZNAME:ODD',
                'DTSTART:19700101T000000',
                'END:STANDARD',
                'END:VTIMEZONE',
            ];
            const withOdd = calendar(
                ...odd,
                ...vevent(
                    'UID:odd',
                    'DTSTART;TZID=Europe/Berlin:20260701T090000',
                    'DTEND;TZID=Europe/Berlin:20260701T100000',
                ),
            );
            expect(expand(withOdd, { from: '2026-07-01', to: '2026-07-02' }).occurrences[0].start).toBe(
                '2026-07-01T04:00:00Z',
            );

            const plain = calendar(
                ...vevent(
                    'UID:plain',
                    'DTSTART;TZID=Europe/Berlin:20260701T090000',
                    'DTEND;TZID=Europe/Berlin:20260701T100000',
                ),
            );
            expect(expand(plain, { from: '2026-07-01', to: '2026-07-02' }).occurrences[0].start).toBe(
                '2026-07-01T07:00:00Z',
            );
        });
    });

    await describe('recurrence: RECURRENCE-ID overrides', async () => {
        await it('replaces the instance an override names and keeps the rest of the series', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:moved',
                    'DTSTART:20260601T090000Z',
                    'DTEND:20260601T100000Z',
                    'RRULE:FREQ=DAILY;COUNT=3',
                    'SUMMARY:standup',
                ),
                ...vevent(
                    'UID:moved',
                    'RECURRENCE-ID:20260602T090000Z',
                    'DTSTART:20260602T140000Z',
                    'DTEND:20260602T150000Z',
                    'SUMMARY:standup (moved)',
                ),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-07-01' });
            expect(starts(result.occurrences)).toBe('2026-06-01T09:00:00Z 2026-06-02T14:00:00Z 2026-06-03T09:00:00Z');
            const moved = result.occurrences[1];
            expect(moved.override).toBe(true);
            expect(moved.summary).toBe('standup (moved)');
            // The slot it fills, not where it moved to — that is what makes it the same instance.
            expect(moved.recurrenceId).toBe('2026-06-02T09:00:00Z');
            expect(result.occurrences[0].override).toBe(false);
        });

        await it('removes an instance whose override is CANCELLED', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:cancel',
                    'DTSTART:20260601T090000Z',
                    'DTEND:20260601T100000Z',
                    'RRULE:FREQ=DAILY;COUNT=3',
                ),
                ...vevent(
                    'UID:cancel',
                    'RECURRENCE-ID:20260602T090000Z',
                    'DTSTART:20260602T090000Z',
                    'DTEND:20260602T100000Z',
                    'STATUS:CANCELLED',
                ),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-07-01' });
            expect(starts(result.occurrences)).toBe('2026-06-01T09:00:00Z 2026-06-03T09:00:00Z');
        });

        await it('matches an override written in UTC against a series written with a TZID', async () => {
            const ical = calendar(
                ...BERLIN_VTIMEZONE,
                ...vevent(
                    'UID:tzoverride',
                    'DTSTART;TZID=Europe/Berlin:20260601T090000',
                    'DTEND;TZID=Europe/Berlin:20260601T100000',
                    'RRULE:FREQ=DAILY;COUNT=3',
                ),
                ...vevent(
                    'UID:tzoverride',
                    'RECURRENCE-ID:20260602T070000Z',
                    'DTSTART:20260602T120000Z',
                    'DTEND:20260602T130000Z',
                ),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-07-01' });
            // Three instances, not four: the override replaced one rather than being added beside it.
            expect(starts(result.occurrences)).toBe('2026-06-01T07:00:00Z 2026-06-02T12:00:00Z 2026-06-03T07:00:00Z');
        });

        await it('keeps an override whose slot the rule never produces', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:orphan',
                    'DTSTART:20260601T090000Z',
                    'DTEND:20260601T100000Z',
                    'RRULE:FREQ=WEEKLY;COUNT=2',
                ),
                ...vevent(
                    'UID:orphan',
                    'RECURRENCE-ID:20260603T090000Z',
                    'DTSTART:20260603T160000Z',
                    'DTEND:20260603T170000Z',
                ),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-07-01' });
            expect(starts(result.occurrences)).toBe('2026-06-01T09:00:00Z 2026-06-03T16:00:00Z 2026-06-08T09:00:00Z');
        });

        await it('moves this and every later instance for RANGE=THISANDFUTURE', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:future',
                    'DTSTART:20260601T090000Z',
                    'DTEND:20260601T100000Z',
                    'RRULE:FREQ=DAILY;COUNT=4',
                ),
                ...vevent(
                    'UID:future',
                    'RECURRENCE-ID;RANGE=THISANDFUTURE:20260603T090000Z',
                    'DTSTART:20260603T110000Z',
                    'DTEND:20260603T120000Z',
                ),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-07-01' });
            expect(starts(result.occurrences)).toBe(
                '2026-06-01T09:00:00Z 2026-06-02T09:00:00Z 2026-06-03T11:00:00Z 2026-06-04T11:00:00Z',
            );
        });
    });

    await describe('recurrence: VTODO and one-off items', async () => {
        await it('expands a repeating task and takes its end from DUE', async () => {
            const ical = calendar(
                'BEGIN:VTODO',
                'UID:task',
                'DTSTART:20260601T080000Z',
                'DUE:20260601T170000Z',
                'RRULE:FREQ=WEEKLY;COUNT=2',
                'SUMMARY:weekly report',
                'END:VTODO',
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-07-01' });
            expect(result.occurrences.map((o) => `${o.kind}:${o.start}/${o.end}`).join(' ')).toBe(
                'todo:2026-06-01T08:00:00Z/2026-06-01T17:00:00Z todo:2026-06-08T08:00:00Z/2026-06-08T17:00:00Z',
            );
        });

        await it('returns a single item for a non-repeating event, with no recurrence id', async () => {
            const ical = calendar(
                ...vevent('UID:once', 'DTSTART:20260601T090000Z', 'DTEND:20260601T100000Z', 'SUMMARY:one-off'),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-07-01' });
            expect(result.occurrences.length).toBe(1);
            expect(result.occurrences[0].recurrenceId).toBe(null);
            expect(result.occurrences[0].override).toBe(false);
        });

        await it('orders instances of several series by start and then by uid', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:b-later',
                    'DTSTART:20260601T090000Z',
                    'DTEND:20260601T093000Z',
                    'RRULE:FREQ=DAILY;COUNT=2',
                ),
                ...vevent(
                    'UID:a-same',
                    'DTSTART:20260601T090000Z',
                    'DTEND:20260601T093000Z',
                    'RRULE:FREQ=DAILY;COUNT=2',
                ),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-07-01' });
            expect(result.occurrences.map((o) => `${o.start}|${o.uid}`).join(' ')).toBe(
                '2026-06-01T09:00:00Z|a-same 2026-06-01T09:00:00Z|b-later 2026-06-02T09:00:00Z|a-same 2026-06-02T09:00:00Z|b-later',
            );
        });
    });

    await describe('recurrence: the per-series cap', async () => {
        await it('keeps the cap and reports exactly how many it cut', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:capped',
                    'DTSTART:20260601T090000Z',
                    'DTEND:20260601T093000Z',
                    'RRULE:FREQ=DAILY;COUNT=20',
                ),
            );
            const result = expand(ical, { from: '2026-06-01', to: '2026-08-01' }, { maxPerSeries: 5 });
            expect(result.occurrences.length).toBe(5);
            expect(result.occurrences[4].start).toBe('2026-06-05T09:00:00Z');
            expect(result.cuts.length).toBe(1);
            expect(result.cuts[0].uid).toBe('capped');
            expect(result.cuts[0].kept).toBe(5);
            expect(result.cuts[0].cut).toBe(15);
            expect(result.cuts[0].exact).toBe(true);
        });

        await it('bounds an endless rule by the scan ceiling and says the count is a lower bound', async () => {
            const ical = calendar(
                ...vevent('UID:endless', 'DTSTART:20260601T090000Z', 'DTEND:20260601T090100Z', 'RRULE:FREQ=MINUTELY'),
            );
            const result = expand(
                ical,
                { from: '2026-06-01', to: '2027-06-01' },
                { maxPerSeries: 3, maxScanPerSeries: 50 },
            );
            expect(result.occurrences.length).toBe(3);
            expect(result.cuts[0].exact).toBe(false);
            // 50 iterations spent, 3 of them kept: the other 47 are a lower bound on what an unbounded
            // scan would have found.
            expect(result.cuts[0].cut).toBe(47);
        });

        await it('reports nothing when the window holds the whole series', async () => {
            const ical = calendar(
                ...vevent(
                    'UID:small',
                    'DTSTART:20260601T090000Z',
                    'DTEND:20260601T093000Z',
                    'RRULE:FREQ=DAILY;COUNT=3',
                ),
            );
            expect(expand(ical, { from: '2026-06-01', to: '2026-07-01' }).cuts.length).toBe(0);
        });
    });

    await describe('recurrence: the window cache', async () => {
        const ical = calendar(
            ...vevent('UID:cached', 'DTSTART:20260601T090000Z', 'DTEND:20260601T093000Z', 'RRULE:FREQ=DAILY;COUNT=5'),
        );
        const window = { from: '2026-06-01', to: '2026-07-01' };

        await it('misses once, then hits for the same uid, version and window', async () => {
            const cache = createWindowCache();
            const key = { uid: 'cached', version: 'etag-1', window };
            expect(cache.get(key)).toBe(null);
            cache.put(key, expand(ical, window));
            const hit = cache.get(key);
            expect(hit === null).toBe(false);
            expect(starts(hit!.occurrences).startsWith('2026-06-01T09:00:00Z')).toBe(true);
            expect(cache.stats().misses).toBe(1);
            expect(cache.stats().hits).toBe(1);
        });

        await it('misses when the version changed, so a refetch is never answered from stale text', async () => {
            const cache = createWindowCache();
            cache.put({ uid: 'cached', version: 'etag-1', window }, expand(ical, window));
            expect(cache.get({ uid: 'cached', version: 'etag-2', window })).toBe(null);
            expect(cache.get({ uid: 'cached', version: 'etag-1', window })).not.toBe(null);
        });

        await it('misses when the window moved, even by a day', async () => {
            const cache = createWindowCache();
            cache.put({ uid: 'cached', version: 'etag-1', window }, expand(ical, window));
            expect(
                cache.get({ uid: 'cached', version: 'etag-1', window: { from: '2026-06-02', to: '2026-07-01' } }),
            ).toBe(null);
        });

        await it('never reuses an entry from a source that sent no version marker', async () => {
            const cache = createWindowCache();
            const key = { uid: 'cached', version: null, window };
            cache.put(key, expand(ical, window));
            // A real ETag that reads like the placeholder must not collide with it.
            expect(cache.get({ ...key, version: 'none' })).toBe(null);
            expect(cache.get({ ...key, version: 'null' })).toBe(null);
            expect(cache.get(key)).not.toBe(null);
        });

        await it('hands out a copy, so a caller cannot edit what the cache holds', async () => {
            const cache = createWindowCache();
            const key = { uid: 'cached', version: 'etag-1', window };
            cache.put(key, expand(ical, window));
            const first = cache.get(key)!;
            first.occurrences[0].summary = 'tampered';
            first.occurrences.length = 0;
            const second = cache.get(key)!;
            expect(second.occurrences.length).toBe(5);
            expect(second.occurrences[0].summary).toBe(null);
        });

        await it('invalidates one uid or everything', async () => {
            const cache = createWindowCache();
            cache.put({ uid: 'a', version: 'v', window }, expand(ical, window));
            cache.put({ uid: 'b', version: 'v', window }, expand(ical, window));
            cache.invalidate('a');
            expect(cache.size()).toBe(1);
            cache.invalidate();
            expect(cache.size()).toBe(0);
        });

        await it('drops the least recently used entry when it is full', async () => {
            const cache = createWindowCache(2);
            const put = (uid: string) => cache.put({ uid, version: 'v', window }, expand(ical, window));
            put('a');
            put('b');
            cache.get({ uid: 'a', version: 'v', window }); // 'a' is now the newer of the two
            put('c');
            expect(cache.size()).toBe(2);
            expect(cache.get({ uid: 'b', version: 'v', window })).toBe(null);
            expect(cache.get({ uid: 'a', version: 'v', window })).not.toBe(null);
            expect(cache.stats().evictions).toBe(1);
        });
    });
};
