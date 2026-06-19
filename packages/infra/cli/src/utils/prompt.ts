// Interactive prompts for `gjsify login` / `gjsify trust`.
//
// On a TTY every prompt runs inside a single RAW-mode session (`runRawSession`)
// that reads key-by-key with manual echo and a guaranteed cooked-mode restore
// (try/finally). This deliberately does NOT rely on the terminal's cooked
// line-discipline nor on the shared `process.stdin` resume/pause cycle:
//   - The old visible prompt read a cooked line via `process.stdin` 'data'
//     events. With the line discipline in an unexpected state (e.g. ICRNL off
//     after a prior raw prompt) Enter arrived as a bare `\r` that never
//     terminated the cooked line — the prompt hung showing `name^M`. The
//     resume/pause churn on the shared stdin singleton between two sequential
//     prompts also intermittently dropped the line or resolved it empty.
//   - Reading raw + handling `\r`/`\n` ourselves removes both failure modes.
//
// Raw mode (via @gjsify/process → terminal-native) now also clears ISIG, so
// Ctrl-C is delivered as a `\x03` keystroke we handle (restore + exit) instead
// of a SIGINT that would kill the process leaving the terminal in raw mode.
//
// Non-TTY stdin (piped input, CI) keeps a plain line read so
// `printf 'user\npass\n' | gjsify login` still works.

const CTRL_C = '\x03'; // ETX (Ctrl-C)
const DEL = '\x7f'; // DEL (Backspace on most terminals)
const BACKSPACE = '\x08'; // BS

/** Credentials read from the terminal. */
export interface PromptedCredentials {
    username: string;
    password: string;
}

type StdinTty = NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };

function isTtyStdin(): boolean {
    const stdin = process.stdin as StdinTty;
    return Boolean(stdin.isTTY) && typeof stdin.setRawMode === 'function';
}

/** Result of feeding one keystroke to the raw-mode line editor. */
export interface KeyOutcome {
    /** The line buffer after this key. */
    buf: string;
    /** Text to echo to the terminal for this key (`''` = nothing). */
    echo: string;
    /** The line is complete (Enter). */
    done: boolean;
    /** Ctrl-C was pressed (caller should restore + exit). */
    interrupt: boolean;
}

/**
 * Pure key handler for the raw-mode line editor — the single source of truth
 * for how a keystroke updates the buffer + echo. Kept pure (no I/O) so it is
 * unit-testable: this is what makes Enter (`\r` OR `\n`) reliably submit, masks
 * passwords, and treats Ctrl-C as an interrupt rather than text.
 */
export function applyKey(buf: string, ch: string, mask: boolean): KeyOutcome {
    if (ch === '\r' || ch === '\n') {
        return { buf, echo: '\n', done: true, interrupt: false };
    }
    if (ch === CTRL_C) {
        return { buf, echo: '\n', done: false, interrupt: true };
    }
    if (ch === DEL || ch === BACKSPACE) {
        if (buf.length > 0) {
            return { buf: buf.slice(0, -1), echo: '\b \b', done: false, interrupt: false };
        }
        return { buf, echo: '', done: false, interrupt: false };
    }
    if (ch >= ' ') {
        return { buf: buf + ch, echo: mask ? '*' : ch, done: false, interrupt: false };
    }
    // Other control characters (arrows, tabs, escapes) are ignored.
    return { buf, echo: '', done: false, interrupt: false };
}

/** Reads one line on TTY (echo or mask) within an open raw session. */
type ReadKey = (question: string, mask: boolean) => Promise<string>;

/**
 * Open ONE raw-mode stdin session, run `fn` (which may read several lines via
 * the supplied reader), and always restore cooked mode afterwards. Keeping a
 * single session for the whole credential exchange avoids per-prompt
 * resume/pause races on the shared stdin singleton.
 */
async function runRawSession<T>(fn: (read: ReadKey) => Promise<T>): Promise<T> {
    const stdin = process.stdin as StdinTty;
    const out = process.stdout;

    let pending: { mask: boolean; buf: string; resolve: (value: string) => void } | null = null;

    const cleanup = (): void => {
        stdin.removeListener('data', onData);
        try {
            stdin.setRawMode!(false);
        } catch {
            /* not a TTY any more */
        }
        if (typeof stdin.pause === 'function') stdin.pause();
    };

    const onData = (chunk: string | Buffer): void => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        for (const ch of text) {
            if (!pending) continue; // ignore type-ahead between prompts
            const r = applyKey(pending.buf, ch, pending.mask);
            pending.buf = r.buf;
            if (r.echo) out.write(r.echo);
            if (r.interrupt) {
                cleanup();
                process.exit(130);
            }
            if (r.done) {
                const { resolve } = pending;
                pending = null;
                resolve(r.buf);
            }
        }
    };

    stdin.setRawMode!(true);
    if (typeof stdin.resume === 'function') stdin.resume();
    stdin.setEncoding('utf-8');
    stdin.on('data', onData);

    const read: ReadKey = (question, mask) =>
        new Promise<string>((resolve) => {
            out.write(question);
            pending = { mask, buf: '', resolve };
        });

    try {
        return await fn(read);
    } finally {
        cleanup();
    }
}

/** Read a single line from non-TTY stdin (piped). Accepts CR, LF, or CRLF. */
function readLine(): Promise<string> {
    return new Promise((resolve) => {
        let buf = '';
        const onData = (chunk: Buffer | string) => {
            buf += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
            const m = buf.search(/[\r\n]/);
            if (m >= 0) {
                cleanup();
                resolve(buf.slice(0, m));
            }
        };
        const onEnd = () => {
            cleanup();
            resolve(buf.replace(/\r$/, '').trim());
        };
        const cleanup = () => {
            process.stdin.removeListener('data', onData);
            process.stdin.removeListener('end', onEnd);
        };
        process.stdin.setEncoding('utf-8');
        if (typeof process.stdin.isPaused === 'function' && process.stdin.isPaused()) process.stdin.resume();
        process.stdin.on('data', onData);
        process.stdin.once('end', onEnd);
    });
}

/** Print a question and read one visible line. */
export async function promptLine(question: string): Promise<string> {
    if (!isTtyStdin()) {
        process.stdout.write(question);
        return readLine();
    }
    return runRawSession((read) => read(question, false));
}

/** Print a question and read one line WITHOUT echoing it (passwords). */
export async function promptHidden(question: string): Promise<string> {
    if (!isTtyStdin()) {
        process.stdout.write(question);
        return readLine();
    }
    return runRawSession((read) => read(question, true));
}

/**
 * Read npm credentials. On a TTY both the visible username and the masked
 * password are read in ONE raw session (no cooked-line dependency, no
 * inter-prompt resume/pause race). `providedUsername` (from `--username`) skips
 * the username prompt.
 */
export async function promptCredentials(providedUsername?: string): Promise<PromptedCredentials> {
    if (!isTtyStdin()) {
        let username = providedUsername;
        if (!username) {
            process.stdout.write('Username: ');
            username = await readLine();
        }
        process.stdout.write('Password: ');
        const password = await readLine();
        return { username, password };
    }

    return runRawSession(async (read) => {
        const username = providedUsername ?? (await read('Username: ', false));
        const password = await read('Password: ', true);
        return { username, password };
    });
}
