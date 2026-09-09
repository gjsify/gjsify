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
 *
 * The libc axis (`prebuild-libc`) adds two more readers, and they exist for the
 * same reason the two above do: the answer was previously HAND-MAINTAINED.
 * "which libc does this bridge need" and "how old a glibc still loads it" were
 * facts nobody had measured — the tree said `libc` nowhere, and the one number
 * that actually bounds the whole Linux floor (`@gjsify/lightningcss-native`'s
 * `GLIBC_2.39`, i.e. Ubuntu 24.04 / Debian 13) was invisible until it was read
 * out of the binary. Both are properties OF THE FILE, so they belong here:
 *   • `readElfNeeded()` — the DT_NEEDED leaf names. A bridge that does not
 *     record `libc.so.6` at all links only GLib/GObject/GIO (plus GnuTLS resp.
 *     GStreamer) and therefore runs against whatever libc the host's GLib was
 *     built for, glibc or musl. That is a real, checkable distinction: it is
 *     the difference between `libc: ["glibc"]` and no `libc` field at all.
 *   • `readElfGlibcRequires()` — the highest `GLIBC_<x.y>` symbol version the
 *     image REQUIRES, out of `SHT_GNU_verneed`. This is the actual glibc floor
 *     the dynamic linker enforces; a declared `gjsify.glibcRequires` below it
 *     is a promise the artifact cannot keep.
 *
 * Both are deliberately implemented HERE rather than by shelling out to
 * `readelf`/`objdump`, for the reason the whole file exists: a Linux x86-64 host
 * has to read a `linux-riscv64` (and a `linux-s390x` big-endian) artifact it
 * cannot execute, and `readelf` is not guaranteed to be installed on a bare CI
 * runner. Unlike the loader-path check they also have to cope with ELF32 —
 * nothing in the tree ships a 32-bit prebuild today, but these two readers are
 * the ones a consumer would point at an `ia32`/`arm` binding, and a parser that
 * silently mis-reads a class it does not support is worse than one that says so.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Leaf-name prefix of the libraries this repo ships. */
const OWN_LIB_PREFIX = 'libgjsify';

const MH_MAGIC_64 = 0xfeedfacf;
const MH_CIGAM_64 = 0xcffaedfe;
const FAT_MAGIC = 0xcafebabe;
const FAT_CIGAM = 0xbebafeca;

const LC_ID_DYLIB = 0x0d;
const LC_LOAD_DYLIB = 0x0c;
const LC_LOAD_WEAK_DYLIB = 0x80000018;
const LC_RPATH = 0x8000001c;
const LC_CODE_SIGNATURE = 0x1d;

/**
 * The two roots a Mach-O may name absolutely and still be portable.
 *
 * Everything under them ships with macOS itself, at a path Apple guarantees;
 * `/usr/lib/libSystem.B.dylib` is on every image here and must stay absolute.
 * Any OTHER absolute path is a fact about the machine that ran the linker.
 */
const SYSTEM_DYLIB_ROOTS = ['/usr/lib/', '/System/'];

/**
 * Does this Mach-O load-command string name an absolute path that only the
 * BUILD HOST is known to have?
 *
 * The whole point of the predicate is that it is DERIVED rather than a list of
 * prefixes to grep for. A `/opt/homebrew` test is vacuously false on an Intel
 * runner (whose prefix is `/usr/local`) and vice versa, so a hardcoded pair
 * would pass on both arches while proving nothing about either — the same trap
 * `build-gtk-runtime-darwin.mjs` § 3 names. It also catches MacPorts
 * (`/opt/local`), a non-default `HOMEBREW_PREFIX`, and `/Users/<someone>/…`
 * without anyone having to think of them first.
 *
 * `@rpath`, `@loader_path` and `@executable_path` are relative BY CONSTRUCTION
 * and never absolute, so the leading-slash test is the whole discriminator.
 *
 * @param {string} p a load-command string exactly as recorded
 * @returns {boolean}
 */
export function isBuildHostAbsolutePath(p) {
    if (!p.startsWith('/')) return false;
    return !SYSTEM_DYLIB_ROOTS.some((root) => p.startsWith(root));
}

