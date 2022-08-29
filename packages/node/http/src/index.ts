/**
 * Performs the low-level validations on the provided `name` that are done when `res.setHeader(name, value)` is called.
 * Passing illegal value as `name` will result in a `TypeError` being thrown, identified by `code: 'ERR_INVALID_HTTP_TOKEN'`.
 * It is not necessary to use this method before passing headers to an HTTP request or response. The HTTP module will automatically validate such headers.
 * @param name
 * @since v14.3.0
 */
export function validateHeaderName(name: string) {
    if (!/^[\^`\-\w!#$%&'*+.|~]+$/.test(name)) {
        const error = new TypeError(`Header name must be a valid HTTP token [${name}]`);
        Object.defineProperty(error, 'code', { value: 'ERR_INVALID_HTTP_TOKEN' });
        throw error;
    }
}

/**
 * Performs the low-level validations on the provided `value` that are done when `res.setHeader(name, value)` is called.
 * Passing illegal value as `value` will result in a `TypeError` being thrown.
 *  * Undefined value error is identified by `code: 'ERR_HTTP_INVALID_HEADER_VALUE'`.
 *  * Invalid value character error is identified by `code: 'ERR_INVALID_CHAR'`.
 * It is not necessary to use this method before passing headers to an HTTP request or response. The HTTP module will automatically validate such headers.
 * @param name 
 * @param value 
 */
export function validateHeaderValue(name: string, value: any) {
    if (/[^\t\u0020-\u007E\u0080-\u00FF]/.test(value)) {
        const error = new TypeError(`Invalid character in header content ["${name}"]`);
        Object.defineProperty(error, 'code', {value: 'ERR_INVALID_CHAR'});
        throw error;
    }
}