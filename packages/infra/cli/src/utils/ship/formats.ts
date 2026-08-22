// The per-format table. Everything that differs between `.deb` and `.rpm`
// outside the archive container itself lives here as DATA, so a new format is
// a row rather than an edit across the stager, the overlay builder and the
// artifact namer.

import type { FormatDescriptor, FormatId, PackSettings } from './types.js';

// `process.arch` → the format's architecture name. Taken from dpkg's own
// `data/cputable` and rpm's arch table. `arm` cannot be told apart from
// `armel` by a running process, and Debian's hard-float port is what anything
// current actually runs, so `armhf` is the default rather than a guess.
const DEBIAN_ARCH: Record<string, string> = {
    x64: 'amd64',
    arm64: 'arm64',
    ia32: 'i386',
    arm: 'armhf',
    riscv64: 'riscv64',
    ppc64: 'ppc64el',
    s390x: 's390x',
};

const RPM_ARCH: Record<string, string> = {
    x64: 'x86_64',
    arm64: 'aarch64',
    ia32: 'i686',
    arm: 'armv7hl',
    riscv64: 'riscv64',
    ppc64: 'ppc64le',
    s390x: 's390x',
};

function lookupArch(table: Record<string, string>, arch: string, label: string): string {
    const mapped = table[arch];
    if (!mapped) {
        throw new Error(
            `gjsify ship: no ${label} architecture is known for \`process.arch\` "${arch}". ` +
                `Known: ${Object.keys(table).join(', ')}.`,
        );
    }
    return mapped;
}

function debArch(arch: string, archIndependent: boolean): string {
    return archIndependent ? 'all' : lookupArch(DEBIAN_ARCH, arch, 'Debian');
}

function rpmArch(arch: string, archIndependent: boolean): string {
    return archIndependent ? 'noarch' : lookupArch(RPM_ARCH, arch, 'RPM');
}

export const FORMATS: Record<FormatId, FormatDescriptor> = {
    deb: {
        id: 'deb',
        prefix: '/usr',
        // Debian policy § 12.5: every package ships its copyright in
        // /usr/share/doc/<package>/copyright, and lintian errors without it.
        licenseDest: (binaryName) => `share/doc/${binaryName}/copyright`,
        licenseKind: 'debian-copyright',
        archName: debArch,
        fileName: (s: PackSettings, archLabel: string) => `${s.binaryName}_${s.version}-${s.release}_${archLabel}.deb`,
    },
    rpm: {
        id: 'rpm',
        prefix: '/usr',
        licenseDest: (binaryName) => `share/licenses/${binaryName}/LICENSE`,
        licenseKind: 'plain',
        archName: rpmArch,
        fileName: (s: PackSettings, archLabel: string) => `${s.binaryName}-${s.version}-${s.release}.${archLabel}.rpm`,
    },
};

// DERIVED, never a second list. `FORMATS` is `Record<FormatId, …>`, so the
// compiler already refuses a `FormatId` with no descriptor — reading the keys
// back inherits that guarantee for free. Written out by hand this was the one
// unbound copy of the vocabulary: adding a format to `FormatId` and `FORMATS`
// compiled fine and left this list short, which would have made the new format
// absent from the default targets (`ship.ts` uses it as the `??` fallback),
// missing from `--help`, and REFUSED by `readStage` as an unknown id.
// Insertion order is stable for string keys, and `resolveFormats` sorts anyway.
export const FORMAT_IDS: FormatId[] = Object.keys(FORMATS) as FormatId[];

/** Parse `--target deb,rpm` into a sorted, deduplicated descriptor list. */
export function resolveFormats(raw: readonly string[]): FormatDescriptor[] {
    const names = raw
        .flatMap((entry) => entry.split(','))
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so
    // `--target constructor` resolved to `Object` and the refusal below never
    // fired — the run then died somewhere unrelated.
    const unknown = names.filter((name) => !Object.hasOwn(FORMATS, name));
    if (unknown.length > 0) {
        throw new Error(
            `gjsify ship: unknown target${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}. ` +
                `Known targets: ${FORMAT_IDS.join(', ')}.`,
        );
    }
    const unique = [...new Set(names as FormatId[])].sort();
    // An empty list would otherwise stage the payload and pack nothing, exit 0,
    // and print no artifact line — a success that produced no artifact.
    if (unique.length === 0) {
        throw new Error(`gjsify ship: --target named no format. Known targets: ${FORMAT_IDS.join(', ')}.`);
    }
    return unique.map((name) => FORMATS[name]);
}
