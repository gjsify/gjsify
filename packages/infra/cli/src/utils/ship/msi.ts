// The Windows installer — ADR 0024 stage 5, issue #1354 M5.
//
// ONE AUTHORED DOCUMENT, TWO COMPILERS. Everything below produces a `.wxs` in
// WiX v3's schema (`http://schemas.microsoft.com/wix/2006/wi`) and hands it to
// whichever compiler the host has: `wixl` from `msitools` on Linux, `candle` +
// `light` from WiX Toolset v3.14 on Windows. That is not two implementations of
// the same thing — the DOCUMENT is the implementation and it is written once;
// the backends are two readers of it, which is the entire point (§ A6). A
// wixl-only path would be this tree's writer read back by `msiinfo`, i.e. by
// wixl's own package.
//
// WIX v3 AND NOT v4/v5, and that is forced rather than nostalgic: `wixl`
// implements a subset of the 2006 schema, while WiX v4 moved to
// `http://wixtoolset.org/schemas/v4/wxs` with renamed elements. One document
// cannot be in two namespaces, so the shared one is v3 — which is also what
// `windows-latest` ships (measured: WiX Toolset 3.14.1.8722 in the
// `actions/runner-images` software list for Windows Server 2025).
//
// WHAT THE INSTALLER ACTUALLY DOES, because "an `.msi` exists" is not the claim:
//
//   * lays the program directory `windows-dir` produces under
//     `%ProgramFiles%\<App>`, overridable with `msiexec INSTALLDIR=…`;
//   * gives the user something to start — one Start-Menu shortcut at the top
//     level, aimed at the GUI-subsystem `.exe` launcher the zip's user
//     double-clicks (see the last paragraph of this header);
//   * comes off again: Add/Remove Programs gets its entry from the MSI's own
//     `ProductName`/`ProductVersion`/`Manufacturer`, and `msiexec /x` removes
//     every file the package installed. The `windows-dir-selfcontained` leg's
//     sibling asserts the install root is GONE afterwards, because an installer
//     that cannot be removed is worse than none.
//
// FIVE THINGS WERE MEASURED against `msitools 0.106.58-1.fc44` (`wixl
// 0.106.58-a155`) before this file was written, each with a plausible wrong
// answer:
//
//   1. `wixl -a x64` sets Component `Attributes` to 256 — `msidbComponent-
//      Attributes64bit` — on its own, so `Win64="yes"` is neither written here nor
//      needed on either backend (`candle -arch x64` does the same).
//   2. An ABSOLUTE `Source=` resolves — and this file writes RELATIVE ones anyway,
//      which is the measurement changing a decision rather than confirming it. The
//      SAME document is compiled twice, on two machines: `wixl` here and WiX v3 on
//      the `windows-latest` leg, out of a `.wxs` that travelled as an artifact. An
//      absolute path is the build host's, so the second compile would fail on every
//      file. `root/<path>`, POSIX-separated, resolves for both — Win32 accepts `/`
//      — and it also keeps the document itself byte-identical between two builds of
//      one project in different directories.
//   3. An explicit `Product/@Id` GUID is honoured (`msiinfo export … Property`
//      prints it back verbatim), so the artifact can be DETERMINISTIC. `Id="*"`
//      would give every rebuild a different `ProductCode`.
//   4. A `<Shortcut Advertise="yes">` nested inside `<File>` compiles, which is
//      what keeps the shortcut in the launcher's own per-machine component instead
//      of a second component with an HKCU key path — the shape ICE43/ICE57 argue
//      about on `light`.
//   5. `Property/@Secure` is ACCEPTED and IGNORED by wixl (`SecureCustom-
//      Properties` came back holding only the two `MajorUpgrade` values), so this
//      file does not emit one: a `<Property Id="INSTALLDIR">` beside
//      `<Directory Id="INSTALLDIR">` would be a divergence between the backends
//      bought for nothing. A directory whose id is a public property is settable
//      from a command line either way.
//
// AND ONE THING IT USED NOT TO FIX. `node.exe` is a CONSOLE-subsystem image and
// the Node release ships no `nodew.exe`, so a Start-Menu shortcut to the `.cmd`
// popped a console window behind the GUI exactly as a double-click did. The
// shortcut now points at the GUI-subsystem launcher the windows LAYOUT stages
// (`utils/ship/pe-launcher.ts`), which runs the same `.cmd` with no window —
// measured on `win11-gjsify` in session 1, where the `.cmd` produces two new
// visible console-host windows and the `.exe` produces none. Still no CI leg can
// observe it: every Windows job starts the app from a shell and already has a
// console.

