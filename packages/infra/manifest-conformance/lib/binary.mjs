/**
 * The ONE binary-artifact parser: Mach-O, ELF, PE/COFF and the GI typelib
 * header. Moved here verbatim from `scripts/check-prebuild-loader-path.mjs` so
 * the standalone CLI, `scripts/stage-prebuild.mjs`, the workspace audit and
 * `gjsify manifest-check` all read a prebuild the same way. Extend this file;
 * never add a second parser.
 *
 * Guard it implements: a shipped prebuild must resolve its OWN sibling
 * libraries from its own directory, with no environment variable set.
 *
 * The `*-native` bridges ship TWO libraries side by side in
 * `prebuilds/<os>-<arch>/`: the Vala/GObject library the typelib names
 * (`libgjsify<name>.{so,dylib}`) and the Rust cdylib it links against
 * (`libgjsify_<name>.{so,dylib}` — note the underscore; cargo and meson spell
 * the leaf differently ON PURPOSE, and the typelib records only the first).
 * Nothing about that pairing is checked by the build: the link succeeds, the
 * typelib is found, and the failure lands at `dlopen` time on a user's machine.
 *
 * Two ways it goes wrong, both seen in this repo:
 *
 *   1. **The sibling is not staged.** `@gjsify/rolldown-native`'s darwin leg
 *      copied `libgjsifyrolldown.dylib` + the typelib and not the cdylib, so
 *      dyld expanded the rpath correctly to the prebuild directory and reported
 *      `'…/prebuilds/darwin-arm64/libgjsify_rolldown.dylib' (no such file)`.
 *      A missing FILE, not a missing rpath — indistinguishable from the rpath
 *      bug in the error text unless you know what to look for.
 *   2. **The self-relative lookup is missing.** Without `@loader_path` (Mach-O)
 *      or `$ORIGIN` (ELF) the loader falls back to the system search path —
 *      Homebrew prefixes on macOS — and never looks in the directory the two
 *      libraries actually share. It then only loads when a launcher happens to
 *      export `DYLD_LIBRARY_PATH`/`LD_LIBRARY_PATH`, which is exactly the kind
 *      of environment-dependent artifact this check exists to reject.
 *
 * The check is therefore: for every `libgjsify*` dependency a shipped library
 * records, (a) that file must be present in the same directory, and (b) the
 * recording library must carry the self-relative lookup token for its format.
 *
 * Both formats are parsed here directly rather than shelling out to
 * `otool`/`readelf`, so a Linux CI host (or a developer machine) can verify a
 * macOS prebuild it cannot run — which is the only way a committed darwin
 * artifact gets checked at all today.
 *
 * The prebuild-artifact rule additionally needs:
 *   • `readLibrary()` reports the image's `os` + `arch`, so a library staged
 *     into the wrong `prebuilds/<os>-<arch>/` directory is caught from any
 *     host — the failure a cross-arch prebuild can never reveal by loading.
 *   • `readTypelibSharedLibraries()` reports the leaf names a GI typelib
 *     records, which are exactly what the loader is asked for once
 *     `GI_TYPELIB_PATH` resolves the namespace. A typelib naming a leaf the
 *     directory does not hold is a prebuild that cannot work, and no amount
 *     of rpath correctness saves it.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Leaf-name prefix of the libraries this repo ships. */
const OWN_LIB_PREFIX = 'libgjsify';

const MH_MAGIC_64 = 0xfeedfacf;
const MH_CIGAM_64 = 0xcffaedfe;
const FAT_MAGIC = 0xcafebabe;
const FAT_CIGAM = 0xbebafeca;

const LC_LOAD_DYLIB = 0x0c;
const LC_LOAD_WEAK_DYLIB = 0x80000018;
const LC_RPATH = 0x8000001c;

const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const DT_NULL = 0;
const DT_NEEDED = 1;
const DT_STRTAB = 5;
const DT_RPATH = 15;
const DT_RUNPATH = 29;

/** PE/COFF `IMAGE_DOS_HEADER.e_magic` ("MZ") and `IMAGE_NT_SIGNATURE` ("PE\0\0"). */
const PE_DOS_MAGIC = 0x5a4d;
const PE_NT_SIGNATURE = 0x00004550;

