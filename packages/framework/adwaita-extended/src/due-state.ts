/** How close a due date is, on the calendar days of the reader's own zone. */
export type DueState = 'overdue' | 'today' | 'soon' | 'later' | 'none';

/** A due date up to this many days ahead (and after today) counts as `soon`. */
export const SOON_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The local calendar day as a UTC day number, so a DST change cannot make a day 23 or 25 hours. */
function dayNumber(d: Date): number {
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** Pure: `null` is `none`; otherwise the difference in local calendar days, not in hours. */
export function dueState(due: Date | null, now: Date): DueState {
    if (due === null || Number.isNaN(due.getTime())) return 'none';
    const days = dayNumber(due) - dayNumber(now);
    if (days < 0) return 'overdue';
    if (days === 0) return 'today';
    if (days <= SOON_DAYS) return 'soon';
    return 'later';
}