const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const DT_NULL = 0;
const DT_NEEDED = 1;
const DT_STRTAB = 5;
const DT_RPATH = 15;
const DT_RUNPATH = 29;

/**
 * Section types the libc axis reads.
 *
 * `SHT_GNU_verneed` (`.gnu.version_r`) is the versioned-symbol REQUIREMENT
 * table — "this image needs symbols tagged `GLIBC_2.39` from `libc.so.6`" — as
 * opposed to `SHT_GNU_verdef` (`0x6ffffffd`, `.gnu.version_d`), which is what a
 * LIBRARY publishes. Reading the wrong one of the two would report a glibc
 * floor of "whatever this bridge itself defines", i.e. nothing, on every
 * artifact — which reads exactly like "no floor" and is why the pair is named
 * here instead of inlined as a magic number.
 */
const SHT_STRTAB = 3;
const SHT_DYNAMIC = 6;
const SHT_GNU_VERNEED = 0x6ffffffe;

/** `e_ident` bytes: 0x7f 'E' 'L' 'F', read big-endian so the compare is one u32. */
const ELF_MAGIC = 0x7f454c46;

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
 * @property {string|null} id the image's OWN recorded name (Mach-O
 *   `LC_ID_DYLIB`); null for a format that has no such record, and for a
 *   Mach-O BUNDLE, which legitimately carries none
 * @property {boolean} signed does the image carry a Mach-O `LC_CODE_SIGNATURE`?
 *   Always false for ELF/PE, which this parser does not read signatures from
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
    // The image's own name. Read alongside the dependencies because it is the
    // same string record and the same failure: an absolute `LC_ID_DYLIB` is a
    // build-host path a consumer links against and cannot resolve. Not
    // hypothetical — librsvg's pixbuf loader ids itself as an absolute keg path,
    // which is why `build-gtk-runtime-darwin.mjs`'s relocate() rewrites the id
    // and not only the deps.
    /** @type {string|null} */ let id = null;
    let signed = false;
    let off = 32; // mach_header_64 is 32 bytes
    for (let i = 0; i < ncmds; i++) {
        const cmd = u32(off);
        const cmdsize = u32(off + 4);
        if (cmdsize < 8 || off + cmdsize > data.length) throw new Error('truncated load commands');
        if (cmd === LC_CODE_SIGNATURE) signed = true;
        if (cmd === LC_LOAD_DYLIB || cmd === LC_LOAD_WEAK_DYLIB || cmd === LC_RPATH || cmd === LC_ID_DYLIB) {
            const strOff = u32(off + 8);
            const raw = data.subarray(off + strOff, off + cmdsize);
            const end = raw.indexOf(0);
            const str = raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
            if (cmd === LC_ID_DYLIB) id = str;
            else (cmd === LC_RPATH ? searchPaths : needed).push(str);
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
        id,
        signed,
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
        // ELF's counterpart is DT_SONAME, which is a bare name by construction
        // and therefore cannot carry a build-host path. Nothing to read.
        id: null,
        signed: false,
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
        id: null,
        signed: false,
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
    if (data.readUInt32BE(0) === ELF_MAGIC) return readElf(data);
    if (data.readUInt16LE(0) === PE_DOS_MAGIC) return readPe(data);
    return null;
}

/**
 * @typedef {object} ElfSection
 * @property {number} type `sh_type`
 * @property {number} offset `sh_offset` — a FILE offset, so no vaddr translation
 * @property {number} size `sh_size`
 * @property {number} link `sh_link` — index of a related section (for
 *   `SHT_DYNAMIC` and `SHT_GNU_verneed`, the string table their names live in)
 * @property {number} info `sh_info` — for `SHT_GNU_verneed`, the Verneed count
 * @property {number} entsize `sh_entsize`
 */

/**
 * Parse an ELF's header + SECTION table, for both classes and both byte orders.
 *
 * Why sections rather than the `PT_DYNAMIC` segment `readElf()` above walks:
 * `.gnu.version_r` has no program-header entry at all, and its string table is
 * named by `sh_link`. Once the section table is being read anyway, `DT_NEEDED`
 * is cheaper to reach the same way — `SHT_DYNAMIC`'s `sh_link` IS the `.dynstr`
 * index, which removes the vaddr→file-offset mapping `readElf()` needs. The two
 * paths coexist on purpose: `readElf()` is a load-bearing, shipped check whose
 * behaviour must not change as a side effect of adding the libc axis.
 *
 * Section NAMES are never resolved, deliberately: everything here selects by
 * `sh_type`, so `.shstrtab` is not consulted and the `SHN_XINDEX` escape
 * (`e_shstrndx == 0xffff` on an object with ≥ 0xff00 sections) cannot arise.
 *
 * @param {Buffer} data
 * @returns {{bits: 32|64, le: boolean, machine: number, sections: ElfSection[], strAt: (sec: ElfSection, idx: number) => string} | null}
 *   null when this is not an ELF image, or is one whose section table was
 *   stripped — the caller MUST treat null as "not measured", never as "measured
 *   and found nothing".
 */
function openElfSections(data) {
    if (data.length < 64) return null;
    if (data.readUInt32BE(0) !== ELF_MAGIC) return null;
    const cls = data.readUInt8(4);
    const enc = data.readUInt8(5);
    if ((cls !== 1 && cls !== 2) || (enc !== 1 && enc !== 2)) return null;
    const bits = cls === 1 ? 32 : 64;
    const le = enc === 1;

    /** @param {number} off */
    const u16 = (off) => (le ? data.readUInt16LE(off) : data.readUInt16BE(off));
    /** @param {number} off */
    const u32 = (off) => (le ? data.readUInt32LE(off) : data.readUInt32BE(off));
    /** @param {number} off */
    const u64 = (off) => Number(le ? data.readBigUInt64LE(off) : data.readBigUInt64BE(off));

    // The two classes differ in the WIDTH of the address/offset fields, not in
    // their order, so every field below is one offset table indexed by class.
    const machine = u16(0x12);
    const shoff = bits === 32 ? u32(0x20) : u64(0x28);
    const shentsize = u16(bits === 32 ? 0x2e : 0x3a);
    let shnum = u16(bits === 32 ? 0x30 : 0x3c);
    if (shoff === 0 || shentsize === 0) return null;
    // `e_shnum == 0` with a non-zero `e_shoff` means the real count did not fit
    // in 16 bits and lives in section 0's `sh_size`. No artifact here is
    // remotely near 65280 sections, but reading 0 sections would report "no
    // DT_NEEDED" on a perfectly normal library, and that answer feeds a
    // "therefore it is libc-agnostic" conclusion — the exact silent-wrongness
    // shape this whole file exists to prevent.
    if (shnum === 0) {
        if (shoff + shentsize > data.length) return null;
        shnum = bits === 32 ? u32(shoff + 0x14) : u64(shoff + 0x20);
        if (shnum === 0) return null;
    }
    if (shoff + shnum * shentsize > data.length) return null;

    /** @type {ElfSection[]} */ const sections = [];
    for (let i = 0; i < shnum; i++) {
        const p = shoff + i * shentsize;
        sections.push({
            type: u32(p + 4),
            offset: bits === 32 ? u32(p + 0x10) : u64(p + 0x18),
            size: bits === 32 ? u32(p + 0x14) : u64(p + 0x20),
            link: u32(bits === 32 ? p + 0x18 : p + 0x28),
            info: u32(bits === 32 ? p + 0x1c : p + 0x2c),
            entsize: bits === 32 ? u32(p + 0x24) : u64(p + 0x38),
        });
    }

    /**
     * Read a NUL-terminated string at `idx` inside a string-table section.
     * Out-of-range indices yield `''` rather than throwing: a malformed index
     * must surface as "this name is empty, so it matched nothing", which the
     * callers report, not as an exception that aborts the whole audit run.
     * @param {ElfSection} sec @param {number} idx
     */
    const strAt = (sec, idx) => {
        const start = sec.offset + idx;
        if (!(idx >= 0) || start >= sec.offset + sec.size || start >= data.length) return '';
        const end = data.indexOf(0, start);
        return data.subarray(start, end === -1 ? data.length : end).toString('utf8');
    };

    return { bits, le, machine, sections, strAt };
}

/**
 * The `DT_NEEDED` dependency LEAF names an ELF shared object records.
 *
 * Leaf names, not the raw strings: a `DT_NEEDED` is normally already a bare
 * soname (`libc.so.6`), but a library linked against an absolute path records
 * that path, and the question every caller asks is "does it need libc at all",
 * which is a question about the leaf.
 *
 * @param {string} file
 * @returns {string[] | null} null when `file` is not an ELF image (or its
 *   section table is unreadable) — i.e. "NOT MEASURED". An empty array means
 *   measured, and the image records no dependency at all (a fully static
 *   object). The distinction is the whole contract: a caller that collapses
 *   null into `[]` concludes "records no libc.so.6" from a file it never read.
 */
export function readElfNeeded(file) {
    const data = readFileSync(file);
    const elf = openElfSections(data);
    if (!elf) return null;
    const dyn = elf.sections.find((s) => s.type === SHT_DYNAMIC);
    if (!dyn) return [];
    const strtab = elf.sections[dyn.link];
    if (!strtab || strtab.type !== SHT_STRTAB) return null;

    const step = elf.bits === 32 ? 8 : 16;
    /** @param {number} off */
    const tagVal = (off) =>
        elf.bits === 32
            ? [
                  elf.le ? data.readUInt32LE(off) : data.readUInt32BE(off),
                  elf.le ? data.readUInt32LE(off + 4) : data.readUInt32BE(off + 4),
              ]
            : [
                  Number(elf.le ? data.readBigUInt64LE(off) : data.readBigUInt64BE(off)),
                  Number(elf.le ? data.readBigUInt64LE(off + 8) : data.readBigUInt64BE(off + 8)),
              ];

    /** @type {string[]} */ const needed = [];
    for (let p = dyn.offset; p + step <= dyn.offset + dyn.size && p + step <= data.length; p += step) {
        const [tag, val] = tagVal(p);
        if (tag === DT_NULL) break;
        if (tag === DT_NEEDED) {
            const name = elf.strAt(strtab, val);
            if (name) needed.push(basename(name));
        }
    }
    return needed;
}

/**
 * Compare two dotted numeric version strings NUMERICALLY.
 *
 * Exported because the glibc floor is compared in two places — the rule reports
 * the measured maximum across an artifact's symbols, and then compares it to a
 * declared `gjsify.glibcRequires` — and both comparisons must agree. A lexical
 * comparison gets this wrong on the most common pair in the actual data:
 * `'2.9' > '2.34'` as strings, so a `2.34` floor would be reported as satisfied
 * by a declaration of `2.9`, and `readElfGlibcRequires` would pick `GLIBC_2.9`
 * as the maximum of a set containing `GLIBC_2.34`.
 *
 * Missing components count as 0, so `2.34` and `2.34.0` are equal.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} negative when a < b, 0 when equal, positive when a > b
 */
export function compareGlibcVersions(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
}

/** A versioned-symbol requirement naming a glibc release, e.g. `GLIBC_2.39`. */
const GLIBC_VERSION_RE = /^GLIBC_(\d+(?:\.\d+)*)$/;

/**
 * The highest glibc symbol version an ELF image REQUIRES — its real floor.
 *
 * This is what the dynamic linker enforces: a binary whose `.gnu.version_r`
 * asks `libc.so.6` for `GLIBC_2.39` symbols refuses to load against an older
 * glibc with `version 'GLIBC_2.39' not found`, no matter how permissive the
 * package's declared support matrix is. Measuring it is the difference between
 * a distro-support claim and a distro-support fact — and the measurement is why
 * `@gjsify/lightningcss-native` turns out to pin this repo's whole Linux floor
 * to Ubuntu 24.04 / Debian 13 single-handedly.
 *
 * `GLIBC_PRIVATE` and `GLIBC_ABI_*` entries are skipped: they are not releases
 * and have no ordering against `2.x`, so including them would make the maximum
 * meaningless (and `Number('PRIVATE')` is `NaN`, which silently loses every
 * comparison).
 *
 * @param {string} file
 * @returns {string | null} the bare version (`'2.34'`), or null when the image
 *   is not ELF, has no `.gnu.version_r`, or requires no `GLIBC_<x.y>` symbol at
 *   all. Callers that need to tell "unreadable" from "genuinely no floor" ask
 *   {@link readElfNeeded} first — it returns null for exactly the unreadable
 *   case and an array for every image this parser understood.
 */
export function readElfGlibcRequires(file) {
    const data = readFileSync(file);
    const elf = openElfSections(data);
    if (!elf) return null;
    const verneed = elf.sections.find((s) => s.type === SHT_GNU_VERNEED);
    if (!verneed) return null;
    const strtab = elf.sections[verneed.link];
    if (!strtab || strtab.type !== SHT_STRTAB) return null;

    /** @param {number} off */
    const u16 = (off) => (elf.le ? data.readUInt16LE(off) : data.readUInt16BE(off));
    /** @param {number} off */
    const u32 = (off) => (elf.le ? data.readUInt32LE(off) : data.readUInt32BE(off));

    /** @type {string | null} */ let max = null;
    // `sh_info` holds the Verneed count; `vn_next`/`vna_next` are byte offsets
    // RELATIVE to the entry they sit in (not absolute, not indices), which is
    // the one detail a hand-rolled walk of this table usually gets wrong.
    let vn = verneed.offset;
    for (let i = 0; i < verneed.info; i++) {
        if (vn + 16 > data.length) break;
        const cnt = u16(vn + 2);
        const auxOff = u32(vn + 8);
        const nextOff = u32(vn + 12);
        let aux = vn + auxOff;
        for (let j = 0; j < cnt; j++) {
            if (aux + 16 > data.length) break;
            const nameIdx = u32(aux + 8);
            const auxNext = u32(aux + 12);
            const m = GLIBC_VERSION_RE.exec(elf.strAt(strtab, nameIdx));
            if (m && (max === null || compareGlibcVersions(m[1], max) > 0)) max = m[1];
            if (auxNext === 0) break;
            aux += auxNext;
        }
        if (nextOff === 0) break;
        vn += nextOff;
    }
    return max;
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

        // THE BUILD HOST MUST NOT SURVIVE INTO THE ARTIFACT (darwin only).
        //
        // ELF records its dependencies by SONAME — a bare name the loader
        // resolves — so a Linux prebuild structurally cannot carry the build
        // machine's paths. Mach-O records the full install path of every
        // dependency, so it does by default, and every darwin prebuild in this
        // tree did: `@gjsify/webgl-darwin-x64` named
        // `/usr/local/opt/glib/lib/libglib-2.0.0.dylib` and the arm64 twin named
        // the same library under `/opt/homebrew`, each matching the DEFAULT
        // Homebrew prefix of the runner that built it. That is correct by
        // coincidence on the common Mac and resolves nothing on any other one.
        //
        // The check runs on the FINISHED artifact rather than on build intent,
        // which is the whole reason it catches this: nothing about the build
        // looked wrong, the libraries loaded on the runner that made them, and
        // the load tests passed on hosts that happened to have Homebrew.
        // Symmetrical to the win32 import-table check (#1096) and to
        // `build-gtk-runtime-darwin.mjs` § 3, which asserts exactly this over
        // the bundle — the prebuilds were the one darwin artifact with no such
        // gate.
        //
        // A HARD dependency fails; a SEARCH PATH is reported. The two are not
        // the same promise: an `LC_LOAD_DYLIB` naming a missing absolute path
        // aborts the load, while an `LC_RPATH` that does not exist is simply
        // skipped by dyld, so keeping the host's Homebrew prefix as a LATER
        // rpath entry is a working fallback rather than a defect. Failing it
        // too would refuse the very artifact this rule wants.
        if (info.format === 'macho') {
            for (const dep of info.needed.filter(isBuildHostAbsolutePath)) {
                problems.push(
                    `${path}: hard-links the build host — \`${dep}\`.\n` +
                        '    A Mach-O records the full install path of each dependency, so this artifact only\n' +
                        '    loads where that exact path exists (the right Homebrew prefix, the right formula\n' +
                        '    installed). Relocate it at stage time: rewrite the load command to `@rpath/<leaf>`\n' +
                        '    and add the rpaths that resolve it — `scripts/relocate-macho.mjs` does both, and\n' +
                        '    `stage-prebuild.mjs` runs it on every darwin target.',
                );
            }
            if (info.id !== null && isBuildHostAbsolutePath(info.id)) {
                problems.push(
                    `${path}: records its OWN name as the build-host path \`${info.id}\`.\n` +
                        '    Anything linking against this library copies that string into its own load\n' +
                        '    command, so the leak propagates to the consumer. Set the id to\n' +
                        `    \`@rpath/${basename(path)}\` (install_name_tool -id).`,
                );
            }
            const hostRpaths = info.searchPaths.filter(isBuildHostAbsolutePath);
            if (hostRpaths.length > 0) {
                note(`  ${lib} — build-host search path(s), FALLBACK ONLY: ${hostRpaths.join(', ')}`);
            }
        }

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

// ─────────────────────────────────────────────────────────────────────────────
// The signed-arrival comparator (ADR 0024 § A4, § A17 — issue #1354 M6).
//
// WHAT IT IS FOR. `gjsify ship --sign` re-signs every Mach-O image INSIDE the
// payload before the container is built, because under hardened runtime a
// Developer-ID-signed main executable will not load ad-hoc-signed dylibs and all
// 106 images in the shipped darwin GTK closure are ad-hoc today. That makes
// signing a MUTATION of a tree somebody already inspected — so the claim that
// has to be checkable is not "the artifact is signed" (Apple's own `codesign
// --verify` answers that) but "signing changed NOTHING ELSE".
//
// Two file classes, two rules, and the second is the whole reason this lives in
// a parser rather than in `sha256sum`:
//
//   * a file that is not a Mach-O image must arrive BYTE-IDENTICAL. A launcher,
//     an `Info.plist`, a `.mo` catalogue, the JavaScript bundle: the signer has
//     no business in any of them, and a digest is the right instrument.
//   * a Mach-O image must be identical OUTSIDE its signature. A digest is
//     structurally unable to say that — every one of the 106 changes — so this
//     reads the load commands and compares what the signature does not own.
//
// WHAT A RE-SIGN IS ALLOWED TO CHANGE, and each entry is a consequence rather
// than a concession made to get a test green:
//
//   1. `LC_CODE_SIGNATURE`'s own record — `dataoff` and `datasize` describe the
//      blob and nothing else.
//   2. the blob at `[dataoff, dataoff + datasize)`.
//   3. `LC_UUID` — named by ADR 0024 § A17's specification of this comparator.
//   4. `__LINKEDIT`'s `filesize`/`vmsize`, because the blob lives inside that
//      segment BY CONSTRUCTION: a signature of a different length moves the
//      segment's end and nothing else. Not in § A17's two-item list, and stated
//      here rather than folded in silently — it is the same fact as (1), read
//      off the segment that contains the thing (1) describes.
//
// Everything else — the mach header, every other load command, every section,
// the whole of `__TEXT` and `__DATA`, and the rest of `__LINKEDIT` — must match
// byte for byte. A change there is a re-signer that rewrote the program.
//
// THIS IS AN INDEPENDENT READER despite living in our own tree, and the
// distinction is worth being exact about because the other `.github/ship-oracle`
// scripts are foreign implementations on purpose. Those check documents THIS
// TREE WRITES (an `Info.plist`, a zip central directory), where our own writer
// would be agreeing with itself. Here the mutation is made by Apple's
// `codesign`, which knows nothing about this file; reading its output with our
// parser compares two independent things. Building a second Mach-O parser in
// CPython beside this one would be the thing this module's header forbids —
// *extend this file; never add a second parser* — and would leave two parsers
// with nothing holding them to each other.

/** `LC_SEGMENT_64`. */
const LC_SEGMENT_64 = 0x19;
/** `LC_UUID`. */
const LC_UUID = 0x1b;

/**
 * @typedef {object} MachOCommand
 * @property {number} cmd the `cmd` field
 * @property {number} offset file offset of the load-command record
 * @property {number} size `cmdsize`
 */

/**
 * @typedef {object} MachOLayout
 * @property {boolean} le little-endian
 * @property {number} ncmds
 * @property {number} sizeofcmds
 * @property {MachOCommand[]} commands
 * @property {{offset: number, dataoff: number, datasize: number} | null} codeSignature
 * @property {MachOCommand | null} uuid
 * @property {{offset: number} | null} linkedit the `__LINKEDIT` `LC_SEGMENT_64` record
 */

/**
 * The load-command LAYOUT of a thin 64-bit Mach-O, with file offsets.
 *
 * A second reader beside {@link readMachO} rather than a widening of it, and the
 * split is the same one `openElfSections` documents one screen up: `readMachO`
 * is a shipped, load-bearing check that answers "what does this image DEPEND
 * on", and it must not change behaviour as a side effect of adding a comparator.
 * This one answers "where is each record in the file", which is a different
 * question and the only one a byte-level diff can be built on.
 *
 * @param {Buffer} data
 * @returns {MachOLayout}
 */
export function readMachOLayout(data) {
    const magic = data.readUInt32LE(0);
    if (magic === FAT_MAGIC || magic === FAT_CIGAM) {
        throw new Error('universal (fat) Mach-O images are not supported by this comparator');
    }
    const le = magic === MH_MAGIC_64;
    if (!le && magic !== MH_CIGAM_64) throw new Error(`not a 64-bit Mach-O image (magic 0x${magic.toString(16)})`);
    /** @param {number} off */
    const u32 = (off) => (le ? data.readUInt32LE(off) : data.readUInt32BE(off));

    const ncmds = u32(16);
    const sizeofcmds = u32(20);
    /** @type {MachOCommand[]} */ const commands = [];
    /** @type {MachOLayout['codeSignature']} */ let codeSignature = null;
    /** @type {MachOCommand | null} */ let uuid = null;
    /** @type {{offset: number} | null} */ let linkedit = null;
    let off = 32; // mach_header_64
    for (let i = 0; i < ncmds; i++) {
        const cmd = u32(off);
        const cmdsize = u32(off + 4);
        if (cmdsize < 8 || off + cmdsize > data.length) throw new Error('truncated load commands');
        commands.push({ cmd, offset: off, size: cmdsize });
        if (cmd === LC_CODE_SIGNATURE) codeSignature = { offset: off, dataoff: u32(off + 8), datasize: u32(off + 12) };
        if (cmd === LC_UUID) uuid = { cmd, offset: off, size: cmdsize };
        if (cmd === LC_SEGMENT_64) {
            // `segname` is 16 bytes at +8, NUL-padded.
            const name = data.subarray(off + 8, off + 24);
            const end = name.indexOf(0);
            if (name.subarray(0, end === -1 ? name.length : end).toString('utf8') === '__LINKEDIT') {
                linkedit = { offset: off };
            }
        }
        off += cmdsize;
    }
    return { le, ncmds, sizeofcmds, commands, codeSignature, uuid, linkedit };
}

/** Blank `[start, start + length)` of a copy, so a diff cannot see it. */
function maskInto(buf, start, length) {
    buf.fill(0, start, Math.min(start + length, buf.length));
}

/**
 * Compare two Mach-O images that should differ only by their signature.
 *
 * @param {Buffer} before
 * @param {Buffer} after
 * @returns {{ verdict: 'identical' | 'signature-only' | 'differs', reasons: string[] }}
 *   `identical` — the bytes are equal, i.e. nothing signed this image.
 *   `signature-only` — equal outside the four regions listed in the header.
 *   `differs` — anything else, with `reasons` naming what and where.
 */
export function compareMachOAfterResign(before, after) {
    if (before.equals(after)) return { verdict: 'identical', reasons: [] };
    /** @type {string[]} */ const reasons = [];
    let a;
    let b;
    try {
        a = readMachOLayout(before);
        b = readMachOLayout(after);
    } catch (error) {
        return { verdict: 'differs', reasons: [`not comparable as Mach-O: ${error.message}`] };
    }
    if (a.ncmds !== b.ncmds || a.sizeofcmds !== b.sizeofcmds) {
        // The unsigned→signed case lands here, and it is reported rather than
        // tolerated: adding `LC_CODE_SIGNATURE` shifts every byte after the
        // header, so "identical outside the signature" is not a statement that
        // can be made about it. The caller decides whether that is expected.
        reasons.push(
            `the load-command table changed: ${a.ncmds} commands / ${a.sizeofcmds} bytes before, ` +
                `${b.ncmds} / ${b.sizeofcmds} after (a signature was ADDED or REMOVED, not replaced)`,
        );
        return { verdict: 'differs', reasons };
    }
    const seqA = a.commands.map((c) => `${c.cmd}:${c.size}`).join(',');
    const seqB = b.commands.map((c) => `${c.cmd}:${c.size}`).join(',');
    if (seqA !== seqB) {
        reasons.push('the load commands are not the same commands in the same order');
        return { verdict: 'differs', reasons };
    }
    if (a.codeSignature === null || b.codeSignature === null) {
        reasons.push(
            a.codeSignature === null
                ? 'the image carried no LC_CODE_SIGNATURE before'
                : 'the image carries no LC_CODE_SIGNATURE after',
        );
        return { verdict: 'differs', reasons };
    }
    if (a.codeSignature.dataoff !== b.codeSignature.dataoff) {
        // Everything that is not the blob ends where the blob starts, so a moved
        // `dataoff` means the program itself changed length. Nothing a re-sign does.
        reasons.push(
            `the signature moved: dataoff ${a.codeSignature.dataoff} before, ${b.codeSignature.dataoff} after — ` +
                'the content in front of it is not the same length',
        );
        return { verdict: 'differs', reasons };
    }
    const cut = a.codeSignature.dataoff;
    const maskedA = Buffer.from(before.subarray(0, cut));
    const maskedB = Buffer.from(after.subarray(0, cut));
    for (const [layout, buf] of [
        [a, maskedA],
        [b, maskedB],
    ]) {
        maskInto(buf, layout.codeSignature.offset, 16); // cmd, cmdsize, dataoff, datasize
        if (layout.uuid !== null) maskInto(buf, layout.uuid.offset, layout.uuid.size);
        // `segment_command_64`: cmd, cmdsize, segname[16], vmaddr, vmsize, fileoff, filesize.
        // `vmsize` is at +32, `filesize` at +48, both 8 bytes.
        if (layout.linkedit !== null) {
            maskInto(buf, layout.linkedit.offset + 32, 8);
            maskInto(buf, layout.linkedit.offset + 48, 8);
        }
    }
    if (maskedA.equals(maskedB)) return { verdict: 'signature-only', reasons: [] };

    // NAME THE OFFSET AND THE COMMAND IT FALLS IN. A comparator that says only
    // "differs" over a 40 MiB dylib cannot be acted on, and the first thing
    // anybody would do is write a second script to find out where.
    let at = -1;
    for (let i = 0; i < cut; i++) {
        if (maskedA[i] !== maskedB[i]) {
            at = i;
            break;
        }
    }
    const inCmd = a.commands.find((c) => at >= c.offset && at < c.offset + c.size);
    reasons.push(
        `first difference outside the signature at file offset ${at} (0x${at.toString(16)}): ` +
            `0x${maskedA[at].toString(16)} → 0x${maskedB[at].toString(16)}` +
            (at < 32
                ? ' — in the mach_header'
                : inCmd !== undefined
                  ? ` — inside load command 0x${inCmd.cmd.toString(16)} at +${at - inCmd.offset}`
                  : ' — in section data or __LINKEDIT'),
    );
    return { verdict: 'differs', reasons };
}
