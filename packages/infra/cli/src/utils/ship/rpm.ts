// The `.rpm` packer.
//
// Hand-written for the same reason as the `.deb` one, and with a better
// oracle: `rpm` itself is on every Fedora image this project's CI runs on, and
// it is a strict, independent parser. `rpm -qp --info`, `rpm -qpl`,
// `rpm -qp --requires` and `rpm -K` between them read the lead, both headers,
// every tag this file writes and the payload digest — so the e2e suite checks
// the artifact with code that shares nothing with the writer.
//
// `rpmbuild` was the alternative and is the wrong dependency: it is not in the
// CI image, adding it there would gate this PR on an image rebuild, and it
// cannot run under GJS at all. What it would have bought is the header
// encoding in `rpm-header.ts`, which is 180 lines.

import { createHash } from 'node:crypto';

import { concatBytes } from './bytes.js';
import { createCpioArchive, S_IFDIR, S_IFREG, type CpioEntry } from './cpio.js';
import { parseDepend } from './depends.js';
import { readPayloadFacts, readShebangInterpreters, type PayloadEntry } from './payload.js';
import {
    buildRpmHeader,
    buildRpmLead,
    padToEight,
    RpmType,
    RPM_TAG_HEADERIMMUTABLE,
    RPM_TAG_HEADERSIGNATURES,
    type RpmEntry,
} from './rpm-header.js';
import { gzipDeterministic } from './gzip.js';
import { renderRpmScriptlets } from './scripts.js';
import type { PackSettings } from './types.js';

export interface RpmInputs {
    settings: PackSettings;
    payload: readonly PayloadEntry[];
    prefix: string;
    depends: readonly string[];
    /** RPM architecture (`x86_64`, `noarch`, …). */
    archLabel: string;
    mtime: number;
}

// Header tags. Named rather than inlined because a wrong NUMBER produces a
// package that parses and is quietly wrong, which is the hardest kind to spot.
const TAG = {
    HEADERI18NTABLE: 100,
    NAME: 1000,
    VERSION: 1001,
    RELEASE: 1002,
    SUMMARY: 1004,
    DESCRIPTION: 1005,
    BUILDTIME: 1006,
    BUILDHOST: 1007,
    SIZE: 1009,
    LICENSE: 1014,
    GROUP: 1016,
    URL: 1020,
    OS: 1021,
    ARCH: 1022,
    POSTIN: 1024,
    POSTUN: 1026,
    FILESIZES: 1028,
    FILEMODES: 1030,
    FILERDEVS: 1033,
    FILEMTIMES: 1034,
    FILEDIGESTS: 1035,
    FILELINKTOS: 1036,
    FILEFLAGS: 1037,
    FILEUSERNAME: 1039,
    FILEGROUPNAME: 1040,
    SOURCERPM: 1044,
    FILEVERIFYFLAGS: 1045,
    PROVIDENAME: 1047,
    REQUIREFLAGS: 1048,
    REQUIRENAME: 1049,
    REQUIREVERSION: 1050,
    RPMVERSION: 1064,
    POSTINPROG: 1086,
    POSTUNPROG: 1088,
    FILEDEVICES: 1095,
    FILEINODES: 1096,
    FILELANGS: 1097,
    PROVIDEFLAGS: 1112,
    PROVIDEVERSION: 1113,
    DIRINDEXES: 1116,
    BASENAMES: 1117,
    DIRNAMES: 1118,
    PAYLOADFORMAT: 1124,
    PAYLOADCOMPRESSOR: 1125,
    PAYLOADFLAGS: 1126,
    FILEDIGESTALGO: 5011,
    ENCODING: 5062,
    PAYLOADDIGEST: 5092,
    PAYLOADDIGESTALGO: 5093,
    PAYLOADDIGESTALT: 5097,
} as const;

const SIGTAG = { SIZE: 1000, MD5: 1004, PAYLOADSIZE: 1007, SHA1HEADER: 269, SHA256HEADER: 273 } as const;

const SENSE = {
    LESS: 1 << 1,
    GREATER: 1 << 2,
    EQUAL: 1 << 3,
    INTERP: 1 << 8,
    SCRIPT_POST: 1 << 10,
    SCRIPT_POSTUN: 1 << 12,
    // "This one was derived from the payload, not declared by the packager" —
    // the sense `rpmbuild`'s own dependency generator uses (measured: 16384).
    FIND_REQUIRES: 1 << 14,
    RPMLIB: 1 << 24,
} as const;

