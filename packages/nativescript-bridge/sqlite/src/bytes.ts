// Java's `byte` is signed (-128..127), a Uint8Array element is not. A NativeScript `byte[]`
// is indexable from JS but converts nothing, so both directions are spelled out here, free
// of Java so they are specced off-device.

/** Any indexable run of numbers: a Java `byte[]` on a device, an Int8Array in a spec. */
export interface SignedBytes {
    readonly length: number;
    [index: number]: number;
}

/** Fill `target` (same length as `data`) with `data` as signed bytes; returns `target`. */
export function writeSignedBytes<T extends SignedBytes>(data: Uint8Array, target: T): T {
    for (let i = 0; i < data.length; i++) target[i] = (data[i] << 24) >> 24;
    return target;
}

/** A null `byte[]` (a zero-length blob on some drivers) reads as empty. */
export function fromSignedBytes(bytes: SignedBytes | null | undefined): Uint8Array {
    if (bytes == null) return new Uint8Array(0);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < out.length; i++) out[i] = bytes[i] & 0xff;
    return out;
}
