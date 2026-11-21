/**
 * What crosses the PIM port. A backend hands out iCalendar text and the calendars it lives in;
 * parsing into richer types is the consumer's job, so every backend stays a transport.
 */

/** What a calendar holds: VEVENTs or VTODOs. EDS keeps them in separate sources. */
export type ItemKind = 'event' | 'reminder';

export interface CalendarInfo {
    /** Backend-specific id, stable across sessions: EDS's source uid, CalDAV's collection URL. */
    uid: string;
    name: string;
    kind: ItemKind;
    /** Which backend serves it, e.g. `eds`. */
    backend: string;
    /** Display name of the collection/account it belongs to, when the backend knows one. */
    account: string | null;
    /** The collection refuses writes (a subscribed or shared-read-only list). Absent: unknown, assume writable. */
    readOnly?: boolean;
}

/** One raw component as a backend returns it: iCalendar text plus where it came from. */
export interface RawItem {
    calendarUid: string;
    ical: string;
}

/** One stored component of a collection, as a delta read keeps it between runs. */
export interface CollectionItem {
    /** Absolute resource URL: the key a later delta merges on. */
    href: string;
    etag: string | null;
    ical: string;
}

/** What a caller remembers about one collection: the marker of its last read and the items it got. */
export interface CollectionPrevious {
    marker: string;
    items: CollectionItem[];
}

/** Outcome of a delta read; `unchanged` carries no items because the caller already holds them. */
export type CollectionDelta =
    | { kind: 'unchanged'; marker: string }
    | { kind: 'changed'; marker: string; items: CollectionItem[] };
