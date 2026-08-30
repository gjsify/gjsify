// SPDX-License-Identifier: MIT
// The Flatpak target: what the manifest says, where it may be packed, and what
// happens to the six config keys that moved (ADR 0024 § 8).
//
// Everything here is pure — no flatpak tooling, no filesystem — because the leg
// that runs it is the one in CI, where there is none. What only a real
// `flatpak-builder` can answer (does `skip` work, does `cp -a` keep the mode,
// does the ref resolve) is `tests/e2e/ship-flatpak`, whose tier 3 runs where
// the GNOME runtime is installed.

import { describe, expect, it } from '@gjsify/unit';

import {
    allRequiredTools,
    assertHostCanFinish,
    assertToolsInstalled,
    defaultFormatIds,
    FORMATS,
    FORMAT_IDS,
    requiredToolsOn,
    resolveFormats,
} from './formats.js';
import {
    LEGACY_FLATPAK_KEYS_REMOVED_IN,
    MIGRATED_FLATPAK_KEYS,
    pickFlatpakBuildKeys,
    resolveShipFlatpakSettings,
} from './flatpak-config.js';
import { renderShipFlatpakManifest } from './flatpak.js';
import { LAYOUTS } from './layout.js';
import type { PackSettings } from './types.js';

function packSettings(overrides: Partial<PackSettings> = {}): PackSettings {
    return {
        binaryName: 'hello-app',
        appId: 'org.example.Hello',
        version: '1.2.3',
        release: '1',
        maintainer: 'Dev <dev@example.org>',
        summary: 'A demo',
        description: ['A demo.'],
        license: 'MIT',
        section: 'utils',
        group: 'Applications/System',
        extraDepends: { deb: [], rpm: [] },
        typelibPackages: {},
        app: 'gjs' as const,
        minGjsVersion: '1.86',
        minNodeVersion: '24',
        flatpak: {
            runtime: 'org.gnome.Platform',
            runtimeVersion: '50',
            sdk: 'org.gnome.Sdk',
            branch: 'stable',
            sdkExtensions: [],
            appendPath: [],
            finishArgs: ['--socket=wayland'],
            cleanup: [],
        },
        ...overrides,
    };
}

function manifest(settings: PackSettings = packSettings()): Record<string, unknown> {
    return renderShipFlatpakManifest({
        settings,
        stageDir: '/out/ship/stage',
        overlayDir: '/out/ship/overlay/flatpak',
        stageManifestFile: '.gjsify-ship-stage.json',
    });
}

interface FlatpakModule {
    name: string;
    buildsystem: string;
    'build-commands': string[];
    sources: Array<{ type: string; path: string; dest: string; skip?: string[] }>;
}

function soleModule(m: Record<string, unknown> = manifest()): FlatpakModule {
    const modules = m.modules as FlatpakModule[];
    expect(modules.length).toBe(1);
    return modules[0] as FlatpakModule;
}

