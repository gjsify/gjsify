// SPDX-License-Identifier: MIT
// The `.wxs` renderer, driven from a machine that may have neither compiler.
//
// WHAT THIS FILE CAN AND CANNOT SAY. Everything here reads the DOCUMENT
// `utils/ship/msi.ts` writes: its identifiers, its GUIDs, its refusals, its
// shape. Whether a compiler accepts the document is a different question with a
// different reader, and it has two — `wixl` in `tests/e2e/ship-msi` and WiX v3 on
// the `windows-latest` leg. Nothing below is evidence about either.
//
// `packages/infra/cli/tsconfig.json` excludes `src/**/*.spec.ts`, so a green
// `tsc` proves nothing about this file. It is run by `@gjsify/unit`.

import { describe, expect, it } from '@gjsify/unit';

import { FORMATS } from './formats.js';
import {
    msiBackendFor,
    msiComponentGuid,
    msiIdentifier,
    msiProductCode,
    msiProductVersion,
    msiUpgradeCode,
    renderWxs,
    uuid5,
} from './msi.js';
import { xmlEscape } from './xml.js';
import type { PackSettings } from './types.js';

const SETTINGS: PackSettings = {
    binaryName: 'ship-demo',
    appId: 'org.example.ShipDemo',
    name: 'Ship Demo',
    version: '1.2.3',
    release: '1',
    maintainer: 'Example Dev <dev@example.org>',
    summary: 'Prove that gjsify ship works',
    description: ['A tiny GTK4 application.'],
    license: 'MIT',
    homepage: 'https://example.org/ship-demo',
    section: 'utils',
    group: 'Applications/Productivity',
    extraDepends: { deb: [], rpm: [] },
    typelibPackages: {},
    app: 'node',
    minGjsVersion: '1.86',
    minNodeVersion: '24',
    flatpak: {
        runtime: 'org.gnome.Platform',
        runtimeVersion: '50',
        sdk: 'org.gnome.Sdk',
        branch: 'stable',
        sdkExtensions: [],
        appendPath: [],
        finishArgs: [],
        cleanup: [],
    },
};

const FILES = [
    { path: 'ship-demo.cmd', source: 'root/ship-demo.cmd' },
    { path: 'node.exe', source: 'root/node.exe' },
    { path: 'app/main.node.mjs', source: 'root/app/main.node.mjs' },
    {
        path: 'lib/node-gi/prebuilds/win32-x64/node_gi.node',
        source: 'root/lib/node-gi/prebuilds/win32-x64/node_gi.node',
    },
    { path: 'share/licenses/ship-demo/LICENSE', source: 'root/share/licenses/ship-demo/LICENSE' },
];

const render = (settings: PackSettings = SETTINGS, files = FILES): string =>
    renderWxs({ settings, files, programDirName: 'Ship Demo', archLabel: 'x64' });

const refusal = (fn: () => unknown): string => {
    try {
        fn();
    } catch (error) {
        return (error as Error).message;
    }
    return '';
};

