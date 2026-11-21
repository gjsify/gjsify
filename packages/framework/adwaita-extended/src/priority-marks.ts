export type PriorityLevel = 'high' | 'medium' | 'low' | 'none';

/** Pure: iCalendar PRIORITY (RFC 5545): 1–4 high, 5 medium, 6–9 low; 0, absent or invalid is none. */
export function priorityLevel(priority: number | null | undefined): PriorityLevel {
    if (priority === null || priority === undefined || !Number.isInteger(priority)) return 'none';
    if (priority >= 1 && priority <= 4) return 'high';
    if (priority === 5) return 'medium';
    if (priority >= 6 && priority <= 9) return 'low';
    return 'none';
}

const MARKS: Record<PriorityLevel, string> = { high: '!!!', medium: '!!', low: '!', none: '' };

export function priorityMarks(priority: number | null | undefined): string {
    return MARKS[priorityLevel(priority)];
}
