// Java's `byte` is signed; a Uint8Array element is not. Both directions, free of Java.

export interface SignedBytes {
    readonly length: number;
    [index: number]: number;
}

export function writeSignedBytes<T extends SignedBytes>(data: Uint8Array, target: T): T {
    for (let i = 0; i < data.length; i++) target[i] = (data[i] << 24) >> 24;
    return target;
}

export function fromSignedBytes(bytes: SignedBytes | null | undefined): Uint8Array {
    if (bytes == null) return new Uint8Array(0);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < out.length; i++) out[i] = bytes[i] & 0xff;
    return out;
}
