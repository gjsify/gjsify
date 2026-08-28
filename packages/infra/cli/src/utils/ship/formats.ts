// The per-format table. Everything that differs between the formats outside the
// archive container itself lives here as DATA, so a new format is a row rather
// than an edit across the stager, the overlay builder and the artifact namer.
//
// Flatpak is the row that proves the claim: ADR 0024 § 2 predicted "the whole
// difference between a Flatpak and an `.rpm` is a four-line prefix map", and
// this file is where that turned out to be one `prefix: '/app'`, one arch table
// and one filename. What it also proved is what the design did NOT predict —
// a format can be host-bound (§ A3), so `host` is a descriptor field now.

import { isOnPath } from '../check-system-deps.js';
import type { Layout } from './layout.js';
import type { FormatDescriptor, FormatId, HostOs, PackSettings } from './types.js';

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

// Flatpak's own vocabulary, which is ostree's: `flatpak --supported-arches` on
// x86_64 answers `x86_64` then `i386`, and a ref is `app/<id>/<arch>/<branch>`.
// Deliberately short — a name this table does not know is refused rather than
// guessed, because the arch is not a label here, it is part of the ref the
// bundle is exported under and installed from.
const FLATPAK_ARCH: Record<string, string> = {
    x64: 'x86_64',
    arm64: 'aarch64',
    ia32: 'i386',
    arm: 'arm',
};

function debArch(arch: string, archIndependent: boolean): string {
    return archIndependent ? 'all' : lookupArch(DEBIAN_ARCH, arch, 'Debian');
}

function rpmArch(arch: string, archIndependent: boolean): string {
    return archIndependent ? 'noarch' : lookupArch(RPM_ARCH, arch, 'RPM');
}

/**
 * Flatpak has no `noarch`, so `archIndependent` is ignored — and that is a
 * measured difference, not an oversight.
 *
 * `all`/`noarch` exist because apt and dnf REFUSE a package whose architecture
 * is not the machine's. Flatpak asks the opposite question: every ref names an
 * arch, `flatpak install` resolves the one matching the host, and an app with no
 * arch is not installable at all. So a payload of pure JavaScript still ships as
 * `app/<id>/x86_64/stable` — which is also what Flathub does for every
 * interpreted app it hosts.
 */
function flatpakArch(arch: string, _archIndependent: boolean): string {
    return lookupArch(FLATPAK_ARCH, arch, 'Flatpak');
}

/** `.deb` and `.rpm` are written by this tree, so they exec nothing and read back with GNU tools. */
const WRITTEN_HERE = (readWith: readonly string[]): FormatDescriptor['host'] => ({
    finishOn: 'any',
    requiredTools: [],
    oracle: { readWith, readOn: ['linux'], selfReading: false },
});

