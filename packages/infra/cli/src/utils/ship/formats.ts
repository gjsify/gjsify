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
import { LAYOUTS, LAYOUT_NAMES, type Layout } from './layout.js';
import { SCHEMA_COMPILER, SCHEMA_COMPILER_HINT } from './schemas.js';
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

/**
 * `process.arch` → the name Apple's tools use.
 *
 * Two rows, because two architectures exist: `x86_64` and `arm64` are what
 * `uname -m`, `lipo -archs` and a Mach-O `cputype` all report on the machines
 * macOS runs on. Anything else is REFUSED rather than passed through, for the
 * reason the Flatpak table gives: an unknown value would end up in a filename a
 * user is asked to download, labelling an artifact for a machine that does not
 * exist. Note this is not `arm64` verbatim from `process.arch` by coincidence —
 * it happens to agree, and the day `process.arch` gains a spelling Apple does
 * not use, this table is where it is caught.
 */
const MACOS_ARCH: Record<string, string> = { x64: 'x86_64', arm64: 'arm64' };

/**
 * A `.app` carries no `noarch`, and unlike Flatpak that is not because the
 * format forbids one — it is because `archIndependent` answers the wrong
 * question here.
 *
 * `all`/`noarch` exist so apt and dnf do not refuse a pure-JavaScript package on
 * a machine of another architecture. Nothing gatekeeps a `.app`: it is dragged
 * into `/Applications` and run. What the label is FOR is the download a user
 * picks between, and that is a claim about which Mac the bundle runs on — which,
 * once M2b stages a runtime, is architecture-specific whatever the JavaScript is.
 * Naming the arch on a payload that happens to be portable is honest; naming
 * `noarch` on one that will not be is not.
 */
