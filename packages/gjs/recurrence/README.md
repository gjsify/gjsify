# @gjsify/recurrence

Read-only RFC 5545 recurrence expansion over [ical.js](https://github.com/kewisch/ical.js): a
window in, the instances that fall in it out. Plain ical.js, so it runs on GJS (via gjsify) and
Node with identical results.

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003).**

## Installation

```bash
gjsify install @gjsify/recurrence
```

## API

```ts
import { expand, createWindowCache } from '@gjsify/recurrence';

const result = expand(icalText, { from: '2026-03-01', to: '2026-04-01' });
// result.occurrences: ordered instances; result.cuts: what a per-series cap dropped;
// result.unresolvedZones: TZIDs that resolved to nothing.

const cache = createWindowCache();
const key = { uid: calendarUid, version: etag, window: { from, to } };
const hit = cache.get(key) ?? (() => { const r = expand(text, key.window); cache.put(key, r); return r; })();
```

- `expand(ical, window, options?)`: `RRULE`, `RDATE`, `EXDATE` (as `DATE` and as `DATE-TIME`),
  `RECURRENCE-ID` overrides including `RANGE=THISANDFUTURE` and `STATUS:CANCELLED`, all-day runs,
  `VEVENT` and `VTODO`. `window.to` is exclusive; an instance that merely *overlaps* the window
  belongs to the answer, so a week-long event still shows in a day view.
- Each `Occurrence` carries `start`/`end` as a UTC instant, a `YYYY-MM-DD` for all-day, or a bare
  wall clock when floating — plus `allDay`, `floating`, the `tzid` as written, and `override`.
- `maxPerSeries` (default 1000) caps one series; what it dropped is reported in `cuts`, never
  silently. `maxScanPerSeries` (default 200 000) bounds an infinite rule; a series stopped by it
  reports `exact: false`, so `cut` reads as a lower bound.
- `createWindowCache()`: in-memory LRU keyed by uid + version + window, with `stats()` for
  hits/misses. ical.js cannot seek — every expansion restarts at the series start — so the cache is
  what keeps a scrolling month view affordable.
- Zones resolve in one order: the item's own `VTIMEZONE` → the TZID as an IANA name against the
  host's `Intl` → floating, flagged. `ZoneScope` registers into ical.js's process-wide
  `TimezoneService` and puts back what it found, so one calendar's table never leaks into another's
  expansion.

## What it does not do

No writing: nothing here produces iCalendar, so an expansion can never corrupt a calendar. No
`VJOURNAL`, no `VALARM` expansion, no `BYSETPOS` beyond what ical.js itself implements, no
persistence (the cache is in-memory; an app's own store holds raw texts).

## Why ical.js, and why its zone database is not used

ical.js is the implementation Thunderbird's calendar ships; its `RecurExpansion` and `Recur`
handle the parts of RFC 5545 that are easy to get subtly wrong. Its licence is MPL-2.0, a
file-level copyleft that does not reach this MIT package.

The stock package registers **no** time zones at all — its README says so, and a probe confirms
`TimezoneService.count === 0` on both runtimes. The optional `ical.timezones.js` bundle is a
generated IANA table that is not part of the distribution and goes stale between releases. The
host already has a zone database that the OS keeps current, so that is what `IntlTimezone` asks.
Measured against VTIMEZONE arithmetic on both runtimes, the two agree to the second, including a
wall clock in a spring-forward gap and in an autumn overlap.