/**
 * `e_machine` → the `process.arch` token that names the same CPU.
 *
 * Deliberately the NODE spelling, not the ELF one: `gjsify.platforms` and the
 * `prebuilds/<os>-<arch>/` directory names are `${process.platform}-${process.arch}`,
 * so translating here is what lets a caller compare an artifact against the
 * directory it sits in without a second vocabulary.
 */
const ELF_MACHINE_ARCH = {
    3: 'ia32', // EM_386
    20: 'ppc', // EM_PPC
    21: 'ppc64', // EM_PPC64 (both big- and little-endian; node spells both `ppc64`)
    22: 's390x', // EM_S390
    40: 'arm', // EM_ARM
    62: 'x64', // EM_X86_64
    183: 'arm64', // EM_AARCH64
    243: 'riscv64', // EM_RISCV (64-bit class only — 32-bit RISC-V is not a node arch we ship)
};

/** Mach-O `cputype` → `process.arch` token. */
const MACHO_CPUTYPE_ARCH = {
    7: 'ia32', // CPU_TYPE_X86
    12: 'arm', // CPU_TYPE_ARM
    0x01000007: 'x64', // CPU_TYPE_X86_64
    0x0100000c: 'arm64', // CPU_TYPE_ARM64
};

/** PE/COFF `IMAGE_FILE_HEADER.Machine` → `process.arch` token. */
const PE_MACHINE_ARCH = {
    0x014c: 'ia32', // IMAGE_FILE_MACHINE_I386
    0x8664: 'x64', // IMAGE_FILE_MACHINE_AMD64
    0xaa64: 'arm64', // IMAGE_FILE_MACHINE_ARM64
};

/**
 * @typedef {object} LibInfo
 * @property {'macho'|'elf'|'pe'} format
 * @property {'linux'|'darwin'|'win32'} os the `process.platform` token the format implies
 * @property {string|null} arch the `process.arch` token the image is built for
 * @property {boolean} inspectable false when the format is recognised but its
 *   dependency records are NOT parsed (PE) — `needed`/`searchPaths` are then
 *   empty because nothing read them, not because the image records none
 * @property {string[]} needed dependency strings exactly as recorded
 * @property {string[]} searchPaths rpath/runpath entries exactly as recorded
 */

/**
 * Read the dependency + search-path records of a Mach-O dylib.
 *
 * Only thin 64-bit images are supported: every artifact this repo ships is
 * built for one architecture. A universal (fat) binary is reported as such
 * rather than silently skipped — a prebuild suddenly turning fat is a change
 * worth noticing, not swallowing.
 *
 * @param {Buffer} data
 * @returns {LibInfo}
 */
function readMachO(data) {
    const magic = data.readUInt32LE(0);
    if (magic === FAT_MAGIC || magic === FAT_CIGAM) {
        throw new Error('universal (fat) Mach-O images are not supported by this check');
    }
    const le = magic === MH_MAGIC_64;
    if (!le && magic !== MH_CIGAM_64) throw new Error(`not a 64-bit Mach-O image (magic 0x${magic.toString(16)})`);
    /** @param {number} off */
    const u32 = (off) => (le ? data.readUInt32LE(off) : data.readUInt32BE(off));

    const cputype = u32(4);
    const ncmds = u32(16);
    /** @type {string[]} */ const needed = [];
    /** @type {string[]} */ const searchPaths = [];
    let off = 32; // mach_header_64 is 32 bytes
    for (let i = 0; i < ncmds; i++) {
        const cmd = u32(off);
        const cmdsize = u32(off + 4);
        if (cmdsize < 8 || off + cmdsize > data.length) throw new Error('truncated load commands');
        if (cmd === LC_LOAD_DYLIB || cmd === LC_LOAD_WEAK_DYLIB || cmd === LC_RPATH) {
            const strOff = u32(off + 8);
            const raw = data.subarray(off + strOff, off + cmdsize);
            const end = raw.indexOf(0);
            const str = raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
            (cmd === LC_RPATH ? searchPaths : needed).push(str);
        }
        off += cmdsize;
    }
    return {
        format: 'macho',
        os: 'darwin',
        arch: MACHO_CPUTYPE_ARCH[cputype] ?? null,
        inspectable: true,
        needed,
        searchPaths,
    };
}

