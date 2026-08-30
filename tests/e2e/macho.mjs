// One synthetic Mach-O writer, for every e2e suite that needs a darwin image on Linux.
//
// WHY SYNTHESISE AT ALL. These suites run on a Linux CI host that can neither
// execute nor edit a Mach-O, and the readers under test — `checkPrebuildDir` and
// `readLibrary` in `packages/infra/manifest-conformance/lib/binary.mjs` — read
// exactly the part a minimal image has: the 32-byte `mach_header_64` and the load
// commands after it. Producing the fixtures with `install_name_tool` would make
// the one check that guards macOS runnable only ON macOS.
//
// WHY IT IS SHARED. `tests/e2e/prebuild-loader-path` had this writer inline, and
// `tests/e2e/ship-macos` needs the same bytes for a different question — that one
// builds LEAK shapes (an absolute `LC_LOAD_DYLIB`, an absolute `LC_ID_DYLIB`) for
// a check that must refuse them; this one builds a self-contained CLOSURE whose
// every dependency resolves inside the staged tree. Two questions, one file
// format, and a second copy of a binary writer is a second set of bytes that
// drifts — which is the same argument `scripts/check-e2e-harness-duplication.mjs`
// makes about the npm harness, applied one format over.
//
// The `cpuType` parameter is what the second consumer needed and the inline copy
// could not give: a `darwin-arm64` staged tree has to be distinguishable from a
// `darwin-x64` one by a reader, or `assertPayloadMatchesArch` is asserting about
// a constant.

/** `mach_header_64` magic, little-endian host order. */
export const MH_MAGIC_64 = 0xfeedfacf;

/** `cputype` values, in the `process.arch` spelling this repo uses everywhere else. */
export const CPU_TYPE = Object.freeze({ x64: 0x01000007, arm64: 0x0100000c });

export const LC_ID_DYLIB = 0x0d;
export const LC_LOAD_DYLIB = 0x0c;
export const LC_RPATH = 0x8000001c;
export const LC_CODE_SIGNATURE = 0x1d;
export const LC_SEGMENT_64 = 0x19;
export const LC_UUID = 0x1b;

/** `/usr/lib/libSystem.B.dylib` — on every real image, and legitimately absolute. */
export const SYSTEM_DYLIB = { cmd: LC_LOAD_DYLIB, str: '/usr/lib/libSystem.B.dylib' };

/**
 * A thin 64-bit Mach-O carrying `commands` and nothing else.
 *
 * @param {Array<{cmd: number, str?: string}>} commands
 * @param {{ arch?: 'x64' | 'arm64' }} [options]
 * @returns {Buffer}
 */
export function machO(commands, { arch = 'x64' } = {}) {
    const header = Buffer.alloc(32);
    header.writeUInt32LE(MH_MAGIC_64, 0);
    header.writeUInt32LE(CPU_TYPE[arch], 4);
    header.writeUInt32LE(commands.length, 16);

    const blocks = commands.map(({ cmd, str }) => {
        // `LC_CODE_SIGNATURE` is a `linkedit_data_command`: 16 bytes, no string.
        // Its PRESENCE is the whole record `readLibrary` reports (ADR 0024 § A4
        // counted 106 of 106 images carrying one), so the offsets it points at do
        // not have to be real for the reader to answer.
        if (cmd === LC_CODE_SIGNATURE) {
            const b = Buffer.alloc(16);
            b.writeUInt32LE(cmd >>> 0, 0);
            b.writeUInt32LE(16, 4);
            return b;
        }
        // `dylib_command` has 24 bytes of fixed fields before the string,
        // `rpath_command` 12. Padded to an 8-byte multiple exactly as ld does.
        const text = str ?? '';
        const strOff = cmd === LC_RPATH ? 12 : 24;
        const size = Math.ceil((strOff + text.length + 1) / 8) * 8;
        const b = Buffer.alloc(size);
        b.writeUInt32LE(cmd >>> 0, 0);
        b.writeUInt32LE(size, 4);
        b.writeUInt32LE(strOff, 8);
        b.write(text, strOff, 'utf8');
        return b;
    });
    return Buffer.concat([header, ...blocks]);
}