export default async () => {
    await describe('uuid5', async () => {
        await it('matches RFC 4122 § 4.3 on the published DNS vector', async () => {
            // The one place this implementation can be checked against something
            // it did not produce. `uuid5(DNS, "python.org")` is the vector in
            // CPython's own `uuid` docs, and getting the version/variant nibbles
            // wrong still yields a plausible-looking UUID — which is exactly why a
            // self-consistent "it is 36 characters" test would prove nothing.
            expect(uuid5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'python.org')).toBe(
                '886313e1-3b8a-5372-9b90-0c9aee199e5d',
            );
        });

        await it('sets version 5 and the RFC variant', async () => {
            const value = uuid5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'gjsify');
            expect(value[14]).toBe('5');
            expect('89ab'.includes(value[19] ?? '')).toBe(true);
        });
    });

    await describe('the two product codes', async () => {
        await it('holds the UpgradeCode still across versions, and moves the ProductCode', async () => {
            // The whole upgrade story in two lines. A moving UpgradeCode leaves
            // every old version installed BESIDE the new one; a still ProductCode
            // makes the upgrade a no-op. Both fail silently at exit 0.
            const next: PackSettings = { ...SETTINGS, version: '1.3.0' };
            expect(msiUpgradeCode(next)).toBe(msiUpgradeCode(SETTINGS));
            expect(msiProductCode(next, 'x64')).not.toBe(msiProductCode(SETTINGS, 'x64'));
        });

        await it('gives two apps different product lines', async () => {
            const other: PackSettings = { ...SETTINGS, appId: 'org.example.Other' };
            expect(msiUpgradeCode(other)).not.toBe(msiUpgradeCode(SETTINGS));
        });

        await it('separates the release and the architecture', async () => {
            expect(msiProductCode({ ...SETTINGS, release: '2' }, 'x64')).not.toBe(msiProductCode(SETTINGS, 'x64'));
            expect(msiProductCode(SETTINGS, 'arm64')).not.toBe(msiProductCode(SETTINGS, 'x64'));
        });

        await it('is DETERMINISTIC, which is what makes the artifact reproducible', async () => {
            expect(msiProductCode(SETTINGS, 'x64')).toBe(msiProductCode({ ...SETTINGS }, 'x64'));
            expect(msiComponentGuid(SETTINGS, 'app/main.mjs')).toBe(msiComponentGuid(SETTINGS, 'app/main.mjs'));
            expect(msiComponentGuid(SETTINGS, 'app/main.mjs')).not.toBe(msiComponentGuid(SETTINGS, 'app/other.mjs'));
        });

        await it('emits GUIDs in the upper case MSI writes them back in', async () => {
            // `msiinfo export … Component` prints `{AAAA…}`, so a lower-case
            // literal here would make every oracle comparison a case fold.
            expect(msiProductCode(SETTINGS, 'x64')).toBe(msiProductCode(SETTINGS, 'x64').toUpperCase());
            expect(msiUpgradeCode(SETTINGS)).toBe(msiUpgradeCode(SETTINGS).toUpperCase());
        });
    });

    await describe('msiProductVersion', async () => {
        await it('takes a plain x.y.z and fills in a missing build field', async () => {
            expect(msiProductVersion('1.2.3')).toBe('1.2.3');
            expect(msiProductVersion('2.0')).toBe('2.0.0');
        });

        await it('REFUSES a prerelease rather than truncating it', async () => {
            // `normaliseVersion` produces `1.2.0~rc.1` for dpkg and rpm. Dropping
            // the suffix would make it and `1.2.0` the same ProductVersion —
            // indistinguishable to MajorUpgrade, so both end up installed.
            const message = refusal(() => msiProductVersion('1.2.0~rc.1'));
            expect(message).toContain('1.2.0~rc.1');
            expect(message).toContain('MajorUpgrade');
            expect(message).toContain('gjsify.ship.version');
        });

        await it('refuses a field Windows Installer would TRUNCATE', async () => {
            expect(refusal(() => msiProductVersion('256.0.0'))).toContain('255');
            expect(refusal(() => msiProductVersion('1.0.70000'))).toContain('65535');
            expect(msiProductVersion('255.255.65535')).toBe('255.255.65535');
        });
    });

    await describe('msiIdentifier', async () => {
        await it('produces a legal MSI Identifier for a path full of illegal characters', async () => {
            const id = msiIdentifier('f', 'lib/node-gi/prebuilds/win32-x64/gtk/bin/libgtk-4-1.dll');
            expect(/^[A-Za-z_][A-Za-z0-9_.]*$/.test(id)).toBe(true);
            expect(id.length <= 72).toBe(true);
        });

        await it('stays inside 72 characters for a path far longer than that', async () => {
            const long = `${'a/'.repeat(60)}some-very-long-library-name-that-keeps-going.dll`;
            const id = msiIdentifier('f', long);
            expect(id.length <= 72).toBe(true);
            expect(/^[A-Za-z_][A-Za-z0-9_.]*$/.test(id)).toBe(true);
        });

        await it('separates two paths whose visible tails are identical', async () => {
            // The reason the digest is over the FULL path and the readable part is
            // only a tail: truncation alone collides, and a collision is two files
            // fighting over one row in the File table.
            const a = msiIdentifier('f', `${'x'.repeat(200)}/gtk/bin/libz.dll`);
            const b = msiIdentifier('f', `${'y'.repeat(200)}/gtk/bin/libz.dll`);
            expect(a).not.toBe(b);
        });
    });

    await describe('renderWxs', async () => {
        await it('nests each file under the directory it lives in', async () => {
            const wxs = render();
            expect(wxs).toContain('<Directory Id="INSTALLDIR" Name="Ship Demo">');
            expect(wxs).toContain('Name="app"');
            expect(wxs).toContain('Name="main.node.mjs"');
            expect(wxs).toContain('Name="node_gi.node"');
            // Every file gets its own component, which is what makes a component
            // GUID stable per path and an uninstall able to remove exactly this.
            const components = wxs.match(/<Component /g) ?? [];
            expect(components.length).toBe(FILES.length);
            const refs = wxs.match(/<ComponentRef /g) ?? [];
            expect(refs.length).toBe(FILES.length);
        });

        await it('installs under ProgramFiles64Folder with no publisher level', async () => {
            const wxs = render();
            expect(wxs).toContain('<Directory Id="ProgramFiles64Folder">');
            // One level, so the installed tree IS the tree `windows-dir-zip`
            // expands to — and no directory is left behind empty by an uninstall.
            expect(wxs).not.toContain('Name="Example Dev">');
        });

        await it('points the Start-Menu shortcut at the launcher, in the launcher’s own component', async () => {
            const wxs = render();
            const line = (wxs.split('\n').find((l) => l.includes('<Shortcut ')) ?? '').trim();
            expect(line).toContain('Directory="ProgramMenuFolder"');
            expect(line).toContain('Name="Ship Demo"');
            expect(line).toContain('Advertise="yes"');
            // Nested inside the `<File>`: the component's key path is the launcher,
            // so the component is per-machine throughout. A sibling component with
            // an HKCU key path is what ICE43 asks for and ICE57 then objects to.
            const shortcutIndex = wxs.indexOf('<Shortcut ');
            const openFile = wxs.lastIndexOf('<File ', shortcutIndex);
            expect(wxs.slice(openFile, shortcutIndex)).toContain('ship-demo.cmd');
        });

        await it('declares ProgramMenuFolder without asking to delete it', async () => {
            // `<RemoveFolder>` on ProgramMenuFolder would ask the installer to
            // remove the Start Menu's Programs folder itself. The shortcut is
            // removed by its own component; nothing else is created there.
            const wxs = render();
            expect(wxs).toContain('<Directory Id="ProgramMenuFolder" />');
            expect(wxs).not.toContain('<RemoveFolder');
        });

        await it('carries the upgrade rule, one embedded cabinet and the ARP link', async () => {
            const wxs = render();
            expect(wxs).toContain('<MajorUpgrade ');
            expect(wxs).toContain('Cabinet="app.cab" EmbedCab="yes"');
            expect(wxs).toContain('<Property Id="ARPURLINFOABOUT" Value="https://example.org/ship-demo" />');
        });

        await it('omits the ARP link when the project declares no homepage', async () => {
            const noHomepage: PackSettings = { ...SETTINGS };
            delete noHomepage.homepage;
            expect(render(noHomepage)).not.toContain('ARPURLINFOABOUT');
        });

        await it('strips the address out of the publisher a user is shown', async () => {
            // `Manufacturer` is what Add/Remove Programs prints as Publisher, and
            // `PackSettings.maintainer` is `Name <email>` because that is what
            // `Maintainer:`/`Packager:` want.
            const wxs = render();
            expect(wxs).toContain('Manufacturer="Example Dev"');
            expect(wxs).not.toContain('dev@example.org');
        });

        await it('escapes a display name XML would otherwise break on', async () => {
            const wxs = render({ ...SETTINGS, name: 'Fish & Chips <beta>' });
            expect(wxs).toContain('Name="Fish &amp; Chips &lt;beta&gt;"');
            expect(xmlEscape(`a"b'c`)).toBe('a&quot;b&apos;c');
        });

        await it('refuses a payload with no launcher at the program-directory root', async () => {
            // An installer whose shortcut points at nothing is an application a
            // user installs and cannot start.
            const message = refusal(() =>
                render(
                    SETTINGS,
                    FILES.filter((f) => f.path !== 'ship-demo.cmd'),
                ),
            );
            expect(message).toContain('ship-demo.cmd');
            expect(message).toContain('Start-Menu');
        });

        await it('refuses an empty payload rather than producing an installer of nothing', async () => {
            expect(refusal(() => render(SETTINGS, []))).toContain('nothing for an `.msi` to install');
        });

        await it('refuses a path segment the installer database cannot address', async () => {
            // A superset of the Win32 rules `windowsProgramDirName` applies, and a
            // different question: `;` is legal in a Win32 filename and is
            // `DefaultDir`'s own list separator.
            const message = refusal(() => render(SETTINGS, [...FILES, { path: 'app/a;b.mjs', source: '/w/root/x' }]));
            expect(message).toContain('a;b.mjs');
            expect(message).toContain('DefaultDir');
        });

        await it('addresses the payload relatively, so a second machine can compile it', async () => {
            // The `.wxs` travels to `windows-latest` as an artifact and WiX v3
            // compiles it there. An absolute `Source=` is the Linux build host's
            // path, so every file would be missing on the second compile — and the
            // document would carry a build directory into a published artifact.
            const wxs = render();
            expect(wxs).toContain('Source="root/app/main.node.mjs"');
            expect(wxs).not.toContain('Source="/');
            expect(wxs).not.toContain('Source="C:');
        });

        await it('is byte-identical across two renders of the same input', async () => {
            // Nothing in the document may come from a clock or a random source —
            // `Product Id="*"` would have, and it is what the explicit ProductCode
            // replaces.
            expect(render()).toBe(render());
        });
    });

    await describe('msiBackendFor', async () => {
        await it('picks wixl on Linux and WiX v3 on Windows', async () => {
            expect(msiBackendFor('linux')).toBe('wixl');
            expect(msiBackendFor('win32')).toBe('wix3');
        });

        await it('refuses the host the descriptor also refuses, and says the same thing', async () => {
            const message = refusal(() => msiBackendFor('darwin'));
            expect(message).toContain('darwin');
            expect(message).toContain('--from-stage');
            // The two refusals must not disagree about which hosts work.
            expect(FORMATS.msi.host.finishOn).toStrictEqual(['linux', 'win32']);
        });
    });
};