import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { describeExit, spawnToCompletion } from '../spawn.js';
import { windowsGuiLauncherPath } from './layout.js';
import type { HostOs, PackSettings } from './types.js';
import { xmlEscape } from './xml.js';

/**
 * The UUID namespace every GUID in a generated `.msi` is derived under.
 *
 * A CONSTANT, and changing it is a breaking change rather than a cosmetic one:
 * the `UpgradeCode` derived from it is how Windows Installer recognises an
 * already-installed copy of the same product, so a new namespace makes every
 * future release a SECOND product that installs beside the old one instead of
 * over it. Written down here rather than passed in for that reason — a knob would
 * be a knob that silently forks a product line.
 */
export const MSI_UUID_NAMESPACE = '7b3a1f6e-0c4d-4a2b-9e51-3d8c6f2a0b14';

/** RFC 4122 § 4.3 name-based UUID, SHA-1 flavour. */
export function uuid5(namespace: string, name: string): string {
    const ns = namespace.replace(/-/g, '');
    const nsBytes = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) nsBytes[i] = Number.parseInt(ns.slice(i * 2, i * 2 + 2), 16);
    const digest = createHash('sha1').update(nsBytes).update(new TextEncoder().encode(name)).digest();
    const bytes = Uint8Array.from(digest.subarray(0, 16));
    // Version 5 in the high nibble of byte 6, RFC 4122 variant in byte 8.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

/**
 * The code that identifies the PRODUCT LINE, stable across every version.
 *
 * Derived from the app id alone. That is what `MajorUpgrade` compares, so it must
 * NOT move when the version does — an `UpgradeCode` that changed per release would
 * leave every old version installed beside the new one, silently, with two entries
 * in Add/Remove Programs and two copies on disk.
 */
export function msiUpgradeCode(settings: PackSettings): string {
    return uuid5(MSI_UUID_NAMESPACE, `upgrade\n${settings.appId}`).toUpperCase();
}

/**
 * The code that identifies THIS build, and it has to move when the version does.
 *
 * The exact inverse of {@link msiUpgradeCode}: Windows Installer refuses to
 * install a second package carrying a `ProductCode` it already has, so a code that
 * did not change per version would make an upgrade a no-op. The arch is in the
 * material because an x64 and a (future) arm64 build of one version are two
 * products, not one.
 */
export function msiProductCode(settings: PackSettings, archLabel: string): string {
    const material = `product\n${settings.appId}\n${settings.version}\n${settings.release}\n${archLabel}`;
    return uuid5(MSI_UUID_NAMESPACE, material).toUpperCase();
}

/** A component's GUID, stable for as long as its path is. */
export function msiComponentGuid(settings: PackSettings, path: string): string {
    return uuid5(MSI_UUID_NAMESPACE, `component\n${settings.appId}\n${path}`).toUpperCase();
}

/**
 * MSI's `ProductVersion`, which is a much smaller vocabulary than npm's.
 *
 * `major.minor.build`, with `major`/`minor` at most 255 and `build` at most 65535 —
 * anything outside that is not a version Windows Installer will compare, and the
 * fourth field it accepts is IGNORED by upgrade detection, which is why nothing is
 * ever put there.
 *
 * A PRERELEASE IS REFUSED rather than truncated, and that is the interesting case.
 * `normaliseVersion` turns `1.2.0-rc.1` into `1.2.0~rc.1` because dpkg and rpm sort
 * a `~` before the release; MSI has no such spelling, so the only two options were
 * to drop the suffix or to say no. Dropping it makes `1.2.0~rc.1` and `1.2.0` the
 * same `ProductVersion` — two products `MajorUpgrade` cannot tell apart, so
 * installing the release over the candidate leaves BOTH on the machine. That is
 * the "installs cleanly, does the wrong thing" class, produced by the field meant
 * to prevent it.
 */
