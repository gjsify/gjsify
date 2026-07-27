#!/usr/bin/env node
/**
 * Guard: a shipped prebuild must resolve its OWN sibling libraries from its own
 * directory, with no environment variable set.
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
 * Usage: node scripts/check-prebuild-loader-path.mjs <dir> [<dir> …]
 *        node scripts/check-prebuild-loader-path.mjs packages/infra/oxfmt-native/prebuilds/darwin-arm64
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

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

/**
 * @typedef {object} LibInfo
 * @property {'macho'|'elf'} format
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
    return { format: 'macho', needed, searchPaths };
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
    return { format: 'elf', needed, searchPaths };
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
    return null;
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
 * @returns {string[]} problems, empty when the directory is sound
 */
export function checkPrebuildDir(dir) {
    /** @type {string[]} */ const problems = [];
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [`${dir}: not a directory`];

    const files = readdirSync(dir);
    const present = new Set(files);
    const libs = files.filter((f) => f.endsWith('.so') || f.endsWith('.dylib'));
    if (libs.length === 0) return [`${dir}: holds no .so/.dylib`];

    for (const lib of libs.sort()) {
        const path = join(dir, lib);
        /** @type {LibInfo | null} */ let info;
        try {
            info = readLibrary(path);
        } catch (err) {
            problems.push(`${path}: ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }
        if (!info) {
            problems.push(`${path}: not a recognised ELF/Mach-O shared library`);
            continue;
        }

        // Only OUR OWN siblings are in scope. A system dependency (glib, gnutls,
        // libSystem) is the host's to resolve and is recorded absolutely or by
        // soname on purpose.
        const siblings = info.needed.filter((n) => basename(n).startsWith(OWN_LIB_PREFIX));
        const token = info.format === 'macho' ? '@loader_path' : '$ORIGIN';
        console.log(
            `  ${lib} [${info.format}] needs ${siblings.length ? siblings.join(', ') : '(no sibling)'}` +
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

function main() {
    const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    if (dirs.length === 0) {
        console.error('usage: node scripts/check-prebuild-loader-path.mjs <prebuild-dir> [<prebuild-dir> …]');
        process.exit(2);
    }
    /** @type {string[]} */ const problems = [];
    for (const d of dirs) {
        const dir = resolve(d);
        console.log(`[check-prebuild-loader-path] ${d}`);
        problems.push(...checkPrebuildDir(dir));
    }
    if (problems.length > 0) {
        console.error('\n[check-prebuild-loader-path] FAILED:');
        for (const p of problems) console.error(`  ✗ ${p}`);
        process.exit(1);
    }
    console.log(`[check-prebuild-loader-path] OK — ${dirs.length} director${dirs.length === 1 ? 'y' : 'ies'} sound`);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('check-prebuild-loader-path.mjs')) main();
