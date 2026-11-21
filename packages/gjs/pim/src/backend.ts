/**
 * The CalendarBackend port — the seam between what an app decides and where the data lives.
 *
 * A backend moves iCalendar TEXT and nothing else. Parsing, dedupe and any policy live with the
 * consumer, so a second backend is a transport and not a second copy of those rules. CalDAV speaks
 * iCalendar on the wire; EDS hands out the same text via `as_ical_string()`.
 */

import type { CalendarInfo, ItemKind, RawItem } from './types.js';

export interface ItemQuery {
    kind: ItemKind;
    /** Restrict to one calendar; otherwise every enabled calendar of that kind. */
    calendarUid?: string;
    /** Events only: the window, as UTC ISO instants. Ignored for reminders. */
    from?: string;
    to?: string;
}

/**
 * One stored component, with whatever the backend uses to detect a concurrent change.
 *
 * `etag` is CalDAV's; EDS has no equivalent and reports null. An update hands the value back so
 * the backend can refuse a write whose base is stale — see `CalendarBackend.updateItem`.
 */
export interface StoredItem {
    ical: string;
    etag: string | null;
}

export interface CalendarBackend {
    /** Short id, shown in `CalendarInfo.backend`. */
    readonly id: string;
    listCalendars(kind?: ItemKind): Promise<CalendarInfo[]>;
    /** Components in the query's scope. Events: those with an occurrence in [from, to]. */
    listItems(query: ItemQuery): Promise<RawItem[]>;
    /** One component by UID, or null when the calendar has none with that UID. */
    getItem(calendarUid: string, kind: ItemKind, uid: string): Promise<StoredItem | null>;
    /** Store one VEVENT/VTODO; returns the UID the backend recorded. Refuses a read-only calendar. */
    createItem(calendarUid: string, kind: ItemKind, ical: string): Promise<string>;
    /**
     * Replace one stored component with `ical`, which must carry the same UID.
     *
     * `etag` is the one `getItem` returned for the text this update was computed from. A backend
     * that has etags makes the write conditional on it and raises `ConflictError` when the stored
     * copy moved on — a lost update is an error, never a silent overwrite. Refuses a read-only
     * calendar.
     */
    updateItem(calendarUid: string, kind: ItemKind, uid: string, ical: string, etag?: string | null): Promise<void>;
}