export function msiProductVersion(version: string): string {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version);
    if (match === null) {
        throw new Error(
            `gjsify ship: "${version}" is not a version an \`.msi\` can carry. Windows Installer's ` +
                '`ProductVersion` is `major.minor.build` and nothing else — no prerelease suffix, no build ' +
                'metadata.\n' +
                '    Dropping the suffix is not an option this command will take silently: `1.2.0~rc.1` and ' +
                '`1.2.0` would\n' +
                '    become the same version, `MajorUpgrade` could not tell them apart, and installing one over ' +
                'the other\n' +
                '    would leave both on the machine. Set `gjsify.ship.version` to a plain `x.y.z`, or drop ' +
                '`msi` from the targets.',
        );
    }
    const [major, minor, build] = [Number(match[1]), Number(match[2]), Number(match[3] ?? '0')];
    if (major > 255 || minor > 255 || build > 65535) {
        throw new Error(
            `gjsify ship: version "${version}" is outside what Windows Installer compares — \`major\` and ` +
                '`minor` are at most 255 and `build` at most 65535. A field over the limit is not rejected by ' +
                'the installer, it is\n' +
                '    TRUNCATED, so the artifact would carry a version that is not the one it was built from. ' +
                'Set `gjsify.ship.version`.',
        );
    }
    return `${major}.${minor}.${build}`;
}

/**
 * An MSI `Identifier`: `[A-Za-z_][A-Za-z0-9_.]{0,71}`.
 *
 * The readable tail is not decoration — `msiinfo export <msi> File` is the oracle,
 * and an id of pure hash makes a mismatch unreadable. The digest is what makes it
 * UNIQUE: it is taken over the full path, so two files whose last 57 characters
 * agree still differ. `renderWxs` asserts uniqueness anyway rather than trusting
 * 48 bits, because the failure of a collision is two files fighting over one row.
 */
export function msiIdentifier(prefix: string, path: string): string {
    const digest = createHash('sha1').update(new TextEncoder().encode(path)).digest('hex').slice(0, 12);
    const safe = path.replace(/[^A-Za-z0-9_.]/g, '_');
    const room = 72 - prefix.length - 2 - digest.length;
    return `${prefix}_${safe.length > room ? safe.slice(safe.length - room) : safe}_${digest}`;
}

/**
 * What Windows Installer will not hold in a `FileName`/`DefaultDir` cell.
 *
 * A SUPERSET of `windowsProgramDirName`'s rules and a different question: that one
 * asks what Win32 can create, this asks what the installer DATABASE can address.
 * MSI adds `;` (its list separator inside `DefaultDir`) and a 255-byte ceiling per
 * segment to the reserved characters, and refuses `.`/`..` outright.
 */
const MSI_NAME_FORBIDDEN = /[<>:"/\\|?*;]/;

function assertNameIsAddressable(segment: string, path: string): void {
    if (segment === '.' || segment === '..' || segment.length === 0 || MSI_NAME_FORBIDDEN.test(segment)) {
        throw new Error(
            `gjsify ship: the payload holds "${path}", and Windows Installer cannot address the path segment ` +
                `"${segment}". A \`FileName\` or \`DefaultDir\` cell reserves < > : " / \\ | ? * and ; (its own ` +
                'list separator), and \n    `.` and `..` are not names. The `.msi` would build and install the ' +
                'file somewhere else, or not at all.',
        );
    }
    if (segment.length > 255) {
        throw new Error(
            `gjsify ship: the payload holds "${path}", whose segment "${segment.slice(0, 40)}…" is ` +
                `${segment.length} characters. Windows Installer's \`FileName\` column is 255.`,
        );
    }
}

/** One payload file, as the installer will address it. */
export interface MsiFile {
    /** Program-directory-relative path, POSIX-separated. */
    path: string;
    /**
     * Where the bytes are, RELATIVE to the directory holding the `.wxs` and
     * POSIX-separated — see measurement 2 in this file's header. An absolute path
     * would make the document unusable on the second machine that compiles it.
     */
    source: string;
}

/** Where {@link buildMsi} writes the payload, and therefore what `Source=` is relative to. */
export const MSI_PAYLOAD_DIR = 'root';

export interface WxsInput {
    settings: PackSettings;
    /** Everything the program directory carries, in any order. */
    files: readonly MsiFile[];
    /** The directory the installer lays down — `windowsProgramDirName(settings)`. */
    programDirName: string;
    /** The format's spelling of the architecture, e.g. `x64`. */
    archLabel: string;
}

interface DirNode {
    /** Program-directory-relative path; `''` is `INSTALLDIR`. */
    path: string;
    name: string;
    children: Map<string, DirNode>;
    files: MsiFile[];
}

function directoryTree(files: readonly MsiFile[]): DirNode {
    const root: DirNode = { path: '', name: '', children: new Map(), files: [] };
    for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
        const segments = file.path.split('/');
        const leaf = segments.pop();
        if (leaf === undefined) throw new Error(`gjsify ship: the payload holds an empty path.`);
        let node = root;
        for (const segment of segments) {
            assertNameIsAddressable(segment, file.path);
            const next = node.children.get(segment) ?? {
                path: node.path === '' ? segment : `${node.path}/${segment}`,
                name: segment,
                children: new Map(),
                files: [],
            };
            node.children.set(segment, next);
            node = next;
        }
        assertNameIsAddressable(leaf, file.path);
        node.files.push(file);
    }
    return root;
}

