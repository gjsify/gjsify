// The payload the packers see.
//
// One shape, read back off the staged tree rather than carried in memory from
// the planner. That is deliberate: it makes `gjsify ship --stage` and
// `gjsify ship --target deb` provably the same payload, because the second
// reads what the first wrote. A packer fed straight from the planner could
// drift from the staged tree and nothing would notice.

import { statSync } from 'node:fs';

/** One file in the payload, with its bytes. */
export interface PayloadEntry {
    /** Prefix-relative path, POSIX-separated, e.g. `bin/learn6502`. */
    path: string;
    /** POSIX mode bits. */
    mode: number;
    data: Uint8Array;
}

/**
 * The build stamp every header gets.
 *
 * `SOURCE_DATE_EPOCH` is the cross-ecosystem convention and wins when it is
 * set. Without it the stamp is the BUNDLE's mtime — never `Date.now()`, which
 * is the one input guaranteeing that packing the same tree twice produces
 * different bytes, and never a fixed 0 either: `Build Date: 1 Jan 1970` is
 * what `rpm -qi` then shows a user, and an artifact that looks broken is a
 * support question. The mtime keeps the property that matters (pack the same
 * build twice, get the same bytes) while saying something true.
 *
 * Only the ASSEMBLING host runs this. A stage records the answer it got
 * (`.gjsify-ship-stage.json` → `mtime`) and the packing host reuses it: an
 * artifact upload does not carry mtimes, so re-stat'ing the stage there would
 * stamp every header with "whenever the download finished" and quietly destroy
 * the reproducibility this function exists to protect.
 */
export function buildTimestamp(bundlePath: string, env: Record<string, string | undefined> = process.env): number {
    const raw = env.SOURCE_DATE_EPOCH;
    if (raw !== undefined) {
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 0) {
            throw new Error(`gjsify ship: SOURCE_DATE_EPOCH must be a non-negative integer, got "${raw}".`);
        }
        return parsed;
    }
    return Math.floor(statSync(bundlePath).mtimeMs / 1000);
}

/**
 * What the payload itself says about what it installs.
 *
 * Every field here used to be answered from the SETTINGS — `settings.iconFiles.length > 0`,
 * `settings.schemaFiles.length > 0`, `settings.typelibFiles` — i.e. from lists of absolute paths
 * on the BUILD host. Two things were wrong with that, and the second is why this function exists
 * at all:
 *
 *  1. It answered a different question than the one being asked. `cacheRefreshCommands` emits
 *     `gtk-update-icon-cache <prefix>/share/icons/hicolor` — the honest precondition is "did this
 *     package install anything into that directory", not "did the project have icon files lying
 *     around". They come apart for a `kind: 'cli'` project with a `data/icons/` folder: the
 *     planner stages no icon (icons are an `'app'` thing), the settings still listed them, and the
 *     postinst refreshed a cache for files that were never installed.
 *  2. An absolute build-host path cannot cross to the host that packs the artifact
 *     (ADR 0024 § A2). Carrying `iconFiles: ["/home/…/icon.svg"]` in a stage manifest so that
 *     `.length > 0` can be read on another machine is authoring a value that is measurable right
 *     there in the tree.
 *
 * Path-only, on purpose — `isArchIndependent` is the sibling that reads BYTES, and the two answer
 * different questions from the same payload. The same split as `plan.ts`'s `isExecutableAsset`
 * (by name) versus this module's magic sniffing (by content).
 */
export interface PayloadFacts {
    /** The payload installs a `share/applications/*.desktop`. */
    hasDesktopEntry: boolean;
    /** The payload installs into `share/icons/hicolor/`. */
    hasIcons: boolean;
    /** The payload installs a compiled-on-install `share/glib-2.0/schemas/*.gschema.xml`. */
    hasSchemas: boolean;
    /** The payload installs a `share/mime/packages/*.xml`, so the mime cache needs rebuilding. */
    hasMimeTypes: boolean;
    /** Prefix-relative paths of the typelibs the payload carries itself. */
    bundledTypelibs: string[];
}

/**
 * Read {@link PayloadFacts} off a payload or off a plan.
 *
 * Takes anything with a `path`, so the assembling phase can ask the same
 * question of the PLAN (before the tree is read back) that the packing phase
 * asks of the payload. One function, so the two phases cannot disagree about
 * whether a package installs a schema.
 */
export function readPayloadFacts(entries: readonly { path: string }[]): PayloadFacts {
    const paths = entries.map((entry) => entry.path);
    return {
        hasDesktopEntry: paths.some((path) => path.startsWith('share/applications/') && path.endsWith('.desktop')),
        hasIcons: paths.some((path) => path.startsWith('share/icons/hicolor/')),
        hasSchemas: paths.some((path) => path.startsWith('share/glib-2.0/schemas/') && path.endsWith('.gschema.xml')),
        hasMimeTypes: paths.some((path) => path.startsWith('share/mime/packages/') && path.endsWith('.xml')),
        // Anywhere in the payload, not only `lib/<name>/gi/`: `gjsify.ship.extraFiles` can place
        // one elsewhere, and a typelib the package carries is a typelib the package must not also
        // declare a distro dependency for, wherever it sits.
        bundledTypelibs: paths.filter((path) => path.endsWith('.typelib')),
    };
}

/**
 * Does the payload contain anything architecture-specific?
 *
 * Decided from the file's MAGIC, not from its name. A bundled runtime is just
 * called `node`, a stripped helper may have no extension at all, and an
 * extension list that misses one of them produces `Architecture: all` on an
 * x86-64 payload — which apt and dnf will happily install on arm64, where it
 * does not run.
 */
