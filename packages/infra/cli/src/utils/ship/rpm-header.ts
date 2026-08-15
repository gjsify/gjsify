// The RPM header structure — an index of typed entries over a shared store.
//
// Both headers in an RPM (the signature and the main one) are this same
// structure, which is why it is its own module: `rpm.ts` decides WHICH tags to
// write, this file decides how a header is spelled.
//
// The one genuinely surprising part is the REGION. `rpm` does not read the
// index as a flat list: the first index entry is a region trailer pointer with
// tag 62 (signatures) or 63 (immutable), whose store payload is a second,
// 16-byte index entry carrying a NEGATIVE offset — the byte distance back to
// the start of the index. Getting that offset wrong does not corrupt anything
// visibly; `rpm -qp` simply reports "region trailer" errors or silently sees a
// header with no tags in it.

const HEADER_MAGIC = Uint8Array.from([0x8e, 0xad, 0xe8, 0x01, 0x00, 0x00, 0x00, 0x00]);
const INDEX_ENTRY_SIZE = 16;
/** The region trailer is one index entry, and rpm checks the count literally. */
const REGION_COUNT = 16;

export const RPM_TAG_HEADERSIGNATURES = 62;
export const RPM_TAG_HEADERIMMUTABLE = 63;

export enum RpmType {
    INT16 = 3,
    INT32 = 4,
    STRING = 6,
    BIN = 7,
    STRING_ARRAY = 8,
    I18NSTRING = 9,
}

/** Store alignment per type — rpm reads INT32s with an aligned load. */
const ALIGNMENT: Record<RpmType, number> = {
    [RpmType.INT16]: 2,
    [RpmType.INT32]: 4,
    [RpmType.STRING]: 1,
    [RpmType.BIN]: 1,
    [RpmType.STRING_ARRAY]: 1,
    [RpmType.I18NSTRING]: 1,
};

export type RpmValue = string | string[] | number | number[] | Uint8Array;

export interface RpmEntry {
    tag: number;
    type: RpmType;
    value: RpmValue;
}

