/**
 * Zone resolution for recurrence expansion, in the order this package fixes:
 *
 * 1. the item's own `VTIMEZONE` — the sender's own table, and the only thing that is certainly
 *    what the sender meant;
 * 2. the TZID read as an IANA name against the host's `Intl` — one zone database per machine,
 *    kept current by the OS;
 * 3. nothing: the time stays floating and says so.
 *
 * ical.js ships no zone data at all (its README: "The stock ical.js does not register any
 * timezones, due to the additional size it brings"), so step 2 is not a fallback we could skip —
 * without it every item whose server omits `VTIMEZONE` would read as floating.
 */

import ICAL from 'ical.js';

const SECOND = 1000;
const DAY = 86_400_000;

/** `Intl.DateTimeFormat` is expensive to construct; a zone is asked about many times per window. */
const formatters = new Map<string, Intl.DateTimeFormat | null>();

/** The formatter for `zone`, or null when the host's `Intl` does not know the name. */
export function zoneFormatter(zone: string): Intl.DateTimeFormat | null {
    const hit = formatters.get(zone);
    if (hit !== undefined) return hit;
    let made: Intl.DateTimeFormat | null = null;
    try {
        made = new Intl.DateTimeFormat('en-US', {
            timeZone: zone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
        });
    } catch {
        made = null;
    }
    formatters.set(zone, made);
    return made;
}

/** Whether the host's zone database knows this IANA name. */
export function hostKnowsZone(zone: string): boolean {
    return zoneFormatter(zone) !== null;
}

