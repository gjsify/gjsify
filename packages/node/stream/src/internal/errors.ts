// Errors a Writable/Duplex reports to its write callback AND emits as 'error'.
//
// Node tags each with a `code` (docs/api/errors.md#common-errors), and
// consumers switch on it — a bare `Error` carrying only a message cannot be
// told apart from any other failure, so a caller has no choice but to ignore
// the whole 'error' event. The write-after-end case is duplicated across
// `writable.ts`, `duplex.ts` and `browser.ts` (three separate writable
// implementations), so the constructor lives here rather than per file.

/** `ERR_STREAM_WRITE_AFTER_END` — a `write()` issued after `end()`. */
export function writeAfterEndError(): Error {
    const err = new Error('write after end') as Error & { code: string };
    err.code = 'ERR_STREAM_WRITE_AFTER_END';
    return err;
}
