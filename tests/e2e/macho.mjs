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
