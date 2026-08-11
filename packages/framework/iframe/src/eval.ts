// Pure helpers for IFrameBridge.evaluateJavaScript. Building the in-page wrapper and
// parsing its JSON result stay WebView-free so they unit-test headless — CI has no GDK
// display to instantiate a real WebKit.WebView.
//
// The caller passes an EXPRESSION, as `page.evaluate` does; its value is JSON-serialised
// in-page and read back on the host, and multi-statement logic wraps itself in an IIFE.
// No in-page `eval`, so the wrapper survives a strict CSP.

/** JSON envelope the in-page wrapper returns. */
export type EvalResult =
    | { __gjsifyEval: 'ok'; value: unknown }
    | { __gjsifyEval: 'undefined' }
    | { __gjsifyEval: 'error'; message: string };

/**
 * Wrap a user expression so its value comes back as a JSON {@link EvalResult}. A value
 * that is not JSON-serialisable (function, circular object) collapses to `undefined`.
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
 * Parse the JSON string {@link buildEvalScript} produces, read off the JSCValue. An
 * `error` envelope throws (as `EvalError`) carrying the page's message; malformed or
 * non-envelope JSON yields `undefined`, because a tampered page must not crash the host.
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