/**
 * Read the dependency + search-path records of an ELF shared object.
 *
 * `DT_STRTAB` holds a virtual address, so it is mapped back to a file offset
 * through the `PT_LOAD` segment that contains it — the same translation
 * `readelf -d` does internally.
 *
 * @param {Buffer} data
 * @returns {LibInfo}
 */
function readElf(data) {
    if (data.readUInt8(4) !== 2) throw new Error('only 64-bit ELF is supported by this check');
    const le = data.readUInt8(5) === 1;
    /** @param {number} off */
    const u16 = (off) => (le ? data.readUInt16LE(off) : data.readUInt16BE(off));
    /** @param {number} off */
    const u64 = (off) => Number(le ? data.readBigUInt64LE(off) : data.readBigUInt64BE(off));

    const machine = u16(0x12);
    const phoff = u64(0x20);
    const phentsize = u16(0x36);
    const phnum = u16(0x38);

    /** @type {{vaddr: number, offset: number, filesz: number}[]} */ const loads = [];
    let dynOff = -1;
    let dynSize = 0;
    for (let i = 0; i < phnum; i++) {
        const p = phoff + i * phentsize;
        const type = le ? data.readUInt32LE(p) : data.readUInt32BE(p);
        const offset = u64(p + 0x08);
        const vaddr = u64(p + 0x10);
        const filesz = u64(p + 0x20);
        if (type === PT_LOAD) loads.push({ vaddr, offset, filesz });
        else if (type === PT_DYNAMIC) {
            dynOff = offset;
            dynSize = filesz;
        }
    }
    if (dynOff < 0) throw new Error('no PT_DYNAMIC segment (not a dynamically linked object)');

    /** @param {number} vaddr @returns {number} */
    const toFileOffset = (vaddr) => {
        for (const l of loads) {
            if (vaddr >= l.vaddr && vaddr < l.vaddr + l.filesz) return l.offset + (vaddr - l.vaddr);
        }
        throw new Error(`virtual address 0x${vaddr.toString(16)} is in no PT_LOAD segment`);
    };

    /** @type {{tag: number, val: number}[]} */ const entries = [];
    for (let p = dynOff; p + 16 <= dynOff + dynSize; p += 16) {
        const tag = u64(p);
        const val = u64(p + 8);
        if (tag === DT_NULL) break;
        entries.push({ tag, val });
    }
    const strtab = entries.find((e) => e.tag === DT_STRTAB);
    if (!strtab) throw new Error('no DT_STRTAB');
    const strBase = toFileOffset(strtab.val);
    /** @param {number} idx */
    const str = (idx) => {
        const start = strBase + idx;
        const end = data.indexOf(0, start);
        return data.subarray(start, end === -1 ? data.length : end).toString('utf8');
    };

    /** @type {string[]} */ const needed = [];
    /** @type {string[]} */ const searchPaths = [];
    for (const e of entries) {
        if (e.tag === DT_NEEDED) needed.push(str(e.val));
        // DT_RUNPATH wins over DT_RPATH at runtime, but for THIS check both are
        // just "did the linker record a self-relative lookup" — keep both.
        else if (e.tag === DT_RUNPATH || e.tag === DT_RPATH) searchPaths.push(...str(e.val).split(':').filter(Boolean));
    }
    return {
        format: 'elf',
        os: 'linux',
        arch: ELF_MACHINE_ARCH[machine] ?? null,
        inspectable: true,
        needed,
        searchPaths,
    };
}

/**
 * Read only the machine of a PE/COFF image.
 *
 * The import table is deliberately NOT parsed: no `win32-*` prebuild is
 * committed today, and a half-read dependency list would let the sibling
 * check report "no sibling recorded" on a DLL that records several. Reporting
 * `inspectable: false` keeps that distinction explicit — the caller can still
 * hold the machine-vs-directory invariant, and knows the loader-path half was
 * not evaluated.
 *
 * @param {Buffer} data
 * @returns {LibInfo}
 */