export const FORMATS: Record<FormatId, FormatDescriptor> = {
    deb: {
        id: 'deb',
        layoutOs: 'linux',
        prefix: '/usr',
        host: WRITTEN_HERE(['ar', 'tar', 'dpkg-deb', 'lintian']),
        depends: 'deb',
        interpreters: ['gjs', 'node'],
        // Debian policy § 12.5: every package ships its copyright in
        // /usr/share/doc/<package>/copyright, and lintian errors without it.
        licenseDest: (binaryName) => `share/doc/${binaryName}/copyright`,
        licenseKind: 'debian-copyright',
        archName: debArch,
        fileName: (s: PackSettings, archLabel: string) => `${s.binaryName}_${s.version}-${s.release}_${archLabel}.deb`,
    },
    rpm: {
        id: 'rpm',
        layoutOs: 'linux',
        prefix: '/usr',
        host: WRITTEN_HERE(['rpm', 'rpm2cpio', 'cpio']),
        depends: 'rpm',
        interpreters: ['gjs', 'node'],
        licenseDest: (binaryName) => `share/licenses/${binaryName}/LICENSE`,
        licenseKind: 'plain',
        archName: rpmArch,
        fileName: (s: PackSettings, archLabel: string) => `${s.binaryName}-${s.version}-${s.release}.${archLabel}.rpm`,
    },
    flatpak: {
        id: 'flatpak',
        layoutOs: 'linux',
        // The one-line difference ADR 0024 § 2 promised. Nothing in the payload
        // changes: the launcher derives its prefix at runtime (§ 3), so the same
        // staged `bin/<name>` works under /usr and under /app.
        prefix: '/app',
        host: {
            // A single-file bundle is an OSTree static delta, and the only writer
            // of one is `flatpak build-bundle`. Unlike the `.dmg` (§ A6) that is
            // not an OS restriction: flatpak runs on Linux, so the format is
            // Linux-bound the way the app itself is.
            finishOn: ['linux'],
            requiredTools: ['flatpak-builder', 'flatpak'],
            installHint:
                'Fedora: `sudo dnf install flatpak flatpak-builder`, Debian/Ubuntu: ' +
                '`sudo apt install flatpak flatpak-builder`',
            oracle: {
                // `flatpak build-import-bundle` into a FRESH repo, then
                // `ostree ls -R`: ostree parses the delta this tree never wrote,
                // and prints a path + mode + size per file. Measured on this
                // workstation — that listing is what the e2e suite compares
                // against the staged payload.
                readWith: ['flatpak', 'ostree'],
                readOn: ['linux'],
                selfReading: false,
            },
        },
        // A Flatpak's one dependency is its runtime, named in the manifest. See
        // `DistroFormatId`: there is no `Depends:` field here to under-declare,
        // which also means the unmapped-namespace refusal ADR 0024 § 6 built for
        // deb and rpm has nothing to say about this format.
        depends: null,
        // GJS ONLY. `org.gnome.Platform` ships `gjs`; Node is a build-time SDK
        // extension, not a runtime — see the field's doc on `FormatDescriptor`.
        interpreters: ['gjs'],
        // No policy demands a location, so this follows rpm's — one fewer shape
        // for a reader to learn, and `/app/share/licenses/<name>/LICENSE` is
        // where the equivalent file sits in the `.rpm` built from the same stage.
        licenseDest: (binaryName) => `share/licenses/${binaryName}/LICENSE`,
        licenseKind: 'plain',
        archName: flatpakArch,
        // Named after the APP ID, not the binary: the id is the ref the file
        // installs as, and it is what `flatpak install ./file.flatpak` prints.
        fileName: (s: PackSettings, archLabel: string) => `${s.appId}-${s.version}-${s.release}.${archLabel}.flatpak`,
    },
};

// DERIVED, never a second list. `FORMATS` is `Record<FormatId, …>`, so the
// compiler already refuses a `FormatId` with no descriptor — reading the keys
// back inherits that guarantee for free. Written out by hand this was the one
// unbound copy of the vocabulary: adding a format to `FormatId` and `FORMATS`
// compiled fine and left this list short, which would have made the new format
// missing from `--help` and REFUSED by `readStage` as an unknown id.
// Insertion order is stable for string keys, and `resolveFormats` sorts anyway.
export const FORMAT_IDS: FormatId[] = Object.keys(FORMATS) as FormatId[];

