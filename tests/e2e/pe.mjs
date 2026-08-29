// One synthetic PE/COFF writer, for every e2e suite that needs a win32 image on Linux.
//
// WHY SYNTHESISE AT ALL — the same argument `tests/e2e/macho.mjs` makes one OS
// over. `gjsify ship windows` is assembled on Linux (ADR 0024 § A1), the readers
// under test read only the headers, and shipping a real 90 MB `node.exe` or a
// gvsbuild DLL into `tests/` to make an assertion about two `u16` fields would put
// a binary in git for a fact that fits in 64 bytes.
//
// WHAT A READER CAN AND CANNOT GET FROM ONE, and this is the difference from the
// Mach-O writer rather than an omission in this file. A Mach-O records its
// dependencies as `LC_LOAD_DYLIB` strings and its search paths as `LC_RPATH`, so
// `tests/e2e/ship-macos` can assert that every non-system dependency of a staged
// image resolves INSIDE the staged tree — and can watch that assertion go red by
// flattening the tree. A PE records its imports in a data directory reached
// through the section table and the RVA map, and
// `manifest-conformance/lib/binary.mjs` deliberately does not parse it: its
// `readPe` returns `inspectable: false`, `needed: []`, `searchPaths: []`, with the
// reason written down there ("a half-read dependency list would let the sibling
// check report 'no sibling recorded' on a DLL that records several").
//
// So on win32 the reachable Linux-side claims are the MACHINE and the TREE — which
// architecture each staged image is built for, and whether the closure kept the
// shape its loader needs. The claim "every DLL this program directory needs is in
// it" has one reader and it is `LoadLibrary`, on Windows, which is what
// `.github/workflows/node-gi.yml`'s `windows-dir-selfcontained` leg exists for.
// Writing a fixture that pretended otherwise would be the more expensive mistake.

/** `IMAGE_DOS_HEADER.e_magic` — "MZ". */
export const PE_DOS_MAGIC = 0x5a4d;

/** `IMAGE_NT_SIGNATURE` — "PE\0\0", little-endian. */
export const PE_NT_SIGNATURE = 0x00004550;

/** `IMAGE_FILE_HEADER.Machine`, keyed by the `process.arch` spelling this repo uses. */
export const PE_MACHINE = Object.freeze({ ia32: 0x014c, x64: 0x8664, arm64: 0xaa64 });

/** `IMAGE_OPTIONAL_HEADER.Magic` for PE32+ — what every 64-bit Windows image is. */
export const PE32PLUS_MAGIC = 0x20b;

/** `IMAGE_SUBSYSTEM_WINDOWS_GUI` / `_CUI`, the field a GUI launch is decided by. */
export const SUBSYSTEM = Object.freeze({ gui: 2, console: 3 });

/**
 * `IMAGE_FILE_HEADER.Characteristics` bit that says "this image is a DLL".
 *
 * Not read by anything in this repository today. Present so a fixture can be
 * honest about which of its files are libraries and which is the program — the
 * distinction a reader would need the day the import table is parsed.
 */
export const IMAGE_FILE_DLL = 0x2000;

/**
 * A minimal PE32+ image: DOS stub, `PE\0\0`, COFF header, optional header.
 *
 * `e_lfanew` is 0x78, which is what MSVC emits and what a real `node.exe` carries
 * — measured on `node-v24.20.0-win-x64.zip`'s `node.exe`, where the `Subsystem`
 * field therefore lands at 0xd4. Keeping the same offset means a fixture and the
 * real binary are read by the same arithmetic, so a reader that works on one works
 * on the other.
 *
 * @param {{ arch?: 'ia32' | 'x64' | 'arm64', subsystem?: number, dll?: boolean }} [options]
 * @returns {Buffer}
 */
export function pe({ arch = 'x64', subsystem = SUBSYSTEM.console, dll = false } = {}) {
    const peOffset = 0x78;
    // 4 (signature) + 20 (COFF) + 112 (the PE32+ optional header up to and
    // including `NumberOfRvaAndSizes`). No sections: nothing here reads one, and a
    // section table that described no data would be the fixture lying in a
    // direction a future reader could believe.
    const image = Buffer.alloc(peOffset + 4 + 20 + 112);
    image.writeUInt16LE(PE_DOS_MAGIC, 0);
    image.write('This program cannot be run in DOS mode.', 0x40, 'ascii');
    image.writeUInt32LE(peOffset, 0x3c);

    image.writeUInt32LE(PE_NT_SIGNATURE, peOffset);
    const coff = peOffset + 4;
    image.writeUInt16LE(PE_MACHINE[arch], coff);
    image.writeUInt16LE(0, coff + 2); // NumberOfSections
    image.writeUInt16LE(112, coff + 16); // SizeOfOptionalHeader
    image.writeUInt16LE(dll ? IMAGE_FILE_DLL : 0, coff + 18);

    const opt = coff + 20;
    image.writeUInt16LE(PE32PLUS_MAGIC, opt);
    image.writeUInt16LE(subsystem, opt + 68);
    return image;
}
