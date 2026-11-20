# @gjsify/calendar-layout

Pure calendar geometry: a month grid with ISO week numbers, multi-day bars in row slots per week
with overflow counts, and overlap columns for day/week time grids. Numbers in, numbers out: no
GTK, no clock, no time zone. Runs on GJS and Node.

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003).**
It knows nothing about iCalendar or recurrence and has no dependencies.

## Installation

```bash
gjsify install @gjsify/calendar-layout
```

## Input contract

The caller hands over already-expanded occurrences as `CalendarItem<T>`:

```ts
interface CalendarItem<T> {
  id: string; // tie-break for stable order
  start: LocalDateTime; // { year, month 1-12, day, hour?, minute? }
  end: LocalDateTime;
  allDay: boolean;
  payload: T; // opaque, returned untouched
}
```

- Values are **local wall-clock** values the caller already resolved. The package never calls
  `new Date()` and never converts a time zone, so "today" and the zone are the caller's business.
- All-day: `end` is **exclusive** (iCalendar `DTEND`). `end <= start` counts as one day.
- Timed: `end` is exclusive. `end < start` is treated as zero-length.
- Every day has 1440 minutes. On a DST-change day an item is placed by its wall-clock minutes
  (02:30 is minute 150 even if the clock skips); the grid does not model 23- or 25-hour days.
- First weekday (`0` = Sunday … `6` = Saturday) is a parameter; the locale lookup stays in the app.

## API

```ts
monthGrid({ year, month, firstWeekday, sixRows? }): MonthGrid
// weeks[].days[] { date, weekday, inMonth }, weeks[] { isoWeek, isoWeekYear }
// The ISO week comes from the row's Thursday, so it is right for any first weekday.

layoutWeekBars(items, weekStart, { maxRows? }): WeekBars
layoutMonthBars(grid, items, { maxRows? }): WeekBars[]
// segments[] { id, row, column, span, continuesLeft, continuesRight }, overflow[7] ("+3 more")
// Order: longer first, then start, then id. Lowest free row wins.
// isBarItem(item): all-day items and timed items touching more than one day belong here.

layoutTimeGrid(items, { firstDay, days, startHour?, endHour?, minMinutes? }): TimeGridDay[]
// placements[] { id, start, end (minutes), column, columns, continuesBefore, continuesAfter }
// Clusters are transitive overlaps; each item takes the first free column. Midnight crossers are
// split per day, all-day items are ignored, zero-length items get `minMinutes` (default 15).
```

Date helpers (`dayNumber`, `isoWeek`, `weekdayOf`, `daysInMonth`, …) are exported too.
