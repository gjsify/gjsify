/**
 * Parse a data: URI into its components.
 * Replaces the `data-uri-to-buffer` npm package.
 *
 * Format: data:[<mediatype>][;base64],<data>
 */
export function parseDataUri(uri: string): { buffer: Uint8Array; typeFull: string } {
    const match = uri.match(/^data:([^,]*?)(;base64)?,(.*)$/s);
    if (!match) {
        throw new TypeError(`Invalid data URI: ${uri.slice(0, 50)}...`);
    }

    const typeFull = match[1] || 'text/plain;charset=US-ASCII';
    const isBase64 = !!match[2];
    const data = match[3];

    let buffer: Uint8Array;
    if (isBase64) {
        const binaryString = atob(data);
        buffer = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            buffer[i] = binaryString.charCodeAt(i);
        }
    } else {
        buffer = new TextEncoder().encode(decodeURIComponent(data));
    }

    return { buffer, typeFull };
}
