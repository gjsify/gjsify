// Header validation utilities shared by @gjsify/http and @gjsify/fetch.
// Kept in a bridge-free module so @gjsify/fetch can import them without
// pulling in @gjsify/http-soup-bridge (which requires the GjsifyHttpSoupBridge
// native Vala typelib — not available in all GJS environments).

export function validateHeaderName(name: string): void {
    if (typeof name !== "string" || !/^[\^`\-\w!#$%&'*+.|~]+$/.test(name)) {
        const error = new TypeError(`Header name must be a valid HTTP token ["${name}"]`);
        Object.defineProperty(error, "code", { value: "ERR_INVALID_HTTP_TOKEN" });
        throw error;
    }
}

export function validateHeaderValue(name: string, value: unknown): void {
    if (value === undefined) {
        const error = new TypeError(`Header "${name}" value must not be undefined`);
        Object.defineProperty(error, "code", { value: "ERR_HTTP_INVALID_HEADER_VALUE" });
        throw error;
    }
    if (typeof value === "string" && /[^\t -~-ÿ]/.test(value)) {
        const error = new TypeError(`Invalid character in header content ["${name}"]`);
        Object.defineProperty(error, "code", { value: "ERR_INVALID_CHAR" });
        throw error;
    }
}
