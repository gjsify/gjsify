// Registers: btoa, atob (via GLib.base64_encode/decode)

import GLib from '@girs/glib-2.0';

if (typeof globalThis.btoa !== 'function') {
    Object.defineProperty(globalThis, 'btoa', {
        value: function btoa(data: string): string {
            const bytes = new Uint8Array(data.length);
            for (let i = 0; i < data.length; i++) {
                bytes[i] = data.charCodeAt(i) & 0xff;
            }
            return GLib.base64_encode(bytes);
        },
        enumerable: true,
        writable: true,
        configurable: true,
    });
}

if (typeof globalThis.atob !== 'function') {
    Object.defineProperty(globalThis, 'atob', {
        value: function atob(data: string): string {
            // The web `atob` takes input without `=` padding; GLib drops the last partial byte of it
            // (an unpadded 64-byte Ed25519 signature decodes to 63 bytes).
            let text = String(data).replace(/[\t\n\f\r ]/g, '');
            if (text.length % 4 !== 0 && !text.includes('=')) text += '='.repeat(4 - (text.length % 4));
            const bytes = GLib.base64_decode(text);
            let result = '';
            for (let i = 0; i < bytes.length; i++) {
                result += String.fromCharCode(bytes[i]);
            }
            return result;
        },
        enumerable: true,
        writable: true,
        configurable: true,
    });
}
