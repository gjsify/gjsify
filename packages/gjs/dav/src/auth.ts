/** Produces the headers that authenticate one request. Called per request, so a token can refresh. */
export type DavAuth = () => Record<string, string> | Promise<Record<string, string>>;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
        out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
        out += i + 2 < bytes.length ? B64[n & 63] : '=';
    }
    return out;
}

export function basicAuth(user: string, password: string): DavAuth {
    const header = 'Basic ' + base64(new TextEncoder().encode(`${user}:${password}`));
    return () => ({ Authorization: header });
}

/** `token` may be a function, so an OAuth access token can be refreshed between requests. */
export function bearerAuth(token: string | (() => string | Promise<string>)): DavAuth {
    return async () => ({
        Authorization: `Bearer ${typeof token === 'function' ? await token() : token}`,
    });
}
