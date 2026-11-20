/**
 * RFC 5545 recurrence expansion over ical.js: a window in, the instances that fall in it out.
 *
 * Read-only by design — nothing here writes iCalendar, so an expansion can never corrupt a
 * calendar. What it covers and what it deliberately does not is in README.md; the zone order and
 * the caching reason are in the README.
 */

import ICAL from 'ical.js';
import { ZoneScope } from './zones.js';

/**
 * Instances kept per series before the expansion gives up on it. A rule may be infinite and a
 * window may be a decade; without a cap one malformed `FREQ=SECONDLY` fills memory, and the view
 * that asked for a month never paints.
 */
export const MAX_PER_SERIES = 1000;

/**
 * Iterations spent on one series, counting the ones skipped before the window and the ones only
 * counted after the cap. ical.js always starts an expansion at the series start (there is no
 * "seek"), so a daily series from 1970 costs ~20k steps before the first instance a caller asked
 * for — that is the reason the window cache exists, and this is the ceiling when it misses.
 */
export const MAX_SCAN_PER_SERIES = 200_000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface ExpandWindow {
    /** Inclusive lower bound: a UTC instant, or `YYYY-MM-DD` for that day's UTC midnight. */
    from: string;
    /** Exclusive upper bound, same forms. */
    to: string;
}

export type ItemKind = 'event' | 'todo';

export interface Occurrence {
    uid: string;
    kind: ItemKind;
    /**
     * The series slot this instance fills, in the same form as `start`; null for an item that is not
     * a series. Two instances of one series never share it, so it is the stable identity of an
     * instance.
     */
    recurrenceId: string | null;
    /** UTC instant (`…Z`), `YYYY-MM-DD` when all-day, or a bare wall clock when floating. */
    start: string;
    /** Exclusive, same form as `start`. */
    end: string;
    allDay: boolean;
    /** True when no zone resolved: `start` and `end` are wall clocks that mean nothing on their own. */
    floating: boolean;
    /** The TZID exactly as the item wrote it, kept even when it did not resolve. */
    tzid: string | null;
    summary: string | null;
    /** `LOCATION`, when the instance or its master names one. */
    location: string | null;
    /** `URL` — the page the item came from, for an "open the original" link. */
    url: string | null;
    /** True when a `RECURRENCE-ID` component replaced what the rule would have produced. */
    override: boolean;
}

/** What one series lost to the cap. */
export interface SeriesCut {
    uid: string;
    kept: number;
    /** Instances inside the window that were dropped. */
    cut: number;
    /** False when the scan ceiling stopped the count: `cut` is then a lower bound. */
    exact: boolean;
}

export interface ExpandResult {
    /** Ordered by start, then uid — stable across runs and across GJS and Node. */
    occurrences: Occurrence[];
    /** One entry per series that hit the cap; empty when nothing was cut. */
    cuts: SeriesCut[];
    /** Every TZID that resolved to neither a VTIMEZONE nor an IANA zone the host knows. */
    unresolvedZones: string[];
}

