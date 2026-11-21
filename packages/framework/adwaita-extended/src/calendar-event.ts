import type { CalendarItem } from '@gjsify/calendar-layout';

/**
 * What the calendar widgets paint for one occurrence. The host maps its own model onto this; the
 * widgets never resolve a recurrence, a time zone or a colour theme themselves.
 */
export interface CalendarEventData {
    title: string;
    /** Source colour as `#rgb` / `#rrggbb`. Anything else is ignored, so the default styling shows. */
    colour?: string | null;
    /** Shown after the time in the agenda, left out where there is no room. */
    location?: string;
}

/** One already-expanded occurrence: geometry from `@gjsify/calendar-layout`, text from the payload. */
export type CalendarEvent = CalendarItem<CalendarEventData>;
