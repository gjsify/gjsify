// Interactive prompts for `gjsify login` / `gjsify trust`.
//
// On a TTY every prompt runs inside a single RAW-mode session (`runRawSession`) reading
// key-by-key with manual echo and a guaranteed cooked-mode restore. It deliberately relies on
// neither the terminal's cooked line-discipline nor the shared `process.stdin` resume/pause
// cycle: a cooked read with the line discipline in an unexpected state (ICRNL off after a prior
// raw prompt) saw Enter arrive as a bare `\r` that never terminated the line, hanging the prompt
// showing `name^M`, and the resume/pause churn on the shared stdin singleton between sequential
// prompts intermittently dropped the line or resolved it empty. Handling `\r`/`\n` here removes
// both failure modes.
//
// Raw mode (via @gjsify/process → terminal-native) also clears ISIG, so Ctrl-C arrives as a
// `\x03` keystroke handled below (restore + exit) rather than a SIGINT that would kill the
// process leaving the terminal in raw mode.
//
// Non-TTY stdin (piped input, CI) keeps a plain line read so
// `printf 'user\npass\n' | gjsify login` still works.

import { beginPrompt, endPrompt } from './prompt-output.js';

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
 * Pure key handler for the raw-mode line editor — the single source of truth for how a keystroke
 * updates the buffer + echo. Pure (no I/O) so the rules are unit-testable: Enter is `\r` OR `\n`,
 * passwords mask, and Ctrl-C is an interrupt rather than text.
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
                // `return` — a bare `process.exit()` is deferred under GJS (no
                // atexit), so the loop kept consuming the rest of the chunk
                // after Ctrl-C and could still resolve the pending prompt.
                // Returning stops input handling here; the deferred exit then
                // carries 130 on the way out.
                return process.exit(130);
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
            // A prompt owns the last line: hold back every other writer until it
            // closes, or their output lands inside the digits being typed.
            beginPrompt();
            out.write(question);
            pending = {
                mask,
                buf: '',
                resolve: (value) => {
                    endPrompt();
                    resolve(value);
                },
            };
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
        // Non-TTY holds back other writers too: the interleaving is not visible
        // here, but a transcript in which a notice sits between the question and
        // the answer is just as hard to read afterwards.
        beginPrompt();
        process.stdout.write(question);
        try {
            return await readLine();
        } finally {
            endPrompt();
        }
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
