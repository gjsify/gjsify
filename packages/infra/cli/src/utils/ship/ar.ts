// The `ar` container a `.deb` is.
//
// Two hundred lines of dependency avoided: a Debian package is an ar archive of
// exactly three members, and the format is a text header per member with no
// index, no compression and no symbol table. Writing it here keeps `gjsify
// ship` free of `dpkg-deb` — which matters beyond convenience, because this
// project's CI runs on Fedora and `dpkg-deb` is not installable there without
// dragging in a foreign package manager. The same reasoning produced
// `gjsify flatpak sources` (a Node-free reader replacing
// `flatpak-node-generator`), and it has the same payoff: the packer runs
// wherever the CLI runs, including under GJS.

export interface ArMember {
    /** Member name, at most 16 bytes. */
    name: string;
    /** Member contents. */
    data: Uint8Array;
    /** Unix mtime in seconds. Default 0 — deterministic archives. */
    mtime?: number;
    /** POSIX mode. Default 0o100644. */
    mode?: number;
}

const GLOBAL_HEADER = '!<arch>\n';
const HEADER_SIZE = 60;

/**
 * Build an ar archive.
 *
 * Names are written space-padded with NO trailing `/`: that is what
 * `dpkg-deb -b` emits and what dpkg's own reader expects for a `.deb`. The
 * GNU `<name>/` convention and the BSD `#1/<len>` long-name extension are both
 * for archives with names longer than 15 bytes — a `.deb`'s three members are
 * `debian-binary`, `control.tar.<ext>` and `data.tar.<ext>`, all short, so
 * neither extension can arise and refusing a long name is honest.
 */
export function createArArchive(members: readonly ArMember[]): Uint8Array {
    const chunks: Uint8Array[] = [encodeAscii(GLOBAL_HEADER)];
    for (const member of members) {
        chunks.push(buildMemberHeader(member));
        chunks.push(member.data);
        // Members are aligned to an even offset; the pad byte is `\n`.
        if (member.data.byteLength % 2 === 1) chunks.push(encodeAscii('\n'));
    }
    return concat(chunks);
}

function buildMemberHeader(member: ArMember): Uint8Array {
    const bytes = new TextEncoder().encode(member.name);
    if (bytes.byteLength > 16) {
        throw new Error(`gjsify ship: ar member name "${member.name}" is longer than the 16-byte name field.`);
    }
    const header =
        pad(member.name, 16) +
        pad(String(member.mtime ?? 0), 12) +
        pad('0', 6) + // uid
        pad('0', 6) + // gid
        pad((member.mode ?? 0o100644).toString(8), 8) +
        pad(String(member.data.byteLength), 10) +
        '`\n';
    if (header.length !== HEADER_SIZE) {
        throw new Error(`gjsify ship: internal error — ar header is ${header.length} bytes, expected ${HEADER_SIZE}.`);
    }
    return encodeAscii(header);
}

function pad(value: string, width: number): string {
    if (value.length > width) {
        throw new Error(`gjsify ship: ar header field "${value}" does not fit in ${width} bytes.`);
    }
    return value.padEnd(width, ' ');
}

function encodeAscii(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
    let total = 0;
    for (const chunk of chunks) total += chunk.byteLength;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}