/** The zone the host itself runs in. */
export function hostZone(): string {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Offset of `zone` at the instant `ms`, in whole seconds, east of UTC.
 *
 * The instant is floored to the second first: `Intl` reports a wall clock only to the second, so
 * subtracting it from an unaligned instant returns the millisecond remainder as a fractional
 * offset — which then travels into every derived instant. Measured, not reasoned about: the first
 * version of this function produced `3599.012` for Europe/Berlin.
 */
export function offsetAt(ms: number, zone: string): number {
    const format = zoneFormatter(zone);
    if (!format) throw new Error(`unknown time zone: ${zone}`);
    const aligned = Math.floor(ms / SECOND) * SECOND;
    const parts: Record<string, number> = {};
    for (const part of format.formatToParts(new Date(aligned))) {
        if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return (asUtc - aligned) / SECOND;
}

/**
 * The first instant in `(lo, hi]` whose offset differs from the one at `lo`, or null when the
 * offset never changes in that span.
 *
 * Both bounds and every probe stay on a second boundary, so the answer is the transition itself
 * and not a point up to a second short of it — off by that second, a wall clock in the gap lands
 * one second past where libical puts it.
 */
export function findTransition(lo: number, hi: number, zone: string): number | null {
    let a = Math.floor(lo / SECOND) * SECOND;
    let b = Math.ceil(hi / SECOND) * SECOND;
    const offsetAtA = offsetAt(a, zone);
    if (offsetAtA === offsetAt(b, zone)) return null;
    while (b - a > SECOND) {
        const mid = a + Math.floor((b - a) / (2 * SECOND)) * SECOND;
        if (offsetAt(mid, zone) === offsetAtA) a = mid;
        else b = mid;
    }
    return b;
}

/**
 * The offset to apply to a wall clock, where `wallMs` carries the wall-clock fields as if they
 * were UTC.
 *
 * Correcting the naive guess once settles every unambiguous reading, including the second pass of
 * an overlap. When guess and correction disagree, the wall clock sits at a transition — it either
 * does not exist or happens twice — and libical's rule decides: a gap takes the offset after the
 * change, an overlap the one before it.
 */
export function wallOffset(wallMs: number, zone: string): number {
    const naive = offsetAt(wallMs, zone);
    const refined = offsetAt(wallMs - naive * SECOND, zone);
    if (naive === refined) return refined;
    const transition = findTransition(wallMs - 2 * DAY, wallMs + 2 * DAY, zone);
    if (transition === null) return refined;
    const before = offsetAt(transition - SECOND, zone);
    const after = offsetAt(transition, zone);
    const boundaryWall = transition + before * SECOND;
    return wallMs >= boundaryWall ? after : before;
}

/**
 * A TZID as servers write it, reduced to candidate IANA names. Evolution and libical emit
 * `/freeassociation.sourceforge.net/Tzfile/Europe/Berlin`; the bare name is what `Intl` knows.
 */
export function zoneCandidates(tzid: string): string[] {
    const stripped = tzid.replace(/^\/[^/]+\/(Tzfile\/)?/, '');
    return stripped === tzid ? [tzid] : [tzid, stripped];
}

/** The first candidate IANA name the host knows, or null when it knows none of them. */
export function resolveIanaZone(tzid: string): string | null {
    for (const candidate of zoneCandidates(tzid)) {
        if (hostKnowsZone(candidate)) return candidate;
    }
    return null;
}

/**
 * An `ICAL.Timezone` that answers from the host's zone database instead of a `VTIMEZONE` table.
 * ical.js only ever asks a zone for `utcOffset(time)`, so this is the whole contract.
 */
export class IntlTimezone extends ICAL.Timezone {
    /** The IANA name actually asked about, which may be shorter than the TZID it is registered as. */
    readonly ianaName: string;

    constructor(tzid: string, ianaName: string) {
        super({ tzid });
        this.ianaName = ianaName;
    }

    override utcOffset(time: ICAL.Time): number {
        const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
        return wallOffset(wall, this.ianaName);
    }
}

/** Where a TZID's offsets came from. */
export type ZoneSource = 'utc' | 'vtimezone' | 'intl' | 'floating';

export interface ZoneBinding {
    tzid: string;
    source: 'vtimezone' | 'intl';
    /** The IANA name behind an `intl` binding. */
    ianaName?: string;
}

/**
 * `ICAL.TimezoneService` is a process-wide singleton, and an item's `VTIMEZONE` must not outlive
 * the item: two calendars can disagree about what `Europe/Berlin` meant in 1980, and the second
 * expansion would silently inherit the first one's table.
 *
 * So a scope records what was registered under each name it touches and puts it back in `release`.
 * `reset()` would be wrong here — it drops entries this package never owned.
 */
export class ZoneScope {
    private readonly saved = new Map<string, ICAL.Timezone | null>();
    private readonly bound = new Map<string, ZoneBinding>();
    private readonly unresolved = new Set<string>();

    private claim(tzid: string): void {
        if (this.saved.has(tzid)) return;
        this.saved.set(tzid, ICAL.TimezoneService.has(tzid) ? ICAL.TimezoneService.get(tzid) : null);
    }

    /** Register the item's own table. The sender's answer wins over everything else. */
    registerVtimezone(component: ICAL.Component): void {
        const tzid = component.getFirstPropertyValue('tzid');
        if (typeof tzid !== 'string' || tzid === '') return;
        this.claim(tzid);
        ICAL.TimezoneService.register(component);
        this.bound.set(tzid, { tzid, source: 'vtimezone' });
        this.unresolved.delete(tzid);
    }

    /**
     * Make sure `tzid` resolves, falling back to the host's zone database. Returns how it resolved;
     * `null` means it did not, and times carrying it stay floating.
     */
    ensure(tzid: string): ZoneBinding | null {
        const already = this.bound.get(tzid);
        if (already) return already;
        const ianaName = resolveIanaZone(tzid);
        if (ianaName === null) {
            this.unresolved.add(tzid);
            return null;
        }
        this.claim(tzid);
        ICAL.TimezoneService.register(new IntlTimezone(tzid, ianaName));
        const binding: ZoneBinding = { tzid, source: 'intl', ianaName };
        this.bound.set(tzid, binding);
        return binding;
    }

    /** How `tzid` resolved in this scope, if it did. */
    binding(tzid: string): ZoneBinding | undefined {
        return this.bound.get(tzid);
    }

    /** Every TZID that resolved to nothing, in the order it was first seen. */
    unresolvedZones(): string[] {
        return [...this.unresolved];
    }

    /** Put the service back as it was found. Safe to repeat. */
    release(): void {
        for (const [tzid, previous] of this.saved) {
            ICAL.TimezoneService.remove(tzid);
            if (previous) ICAL.TimezoneService.register(previous, tzid);
        }
        this.saved.clear();
        this.bound.clear();
    }
}
