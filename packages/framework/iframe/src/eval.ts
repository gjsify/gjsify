// Pure helpers for IFrameBridge.evaluateJavaScript — original implementation.
//
// Building the in-page wrapper script and parsing its JSON result are kept
// WebView-free so they unit-test headless (CI has no GDK display to
// instantiate a real WebKit.WebView, see the package's other specs).
//
// Contract (mirrors Playwright/Puppeteer `page.evaluate`): the caller passes
// a JavaScript *expression*. Its value is serialised to JSON in-page and read
// back on the GJS host. Multi-statement scripts wrap themselves in an IIFE
// that returns a value, e.g. `(() => { const a = 1; return a + 1; })()`.
// No `eval` is used in-page, so the wrapper stays compatible with strict CSP.

/** JSON envelope the in-page wrapper returns. */
export type EvalResult =
    | { __gjsifyEval: 'ok'; value: unknown }
    | { __gjsifyEval: 'undefined' }
    | { __gjsifyEval: 'error'; message: string };

/**
 * Wrap a user expression so its value comes back as a JSON string.
 *
 * The wrapper always evaluates to a JSON string of one {@link EvalResult}
 * shape — `ok` with the JSON-serialised value, `undefined` when the value is
 * `undefined`, or `error` with the thrown message. A value that is not
 * JSON-serialisable (function, circular object) collapses to `undefined`.
 */
export function buildEvalScript(expression: string): string {
    return (
        '(function(){try{' +
        'var __v=(' +
        expression +
        ');' +
        "if(__v===undefined)return JSON.stringify({__gjsifyEval:'undefined'});" +
        "return JSON.stringify({__gjsifyEval:'ok',value:__v});" +
        '}catch(__e){' +
        "return JSON.stringify({__gjsifyEval:'error',message:String((__e&&__e.message)||__e)});" +
        '}})()'
    );
}

/**
 * Parse the JSON string returned by {@link buildEvalScript} (read off the
 * JSCValue via `to_string()`).
 *
 * - `ok` → the deserialised value.
 * - `undefined` → `undefined`.
 * - `error` → throws an `Error` (name `EvalError`) carrying the page message.
 * - malformed / `null` / non-envelope JSON → `undefined` (defensive — a
 *   tampered page or a non-wrapper result must not crash the host).
 */
export function parseEvalResult(json: string | null | undefined): unknown {
    if (json === null || json === undefined) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return undefined;
    }
    if (parsed === null || typeof parsed !== 'object') return undefined;
    const tag = (parsed as { __gjsifyEval?: unknown }).__gjsifyEval;
    if (tag === 'error') {
        const message = (parsed as { message?: unknown }).message;
        const err = new Error(typeof message === 'string' ? message : 'evaluateJavaScript failed');
        err.name = 'EvalError';
        throw err;
    }
    if (tag === 'undefined') return undefined;
    if (tag === 'ok') return (parsed as { value?: unknown }).value;
    return undefined;
}