export function isArchIndependent(payload: readonly PayloadEntry[]): boolean {
    return !payload.some((entry) => isNativeBinary(entry.data));
}

// `process.arch` tokens, keyed by what the image records about itself. Only the
// values this repository can actually produce are listed; an unknown one reads
// as "cannot tell" rather than as a mismatch, because refusing an artifact over
// a machine constant nobody here emits would be a guess wearing a gate's clothes.
// `EM_MIPS` (0x08) is deliberately ABSENT, and adding it would be a regression:
// one machine value covers both `mips` and `mipsel`, which `process.arch` spells
// apart, so the row would have to guess and would refuse a CORRECT pack half the
// time. A value this table cannot decode unambiguously belongs out of it — the
// check stays silent instead of being wrong.
const ELF_MACHINE_TO_ARCH: Record<number, string> = {
    0x03: 'ia32',
    0x15: 'ppc64',
    0x16: 's390x',
    0x28: 'arm',
    0x3e: 'x64',
    0xb7: 'arm64',
    0xf3: 'riscv64',
};

const MACHO_CPUTYPE_TO_ARCH: Record<number, string> = {
    0x00000007: 'ia32',
    0x0000000c: 'arm',
    0x01000007: 'x64',
    0x0100000c: 'arm64',
};

/**
 * The `process.arch` token an image says it is built for, or `null` when the
 * question cannot be answered from the bytes.
 *
 * `null` covers three different things on purpose, and all three must stay
 * silent: a file that is not a native binary at all (most of a payload), a PE
 * (whose COFF machine field this tree has never parsed — `isNativeBinary` reads
 * `MZ` and stops), and a Mach-O fat archive, which carries several
 * architectures and therefore matches any label a caller could pass.
 */
export function readBinaryArch(data: Uint8Array): string | null {
    if (data.byteLength < 20) return null;
    const magic = ((data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!) >>> 0;
    if (magic === 0x7f454c46) {
        // ELF: EI_DATA at offset 5 says which end e_machine (offset 18) is written from.
        const littleEndian = data[5] === 1;
        const machine = littleEndian ? data[18]! | (data[19]! << 8) : (data[18]! << 8) | data[19]!;
        return ELF_MACHINE_TO_ARCH[machine] ?? null;
    }
    if (magic === 0xfeedface || magic === 0xfeedfacf) {
        return MACHO_CPUTYPE_TO_ARCH[((data[4]! << 24) | (data[5]! << 16) | (data[6]! << 8) | data[7]!) >>> 0] ?? null;
    }
    if (magic === 0xcefaedfe || magic === 0xcffaedfe) {
        return MACHO_CPUTYPE_TO_ARCH[((data[7]! << 24) | (data[6]! << 16) | (data[5]! << 8) | data[4]!) >>> 0] ?? null;
    }
    return null;
}

/**
 * Refuse a payload whose binaries disagree with the label the package will carry.
 *
 * THE INCIDENT, measured on 0.41.0 before this existed. A project whose payload
 * carries one x86-64 `.so`, packed on this x86-64 host:
 *
 *     gjsify ship --skip-build --arch arm64
 *     → xarch-demo_1.2.3-1_arm64.deb, xarch-demo-1.2.3-1.aarch64.rpm
 *     rpm -qp --qf '%{ARCH}'  → aarch64
 *     the .so inside it       → ELF e_machine 0x3e (x86-64)
 *
 * `--arch` LABELS the payload; it does not cross-compile it, and nothing
 * compared the two. The result installs on an arm64 machine — apt and dnf both
 * believe the header — and then fails to load, which is this tree's most
 * expensive failure class with an independent oracle actively confirming the
 * lie: `rpm` reads the header, and the header was written from the caller's
 * claim.
 *
 * Payload against LABEL, never payload against HOST. Assembling an arm64
 * artifact on an x64 machine is a supported path — the packers are pure
 * JavaScript and ADR 0024 § A1 turns it into a design commitment — so a host
 * comparison would refuse the very case the split exists to allow.
 */
export function assertPayloadMatchesArch(payload: readonly PayloadEntry[], arch: string): void {
    for (const entry of payload) {
        const found = readBinaryArch(entry.data);
        if (found === null || found === arch) continue;
        throw new Error(
            `gjsify ship: the payload is ${found}, but the package would be labelled ${arch} — ` +
                `${entry.path} is built for ${found}.\n` +
                '    `--arch` names the architecture the PAYLOAD was built for; it does not cross-compile ' +
                'anything.\n' +
                `    A package labelled ${arch} installs on ${arch} and then fails to load. Build the payload ` +
                `for ${arch}\n` +
                '    (its own prebuild), or assemble the stage without `--arch` and label the payload you ' +
                'actually have.',
        );
    }
}

/** ELF, Mach-O (both endiannesses, both widths, and a fat archive) or PE. */
function isNativeBinary(data: Uint8Array): boolean {
    if (data.byteLength < 4) return false;
    const magic = (data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!;
    switch (magic >>> 0) {
        case 0x7f454c46: // \x7fELF
        case 0xfeedface: // Mach-O 32
        case 0xfeedfacf: // Mach-O 64
        case 0xcefaedfe: // Mach-O 32, byte-swapped
        case 0xcffaedfe: // Mach-O 64, byte-swapped
        case 0xcafebabe: // Mach-O universal binary
            return true;
        default:
            return data[0] === 0x4d && data[1] === 0x5a; // MZ — PE/COFF
    }
}