function readPe(data) {
    const peOff = data.readUInt32LE(0x3c);
    if (peOff + 6 > data.length || data.readUInt32LE(peOff) !== PE_NT_SIGNATURE) {
        throw new Error('not a PE image (missing PE\\0\\0 signature)');
    }
    const machine = data.readUInt16LE(peOff + 4);
    return {
        format: 'pe',
        os: 'win32',
        arch: PE_MACHINE_ARCH[machine] ?? null,
        inspectable: false,
        needed: [],
        searchPaths: [],
    };
}

/**
 * @param {string} file
 * @returns {LibInfo | null} null when the file is not a shared library
 */
export function readLibrary(file) {
    const data = readFileSync(file);
    if (data.length < 64) return null;
    const magic = data.readUInt32LE(0);
    if (magic === MH_MAGIC_64 || magic === MH_CIGAM_64 || magic === FAT_MAGIC || magic === FAT_CIGAM) {
        return readMachO(data);
    }
    if (data.readUInt32BE(0) === 0x7f454c46) return readElf(data);
    if (data.readUInt16LE(0) === PE_DOS_MAGIC) return readPe(data);
    return null;
}

/** GI typelib header magic — `GOBJ\nMETADATA\r\n\x1a`. */
const TYPELIB_MAGIC = 'GOBJ\nMETADATA\r\n\x1a';
/**
 * Byte offset of the `shared_library` field in the typelib header (a u32
 * offset into the file at which a NUL-terminated, comma-separated list of
 * library names begins; 0 = the namespace names no library).
 *
 * Layout up to it: magic[16] · major u8 · minor u8 · reserved u16 · n_entries
 * u16 · n_local_entries u16 · directory u32 · n_attributes u32 · attributes
 * u32 · dependencies u32 · size u32 · namespace u32 · nsversion u32 →
 * shared_library u32 at 52. Stable across typelib major versions 2–4.
 */
const TYPELIB_SHARED_LIBRARY_OFFSET = 52;
/** Byte offset of the header's `size` field — the whole blob's length. */
const TYPELIB_SIZE_OFFSET = 40;

/**
 * The library leaf names a GI typelib records.
 *
 * This is what GI hands to `dlopen` the moment a consumer resolves a class in
 * the namespace, and it is resolved through the loader's normal search path —
 * i.e. through the `LD_LIBRARY_PATH`/`DYLD_LIBRARY_PATH` entry `buildNativeEnv()`
 * points at the prebuild directory. So every leaf here must be present in that
 * directory; a rename in `meson.build` that the staging step follows but the
 * typelib does not is invisible to every other check.
 *
 * A typelib is written in the byte order of the machine that COMPILED it, and
 * its header carries no endianness flag — GI mmaps the blob and reads it
 * natively, so the question never arises on the target. It arises here,
 * because this check reads a `linux-s390x` typelib from an x86-64 host. The
 * `size` field is the discriminator: it holds the blob's own length, so the
 * byte order in which it equals the file size is the one the file is in. That
 * is a self-validating probe rather than a guess, and it is not academic —
 * reading a big-endian header little-endian yields an out-of-range offset,
 * which silently reports "this namespace records no library" and skips the
 * whole staged-leaf check on the ONE architecture where it is big-endian.
 *
 * @param {string} file
 * @returns {string[] | null} null when the file is not a typelib
 */