export interface ExpandOptions {
    /** Per-series cap; defaults to {@link MAX_PER_SERIES}. */
    maxPerSeries?: number;
    /** Scan ceiling per series; defaults to {@link MAX_SCAN_PER_SERIES}. */
    maxScanPerSeries?: number;
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0');

/** A wall clock carries no zone, so its fields are read as if they were UTC. */
function wallMs(time: ICAL.Time): number {
    return Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
}

function isFloating(time: ICAL.Time): boolean {
    return !time.isDate && time.zone.tzid === 'floating';
}

/** The instant used for ordering and window tests; a floating or all-day time is read as UTC. */
function instantMs(time: ICAL.Time): number {
    if (time.isDate) return Date.UTC(time.year, time.month - 1, time.day);
    if (isFloating(time)) return wallMs(time);
    return time.toJSDate().getTime();
}

function formatTime(time: ICAL.Time): string {
    const day = `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}`;
    if (time.isDate) return day;
    if (isFloating(time)) return `${day}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`;
    return new Date(instantMs(time)).toISOString().replace('.000Z', 'Z');
}

/**
 * One key per slot, independent of how the slot was written. A server may send `DTSTART` with a
 * TZID and the matching `RECURRENCE-ID` in UTC; compared as text those two never meet, so the
 * override would be dropped and the instance it replaces shown twice.
 */
function slotKey(time: ICAL.Time): string {
    if (time.isDate) return `D:${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}`;
    if (isFloating(time)) return `F:${wallMs(time)}`;
    return `T:${instantMs(time)}`;
}

function parseBound(value: string, label: string): number {
    const ms = DATE_ONLY.test(value) ? Date.parse(`${value}T00:00:00Z`) : Date.parse(value);
    if (Number.isNaN(ms)) throw new RangeError(`expand: ${label} is not a date or instant: ${value}`);
    return ms;
}

/** `vtodo` ends at DUE, `vevent` at DTEND — otherwise the two are expanded the same way. */
function endPropertyName(kind: ItemKind): string {
    return kind === 'todo' ? 'due' : 'dtend';
}

function oneDay(): ICAL.Duration {
    return ICAL.Duration.fromData({ days: 1 });
}

/**
 * The nominal length of a series, taken from the master once and added to every instance. An item
 * with neither an end nor a DURATION lasts one day when it is a DATE and nothing when it is not
 * (RFC 5545 §3.6.1).
 */
function seriesDuration(component: ICAL.Component, start: ICAL.Time, kind: ItemKind): ICAL.Duration {
    const explicit = component.getFirstPropertyValue('duration');
    if (explicit) return explicit as ICAL.Duration;
    const end = component.getFirstPropertyValue(endPropertyName(kind)) as ICAL.Time | null;
    if (end) return end.subtractDate(start);
    return start.isDate ? oneDay() : ICAL.Duration.fromSeconds(0);
}

function addDuration(start: ICAL.Time, duration: ICAL.Duration): ICAL.Time {
    const end = start.clone();
    end.addDuration(duration);
    return end;
}

interface Series {
    uid: string;
    kind: ItemKind;
    master: ICAL.Component | null;
    /** Keyed by {@link slotKey} of their `RECURRENCE-ID`. */
    overrides: Map<string, ICAL.Component>;
    /** `RANGE=THISANDFUTURE` overrides, earliest first. */
    openEnded: { key: string; at: number; component: ICAL.Component }[];
}

const KINDS: Record<string, ItemKind> = { vevent: 'event', vtodo: 'todo' };

/** The TZID a property names, or null — read from the parameter, never from the converted value. */
function propertyTzid(component: ICAL.Component, name: string): string | null {
    const property = component.getFirstProperty(name);
    const tzid = property?.getParameter('tzid');
    return typeof tzid === 'string' && tzid !== '' ? tzid : null;
}

const ZONED_PROPERTIES = ['dtstart', 'dtend', 'due', 'recurrence-id', 'rdate', 'exdate'];

/**
 * Register every zone the text relies on, before a single value is converted: ical.js resolves a
 * TZID at conversion time and silently falls back to floating, and that fallback is cached on the
 * property. So the zones have to be in place first, which is why the caller re-reads the same jCal
 * through a second `ICAL.Component`.
 */
function bindZones(root: ICAL.Component, scope: ZoneScope): void {
    for (const vtimezone of root.getAllSubcomponents('vtimezone')) scope.registerVtimezone(vtimezone);
    for (const component of root.getAllSubcomponents()) {
        if (!(component.name in KINDS)) continue;
        for (const name of ZONED_PROPERTIES) {
            for (const property of component.getAllProperties(name)) {
                const tzid = property.getParameter('tzid');
                if (typeof tzid === 'string' && tzid !== '') scope.ensure(tzid);
            }
        }
    }
}

function collectSeries(root: ICAL.Component): Series[] {
    const byUid = new Map<string, Series>();
    for (const component of root.getAllSubcomponents()) {
        const kind = KINDS[component.name];
        if (!kind) continue;
        const uid = component.getFirstPropertyValue('uid');
        if (typeof uid !== 'string' || uid === '') continue;
        let series = byUid.get(uid);
        if (!series) {
            series = { uid, kind, master: null, overrides: new Map(), openEnded: [] };
            byUid.set(uid, series);
        }
        const recurrenceId = component.getFirstPropertyValue('recurrence-id') as ICAL.Time | null;
        if (!recurrenceId) {
            // Two masters under one uid is malformed; the first one wins rather than the last, so the
            // answer does not depend on the order a server happened to serialise them in.
            series.master ??= component;
            continue;
        }
        const key = slotKey(recurrenceId);
        series.overrides.set(key, component);
        const range = component.getFirstProperty('recurrence-id')?.getParameter('range');
        if (typeof range === 'string' && range.toUpperCase() === 'THISANDFUTURE') {
            series.openEnded.push({ key, at: instantMs(recurrenceId), component });
        }
    }
    for (const series of byUid.values()) series.openEnded.sort((a, b) => a.at - b.at);
    return [...byUid.values()];
}

function isCancelled(component: ICAL.Component): boolean {
    const status = component.getFirstPropertyValue('status');
    return typeof status === 'string' && status.toUpperCase() === 'CANCELLED';
}

function summaryOf(component: ICAL.Component): string | null {
    const summary = component.getFirstPropertyValue('summary');
    return typeof summary === 'string' ? summary : null;
}

/** A text property of the instance, or null where it is absent or empty. */
function textOf(component: ICAL.Component, name: string): string | null {
    const value = component.getFirstPropertyValue(name);
    return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Overlap, not containment: an instance that starts before the window and reaches into it belongs
 * to the answer, or a week-long event would vanish from every day view but the first. A zero-length
 * instance counts as covering its own start.
 */
function overlaps(startMs: number, endMs: number, from: number, to: number): boolean {
    const reach = endMs > startMs ? endMs : startMs + 1;
    return startMs < to && reach > from;
}

interface Instance {
    start: ICAL.Time;
    end: ICAL.Time;
    component: ICAL.Component;
    override: boolean;
    recurrenceId: ICAL.Time | null;
}

/** The `THISANDFUTURE` override in force at `at`, if any. */
function openEndedAt(series: Series, at: number): ICAL.Component | null {
    let found: ICAL.Component | null = null;
    for (const entry of series.openEnded) {
        if (entry.at > at) break;
        found = entry.component;
    }
    return found;
}

/**
 * `RANGE=THISANDFUTURE` moves this instance and every later one by the same amount. Applying the
 * shift from the override's own slot keeps the rest of the series in step instead of collapsing it
 * onto one time.
 */
function shiftForOpenEnded(
    component: ICAL.Component,
    kind: ItemKind,
): { seconds: number; duration: ICAL.Duration } | null {
    const recurrenceId = component.getFirstPropertyValue('recurrence-id') as ICAL.Time | null;
    const start = component.getFirstPropertyValue('dtstart') as ICAL.Time | null;
    if (!recurrenceId || !start) return null;
    return { seconds: start.subtractDate(recurrenceId).toSeconds(), duration: seriesDuration(component, start, kind) };
}

function expandSeries(
    series: Series,
    from: number,
    to: number,
    maxPerSeries: number,
    maxScan: number,
): { occurrences: Occurrence[]; cut: SeriesCut | null } {
    const instances: Instance[] = [];
    const visited = new Set<string>();
    let cut = 0;
    let exact = true;

    const master = series.master;
    if (master) {
        const start = master.getFirstPropertyValue('dtstart') as ICAL.Time | null;
        if (start) {
            const duration = seriesDuration(master, start, series.kind);
            const iterator = new ICAL.RecurExpansion({ component: master, dtstart: start });
            let scanned = 0;
            for (;;) {
                if (scanned >= maxScan) {
                    exact = false;
                    break;
                }
                scanned += 1;
                const slot = iterator.next();
                if (!slot) break;
                const slotMs = instantMs(slot);
                if (slotMs >= to) break;
                const key = slotKey(slot);
                visited.add(key);

                const override = series.overrides.get(key);
                let instance: Instance | null = null;
                if (override) {
                    if (isCancelled(override)) continue;
                    const overrideStart = (override.getFirstPropertyValue('dtstart') as ICAL.Time | null) ?? slot;
                    instance = {
                        start: overrideStart,
                        end: addDuration(overrideStart, seriesDuration(override, overrideStart, series.kind)),
                        component: override,
                        override: true,
                        recurrenceId: slot,
                    };
                } else {
                    const open = openEndedAt(series, slotMs);
                    const shift = open ? shiftForOpenEnded(open, series.kind) : null;
                    if (open && shift) {
                        const moved = slot.clone();
                        moved.addDuration(ICAL.Duration.fromSeconds(shift.seconds));
                        instance = {
                            start: moved,
                            end: addDuration(moved, shift.duration),
                            component: open,
                            override: true,
                            recurrenceId: slot,
                        };
                    } else {
                        instance = {
                            start: slot,
                            end: addDuration(slot, duration),
                            component: master,
                            override: false,
                            recurrenceId: series.overrides.size > 0 || !iterator.complete ? slot : null,
                        };
                    }
                }

                if (!overlaps(instantMs(instance.start), instantMs(instance.end), from, to)) continue;
                if (instances.length < maxPerSeries) instances.push(instance);
                else cut += 1;
            }
        }
    }

    // An override may name a slot the rule never produces — a moved instance of a series whose rule
    // was edited afterwards, or an override the master's EXDATE also lists. RFC 5545 keeps it, and
    // dropping it would lose an appointment that exists.
    for (const [key, component] of series.overrides) {
        if (visited.has(key)) continue;
        if (isCancelled(component)) continue;
        const recurrenceId = component.getFirstPropertyValue('recurrence-id') as ICAL.Time | null;
        const start = (component.getFirstPropertyValue('dtstart') as ICAL.Time | null) ?? recurrenceId;
        if (!start) continue;
        const end = addDuration(start, seriesDuration(component, start, series.kind));
        if (!overlaps(instantMs(start), instantMs(end), from, to)) continue;
        const instance: Instance = { start, end, component, override: true, recurrenceId };
        if (instances.length < maxPerSeries) instances.push(instance);
        else cut += 1;
    }

    // A one-off item with no master and no override is nothing to expand; a master-less series shows
    // only its overrides.
    const occurrences = instances.map((instance) => ({
        uid: series.uid,
        kind: series.kind,
        recurrenceId: instance.recurrenceId ? formatTime(instance.recurrenceId) : null,
        start: formatTime(instance.start),
        end: formatTime(instance.end),
        allDay: instance.start.isDate,
        floating: isFloating(instance.start),
        tzid: propertyTzid(instance.component, 'dtstart') ?? propertyTzid(instance.component, 'recurrence-id'),
        summary: summaryOf(instance.component) ?? (series.master ? summaryOf(series.master) : null),
        location: textOf(instance.component, 'location') ?? (series.master ? textOf(series.master, 'location') : null),
        url: textOf(instance.component, 'url') ?? (series.master ? textOf(series.master, 'url') : null),
        override: instance.override,
    }));

    return {
        occurrences,
        cut: cut > 0 || !exact ? { uid: series.uid, kept: occurrences.length, cut, exact } : null,
    };
}

/**
 * Expand every series in `ical` into the instances that overlap `window`.
 *
 * `window.to` is exclusive. The result is ordered and the same on GJS and Node, which is what makes
 * it comparable in a test and cacheable across a restart.
 */
export function expand(ical: string, window: ExpandWindow, options: ExpandOptions = {}): ExpandResult {
    const from = parseBound(window.from, 'window.from');
    const to = parseBound(window.to, 'window.to');
    if (to < from) throw new RangeError(`expand: window.to is before window.from: ${window.to} < ${window.from}`);
    const maxPerSeries = options.maxPerSeries ?? MAX_PER_SERIES;
    const maxScan = options.maxScanPerSeries ?? MAX_SCAN_PER_SERIES;

    const jcal = ICAL.parse(ical);
    const scope = new ZoneScope();
    try {
        // Pass one binds the zones, pass two reads the values through them. Both read the same jCal;
        // the conversion cache that must not see a half-bound service lives on the Component.
        bindZones(new ICAL.Component(jcal), scope);
        const occurrences: Occurrence[] = [];
        const cuts: SeriesCut[] = [];
        for (const series of collectSeries(new ICAL.Component(jcal))) {
            const result = expandSeries(series, from, to, maxPerSeries, maxScan);
            occurrences.push(...result.occurrences);
            if (result.cut) cuts.push(result.cut);
        }
        occurrences.sort((a, b) =>
            a.start < b.start ? -1 : a.start > b.start ? 1 : a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0,
        );
        return { occurrences, cuts, unresolvedZones: scope.unresolvedZones() };
    } finally {
        scope.release();
    }
}
