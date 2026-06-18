// Minimal interactive prompts for `gjsify login` — a visible line prompt and a
// hidden (no-echo) password prompt. Cross-runtime: `process.stdin.setRawMode`
// is provided by Node and by `@gjsify/process` (terminal-native) under GJS.
//
// Non-TTY stdin (piped input, CI) is supported: both helpers read a single line
// without raw-mode masking, so `printf 'user\npass\n' | gjsify login` works for
// automation.

const CTRL_C = String.fromCharCode(3); // ETX (Ctrl-C)
const DEL = String.fromCharCode(127); // DEL (Backspace on most terminals)
const BACKSPACE = String.fromCharCode(8); // BS

/** Print a question and read one line from stdin (visible). */
export async function promptLine(question: string): Promise<string> {
    process.stdout.write(question);
    return readLine();
}

/**
 * Print a question and read one line WITHOUT echoing it (passwords). Uses raw
 * mode + manual key handling on a TTY; falls back to a plain line read when
 * stdin is not a TTY (piped). Ctrl-C aborts the process.
 */
export async function promptHidden(question: string): Promise<string> {
    process.stdout.write(question);
    const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
        // Non-interactive: read a line as-is (no masking possible/needed).
        return readLine();
    }
    return new Promise<string>((resolve) => {
        let buf = '';
        stdin.setRawMode!(true);
        stdin.resume();
        stdin.setEncoding('utf-8');
        // Do NOT assume `chunk` is a string: under GJS `@gjsify/process` does
        // not honour `setEncoding('utf-8')` in raw mode, so each chunk arrives
        // as bytes (a Buffer). Iterating bytes makes `ch === '\r'` always false
        // and Enter (byte 13) coerce past `ch >= ' '` (→ `13 >= 0`) so it was
        // masked as another `*` and the prompt never submitted. Normalise to a
        // string first (same shape as readLine's handler), so this works on
        // both Node (string) and GJS (bytes) — aligning with `npm login`.
        const onData = (raw: string | Buffer) => {
            const chunk = typeof raw === 'string' ? raw : raw.toString('utf-8');
            for (const ch of chunk) {
                if (ch === '\r' || ch === '\n') {
                    cleanup();
                    process.stdout.write('\n');
                    resolve(buf);
                    return;
                } else if (ch === CTRL_C) {
                    cleanup();
                    process.stdout.write('\n');
                    process.exit(130);
                } else if (ch === DEL || ch === BACKSPACE) {
                    if (buf.length > 0) {
                        buf = buf.slice(0, -1);
                        process.stdout.write('\b \b');
                    }
                } else if (ch >= ' ') {
                    buf += ch;
                    process.stdout.write('*');
                }
            }
        };
        const cleanup = () => {
            stdin.setRawMode!(false);
            stdin.removeListener('data', onData);
            stdin.pause();
        };
        stdin.on('data', onData);
    });
}

/** Read a single line from stdin (shared by both prompts on non-TTY). */
function readLine(): Promise<string> {
    return new Promise((resolve) => {
        let buf = '';
        const onData = (chunk: Buffer | string) => {
            buf += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
            // Accept CR, LF, or CRLF as the line terminator. A bare CR (`\r`)
            // is what some terminals / the GJS terminal-native stdin deliver on
            // Enter — keying only on `\n` made the prompt hang forever there.
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