/**
 * What `gjsify ship <os>` builds when nothing said otherwise — every format that
 * wraps THAT OS's layout and needs no tool and no particular host.
 *
 * A SECOND derivation from the same table, and it has to be one: `FORMAT_IDS`
 * used to be both "every format that exists" and "every format to build by
 * default", which was the same list only while every format was `finishOn:
 * 'any'`. Adding Flatpak to `FORMAT_IDS` alone would have made a bare
 * `gjsify ship` demand `flatpak-builder` of every project that ever packaged a
 * `.deb` — and on a host without it, of every `release-cut.yml` run, which
 * packs `@gjsify/cli` itself on a bare ubuntu runner. A host-bound format is
 * opt-in through `--target` or `gjsify.ship.targets`; `--help` still lists all
 * of them.
 *
 * `layoutOs` is the SECOND criterion, and it is what the layout axis needed: a
 * `.app` and its zip and a Windows program directory are all `finishOn: 'any'`,
 * so on the one criterion a bare `gjsify ship` on Linux would start emitting
 * five artifacts (ADR 0024 issue #1354, open question 3). Answered with § A2's
 * positional rather than instead of it — the positional picks the layout, this
 * picks the formats that wrap it, and `gjsify ship` on Linux keeps emitting
 * exactly `deb` and `rpm`.
 *
 * An EMPTY answer is legal and is what darwin and windows give today: their
 * layouts assemble (`--stage`) and no format wraps them yet. `assemble` refuses
 * a pack with nothing to pack rather than exiting 0 having produced no artifact.
 */
export function defaultFormatIds(layoutOs: HostOs): FormatId[] {
    return FORMAT_IDS.filter((id) => FORMATS[id].layoutOs === layoutOs && FORMATS[id].host.finishOn === 'any');
}

/** Every format that wraps one OS's layout, tool-bound ones included. */
export function formatIdsFor(layoutOs: HostOs): FormatId[] {
    return FORMAT_IDS.filter((id) => FORMATS[id].layoutOs === layoutOs);
}

/**
 * Refuse a format this host cannot finish, BEFORE anything is built or written.
 *
 * `host` is injected so both branches are unit-testable from any machine — the
 * same reason `resolvePrebuildDirName` and `checkTypeSkew`'s readers are pure.
 * The message names the two-phase split rather than just saying no: the answer
 * to "I am on macOS and want a Flatpak" is `--stage` here and `--from-stage` on
 * a Linux runner, and a refusal that does not say so reads as "unsupported".
 */
export function assertHostCanFinish(format: FormatDescriptor, host: string = process.platform): void {
    const { finishOn } = format.host;
    if (finishOn === 'any' || (finishOn as readonly string[]).includes(host)) return;
    throw new Error(
        `gjsify ship: a ${format.id} artifact is packed on ${(finishOn as readonly HostOs[]).join(' or ')} and ` +
            `this host is ${host} (ADR 0024 § A1: a container is produced where its format's tool lives). ` +
            'Assembly is not host-bound, so the way across is the two-phase split: run ' +
            '`gjsify ship --stage` here, move `ship/stage/` to a ' +
            `${(finishOn as readonly HostOs[]).join('/')} runner, and finish with ` +
            `\`gjsify ship --from-stage <dir> --target ${format.id}\`.`,
    );
}

/**
 * Refuse a format whose tools are not installed, with the tool named.
 *
 * Separate from {@link assertHostCanFinish} because the two failures have
 * different fixes — one needs a different machine, the other needs a package —
 * and separate from the packer's own `notFound` handler because it fires BEFORE
 * a build: `gjsify ship` runs the project's `build` script first, and finding
 * out afterwards that `flatpak-builder` is absent costs the whole build.
 */
export function assertToolsInstalled(format: FormatDescriptor, present: (cmd: string) => boolean = isOnPath): void {
    const missing = format.host.requiredTools.filter((tool) => !present(tool));
    if (missing.length === 0) return;
    // The install instruction is the DESCRIPTOR's, not this function's: hardcoded
    // here it was `dnf install flatpak flatpak-builder` for every format that
    // will ever need a tool, which is the branch this table exists to avoid.
    const hint = format.host.installHint;
    throw new Error(
        `gjsify ship: packing a ${format.id} needs ${format.host.requiredTools.join(' and ')}, and ` +
            `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not on PATH. ` +
            `${hint === undefined ? 'Install it' : `Install it (${hint})`}, or drop this target — the other ` +
            `formats need no tools at all. \`gjsify ship --stage\` also works without ${missing.join('/')}: ` +
            'the payload is assembled by this CLI and only the container needs them.',
    );
}