/** SHA-256 in rpm's digest-algorithm numbering (PGP hash algorithm ids). */
const DIGEST_ALGO_SHA256 = 8;

/**
 * The rpmlib features this writer's output depends on.
 *
 * These are not optional decoration: `CompressedFileNames` is what declares
 * the DIRNAMES/BASENAMES/DIRINDEXES split, `FileDigests` that FILEDIGESTS is
 * a digest rather than an MD5, and `PayloadFilesHavePrefix` that the cpio
 * names carry a `./`. An rpm too old for one of them must refuse the package
 * rather than misread it.
 */
const RPMLIB_REQUIRES: Array<[string, string]> = [
    ['rpmlib(CompressedFileNames)', '3.0.4-1'],
    ['rpmlib(FileDigests)', '4.6.0-1'],
    ['rpmlib(PayloadFilesHavePrefix)', '4.0-1'],
];

/**
 * Directories a base system already owns.
 *
 * An rpm that claims nothing leaves its own `/usr/lib/<app>` unowned, which
 * `rpm -e` then leaves behind. Listing the base-system directories it must not
 * claim is the middle ground.
 *
 * Deliberately not exhaustive, and that is affordable: rpm treats directory
 * CO-ownership as normal (`rpm -qf /usr/share/icons/hicolor` names three
 * packages on this machine), so a directory missing from this list costs
 * rpmlint noise, not a broken install. The entries that matter are the ones a
 * package would otherwise claim on every install.
 */
const SYSTEM_OWNED_DIRECTORIES = new Set([
    '/usr',
    '/usr/bin',
    '/usr/lib',
    '/usr/lib64',
    '/usr/libexec',
    '/usr/sbin',
    '/usr/share',
    '/usr/share/applications',
    '/usr/share/doc',
    '/usr/share/icons',
    '/usr/share/licenses',
    '/usr/share/man',
    '/usr/share/metainfo',
    // Owned by glib2 — an app that installs a schema must not claim the
    // directory the whole system's schemas live in. Verified with `rpm -qf`.
    '/usr/share/glib-2.0',
    '/usr/share/glib-2.0/schemas',
    '/etc',
    '/opt',
    '/var',
]);

interface RpmFile {
    /** Absolute install path. */
    path: string;
    /** Full `st_mode`, file-type bits included. */
    mode: number;
    data: Uint8Array;
    isDirectory: boolean;
}

export async function buildRpm(inputs: RpmInputs): Promise<Uint8Array> {
    const { settings, mtime } = inputs;
    const prefix = `/${inputs.prefix.replace(/^\/+|\/+$/g, '')}`;
    const files = collectFiles(inputs, prefix);

    const cpio = createCpioArchive(
        files.map(
            (file, index): CpioEntry => ({
                name: `.${file.path}`,
                mode: file.mode,
                data: file.data,
                mtime,
                ino: index + 1,
            }),
        ),
    );
    const compressed = await gzipDeterministic(cpio);

    const header = buildRpmHeader(mainHeaderEntries(inputs, files, cpio, compressed), RPM_TAG_HEADERIMMUTABLE);
    const body = concatBytes([header, compressed]);
    const signature = padToEight(
        buildRpmHeader(
            [
                { tag: SIGTAG.SHA1HEADER, type: RpmType.STRING, value: hashHex('sha1', header) },
                { tag: SIGTAG.SHA256HEADER, type: RpmType.STRING, value: hashHex('sha256', header) },
                { tag: SIGTAG.SIZE, type: RpmType.INT32, value: [body.byteLength] },
                { tag: SIGTAG.MD5, type: RpmType.BIN, value: hashBytes('md5', body) },
                { tag: SIGTAG.PAYLOADSIZE, type: RpmType.INT32, value: [cpio.byteLength] },
            ],
            RPM_TAG_HEADERSIGNATURES,
        ),
    );

    const lead = buildRpmLead(`${settings.binaryName}-${settings.version}-${settings.release}`);
    return concatBytes([lead, signature, body]);
}

