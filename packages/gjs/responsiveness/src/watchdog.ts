// The policy half of ADR 0149: spans, the stall record, counters. The lag source
// is `startLagMonitor` in @gjsify/utils; a JS watchdog only runs again once the
// blocking code has returned, so it names the innermost open SPAN, never the
// function — that is the profiler's job (`gjs --profile`, GJS_ENABLE_PROFILER=1).

import { type LagMonitor, monotonicMs, startLagMonitor } from '@gjsify/utils/main-loop';

export const LOG_DOMAIN = 'gjsify-responsiveness';
export const DEFAULT_STALL_MS = 50;

export interface StallRecord {
    /** How late the loop ran its timer, ms. */
    ms: number;
    /** Innermost open span at detection, or `null`: nothing was marked, ask the profiler. */
    span: string | null;
    /** Open spans at detection. */
    depth: number;
    /** Stack captured when that span OPENED (`GJSIFY_STALL_STACKS=1`); detection time has the wrong one. */
    stack?: string;
}

export interface StallCounters {
    stalls: number;
    worstMs: number;
    totalMs: number;
    /** Stall count per innermost span label; `(none)` when no span was open. */
    bySpan: Record<string, number>;
}

export interface WatchdogOptions {
    /** Stall threshold in ms. Default `GJSIFY_STALL_MS`, else 50 (16 for frame work). */
    thresholdMs?: number;
    /** Capture a stack at span open. Default `GJSIFY_STALL_STACKS=1`. */
    stacks?: boolean;
    /** Called per stall, after the counters and the log record. */
    onStall?: (record: StallRecord) => void;
}

export interface SpanHandle {
    /** Close the span; returns its duration in ms (0 for the inert handle). */
    end(): number;
}

interface OpenSpan {
    label: string;
    start: number;
    end?: number;
    stack?: string;
}

/** The detection tick runs after the blocking code returned, and microtasks have closed its span by then. */
const CLOSED_KEEP = 64;

interface GLibLog {
    log_structured(domain: string, level: number, fields: Record<string, string>): void;
    LogLevelFlags: { LEVEL_WARNING: number };
}

const INERT: SpanHandle = Object.freeze({ end: () => 0 });

let monitor: LagMonitor | undefined;
let captureStacks = false;
let userOnStall: ((record: StallRecord) => void) | undefined;
let open: OpenSpan[] = [];
let closed: OpenSpan[] = [];
let envChecked = false;
let counters = emptyCounters();

function emptyCounters(): StallCounters {
    return { stalls: 0, worstMs: 0, totalMs: 0, bySpan: {} };
}

function env(name: string): string | undefined {
    return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

/** The GLib binding where one exists; structural like `@gjsify/utils`, so Node needs no GI. */
function glibLog(): GLibLog | undefined {
    return (globalThis as { imports?: { gi?: { GLib?: GLibLog } } }).imports?.gi?.GLib;
}

function emit(record: StallRecord): void {
    const message = `main loop stalled ${record.ms.toFixed(1)} ms in ${record.span ?? '(no open span)'}`;
    const glib = glibLog();
    if (glib?.log_structured) {
        const fields: Record<string, string> = {
            MESSAGE: message,
            GJSIFY_STALL_MS: record.ms.toFixed(1),
            GJSIFY_STALL_SPAN: record.span ?? '',
            GJSIFY_STALL_DEPTH: String(record.depth),
        };
        if (record.stack) fields.GJSIFY_STALL_STACK = record.stack;
        glib.log_structured(LOG_DOMAIN, glib.LogLevelFlags.LEVEL_WARNING, fields);
    } else {
        console.warn(`[${LOG_DOMAIN}] ${message}`);
    }
}

function onStall(ms: number): void {
    const now = monotonicMs();
    const from = now - ms;
    const overlapping = [...closed, ...open].filter(
        (s) => Math.min(s.end ?? now, now) - Math.max(s.start, from) >= ms * 0.5,
    );
    let top: OpenSpan | undefined;
    for (const s of overlapping) if (!top || s.start >= top.start) top = s;
    const record: StallRecord = { ms, span: top?.label ?? null, depth: overlapping.length };
    if (top?.stack) record.stack = top.stack;
    counters.stalls += 1;
    counters.totalMs += ms;
    if (ms > counters.worstMs) counters.worstMs = ms;
    const key = record.span ?? '(none)';
    counters.bySpan[key] = (counters.bySpan[key] ?? 0) + 1;
    emit(record);
    userOnStall?.(record);
}

/** Arm from `GJSIFY_STALL_MS` once per process; unset leaves everything inert. */
function armFromEnv(): void {
    if (envChecked) return;
    envChecked = true;
    const raw = env('GJSIFY_STALL_MS');
    if (raw === undefined || raw === '') return;
    const ms = Number(raw);
    if (Number.isFinite(ms) && ms > 0 && !monitor) armStallWatchdog({ thresholdMs: ms });
}

/**
 * Arm the watchdog. Armed it wakes the process 100 times a second: a debugging
 * and test mode, not a production default. Returns the disarm function.
 */
export function armStallWatchdog(options: WatchdogOptions = {}): () => void {
    envChecked = true;
    disarmStallWatchdog();
    captureStacks = options.stacks ?? env('GJSIFY_STALL_STACKS') === '1';
    userOnStall = options.onStall;
    const thresholdMs = options.thresholdMs ?? (Number(env('GJSIFY_STALL_MS')) || DEFAULT_STALL_MS);
    monitor = startLagMonitor({ intervalMs: 10, thresholdMs, onStall });
    return disarmStallWatchdog;
}

export function disarmStallWatchdog(): void {
    monitor?.stop();
    monitor = undefined;
    userOnStall = undefined;
    open = [];
    closed = [];
}

export function isStallWatchdogArmed(): boolean {
    armFromEnv();
    return monitor !== undefined;
}

/**
 * Open a span. Unarmed this returns a shared inert handle: no allocation, no clock read.
 * A stall names the innermost span that covered it, open or just closed.
 */
export function mark(label: string): SpanHandle {
    armFromEnv();
    if (!monitor) return INERT;
    const entry: OpenSpan = { label, start: monotonicMs() };
    if (captureStacks) entry.stack = new Error().stack;
    open.push(entry);
    let ended = false;
    return {
        end() {
            if (ended) return 0;
            ended = true;
            const at = open.lastIndexOf(entry);
            if (at !== -1) open.splice(at, 1);
            entry.end = monotonicMs();
            closed.push(entry);
            if (closed.length > CLOSED_KEEP) closed.shift();
            return entry.end - entry.start;
        },
    };
}

/** Run `fn` inside a span; a returned promise keeps it open until it settles. */
export function span<T>(label: string, fn: () => T): T {
    const handle = mark(label);
    let result: T;
    try {
        result = fn();
    } catch (error) {
        handle.end();
        throw error;
    }
    if (result instanceof Promise) {
        return result.finally(() => handle.end()) as T;
    }
    handle.end();
    return result;
}

export function getStallCounters(): StallCounters {
    return { ...counters, bySpan: { ...counters.bySpan } };
}

export function resetStallCounters(): void {
    counters = emptyCounters();
}