/**
 * The shared half: names in, `FormatId`s out, with the two refusals that hold for
 * every caller.
 */
function parseFormatNames(raw: readonly string[], source: string): FormatId[] {
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
            `gjsify ship: unknown target${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')} in ${source}. ` +
                `Known targets: ${FORMAT_IDS.join(', ')}.`,
        );
    }
    const unique = [...new Set(names as FormatId[])].sort();
    // An empty list would otherwise stage the payload and pack nothing, exit 0,
    // and print no artifact line — a success that produced no artifact.
    if (unique.length === 0) {
        throw new Error(`gjsify ship: ${source} named no format. Known targets: ${FORMAT_IDS.join(', ')}.`);
    }
    return unique;
}

/**
 * Parse an explicit `--target deb,rpm` into a sorted, deduplicated descriptor list.
 *
 * A format belonging to another layout is an ERROR here, not a filter:
 * `gjsify ship darwin --target deb` is a mistake worth naming, and dropping it
 * silently would stage the darwin layout, pack nothing and exit 0 — the shape
 * the empty-list refusal above already exists to prevent, arriving through a
 * different door.
 *
 * The FLAG is what makes that the right answer, and it is the whole difference
 * from {@link configuredFormats}: a value typed on this command line is a claim
 * about THIS run.
 */
export function resolveFormats(raw: readonly string[], layout: Layout): FormatDescriptor[] {
    const unique = parseFormatNames(raw, '--target');
    const foreign = unique.filter((name) => FORMATS[name].layoutOs !== layout.os);
    if (foreign.length > 0) {
        const wrap = formatIdsFor(layout.os);
        // Deduplicated: two formats wrapping the same layout read as
        // "the linux/linux layout" without it.
        const foreignLayouts = [...new Set(foreign.map((name) => FORMATS[name].layoutOs))];
        throw new Error(
            `gjsify ship: ${foreign.join(', ')} ${foreign.length > 1 ? 'wrap' : 'wraps'} the ` +
                `${foreignLayouts.join('/')} layout and this run assembles the ${layout.name} one. ` +
                (wrap.length === 0
                    ? `No format wraps the ${layout.name} layout yet — \`gjsify ship ${layout.name} --stage\` ` +
                      'assembles it and stops (ADR 0024 stages 4 and 5).'
                    : `Formats for this layout: ${wrap.join(', ')}.`) +
                ` To build ${foreign.join(', ')}, name the layout ${foreign.length > 1 ? 'they wrap' : 'it wraps'}` +
                `: \`gjsify ship ${FORMATS[foreign[0] as FormatId].layoutOs} --target ${foreign.join(',')}\`.`,
        );
    }
    return unique.map((name) => FORMATS[name]);
}

/**
 * The same names from `gjsify.ship.targets`, FILTERED to the current layout.
 *
 * A configured list is a project-level DEFAULT — "when I ship this, build these"
 * — written once and read by every run, so it cannot be a claim about a layout
 * the author had not heard of when they wrote it. Refusing it the way
 * {@link resolveFormats} refuses a flag makes the new positional unusable in
 * every project that has the key, and this repository is the proof: with
 * `targets: ["deb", "rpm"]` in `packages/infra/cli/package.json`,
 * `gjsify ship darwin --stage` exited 1 telling the author to run
 * `gjsify ship darwin --stage`. There was no `--target` value that got a darwin
 * stage out of such a project at all.
 *
 * Filtering is safe HERE and only here, because an empty result is not a silent
 * success: `assemble` refuses a PACK with nothing to pack, and a `--stage` run
 * legitimately wants exactly this — assemble the layout, wrap nothing.
 */
export function configuredFormats(raw: readonly string[], layout: Layout): FormatDescriptor[] {
    return parseFormatNames(raw, '`gjsify.ship.targets`')
        .filter((name) => FORMATS[name].layoutOs === layout.os)
        .map((name) => FORMATS[name]);
}