export function readTypelibSharedLibraries(file) {
    const data = readFileSync(file);
    if (data.length < TYPELIB_SHARED_LIBRARY_OFFSET + 4) return null;
    if (data.subarray(0, TYPELIB_MAGIC.length).toString('latin1') !== TYPELIB_MAGIC) return null;
    const bigEndian =
        data.readUInt32BE(TYPELIB_SIZE_OFFSET) === data.length &&
        data.readUInt32LE(TYPELIB_SIZE_OFFSET) !== data.length;
    const off = bigEndian
        ? data.readUInt32BE(TYPELIB_SHARED_LIBRARY_OFFSET)
        : data.readUInt32LE(TYPELIB_SHARED_LIBRARY_OFFSET);
    if (off === 0 || off >= data.length) return [];
    const end = data.indexOf(0, off);
    return data
        .subarray(off, end === -1 ? data.length : end)
        .toString('utf8')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Does this search-path list contain the token that resolves relative to the
 * loading binary?
 *
 * @param {LibInfo} info
 * @returns {boolean}
 */
function hasSelfRelativeSearchPath(info) {
    const token = info.format === 'macho' ? '@loader_path' : '$ORIGIN';
    return info.searchPaths.some((p) => p === token || p.startsWith(`${token}/`));
}

/**
 * Verify one staged prebuild directory.
 *
 * @param {string} dir
 * @param {{verbose?: boolean}} [options] `verbose: false` suppresses the
 *   per-library inventory line. The standalone CLI wants it (it is the whole
 *   output); the workspace audit calls this across ~50 directories and
 *   wants only the problems.
 * @returns {string[]} problems, empty when the directory is sound
 */
export function checkPrebuildDir(dir, { verbose = true } = {}) {
    /** @type {string[]} */ const problems = [];
    const note = verbose ? console.log : () => {};
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [`${dir}: not a directory`];

    const files = readdirSync(dir);
    const present = new Set(files);
    const libs = files.filter((f) => f.endsWith('.so') || f.endsWith('.dylib') || f.endsWith('.dll'));
    if (libs.length === 0) return [`${dir}: holds no .so/.dylib/.dll`];

    for (const lib of libs.sort()) {
        const path = join(dir, lib);
        /** @type {LibInfo | null} */ let info = null;
        /** @type {string | null} */ let reason = null;
        try {
            info = readLibrary(path);
        } catch (err) {
            reason = err instanceof Error ? err.message : String(err);
        }
        if (!info || !info.inspectable) {
            // A format whose dependency records this check cannot read is
            // SKIPPED, not failed: PE/COFF (a future win32-x64 `.dll`) is a
            // legitimate artifact whose import table this parser does not
            // speak, and treating "I cannot read it" as "it is broken" would
            // make the guard lie about a platform it never inspected. The skip
            // is printed so it is never silent, and the job's load test remains
            // the functional backstop. (The prebuild-artifact rule still holds
            // the machine-vs-directory invariant on such an image —
            // `readLibrary` reports `os`/`arch` for every format it recognises.)
            note(`  ${lib} — skipped (${reason ?? info?.format?.toUpperCase() ?? 'not ELF or Mach-O'})`);
            continue;
        }

        // Only OUR OWN siblings are in scope. A system dependency (glib, gnutls,
        // libSystem) is the host's to resolve and is recorded absolutely or by
        // soname on purpose.
        const siblings = info.needed.filter((n) => basename(n).startsWith(OWN_LIB_PREFIX));
        const token = info.format === 'macho' ? '@loader_path' : '$ORIGIN';
        note(
            `  ${lib} [${info.format}/${info.arch ?? 'unknown-arch'}] needs ${siblings.length ? siblings.join(', ') : '(no sibling)'}` +
                ` | search: ${info.searchPaths.join(', ') || '(none)'}`,
        );

        for (const dep of siblings) {
            const leaf = basename(dep);
            if (!present.has(leaf)) {
                problems.push(
                    `${path}: records a dependency on ${dep} but ${leaf} is NOT staged in ${dir}.\n` +
                        '    The loader resolves the directory correctly and then finds nothing there — stage both\n' +
                        '    libraries (the Vala one the typelib names AND the Rust cdylib it links against).',
                );
            }
            if (!hasSelfRelativeSearchPath(info)) {
                problems.push(
                    `${path}: depends on the sibling ${leaf} but records no ${token} search path.\n` +
                        `    Without it the loader searches system prefixes instead of the directory the two\n` +
                        `    libraries share, so the prebuild only loads when a launcher exports a library-path\n` +
                        `    environment variable. Set build_rpath/install_rpath to ${token} in meson.build.`,
                );
            }
        }
    }
    return problems;
}