export default async () => {
    await describe('renderShipFlatpakManifest', async () => {
        await it('installs the staged payload with `cp -a stage/.`, and no build system', async () => {
            // The whole point of stage 6: `buildsystem: meson` is what put 158
            // lines of glue inside the sandbox whose only job was to call
            // `gjsify build` and copy the result into a prefix. `ship` already
            // produced that prefix.
            const module = soleModule();
            expect(module.buildsystem).toBe('simple');
            expect(module['build-commands']).toStrictEqual([
                'mkdir -p /app',
                'cp -a stage/. /app/',
                'cp -a overlay/. /app/',
            ]);
        });

        await it('copies the CONTENTS of the stage, never the directory', async () => {
            // `cp -a stage /app/` creates `/app/stage` and puts the entire
            // payload one level too deep. It installs cleanly; `/app/bin` is
            // then empty and the app has no launcher.
            for (const command of soleModule()['build-commands']) {
                if (!command.startsWith('cp ')) continue;
                expect(command).toContain('/. /app/');
            }
        });

        await it('skips the stage manifest, which is closure and not payload', async () => {
            // `cp -a` copies dotfiles, so without this the stage's own
            // `.gjsify-ship-stage.json` ships inside /app. Nothing downstream
            // would ever complain about one extra file.
            const [stage, overlay] = soleModule().sources;
            expect(stage?.dest).toBe('stage');
            expect(stage?.skip).toStrictEqual(['.gjsify-ship-stage.json']);
            // The overlay is rendered by `planOverlay` and holds no sidecar.
            expect(overlay?.dest).toBe('overlay');
            expect(overlay?.skip).toBe(undefined);
        });

        await it('takes absolute source paths, so the stage need not sit beside the manifest', async () => {
            // Measured with flatpak-builder 1.4.10: an absolute `path` on a
            // `dir` source works. Relative-to-the-manifest would break
            // `--from-stage --out <elsewhere>`, where the stage and the
            // artifacts have no common ancestor.
            for (const source of soleModule().sources) {
                expect(source.path.startsWith('/')).toBe(true);
            }
        });

        await it('runs the launcher, not the app id', async () => {
            // `gjsify flatpak init` defaults `command` to the app id. Under
            // `ship` the only executable in /app/bin is `bin/<binaryName>`, and
            // a `command` naming anything else installs and cannot be launched.
            expect(manifest().command).toBe('hello-app');
        });

        await it('names the id, runtime, sdk and branch from the resolved settings', async () => {
            const m = manifest();
            expect(m.id).toBe('org.example.Hello');
            expect(m.runtime).toBe('org.gnome.Platform');
            expect(m['runtime-version']).toBe('50');
            expect(m.sdk).toBe('org.gnome.Sdk');
            // Declared here AND passed to `build-bundle`: the two have to name
            // the same ref, and `build-bundle`'s own default is `master`.
            expect(m.branch).toBe('stable');
            expect(m['finish-args']).toStrictEqual(['--socket=wayland']);
        });

        await it('omits the optional blocks rather than emitting empty ones', async () => {
            const m = manifest();
            expect(m['sdk-extensions']).toBe(undefined);
            expect(m['build-options']).toBe(undefined);
            expect(m.cleanup).toBe(undefined);
        });

        await it('joins appendPath into the single string flatpak-builder reads', async () => {
            const settings = packSettings();
            settings.flatpak.sdkExtensions = ['org.freedesktop.Sdk.Extension.llvm17'];
            settings.flatpak.appendPath = ['/usr/lib/sdk/llvm17/bin', '/app/bin'];
            const m = manifest(settings);
            expect(m['sdk-extensions']).toStrictEqual(['org.freedesktop.Sdk.Extension.llvm17']);
            expect(m['build-options']).toStrictEqual({ 'append-path': '/usr/lib/sdk/llvm17/bin:/app/bin' });
        });
    });

    await describe('format descriptors', async () => {
        await it('keeps the host-bound format out of the default target set', async () => {
            // A bare `gjsify ship` must not start demanding `flatpak-builder` of
            // every project that ever packaged a `.deb` — including
            // `release-cut.yml`, which packs @gjsify/cli on a bare ubuntu runner.
            expect(FORMAT_IDS).toContain('flatpak');
            expect(defaultFormatIds('linux')).toStrictEqual(['deb', 'rpm']);
        });

        await it('resolves flatpak only when it is asked for', async () => {
            expect(resolveFormats(['flatpak'], LAYOUTS.linux).map((f) => f.id)).toStrictEqual(['flatpak']);
            expect(resolveFormats(['deb,rpm,flatpak'], LAYOUTS.linux).map((f) => f.id)).toStrictEqual([
                'deb',
                'flatpak',
                'rpm',
            ]);
        });

        await it('gives every tool-needing format a way to install them', async () => {
            // The refusal is ONE generic function. Hardcoded in it, the hint said
            // `dnf install flatpak flatpak-builder` — correct for exactly one format,
            // and what the first `.dmg` or `.msi` user would have been told to run.
            //
            // `allRequiredTools` and NOT the current host's set: "does this row need
            // a hint" is a property of the row. Asking `requiredToolsOn(…, 'linux')`
            // would let a Windows-only tool ship with no hint because the gate ran
            // on Linux — the exact shape of a check that passes for the wrong reason.
            for (const id of FORMAT_IDS) {
                const { requiredTools, installHint } = FORMATS[id].host;
                if (allRequiredTools(requiredTools).length === 0) continue;
                expect(typeof installHint).toBe('string');
                expect((installHint ?? '').length > 0).toBe(true);
            }
        });

        await it('never names a tool for a host that cannot finish the format', async () => {
            // The per-OS `requiredTools` map arrived with the `.msi`, and its
            // failure mode is quiet: a key for an OS `finishOn` excludes is a tool
            // list nothing will ever read, so it can name anything — a typo, a
            // retired backend — and no run disagrees. `requiredToolsOn` answers `[]`
            // off the map for an unlisted host, so the two fields have to agree here
            // or the disagreement is invisible.
            for (const id of FORMAT_IDS) {
                const { finishOn, requiredTools } = FORMATS[id].host;
                if (Array.isArray(requiredTools)) continue;
                const named = Object.keys(requiredTools);
                expect(named.length > 0).toBe(true);
                for (const host of named) {
                    expect(finishOn === 'any' || (finishOn as readonly string[]).includes(host)).toBe(true);
                }
                // …and the other direction: a host that CAN finish it and is missing
                // from the map would silently need no tools at all.
                if (finishOn !== 'any') for (const host of finishOn) expect(named).toContain(host);
            }
        });

        await it('resolves the msi backend per host, and refuses the third OS', async () => {
            // The one row whose tools differ by host. Both halves are asserted from
            // this machine, which is the whole reason `requiredToolsOn` takes the
            // host rather than reading `process.platform`.
            expect(requiredToolsOn(FORMATS.msi.host.requiredTools, 'linux')).toContain('wixl');
            expect(requiredToolsOn(FORMATS.msi.host.requiredTools, 'win32')).toContain('candle.exe');
            expect(requiredToolsOn(FORMATS.msi.host.requiredTools, 'win32')).not.toContain('wixl');
            expect(requiredToolsOn(FORMATS.msi.host.requiredTools, 'darwin')).toStrictEqual([]);
            // A flat row answers the same list whoever asks.
            expect(requiredToolsOn(FORMATS.deb.host.requiredTools, 'win32')).toStrictEqual([]);
            expect(requiredToolsOn(FORMATS.flatpak.host.requiredTools, 'darwin')).toContain('flatpak-builder');
        });

        await it('publishes no format without an independent reader', async () => {
            // ADR 0024 § A3: `selfReading: true` is legal to DECLARE while a
            // format is being built and illegal to release. This is that
            // sentence as a test — a format that arrives with no discriminator
            // reds here, so flipping the field is somebody's decision rather
            // than a value nobody reads.
            for (const id of FORMAT_IDS) {
                const { oracle } = FORMATS[id].host;
                expect(oracle.selfReading).toBe(false);
                expect(oracle.readWith.length > 0).toBe(true);
                expect(oracle.readOn).toContain('linux');
            }
        });

        await it('gives every format a dependency answer, and flatpak answers `none`', async () => {
            expect(FORMATS.deb.depends).toBe('deb');
            expect(FORMATS.rpm.depends).toBe('rpm');
            // Not `'rpm'` by accident, which is what a `format !== 'deb'`
            // ternary produced: rpm package names in a Debian `Depends:`.
            expect(FORMATS.flatpak.depends).toBe(null);
        });

        await it('hangs the Flatpak payload under /app and everything else under /usr', async () => {
            expect(FORMATS.flatpak.prefix).toBe('/app');
            expect(FORMATS.deb.prefix).toBe('/usr');
            expect(FORMATS.rpm.prefix).toBe('/usr');
        });

        await it('never labels a Flatpak `noarch`', async () => {
            // apt and dnf REFUSE a package whose arch is not the machine's, so
            // `all`/`noarch` exist. Flatpak asks the opposite question: an app
            // with no arch in its ref is not installable at all.
            expect(FORMATS.flatpak.archName('x64', true)).toBe('x86_64');
            expect(FORMATS.flatpak.archName('arm64', true)).toBe('aarch64');
            expect(FORMATS.deb.archName('x64', true)).toBe('all');
        });

        await it('refuses an architecture it has no Flatpak name for', async () => {
            // Not a label: the arch is part of `app/<id>/<arch>/<branch>`, so a
            // guess is a ref nothing can install.
            expect(() => FORMATS.flatpak.archName('s390x', false)).toThrow();
        });
    });

    await describe('host requirements', async () => {
        await it('packs deb and rpm anywhere, with no tools at all', async () => {
            for (const id of defaultFormatIds('linux')) {
                assertHostCanFinish(FORMATS[id], 'darwin');
                assertToolsInstalled(FORMATS[id], () => false);
            }
        });

        await it('refuses a flatpak off Linux, and names the two-phase way across', async () => {
            let message = '';
            try {
                assertHostCanFinish(FORMATS.flatpak, 'darwin');
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('darwin');
            // A refusal that does not say `--stage` here / `--from-stage` there
            // reads as "unsupported", and the answer is a different job.
            expect(message).toContain('--stage');
            expect(message).toContain('--from-stage');
        });

        await it('allows a flatpak on Linux', async () => {
            assertHostCanFinish(FORMATS.flatpak, 'linux');
        });

        await it('names the missing tool rather than the format', async () => {
            let message = '';
            try {
                assertToolsInstalled(FORMATS.flatpak, (cmd) => cmd !== 'flatpak-builder');
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('flatpak-builder');
            // `--stage` needs neither tool, and a user told only "install
            // flatpak-builder" on a machine that cannot have it is stuck.
            expect(message).toContain('--stage');
        });

        await it('passes when both tools are present', async () => {
            assertToolsInstalled(FORMATS.flatpak, () => true);
        });

        await it('packs an msi on either Linux or Windows, and nowhere else', async () => {
            assertHostCanFinish(FORMATS.msi, 'linux');
            assertHostCanFinish(FORMATS.msi, 'win32');
            let message = '';
            try {
                assertHostCanFinish(FORMATS.msi, 'darwin');
            } catch (error) {
                message = (error as Error).message;
            }
            // Named rather than "unsupported": macOS CAN assemble the stage, so
            // the refusal has to point at the two-phase split and not at a wall.
            expect(message).toContain('linux or win32');
            expect(message).toContain('--from-stage');
        });

        await it('asks each msi host for ITS compiler and no other', async () => {
            // The defect a flat `requiredTools` would have shipped: the union
            // demands `wixl` of a Windows host that will never run it. Both
            // directions are driven from this machine.
            assertToolsInstalled(FORMATS.msi, (cmd) => cmd !== 'candle.exe', 'linux');
            assertToolsInstalled(FORMATS.msi, (cmd) => cmd !== 'wixl', 'win32');

            let onLinux = '';
            try {
                assertToolsInstalled(FORMATS.msi, (cmd) => cmd !== 'wixl', 'linux');
            } catch (error) {
                onLinux = (error as Error).message;
            }
            expect(onLinux).toContain('wixl');
            expect(onLinux).toContain('msitools');
            expect(onLinux).not.toContain('candle.exe');

            let onWindows = '';
            try {
                assertToolsInstalled(FORMATS.msi, (cmd) => cmd !== 'light.exe', 'win32');
            } catch (error) {
                onWindows = (error as Error).message;
            }
            expect(onWindows).toContain('light.exe');
            expect(onWindows).toContain('WiX Toolset');
            expect(onWindows).not.toContain('wixl');
        });
    });

    await describe('the gjsify.flatpak deprecation window', async () => {
        await it('resolves the new spelling silently', async () => {
            const { settings, warnings } = resolveShipFlatpakSettings({
                ship: { flatpak: { runtime: 'freedesktop', runtimeVersion: '24.08' } },
                flatpak: {},
                kind: 'app',
            });
            expect(settings.runtime).toBe('org.freedesktop.Platform');
            expect(settings.sdk).toBe('org.freedesktop.Sdk');
            expect(warnings).toStrictEqual([]);
        });

        await it('still resolves the old spelling, and warns naming the key and the release', async () => {
            const { settings, warnings } = resolveShipFlatpakSettings({
                ship: {},
                flatpak: { runtimeVersion: '49' },
                kind: 'app',
            });
            expect(settings.runtimeVersion).toBe('49');
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain('gjsify.flatpak.runtimeVersion');
            expect(warnings[0]).toContain('gjsify.ship.flatpak.runtimeVersion');
            // The `esbuild` shim's warning names a removal version the tree is
            // eight minors past, so its header has to say "removing the shim
            // means fixing that string too". One constant, and this assertion,
            // is what keeps the plan and the message the same sentence.
            expect(warnings[0]).toContain(LEGACY_FLATPAK_KEYS_REMOVED_IN);
        });

        await it('falls back per KEY, so a half-migrated project keeps both halves', async () => {
            const { settings, warnings } = resolveShipFlatpakSettings({
                ship: { flatpak: { runtimeVersion: '50' } },
                flatpak: { runtimeVersion: '47', finishArgs: ['--share=network'] },
                kind: 'app',
            });
            expect(settings.runtimeVersion).toBe('50');
            expect(settings.finishArgs).toStrictEqual(['--share=network']);
            // Only the key actually inherited is named — a warning that says
            // "this block is deprecated" leaves the reader to diff it by hand.
            expect(warnings[0]).toContain('gjsify.flatpak.finishArgs');
            expect(warnings[0]?.includes('gjsify.flatpak.runtimeVersion')).toBe(false);
        });

        await it('warns once for all inherited keys, in a stable order', async () => {
            const { warnings } = resolveShipFlatpakSettings({
                ship: {},
                flatpak: { runtime: 'gnome', finishArgs: [], cleanup: ['/include'] },
                kind: 'app',
            });
            expect(warnings.length).toBe(1);
            const at = (key: string) => warnings[0]?.indexOf(`gjsify.flatpak.${key}`) ?? -1;
            expect(at('runtime') < at('finishArgs')).toBe(true);
            expect(at('finishArgs') < at('cleanup')).toBe(true);
        });

        await it('does not deprecate the app metadata, which either block may carry', async () => {
            // Both `ConfigDataFlatpak` and `ConfigDataShip` extend `AppMetadata`
            // by design (§ 8: "those files are not Flatpak's, they are the
            // app's"). Warning on it would print for every project that has a
            // `gjsify.flatpak` block at all.
            const { warnings } = resolveShipFlatpakSettings({
                ship: {},
                flatpak: { name: 'Hello', summary: 'A demo', categories: ['Utility'] },
                kind: 'app',
            });
            expect(warnings).toStrictEqual([]);
        });

        await it('reads EVERY declared key from the old block, and names each one', async () => {
            // The list and the resolution used to be two copies: `MIGRATED_FLATPAK_KEYS`
            // was the vocabulary and six hand-written picks were the behaviour, so a key
            // added to the list with nothing reading it was simply not in the window —
            // and the only test that mentioned the constant compared it to a literal
            // copy of itself, which cannot fail. This drives the constant THROUGH the
            // resolver: a key the window does not actually read reds here.
            const legacy = {
                runtime: 'freedesktop' as const,
                runtimeVersion: '24.08',
                sdkExtensions: ['org.freedesktop.Sdk.Extension.node24'],
                appendPath: ['/usr/lib/sdk/node24/bin'],
                finishArgs: ['--share=network'],
                cleanup: ['/include'],
            };
            // The fixture has to declare every key, or the loop below is vacuous for
            // the ones it forgot.
            for (const key of MIGRATED_FLATPAK_KEYS) expect(legacy[key] === undefined).toBe(false);
            const { settings, warnings } = resolveShipFlatpakSettings({ ship: {}, flatpak: legacy, kind: 'app' });
            expect(warnings.length).toBe(1);
            for (const key of MIGRATED_FLATPAK_KEYS) expect(warnings[0]).toContain(`gjsify.flatpak.${key}`);
            // …and each value actually reached the settings, so "named in the warning"
            // cannot pass for a key the resolver ignores.
            expect(settings.runtime).toBe('org.freedesktop.Platform');
            expect(settings.runtimeVersion).toBe('24.08');
            expect(settings.sdkExtensions).toStrictEqual(legacy.sdkExtensions);
            expect(settings.appendPath).toStrictEqual(legacy.appendPath);
            expect(settings.finishArgs).toStrictEqual(legacy.finishArgs);
            expect(settings.cleanup).toStrictEqual(legacy.cleanup);
        });

        await it('resolves both spellings for `gjsify flatpak init` too', async () => {
            // The window has TWO sides, and the first cut built one. These six keys are
            // read by `flatpak init` and `flatpak ci` as well, and those commands have
            // not moved — so a project that followed the warning and moved them lost
            // them there, silently, in a manifest it commits. `pickFlatpakBuildKeys` is
            // the one resolution both command groups go through; this is the half
            // `ship`'s own tests never exercise.
            const moved = pickFlatpakBuildKeys({ runtimeVersion: '49', cleanup: ['/lib/pkgconfig'] }, {});
            expect(moved.values.runtimeVersion).toBe('49');
            expect(moved.values.cleanup).toStrictEqual(['/lib/pkgconfig']);
            expect(moved.fromLegacy).toStrictEqual([]);
            // The old spelling still answers, and the new one wins over it per key.
            const both = pickFlatpakBuildKeys(
                { runtimeVersion: '50' },
                { runtimeVersion: '47', cleanup: ['/include'] },
            );
            expect(both.values.runtimeVersion).toBe('50');
            expect(both.values.cleanup).toStrictEqual(['/include']);
            expect(both.fromLegacy).toStrictEqual(['cleanup']);
        });

        await it('gives a CLI no display sockets and an app the GUI set', async () => {
            const cli = resolveShipFlatpakSettings({ ship: {}, flatpak: {}, kind: 'cli' });
            expect(cli.settings.finishArgs).toStrictEqual([]);
            const app = resolveShipFlatpakSettings({ ship: {}, flatpak: {}, kind: 'app' });
            expect(app.settings.finishArgs).toContain('--socket=wayland');
        });

        await it('derives appendPath from the extensions, and only when undeclared', async () => {
            const derived = resolveShipFlatpakSettings({
                ship: { flatpak: { sdkExtensions: ['org.freedesktop.Sdk.Extension.node24'] } },
                flatpak: {},
                kind: 'cli',
            });
            expect(derived.settings.appendPath).toStrictEqual(['/usr/lib/sdk/node24/bin', '/app/bin']);
            const bare = resolveShipFlatpakSettings({ ship: {}, flatpak: {}, kind: 'cli' });
            expect(bare.settings.appendPath).toStrictEqual([]);
        });
    });
};
