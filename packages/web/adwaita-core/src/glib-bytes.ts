// `GLib.Bytes`, minimal — ADR 0100 § 3: what `Gio.OutputStream.write_bytes_async` takes. As on GJS
// the constructor copies its input and every `get_data()` is a fresh copy, so neither the caller
// nor a reader can change the bytes afterwards. The rest of `GLib.Bytes` throws by name.
//
// Reference: glib glib/gbytes.c, gjs gi/boxed.cpp (the `Uint8Array` constructor)
// Copyright (c) GNOME contributors (GLib, GJS). LGPLv2.1+, MIT OR LGPLv2+.

import { UnsupportedGObjectError } from './gobject.js';

function refuse(feature: string): UnsupportedGObjectError {
    return new UnsupportedGObjectError(feature, `${feature} is outside the GLib.Bytes subset (ADR 0100 § 3).`);
}

const REFUSED = ['slice', 'hash', 'compare', 'equal', 'unref_to_data', 'unref_to_array', 'get_region', 'toArray'];

export class Bytes {
    readonly #data: Uint8Array;

    constructor(data: Uint8Array) {
        if (!(data instanceof Uint8Array)) throw refuse(`new GLib.Bytes(${typeof data})`);
        this.#data = data.slice();
    }

    static new(data: Uint8Array): Bytes {
        return new Bytes(data);
    }

    static new_take(): never {
        throw refuse('GLib.Bytes.new_take()');
    }

    static new_static(): never {
        throw refuse('GLib.Bytes.new_static()');
    }

    get_size(): number {
        return this.#data.length;
    }

    get_data(): Uint8Array {
        return this.#data.slice();
    }

    /** @internal The bytes without a copy, for the stream that writes them. */
    static view(bytes: Bytes): Uint8Array {
        return bytes.#data;
    }
}

for (const name of REFUSED) {
    Object.defineProperty(Bytes.prototype, name, {
        value: () => {
            throw refuse(`GLib.Bytes.${name}()`);
        },
        writable: true,
        configurable: true,
        enumerable: false,
    });
}