/** The payload plus the directories this package should own, in install order. */
function collectFiles(inputs: RpmInputs, prefix: string): RpmFile[] {
    const files: RpmFile[] = inputs.payload.map((entry) => {
        if (entry.data.byteLength > 0xffffffff) {
            throw new Error(
                `gjsify ship: ${entry.path} is larger than 4 GiB, which needs rpm's LONGFILESIZES tag. ` +
                    'That is not implemented — split the payload.',
            );
        }
        return {
            path: `${prefix}/${entry.path}`,
            mode: S_IFREG | (entry.mode & 0o7777),
            data: entry.data,
            isDirectory: false,
        };
    });

    const owned = new Set<string>();
    for (const file of files) {
        const parts = file.path.split('/').slice(1);
        parts.pop();
        let current = '';
        for (const part of parts) {
            current = `${current}/${part}`;
            if (!SYSTEM_OWNED_DIRECTORIES.has(current)) owned.add(current);
        }
    }
    for (const directory of owned) {
        files.push({ path: directory, mode: S_IFDIR | 0o755, data: new Uint8Array(0), isDirectory: true });
    }

    // rpm reads the file list positionally across a dozen parallel arrays, so
    // ONE order has to serve all of them; sorting here is what guarantees a
    // directory is listed before what lives in it.
    return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function mainHeaderEntries(
    inputs: RpmInputs,
    files: readonly RpmFile[],
    cpio: Uint8Array,
    compressed: Uint8Array,
): RpmEntry[] {
    const { settings } = inputs;
    const evr = `${settings.version}-${settings.release}`;

    const dirNames: string[] = [];
    const dirIndexes: number[] = [];
    const baseNames: string[] = [];
    for (const file of files) {
        const slash = file.path.lastIndexOf('/');
        const dir = `${file.path.slice(0, slash)}/`;
        let index = dirNames.indexOf(dir);
        if (index === -1) index = dirNames.push(dir) - 1;
        dirIndexes.push(index);
        baseNames.push(file.path.slice(slash + 1));
    }

    // From the PAYLOAD, not the settings — see the same call in `deb.ts`.
    const scripts = renderRpmScriptlets(readPayloadFacts(inputs.payload), inputs.prefix);
    const requires = buildRequires(inputs.depends, scripts, readShebangInterpreters(inputs.payload));

    const entries: RpmEntry[] = [
        { tag: TAG.HEADERI18NTABLE, type: RpmType.STRING_ARRAY, value: ['C'] },
        { tag: TAG.NAME, type: RpmType.STRING, value: settings.binaryName },
        { tag: TAG.VERSION, type: RpmType.STRING, value: settings.version },
        { tag: TAG.RELEASE, type: RpmType.STRING, value: settings.release },
        { tag: TAG.SUMMARY, type: RpmType.I18NSTRING, value: [settings.summary] },
        { tag: TAG.DESCRIPTION, type: RpmType.I18NSTRING, value: [settings.description.join('\n\n')] },
        { tag: TAG.BUILDTIME, type: RpmType.INT32, value: [inputs.mtime] },
        // Not the real hostname: it would put the build machine's name in
        // every artifact and make two builds of the same source differ.
        { tag: TAG.BUILDHOST, type: RpmType.STRING, value: 'localhost' },
        {
            tag: TAG.SIZE,
            type: RpmType.INT32,
            value: [files.reduce((total, file) => total + file.data.byteLength, 0)],
        },
        { tag: TAG.LICENSE, type: RpmType.STRING, value: settings.license },
        { tag: TAG.GROUP, type: RpmType.I18NSTRING, value: [settings.group] },
        { tag: TAG.OS, type: RpmType.STRING, value: 'linux' },
        { tag: TAG.ARCH, type: RpmType.STRING, value: inputs.archLabel },
        { tag: TAG.SOURCERPM, type: RpmType.STRING, value: `${settings.binaryName}-${evr}.src.rpm` },
        { tag: TAG.RPMVERSION, type: RpmType.STRING, value: '4.20.0' },
        { tag: TAG.ENCODING, type: RpmType.STRING, value: 'utf-8' },

        { tag: TAG.FILESIZES, type: RpmType.INT32, value: files.map((file) => file.data.byteLength) },
        { tag: TAG.FILEMODES, type: RpmType.INT16, value: files.map((file) => file.mode) },
        { tag: TAG.FILERDEVS, type: RpmType.INT16, value: files.map(() => 0) },
        { tag: TAG.FILEMTIMES, type: RpmType.INT32, value: files.map(() => inputs.mtime) },
        {
            tag: TAG.FILEDIGESTS,
            type: RpmType.STRING_ARRAY,
            // A directory has no contents to digest, and rpm expects the empty
            // string there rather than the digest of zero bytes.
            value: files.map((file) => (file.isDirectory ? '' : hashHex('sha256', file.data))),
        },
        { tag: TAG.FILELINKTOS, type: RpmType.STRING_ARRAY, value: files.map(() => '') },
        { tag: TAG.FILEFLAGS, type: RpmType.INT32, value: files.map(() => 0) },
        { tag: TAG.FILEUSERNAME, type: RpmType.STRING_ARRAY, value: files.map(() => 'root') },
        { tag: TAG.FILEGROUPNAME, type: RpmType.STRING_ARRAY, value: files.map(() => 'root') },
        { tag: TAG.FILEVERIFYFLAGS, type: RpmType.INT32, value: files.map(() => 0xffffffff) },
        { tag: TAG.FILEDEVICES, type: RpmType.INT32, value: files.map(() => 1) },
        { tag: TAG.FILEINODES, type: RpmType.INT32, value: files.map((_, index) => index + 1) },
        { tag: TAG.FILELANGS, type: RpmType.STRING_ARRAY, value: files.map(() => '') },
        { tag: TAG.FILEDIGESTALGO, type: RpmType.INT32, value: [DIGEST_ALGO_SHA256] },
        { tag: TAG.DIRINDEXES, type: RpmType.INT32, value: dirIndexes },
        { tag: TAG.BASENAMES, type: RpmType.STRING_ARRAY, value: baseNames },
        { tag: TAG.DIRNAMES, type: RpmType.STRING_ARRAY, value: dirNames },

        { tag: TAG.PROVIDENAME, type: RpmType.STRING_ARRAY, value: [settings.binaryName] },
        { tag: TAG.PROVIDEFLAGS, type: RpmType.INT32, value: [SENSE.EQUAL] },
        { tag: TAG.PROVIDEVERSION, type: RpmType.STRING_ARRAY, value: [evr] },
        { tag: TAG.REQUIRENAME, type: RpmType.STRING_ARRAY, value: requires.names },
        { tag: TAG.REQUIREFLAGS, type: RpmType.INT32, value: requires.flags },
        { tag: TAG.REQUIREVERSION, type: RpmType.STRING_ARRAY, value: requires.versions },

        { tag: TAG.PAYLOADFORMAT, type: RpmType.STRING, value: 'cpio' },
        { tag: TAG.PAYLOADCOMPRESSOR, type: RpmType.STRING, value: 'gzip' },
        // Write-side metadata only — no reader acts on it (rpm-format.md § 6.5).
        // `9` is what rpmbuild writes; the Web `CompressionStream` this packer
        // uses exposes no level to report, so the honest reading of this field
        // is "gzip, default settings" rather than a measured level.
        { tag: TAG.PAYLOADFLAGS, type: RpmType.STRING, value: '9' },
        { tag: TAG.PAYLOADDIGEST, type: RpmType.STRING_ARRAY, value: [hashHex('sha256', compressed)] },
        { tag: TAG.PAYLOADDIGESTALGO, type: RpmType.INT32, value: [DIGEST_ALGO_SHA256] },
        { tag: TAG.PAYLOADDIGESTALT, type: RpmType.STRING_ARRAY, value: [hashHex('sha256', cpio)] },
    ];

    assertParallelFileArrays(entries, files.length);

    if (settings.homepage) entries.push({ tag: TAG.URL, type: RpmType.STRING, value: settings.homepage });
    if (scripts.post !== undefined) {
        entries.push({ tag: TAG.POSTIN, type: RpmType.STRING, value: scripts.post });
        entries.push({ tag: TAG.POSTINPROG, type: RpmType.STRING, value: '/bin/sh' });
    }
    if (scripts.postun !== undefined) {
        entries.push({ tag: TAG.POSTUN, type: RpmType.STRING, value: scripts.postun });
        entries.push({ tag: TAG.POSTUNPROG, type: RpmType.STRING, value: '/bin/sh' });
    }
    return entries;
}

/**
 * Every per-file tag is one column of the same table.
 *
 * rpm reads them POSITIONALLY and never checks that they agree: a short
 * FILEMODES array is not an error, it is a package whose later files install
 * with whatever value happened to sit at that index. The lengths are trivially
 * checkable here and effectively uncheckable afterwards, so they are checked
 * here.
 */
function assertParallelFileArrays(entries: readonly RpmEntry[], fileCount: number): void {
    const perFileTags = new Set<number>([
        TAG.FILESIZES,
        TAG.FILEMODES,
        TAG.FILERDEVS,
        TAG.FILEMTIMES,
        TAG.FILEDIGESTS,
        TAG.FILELINKTOS,
        TAG.FILEFLAGS,
        TAG.FILEUSERNAME,
        TAG.FILEGROUPNAME,
        TAG.FILEVERIFYFLAGS,
        TAG.FILEDEVICES,
        TAG.FILEINODES,
        TAG.FILELANGS,
        TAG.DIRINDEXES,
        TAG.BASENAMES,
    ]);
    for (const entry of entries) {
        if (!perFileTags.has(entry.tag)) continue;
        const length = Array.isArray(entry.value) ? entry.value.length : 1;
        if (length !== fileCount) {
            throw new Error(
                `gjsify ship: internal error — rpm tag ${entry.tag} has ${length} values for ${fileCount} files.`,
            );
        }
    }
}

/**
 * The three parallel `Requires` arrays.
 *
 * A scriptlet's interpreter is a dependency like any other and rpm expects it
 * declared with the matching `SCRIPT_*` sense bit — without it, a system
 * without `/bin/sh` installs the package and then fails inside `%post`.
 *
 * The payload's own executables need the same treatment, and until the first
 * real `rpm -qp --requires` ran against this writer nothing here said so: every
 * `.rpm` it produced installed a `#!/bin/sh` launcher and declared no shell.
 * The two senses are not redundant and rpm emits both — a package can need a
 * shell to CONFIGURE (`Requires(post)`) and to RUN (a plain requirement), and
 * dropping either is a different broken system.
 */
function buildRequires(
    depends: readonly string[],
    scripts: { post?: string; postun?: string },
    interpreters: readonly string[],
): { names: string[]; flags: number[]; versions: string[] } {
    const names: string[] = [];
    const flags: number[] = [];
    const versions: string[] = [];

    for (const depend of depends) {
        const parsed = parseDepend(depend);
        names.push(parsed.name);
        flags.push(senseFor(parsed.relation));
        versions.push(parsed.version ?? '');
    }
    if (scripts.post !== undefined) {
        names.push('/bin/sh');
        flags.push(SENSE.INTERP | SENSE.SCRIPT_POST);
        versions.push('');
    }
    if (scripts.postun !== undefined) {
        names.push('/bin/sh');
        flags.push(SENSE.INTERP | SENSE.SCRIPT_POSTUN);
        versions.push('');
    }
    for (const interpreter of interpreters) {
        names.push(interpreter);
        flags.push(SENSE.FIND_REQUIRES);
        versions.push('');
    }
    for (const [name, version] of RPMLIB_REQUIRES) {
        names.push(name);
        flags.push(SENSE.RPMLIB | SENSE.LESS | SENSE.EQUAL);
        versions.push(version);
    }
    return { names, flags, versions };
}

function senseFor(relation: string | undefined): number {
    switch (relation) {
        case '>=':
            return SENSE.GREATER | SENSE.EQUAL;
        case '>':
            return SENSE.GREATER;
        case '<=':
            return SENSE.LESS | SENSE.EQUAL;
        case '<':
            return SENSE.LESS;
        case '=':
            return SENSE.EQUAL;
        default:
            return 0;
    }
}

function hashHex(algorithm: string, data: Uint8Array): string {
    return createHash(algorithm).update(data).digest('hex');
}

function hashBytes(algorithm: string, data: Uint8Array): Uint8Array {
    return new Uint8Array(createHash(algorithm).update(data).digest());
}
