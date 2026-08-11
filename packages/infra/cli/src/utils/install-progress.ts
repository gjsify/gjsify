// Progress reporter for `gjsify install` + `gjsify dlx`. The backend reports every
// resolve/download/extract/link step; on TTY stderr this renders one `\r`-overwritten
// bar, rate-limited to ~30fps so a tight inner loop cannot drown the terminal, and
// on a non-TTY it degrades to the heartbeat mode described below.

export type ProgressPhase = 'resolve' | 'download' | 'extract' | 'link';

export interface ProgressEvent {
    phase: ProgressPhase;
    current: number;
    total: number;
    /** Package name being processed, surfaced in the right-hand side of the bar. */
    name?: string;
}

export interface ProgressReporter {
    update(event: ProgressEvent): void;
    beginPhase(phase: ProgressPhase, total: number): void;
    /** Clears the inline bar and replaces it with a completion line. */
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

/** Pick the reporter for `process.stderr` (or `opts.stream`): silent, plain, or TTY bar. */
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

function makeTtyReporter(stream: NodeJS.WriteStream): ProgressReporter {
    let lastRender = 0;
    let lastLine = '';
    const FRAME_MS = 33; // ~30fps

    function render(line: string, force = false) {
        const now = Date.now();
        if (!force && now - lastRender < FRAME_MS && line === lastLine) return;
        lastRender = now;
        lastLine = line;
        // `\x1b[2K` = erase entire line.
        stream.write('\r\x1b[2K' + line);
    }

    function clearLine() {
        stream.write('\r\x1b[2K');
        lastLine = '';
    }

    return {
        beginPhase(phase, total) {
            // Forced, so the first frame is not eaten by the rate limit.
            render(formatBar(phase, 0, total, undefined, stream.columns ?? 80), true);
        },
        update(ev) {
            render(formatBar(ev.phase, ev.current, ev.total, ev.name, stream.columns ?? 80));
        },
        endPhase(phase) {
            // A definitive "done" line, or the stopped bar reads as a stall.
            const label = PHASE_LABEL[phase];
            clearLine();
            stream.write(`gjsify install: ${label} done\n`);
        },
    };
}

// Non-TTY heartbeat. Per-package lines would flood a log file, but emitting
// NOTHING between `beginPhase` and `endPhase` makes a long download/extract look
// frozen — the exact "no further output for 25+ minutes" symptom of a slow install.
// So: at most one line per HEARTBEAT_MS, and only once `current` has actually
// advanced, which keeps a fast warm install (most nodes skipped) silent while a
// genuinely long phase reports `… N/M (X%)` every few seconds.
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
    const prefix = `gjsify install: ${label} `;
    const suffix = ` ${pct}` + (name ? ` ${name}` : '');
    const barWidth = Math.max(8, Math.min(40, columns - prefix.length - suffix.length - 4));
    const filled = Math.round(ratio * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    let line = `${prefix}[${bar}]${suffix}`;
    if (line.length > columns) {
        const overflow = line.length - columns + 1;
        const truncatedName = name && name.length > overflow ? name.slice(0, name.length - overflow - 1) + '…' : '';
        line = `${prefix}[${bar}] ${pct}${truncatedName ? ' ' + truncatedName : ''}`;
    }
    return line;
}
