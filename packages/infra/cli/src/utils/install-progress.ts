// Progress reporter for `gjsify install` + `gjsify dlx`.
//
// Auto-enables on TTY stderr. Renders a single-line progress bar that gets
// overwritten via `\r`, mirroring what `yarn install` / `pnpm install` show:
//
//     resolving [████████░░░░░░░░] 234/500 typescript@^6.0.3
//
// Falls back to a chatty mode (one line per completed step) when stderr is
// not a TTY, e.g. when piped into a log file or running on CI.
//
// Caller plumbing — the install backend calls `report({phase, current, total,
// name})` after every resolve/download/extract step; the renderer rate-limits
// to ~30fps so a tight inner loop doesn't drown the terminal.

export type ProgressPhase = 'resolve' | 'download' | 'extract' | 'link';

export interface ProgressEvent {
    phase: ProgressPhase;
    current: number;
    total: number;
    /** Package name being processed, surfaced in the right-hand side of the bar. */
    name?: string;
}

export interface ProgressReporter {
    /** Called for each step within a phase. */
    update(event: ProgressEvent): void;
    /** Called once when a phase begins; lets the reporter print a header line. */
    beginPhase(phase: ProgressPhase, total: number): void;
    /** Called once when a phase completes; clears the inline progress bar. */
    endPhase(phase: ProgressPhase): void;
}

const PHASE_LABEL: Record<ProgressPhase, string> = {
    resolve: 'resolving',
    download: 'downloading',
    extract: 'extracting',
    link: 'linking bins',
};

const NOOP_REPORTER: ProgressReporter = {
    update() {},
    beginPhase() {},
    endPhase() {},
};

/**
 * Make a progress reporter that auto-targets `process.stderr`.
 * - `enabled=false` → silent.
 * - stderr is not a TTY → fall back to one line per phase (begin + end).
 * - stderr is a TTY → live single-line progress bar (\r-updated, 30fps).
 */
export function makeProgressReporter(
    opts: {
        enabled?: boolean;
        stream?: NodeJS.WriteStream;
    } = {},
): ProgressReporter {
    if (opts.enabled === false) return NOOP_REPORTER;
    const stream = opts.stream ?? process.stderr;
    const isTty = Boolean(stream.isTTY);
    const enabled = opts.enabled ?? true;
    if (!enabled) return NOOP_REPORTER;
    return isTty ? makeTtyReporter(stream) : makePlainReporter(stream);
}

// ──── TTY reporter — single-line, \r-updated, 30fps rate-limit ────────────

function makeTtyReporter(stream: NodeJS.WriteStream): ProgressReporter {
    let lastRender = 0;
    let lastLine = '';
    const FRAME_MS = 33; // ~30fps

    function render(line: string, force = false) {
        const now = Date.now();
        if (!force && now - lastRender < FRAME_MS && line === lastLine) return;
        lastRender = now;
        lastLine = line;
        // Clear current line, write new content. \x1b[2K = erase entire line.
        stream.write('\r\x1b[2K' + line);
    }

    function clearLine() {
        stream.write('\r\x1b[2K');
        lastLine = '';
    }

    return {
        beginPhase(phase, total) {
            // First frame so the user sees immediate feedback.
            render(formatBar(phase, 0, total, undefined, stream.columns ?? 80), true);
        },
        update(ev) {
            render(formatBar(ev.phase, ev.current, ev.total, ev.name, stream.columns ?? 80));
        },
        endPhase(phase) {
            // Replace the live bar with a completion line so the user sees
            // a definitive "done" after the spinner stops.
            const label = PHASE_LABEL[phase];
            clearLine();
            stream.write(`gjsify install: ${label} done\n`);
        },
    };
}

// ──── Plain reporter — phase begin/end + periodic heartbeat (non-TTY) ──────
//
// On a non-TTY (piped to a log file, CI, or captured output) the bar can't
// `\r`-overwrite, so per-package lines are suppressed to avoid flooding the
// log. But emitting NOTHING between `beginPhase` and `endPhase` makes a long
// download/extract phase look frozen — the exact "no further output for 25+
// minutes" symptom of a slow install. So we emit a low-frequency heartbeat:
// at most one line per HEARTBEAT_MS, AND only after at least a few packages of
// real progress, so a fast warm install (most nodes skipped) stays quiet while
// a genuinely long phase reports `… N/M (X%)` every few seconds. This mirrors
// what npm (`--loglevel http`) and pnpm log on non-TTY: progress you can watch
// without it being one line per file.
const HEARTBEAT_MS = 5_000;

function makePlainReporter(stream: NodeJS.WriteStream): ProgressReporter {
    let lastHeartbeat = 0;
    let lastReported = 0;
    return {
        beginPhase(phase, total) {
            lastHeartbeat = Date.now();
            lastReported = 0;
            stream.write(`gjsify install: ${PHASE_LABEL[phase]} ${total} package(s)\n`);
        },
        update(ev) {
            const now = Date.now();
            if (now - lastHeartbeat < HEARTBEAT_MS) return;
            if (ev.current <= lastReported) return;
            lastHeartbeat = now;
            lastReported = ev.current;
            const pct = ev.total > 0 ? Math.round((ev.current / ev.total) * 100) : 0;
            stream.write(`gjsify install: ${PHASE_LABEL[ev.phase]} ${ev.current}/${ev.total} (${pct}%)\n`);
        },
        endPhase(phase) {
            stream.write(`gjsify install: ${PHASE_LABEL[phase]} done\n`);
        },
    };
}

// ──── Bar formatter ────────────────────────────────────────────────────────

function formatBar(
    phase: ProgressPhase,
    current: number,
    total: number,
    name: string | undefined,
    columns: number,
): string {
    const label = PHASE_LABEL[phase];
    const ratio = total > 0 ? Math.min(1, current / total) : 0;
    const pct = `${current}/${total}`;
    // Reserve: "gjsify install: " (16) + label (max ~12) + " [" (2) + "] " (2) + pct (~8) + " " + name
    const prefix = `gjsify install: ${label} `;
    const suffix = ` ${pct}` + (name ? ` ${name}` : '');
    const barWidth = Math.max(8, Math.min(40, columns - prefix.length - suffix.length - 4));
    const filled = Math.round(ratio * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    let line = `${prefix}[${bar}]${suffix}`;
    if (line.length > columns) {
        // Truncate name if the terminal is narrow.
        const overflow = line.length - columns + 1;
        const truncatedName = name && name.length > overflow ? name.slice(0, name.length - overflow - 1) + '…' : '';
        line = `${prefix}[${bar}] ${pct}${truncatedName ? ' ' + truncatedName : ''}`;
    }
    return line;
}
