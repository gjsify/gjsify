// window.location stub for GJS — provides minimal Location-compatible object.
// In GJS apps, there is no browser URL — we use file:// as a reasonable default.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/Location

export const location = {
    href:     'file://',
    origin:   'file://',
    protocol: 'file:',
    host:     '',
    hostname: '',
    port:     '',
    pathname: '/',
    search:   '',
    hash:     '',
    assign(_url: string): void {},
    replace(_url: string): void {},
    reload(): void {},
    toString(): string { return this.href; },
    ancestorOrigins: { length: 0, item: () => null, contains: () => false, [Symbol.iterator]: function*(): Generator<string> {} },
};