function macosArch(arch: string, _archIndependent: boolean): string {
    return lookupArch(MACOS_ARCH, arch, 'macOS');
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
        // Neither is restricted, because a distro package DECLARES its
        // interpreter rather than carrying one: `Depends: gjs` and
        // `Depends: nodejs` are both satisfiable from any distribution's own
        // archive, so the artifact's runtime is the machine's.
        interpreterGap:
            'a distro package declares its interpreter as a dependency instead of carrying one, and every ' +
            'distribution ships both',
        // Debian policy § 12.5: every package ships its copyright in
        // /usr/share/doc/<package>/copyright, and lintian errors without it.
        licenseDest: (binaryName) => `share/doc/${binaryName}/copyright`,
        licenseKind: 'debian-copyright',
        archName: debArch,
        fileName: (s: PackSettings, archLabel: string) => `${s.binaryName}_${s.version}-${s.release}_${archLabel}.deb`,
        artifactKind: 'file',
    },
    rpm: {
        id: 'rpm',
        layoutOs: 'linux',
        prefix: '/usr',
        host: WRITTEN_HERE(['rpm', 'rpm2cpio', 'cpio']),
        depends: 'rpm',
        interpreters: ['gjs', 'node'],
        // Neither is restricted, because a distro package DECLARES its
        // interpreter rather than carrying one: `Depends: gjs` and
        // `Depends: nodejs` are both satisfiable from any distribution's own
        // archive, so the artifact's runtime is the machine's.
        interpreterGap:
            'a distro package declares its interpreter as a dependency instead of carrying one, and every ' +
            'distribution ships both',
        licenseDest: (binaryName) => `share/licenses/${binaryName}/LICENSE`,
        licenseKind: 'plain',
        archName: rpmArch,
        fileName: (s: PackSettings, archLabel: string) => `${s.binaryName}-${s.version}-${s.release}.${archLabel}.rpm`,
        artifactKind: 'file',
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
        interpreterGap:
            'a Flatpak runs against `org.gnome.Platform`, which ships `gjs` and no `node`. Node exists only ' +
            'as `org.freedesktop.Sdk.Extension.node2x`, and that extension puts node on the BUILD path, not ' +
            'in the runtime — so the artifact would install and then fail at `exec node`',
        // No policy demands a location, so this follows rpm's — one fewer shape
        // for a reader to learn, and `/app/share/licenses/<name>/LICENSE` is
        // where the equivalent file sits in the `.rpm` built from the same stage.
        licenseDest: (binaryName) => `share/licenses/${binaryName}/LICENSE`,
        licenseKind: 'plain',
        archName: flatpakArch,
        // Named after the APP ID, not the binary: the id is the ref the file
        // installs as, and it is what `flatpak install ./file.flatpak` prints.
        fileName: (s: PackSettings, archLabel: string) => `${s.appId}-${s.version}-${s.release}.${archLabel}.flatpak`,
        artifactKind: 'file',
    },
    // ── macOS (#1354 M2a) ────────────────────────────────────────────────
    //
    // TWO ROWS FOR ONE TREE, and the pair is what `layoutOs` was added for. The
    // bundle and the zip around it wrap the same staged `<App>.app`; they differ
    // only in whether the artifact is a directory a user drags or a file a user
    // downloads. Both are `finishOn: 'any'` — the `.dmg` that is not is ADR 0024
    // § A6 and milestone M6.
    //
    // NEITHER IS SIGNED, and that is a property of M2a rather than an omission
    // this table hides: `codesign` is macOS-only, so a bundle assembled on Linux
    // is unsigned by construction. Gatekeeper will quarantine it on a stranger's
    // Mac. M6 is where a signing host enters, and § A4 already records what it
    // costs (re-signing the whole Mach-O closure inside the stage).
    'macos-app': {
        id: 'macos-app',
        layoutOs: 'darwin',
        // The bundle IS the prefix. `Contents/` hangs directly off the artifact,
        // so unlike `/usr` or `/app` there is nothing above it — and unlike those
        // two, the launcher does not derive this at runtime: it walks up from
        // `Contents/MacOS` (see `renderAppBundleLauncher`), because a `.app` can
        // be anywhere and `/Applications` is a convention, not a path.
        prefix: '',
        host: {
            // Assembled anywhere, packed anywhere: everything here is a file copy.
            finishOn: 'any',
            // …with ONE exception, and it is the honest one. A non-Linux layout
            // has no install step, so `gschemas.compiled` has to be produced while
            // the tree is being assembled or the bundle aborts at its first
            // `Gio.Settings.new()` (`utils/ship/schemas.ts`). `glib-compile-schemas`
            // is GLib's own and runs on all three OSes, so declaring it does NOT
            // make the format host-bound — `assertToolsInstalled` is deliberately
            // separate from `assertHostCanFinish` for exactly this shape.
            requiredTools: [SCHEMA_COMPILER],
            installHint: SCHEMA_COMPILER_HINT,
            oracle: {
                // CPython's `plistlib` — a DIFFERENT implementation family from
                // the XML this tree writes, and already precedent here
                // (`.github/ship-oracle/verify-modes.py`). Measured on this
                // workstation against a plist with a `<key>` and no value:
                // `plistlib.load` exits 1 naming the line, `plistutil -i` exits 0
                // and prints `<dict/>`, and `xmllint --noout` exits 0 because
                // well-formedness is a weaker question. So `plistlib` is the
                // oracle and the other two are not.
                readWith: ['python3'],
                readOn: ['linux', 'darwin'],
                selfReading: false,
            },
        },
        // No package list. macOS resolves nothing for an app: whatever the bundle
        // does not carry, it finds on the machine or it does not run — which is
        // what makes M2b (staging a runtime) the milestone that matters, not a
        // dependency field.
        depends: null,
        // NODE ONLY, and it is a measured limit rather than caution.
        // `packages/node-gi/scripts/build-gtk-runtime-darwin.mjs` records that GJS
        // ships no relocation, so there is no relocatable GJS to put inside a
        // bundle a stranger downloads (ADR 0024 § 4, stage 7). A `--app gjs`
        // payload therefore cannot be shipped this way, and
        // `assertFormatCanRunInterpreter` says so by name instead of producing a
        // bundle that dies at `exec gjs`.
        interpreters: ['node'],
        interpreterGap:
            'a `.app` a stranger downloads has to CARRY its interpreter, and there is no relocatable GJS to ' +
            'put in one — `packages/node-gi/scripts/build-gtk-runtime-darwin.mjs` records "GJS ships no ' +
            'relocation", which is why ADR 0024 § 4 derives Node on macOS and stage 7 is what would change it',
        // Inside `Contents/Resources`, which is where a `.app`'s non-executable
        // files go. Following rpm's `share/licenses/<name>/LICENSE` shape keeps
        // one fewer layout for a reader to learn — the layout map turns it into
        // `Contents/Resources/share/licenses/<name>/LICENSE`.
        licenseDest: (binaryName) => `share/licenses/${binaryName}/LICENSE`,
        licenseKind: 'plain',
        archName: macosArch,
        // The DISPLAY name, not the binary: this artifact is the thing a user
        // drags into `/Applications`, and its name is what the Finder shows.
        fileName: (s: PackSettings) => `${s.name}.app`,
        artifactKind: 'directory',
    },
    'macos-app-zip': {
        id: 'macos-app-zip',
        layoutOs: 'darwin',
        prefix: '',
        host: {
            finishOn: 'any',
            // The ZIP is written by this tree (`utils/ship/zip.ts`), so the only
            // tool here is the schema compiler the layout needs — see the row
            // above. Writing the archive ourselves is what keeps `zipinfo` an
            // INDEPENDENT reader rather than the other half of a `zip`/`unzip`
            // round trip; same argument ADR 0024 § A3 makes for the deb and rpm.
            requiredTools: [SCHEMA_COMPILER],
            installHint: SCHEMA_COMPILER_HINT,
            oracle: {
                // `zipinfo -l`, not `unzip -Z1`. The failure that matters for a
                // distributed `.app` is a launcher extracted 0644 that will not
                // run, and `-Z1` prints NAMES ONLY — it is structurally blind to
                // it. `zipinfo` prints the Unix mode (`-rwxr-xr-x`) and ships in
                // the same `unzip` package, which is already in the CI image.
                readWith: ['zipinfo'],
                readOn: ['linux', 'darwin'],
                selfReading: false,
            },
        },
        depends: null,
        interpreters: ['node'],
        interpreterGap:
            'a `.app` a stranger downloads has to CARRY its interpreter, and there is no relocatable GJS to ' +
            'put in one — `packages/node-gi/scripts/build-gtk-runtime-darwin.mjs` records "GJS ships no ' +
            'relocation", which is why ADR 0024 § 4 derives Node on macOS and stage 7 is what would change it',
        licenseDest: (binaryName) => `share/licenses/${binaryName}/LICENSE`,
        licenseKind: 'plain',
        archName: macosArch,
        // The BINARY name here and the display name above, deliberately. This one
        // is a download: it lands in a browser's downloads folder beside other
        // files, so it carries the version and the arch, and it avoids the spaces
        // a display name may contain.
        fileName: (s: PackSettings, archLabel: string) => `${s.binaryName}-${s.version}-${s.release}.${archLabel}.zip`,
        artifactKind: 'file',
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

/** `process.platform` token → the positional that selects it, so a message says `windows`, not `win32`. */
const LAYOUT_NAME_BY_OS: Record<string, string> = Object.fromEntries(
    LAYOUT_NAMES.map((name) => [LAYOUTS[name].os, name]),
);

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
                // One suggestion PER foreign layout. `foreign[0]`'s layout was
                // being offered for all of them, two lines under the dedup that
                // exists precisely because several are anticipated — so a mixed
                // `--target` would have printed a command that fails the same way.
                ` To build ${foreign.join(', ')}, name the layout each wraps: ` +
                `${foreignLayouts
                    .map(
                        (os) =>
                            `\`gjsify ship ${LAYOUT_NAME_BY_OS[os] ?? os} --target ` +
                            `${foreign.filter((name) => FORMATS[name].layoutOs === os).join(',')}\``,
                    )
                    .join(', ')}.`,
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
export function configuredFormats(
    raw: readonly string[],
    layout: Layout,
): { formats: FormatDescriptor[]; dropped: FormatId[] } {
    const named = parseFormatNames(raw, '`gjsify.ship.targets`');
    const kept = named.filter((name) => FORMATS[name].layoutOs === layout.os);
    // The dropped names are RETURNED rather than swallowed. The `--target` path
    // refuses by name; this one silently produced a shorter list, so a project
    // whose configured formats all belong to another layout got a stage and no
    // explanation of why nothing was packed.
    return {
        formats: kept.map((name) => FORMATS[name]),
        dropped: named.filter((name) => FORMATS[name].layoutOs !== layout.os),
    };
}