// ── A SIGNED image, for the comparator that reads a re-sign back ─────────────
//
// {@link machO} above answers "which load commands does this image carry", which
// is the whole of what `readLibrary` and `checkPrebuildDir` ask — so its
// `LC_CODE_SIGNATURE` is a 16-byte record whose offsets point nowhere, and that
// is correct for those readers.
//
// `compareMachOAfterResign` asks a different question — "is this image identical
// outside its signature" — and cannot be answered from a record that points
// nowhere: it reads `dataoff` to find where the non-signature content ENDS, and
// `__LINKEDIT`'s size fields to know which two 8-byte fields a longer signature
// is allowed to move. So this builder emits a real layout. It lives HERE and not
// in the suite that needs it for the reason this file's header already gives: a
// second copy of a binary writer is a second set of bytes that drifts.
//
// Watching that comparator FAIL needs an image whose signature can be replaced on
// demand and whose `__TEXT` can be corrupted by one byte, and on Linux — where
// every CI leg is — there is no `codesign` to make one with. The macOS leg drives
// the same comparator with Apple's own `codesign` over a real payload; neither
// substitutes for the other.

/** `mach_header_64` (32) + two `segment_command_64` (72 each) + `LC_UUID` (24) + `LC_CODE_SIGNATURE` (16). */
const SIGNED_SIZEOFCMDS = 72 * 2 + 24 + 16;
/** Where `__TEXT`'s payload starts — and therefore where a one-byte corruption goes. */
export const TEXT_BODY_OFFSET = 32 + SIGNED_SIZEOFCMDS;
/** `__LINKEDIT`'s file offset. Fixed, so a re-sign moves only what follows it. */
const LINKEDIT_OFFSET = 512;

/** One `segment_command_64` with no sections. */
function segment(name, fileoff, filesize) {
    const buf = Buffer.alloc(72);
    buf.writeUInt32LE(LC_SEGMENT_64, 0);
    buf.writeUInt32LE(72, 4);
    buf.write(name, 8, 16, 'utf8');
    buf.writeBigUInt64LE(BigInt(fileoff), 24); // vmaddr
    buf.writeBigUInt64LE(BigInt(filesize), 32); // vmsize
    buf.writeBigUInt64LE(BigInt(fileoff), 40); // fileoff
    buf.writeBigUInt64LE(BigInt(filesize), 48); // filesize
    return buf;
}

/**
 * A thin 64-bit Mach-O whose `__LINKEDIT` ends in `signature`.
 *
 * Deliberately not loadable: nothing here has to run, and a fixture that also had
 * to be a working dylib would need a toolchain the Linux legs do not have for a
 * property nothing reads.
 *
 * @param {{ signature: Buffer, uuid: Buffer, code?: Buffer, linkedit?: Buffer, arch?: 'x64' | 'arm64' }} parts
 * @returns {Buffer}
 */
export function signedMachO(parts) {
    const linkeditBody = parts.linkedit ?? Buffer.from('linkedit-body-bytes');
    const dataoff = LINKEDIT_OFFSET + linkeditBody.length;

    const header = Buffer.alloc(32);
    header.writeUInt32LE(MH_MAGIC_64, 0);
    header.writeUInt32LE(CPU_TYPE[parts.arch ?? 'arm64'], 4);
    header.writeUInt32LE(6, 12); // MH_DYLIB
    header.writeUInt32LE(4, 16); // ncmds
    header.writeUInt32LE(SIGNED_SIZEOFCMDS, 20);

    const uuid = Buffer.alloc(24);
    uuid.writeUInt32LE(LC_UUID, 0);
    uuid.writeUInt32LE(24, 4);
    parts.uuid.copy(uuid, 8, 0, 16);

    const sigCmd = Buffer.alloc(16);
    sigCmd.writeUInt32LE(LC_CODE_SIGNATURE, 0);
    sigCmd.writeUInt32LE(16, 4);
    sigCmd.writeUInt32LE(dataoff, 8);
    sigCmd.writeUInt32LE(parts.signature.length, 12);

    const head = Buffer.concat([
        header,
        segment('__TEXT', 0, LINKEDIT_OFFSET),
        segment('__LINKEDIT', LINKEDIT_OFFSET, linkeditBody.length + parts.signature.length),
        uuid,
        sigCmd,
    ]);
    const text = Buffer.alloc(LINKEDIT_OFFSET - head.length, 0x90);
    (parts.code ?? Buffer.from('gjsify-ship-signing-fixture')).copy(text, 0);
    return Buffer.concat([head, text, linkeditBody, parts.signature]);
}