/**
 * Render the installer's source document.
 *
 * PURE — a string in, a string out, no filesystem and no compiler — which is what
 * makes every decision above unit-testable on a machine with neither backend
 * installed. The one thing it cannot answer is whether a compiler accepts what it
 * wrote, and that is what the two legs are for.
 */
export function renderWxs(input: WxsInput): string {
    const { settings, programDirName, archLabel } = input;
    const productVersion = msiProductVersion(settings.version);
    // `Name <email>` is `PackSettings.maintainer`'s shape; ARP shows `Publisher`
    // to a human, and an address in that field reads as a mistake.
    const manufacturer = settings.maintainer.replace(/\s*<[^>]*>\s*$/, '').trim() || settings.maintainer;
    // THE SHORTCUT POINTS AT THE `.exe`, NOT THE `.cmd` — this installer's half of
    // the console-window fix. A Start-Menu shortcut to a batch file starts
    // `cmd.exe`, a console-subsystem image, so Windows allocates a console for it
    // and a black window sits behind the app (ADR 0024 § M3). The GUI-subsystem
    // launcher beside it — `utils/ship/pe-launcher.ts`, staged by the windows
    // LAYOUT — runs the same `.cmd` and has no window of its own.
    //
    // Derived from `windowsGuiLauncherPath` and never spelled again here: the stub
    // finds its `.cmd` by rewriting the last three characters of its own filename,
    // so the two names are ONE decision, and a second literal is where they would
    // come apart.
    const launcher = windowsGuiLauncherPath(settings);

    const identifiers = new Map<string, string>();
    const claim = (id: string, what: string): string => {
        const previous = identifiers.get(id);
        if (previous !== undefined) {
            throw new Error(
                `gjsify ship: the MSI identifier "${id}" would be shared by ${previous} and ${what}. ` +
                    'Two rows cannot carry one id — one would silently replace the other.',
            );
        }
        identifiers.set(id, what);
        return id;
    };

    const lines: string[] = [];
    const componentIds: string[] = [];
    let launcherFound = false;

    const emitDir = (node: DirNode, indent: string): void => {
        for (const file of node.files) {
            const componentId = claim(msiIdentifier('c', file.path), file.path);
            const fileId = claim(msiIdentifier('f', file.path), file.path);
            componentIds.push(componentId);
            const guid = msiComponentGuid(settings, file.path);
            // `posix.basename`, not `basename`: `MsiFile.path` is POSIX-separated
            // by construction (it is the STAGED path), and the host's separator is
            // not the authority for it — a Windows packing host would otherwise
            // split a name containing a backslash.
            const name = xmlEscape(posix.basename(file.path));
            lines.push(`${indent}<Component Id="${componentId}" Guid="${guid}">`);
            // THE SHORTCUT LIVES IN THE LAUNCHER'S OWN COMPONENT, nested in its
            // `<File>` and advertised. The obvious alternative — a second component
            // under `ProgramMenuFolder` whose key path is an HKCU registry value —
            // is the shape `light`'s ICE43 asks for and ICE57 then objects to,
            // because a per-machine install with a per-user key path is a component
            // that is half in each world. Nesting it makes the key path the file, so
            // the component is per-machine throughout and the shortcut is removed
            // with it.
            if (file.path === launcher) {
                launcherFound = true;
                lines.push(
                    `${indent}    <File Id="${fileId}" Name="${name}" ` +
                        `Source="${xmlEscape(file.source)}" KeyPath="yes">`,
                );
                lines.push(
                    `${indent}        <Shortcut Id="${claim('s_startmenu', 'the Start-Menu shortcut')}" ` +
                        `Directory="ProgramMenuFolder" Name="${xmlEscape(settings.name)}" ` +
                        `WorkingDirectory="INSTALLDIR" Description="${xmlEscape(settings.summary)}" ` +
                        `Advertise="yes" />`,
                );
                lines.push(`${indent}    </File>`);
            } else {
                lines.push(
                    `${indent}    <File Id="${fileId}" Name="${name}" ` +
                        `Source="${xmlEscape(file.source)}" KeyPath="yes" />`,
                );
            }
            lines.push(`${indent}</Component>`);
        }
        for (const child of [...node.children.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
            const dirId = claim(msiIdentifier('d', child.path), `the directory ${child.path}`);
            lines.push(`${indent}<Directory Id="${dirId}" Name="${xmlEscape(child.name)}">`);
            emitDir(child, `${indent}    `);
            lines.push(`${indent}</Directory>`);
        }
    };

    emitDir(directoryTree(input.files), '                    ');

    // EMPTINESS FIRST, and the order is load-bearing rather than tidy: an empty
    // payload has no launcher either, so the launcher refusal below fires on it and
    // sends the reader to look for a `.cmd` in a tree that has no files at all.
    if (componentIds.length === 0) {
        throw new Error('gjsify ship: the windows payload is empty, so there is nothing for an `.msi` to install.');
    }
    if (!launcherFound) {
        throw new Error(
            `gjsify ship: the windows payload carries no "${launcher}" at the root of the program directory, ` +
                'so the installer would have nothing to point a Start-Menu shortcut at — an application a user ' +
                'installs and\n    cannot start. `windows-dir` puts the launcher there; a payload without one ' +
                'is a stage assembled for another layout.',
        );
    }

    const about =
        settings.homepage === undefined
            ? []
            : [`        <Property Id="ARPURLINFOABOUT" Value="${xmlEscape(settings.homepage)}" />`];

    return [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<!-- Generated by `gjsify ship` (ADR 0024 stage 5). Do not edit; edit utils/ship/msi.ts. -->',
        '<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">',
        `    <Product Id="${msiProductCode(settings, archLabel)}" Name="${xmlEscape(settings.name)}" ` +
            `Language="1033" Version="${productVersion}" Manufacturer="${xmlEscape(manufacturer)}" ` +
            `UpgradeCode="${msiUpgradeCode(settings)}">`,
        `        <Package InstallerVersion="200" Compressed="yes" InstallScope="perMachine" ` +
            `Manufacturer="${xmlEscape(manufacturer)}" Description="${xmlEscape(settings.summary)}" />`,
        // The whole reason `UpgradeCode` is derived from the app id: this is what
        // takes the previous version off before laying the new one down.
        `        <MajorUpgrade DowngradeErrorMessage="A newer version of ${xmlEscape(settings.name)} is ` +
            `already installed." />`,
        // ONE embedded cabinet, so the artifact is the single file a browser
        // downloads rather than an `.msi` plus loose `.cab` siblings that a user
        // will separate from it.
        '        <Media Id="1" Cabinet="app.cab" EmbedCab="yes" />',
        ...about,
        '        <Directory Id="TARGETDIR" Name="SourceDir">',
        '            <Directory Id="ProgramFiles64Folder">',
        // ONE LEVEL, not `%ProgramFiles%\<Publisher>\<App>`, and the reason is an
        // assertion rather than taste: the tree this lays down is then byte-for-byte
        // the tree `windows-dir-zip` expands to, so the two artifacts can be
        // compared against each other instead of each against its own idea of the
        // layout. A publisher level would also be a directory nothing owns, left
        // behind empty by an uninstall.
        `                <Directory Id="INSTALLDIR" Name="${xmlEscape(programDirName)}">`,
        ...lines,
        '                </Directory>',
        '            </Directory>',
        // Declared and left empty: the shortcut reaches it by `Directory=`, so this
        // exists only to give that reference a row. No `<RemoveFolder>` on it — that
        // would ask the installer to delete the Start Menu's Programs folder itself.
        '            <Directory Id="ProgramMenuFolder" />',
        '        </Directory>',
        `        <Feature Id="Main" Title="${xmlEscape(settings.name)}" Level="1">`,
        ...componentIds.map((id) => `            <ComponentRef Id="${id}" />`),
        '        </Feature>',
        '    </Product>',
        '</Wix>',
        '',
    ].join('\n');
}

/** Which compiler a host has. */
export type MsiBackend = 'wixl' | 'wix3';

/**
 * The backend for one host.
 *
 * A FUNCTION of the host and nothing else, so the choice is testable from either
 * OS. `assertHostCanFinish` has already refused anything but these two by the time
 * this runs — the throw is for the caller that forgets to.
 */
export function msiBackendFor(host: string): MsiBackend {
    if (host === 'linux') return 'wixl';
    if (host === 'win32') return 'wix3';
    throw new Error(
        `gjsify ship: no MSI compiler is wired for ${host}. \`wixl\` (msitools) is used on linux and WiX v3 ` +
            'on win32; assembly is not host-bound, so `gjsify ship windows --stage` here and ' +
            '`gjsify ship --from-stage <dir> --target msi` there is the way across.',
    );
}

export interface MsiPackInput {
    settings: PackSettings;
    files: readonly MsiFile[];
    programDirName: string;
    archLabel: string;
    /** Working root for the rendered document and the compiler's intermediates. */
    workDir: string;
    /** Absolute path the finished `.msi` is written to. */
    target: string;
    verbose: boolean;
    /** Injected so the dispatch is testable off the host it selects for. */
    host?: HostOs;
}

/**
 * Render the document and compile it into `input.target`.
 *
 * The `.wxs` is KEPT in `workDir` rather than written to a temporary file, and
 * that is deliberate: it is the one artifact of this milestone a human can read,
 * it is what a bug report should carry, and it is what the Windows leg compiles a
 * SECOND time with WiX to produce the file the Linux oracle reads back.
 */
export async function buildMsi(input: MsiPackInput): Promise<string> {
    const host = input.host ?? (process.platform as HostOs);
    const backend = msiBackendFor(host);

    mkdirSync(input.workDir, { recursive: true });
    const wxsPath = join(input.workDir, `${input.settings.binaryName}.wxs`);
    writeFileSync(wxsPath, renderWxs(input));

    if (backend === 'wixl') {
        await run('wixl', ['-a', input.archLabel, '-o', input.target, wxsPath], input);
        return wxsPath;
    }

    // WiX v3 is two passes, and the intermediate directory is wiped between runs
    // for the reason the Flatpak packer wipes its repo: a `.wixobj` that survives a
    // failed compile is one `light` will happily link into an artifact wearing the
    // new version's filename.
    const objDir = join(input.workDir, 'obj');
    rmSync(objDir, { recursive: true, force: true, maxRetries: 5 });
    mkdirSync(objDir, { recursive: true });
    await run('candle.exe', ['-nologo', '-arch', input.archLabel, '-out', `${objDir}\\`, wxsPath], input);
    await run(
        'light.exe',
        ['-nologo', '-out', input.target, join(objDir, `${input.settings.binaryName}.wixobj`)],
        input,
    );
    return wxsPath;
}

async function run(cmd: string, args: readonly string[], input: MsiPackInput): Promise<void> {
    if (input.verbose) console.log(`[gjsify ship] ${cmd} ${args.join(' ')}`);
    // `completion: 'return'`, as the Flatpak packer does and for the same reason:
    // `ship` packs the remaining formats and prints the artifact list afterwards,
    // so it cannot end in `process.exit()`.
    const result = await spawnToCompletion(cmd, [...args], {
        completion: 'return',
        cwd: input.workDir,
        stdio: 'inherit',
        notFound: () =>
            new Error(
                `gjsify ship: ${cmd} not found. It is the MSI compiler for this host — ` +
                    'Fedora: `sudo dnf install msitools`, Debian/Ubuntu: `sudo apt install msitools`, ' +
                    'Windows: WiX Toolset v3.14 with its `bin` directory on PATH.',
            ),
    });
    if (result.code !== 0) {
        throw new Error(`gjsify ship: ${cmd} failed with ${describeExit(result)}.`);
    }
}