/** Build a complete header blob, magic included. */
export function buildRpmHeader(entries: readonly RpmEntry[], regionTag: number): Uint8Array {
    // rpm expects the index sorted by tag; the store is laid out in the same
    // order, which is not required but makes a hexdump readable next to a real
    // package's.
    const sorted = [...entries].sort((a, b) => a.tag - b.tag);
    const index: Array<{ tag: number; type: RpmType; offset: number; count: number }> = [];
    const chunks: Uint8Array[] = [];
    let storeSize = 0;

    for (const entry of sorted) {
        if (entry.tag < 100) {
            throw new Error(`gjsify ship: rpm tag ${entry.tag} is below 100 and would be rejected by hdrchkTag.`);
        }
        const { data, count } = encodeValue(entry.type, entry.value, entry.tag);
        const alignment = ALIGNMENT[entry.type];
        const padding = (alignment - (storeSize % alignment)) % alignment;
        if (padding > 0) {
            chunks.push(new Uint8Array(padding));
            storeSize += padding;
        }
        index.push({ tag: entry.tag, type: entry.type, offset: storeSize, count });
        chunks.push(data);
        storeSize += data.byteLength;
    }

    const trailerOffset = storeSize;
    const indexCount = index.length + 1; // the region entry counts itself
    chunks.push(indexEntry(regionTag, RpmType.BIN, -(INDEX_ENTRY_SIZE * indexCount), REGION_COUNT));
    storeSize += INDEX_ENTRY_SIZE;

    const header = new Uint8Array(HEADER_MAGIC.byteLength + 8 + indexCount * INDEX_ENTRY_SIZE + storeSize);
    const view = new DataView(header.buffer);
    header.set(HEADER_MAGIC, 0);
    view.setUint32(8, indexCount);
    view.setUint32(12, storeSize);

    let offset = 16;
    header.set(indexEntry(regionTag, RpmType.BIN, trailerOffset, REGION_COUNT), offset);
    offset += INDEX_ENTRY_SIZE;
    for (const item of index) {
        header.set(indexEntry(item.tag, item.type, item.offset, item.count), offset);
        offset += INDEX_ENTRY_SIZE;
    }
    for (const chunk of chunks) {
        header.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return header;
}

function indexEntry(tag: number, type: RpmType, offset: number, count: number): Uint8Array {
    const bytes = new Uint8Array(INDEX_ENTRY_SIZE);
    const view = new DataView(bytes.buffer);
    view.setInt32(0, tag);
    view.setInt32(4, type);
    view.setInt32(8, offset);
    view.setInt32(12, count);
    return bytes;
}

function encodeValue(type: RpmType, value: RpmValue, tag: number): { data: Uint8Array; count: number } {
    const encoder = new TextEncoder();
    switch (type) {
        case RpmType.STRING: {
            if (typeof value !== 'string') throw typeMismatch(tag, 'a string');
            return { data: encoder.encode(`${value}\0`), count: 1 };
        }
        case RpmType.STRING_ARRAY:
        case RpmType.I18NSTRING: {
            const list = typeof value === 'string' ? [value] : (value as string[]);
            if (!Array.isArray(list)) throw typeMismatch(tag, 'a string array');
            // rpm rejects a zero count, so an empty array is a bug rather than
            // "no value" — the caller must omit the tag instead.
            if (list.length === 0) throw new Error(`gjsify ship: rpm tag ${tag} has an empty array; omit it instead.`);
            return { data: encoder.encode(list.map((item) => `${item}\0`).join('')), count: list.length };
        }
        case RpmType.BIN: {
            if (!(value instanceof Uint8Array)) throw typeMismatch(tag, 'binary data');
            return { data: value, count: value.byteLength };
        }
        case RpmType.INT16:
        case RpmType.INT32: {
            const list = typeof value === 'number' ? [value] : (value as number[]);
            if (!Array.isArray(list)) throw typeMismatch(tag, 'a number array');
            if (list.length === 0) throw new Error(`gjsify ship: rpm tag ${tag} has an empty array; omit it instead.`);
            const width = type === RpmType.INT16 ? 2 : 4;
            const data = new Uint8Array(list.length * width);
            const view = new DataView(data.buffer);
            list.forEach((item, i) => {
                if (type === RpmType.INT16) view.setUint16(i * width, item & 0xffff);
                else view.setUint32(i * width, item >>> 0);
            });
            return { data, count: list.length };
        }
    }
}

function typeMismatch(tag: number, expected: string): Error {
    return new Error(`gjsify ship: internal error — rpm tag ${tag} expects ${expected}.`);
}

/**
 * The 96-byte lead.
 *
 * Legacy: modern rpm validates the magic and the major version and takes
 * everything else from the headers, which is why the name field is allowed to
 * be truncated. It is written because the magic is how `file(1)`, and rpm's
 * own first read, recognise the format at all.
 */
export function buildRpmLead(nevr: string): Uint8Array {
    const lead = new Uint8Array(96);
    const view = new DataView(lead.buffer);
    lead.set([0xed, 0xab, 0xee, 0xdb], 0);
    lead[4] = 3; // major
    lead[5] = 0; // minor
    view.setInt16(6, 0); // type: binary package
    view.setInt16(8, 0); // archnum — informational; the header's ARCH is authoritative
    const name = new TextEncoder().encode(nevr).slice(0, 65);
    lead.set(name, 10);
    view.setInt16(76, 0); // osnum — same story as archnum
    view.setInt16(78, 5); // signature type: header-style signatures
    return lead;
}

/** Pad a signature header to the 8-byte boundary the main header starts on. */
export function padToEight(bytes: Uint8Array): Uint8Array {
    const padding = (8 - (bytes.byteLength % 8)) % 8;
    if (padding === 0) return bytes;
    const out = new Uint8Array(bytes.byteLength + padding);
    out.set(bytes, 0);
    return out;
}
