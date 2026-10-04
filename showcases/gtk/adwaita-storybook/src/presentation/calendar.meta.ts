// Shared, renderer-agnostic metadata for the Calendar story. Imported by the GTK renderer
// (calendar.story.ts) and the browser renderer (browser/presentation/calendar.web.ts), so
// both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/**
 * The date both renderings start from, in the ISO form `GDateTime` serialises to. A fixed
 * date rather than "today", so a screenshot of the story is the same on every machine —
 * which is the same trade the `dir` reading in `roving-focus.ts` makes.
 */
export const CALENDAR_STORY_DATE = '2026-10-02';

/** The days both renderings mark, so the tint appears at the same place everywhere. */
export const CALENDAR_STORY_MARKS = [14, 25];

export const calendarMeta: StoryMeta = {
    title: 'Presentation/Calendar',
    description:
        'Gtk.Calendar — a six-by-seven month grid with four navigation arrows. The arrows clamp the way ' +
        'g_date_time_add_months does, so paging from the 31st lands on the 28th, and a marked day is a day ' +
        'NUMBER of the shown month, so it survives a month that has no such day.',
    controls: [
        { name: 'showHeading', label: 'Heading', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'showDayNames', label: 'Day names', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'showWeekNumbers', label: 'Week numbers', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
