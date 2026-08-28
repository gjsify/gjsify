// Stdout arbitration between a live prompt and everything else writing to it.
//
// A prompt owns the last line of the terminal. On a TTY `prompt.ts` runs in RAW
// mode and echoes each keystroke by hand, so the cursor sits mid-line with no
// newline pending — and any other writer lands INSIDE what the user is typing:
//
//     Enter a NEW OTP:   npm rate limit hit. npm sent no Retry-After …
//     228000
//
// (measured on a real `gjsify onboard` sweep: a rate-limit notice from a
// concurrent worker spliced into the digits being entered, leaving the typed
// code visually split across two lines).
//
// The rule is arbitration, not silence: a message that arrives during a prompt
// is HELD and flushed the moment the prompt closes. Dropping it would trade a
// cosmetic problem for a lost one, and the messages that show up here are
// exactly the ones explaining why the sweep is slow.

type Writer = (text: string) => void;

let depth = 0;
const held: string[] = [];

/** How many prompts are currently on screen. Exposed for tests. */
export function promptDepth(): number {
    return depth;
}

/** Mark a prompt as open; every `writeAroundPrompt` is held until it closes. */
export function beginPrompt(): void {
    depth++;
}

/** Close a prompt and flush anything held while it was open. */
export function endPrompt(write: Writer = defaultWrite): void {
    depth = Math.max(0, depth - 1);
    if (depth > 0) return;
    if (held.length === 0) return;
    const pendingLines = held.splice(0, held.length);
    for (const line of pendingLines) write(line);
}

/** Write now, or hold until the open prompt closes. */
export function writeAroundPrompt(text: string, write: Writer = defaultWrite): void {
    if (depth > 0) {
        held.push(text);
        return;
    }
    write(text);
}

function defaultWrite(text: string): void {
    process.stdout.write(text);
}

/** Test seam: forget any held output and reset the depth. */
export function resetPromptOutput(): void {
    depth = 0;
    held.length = 0;
}
