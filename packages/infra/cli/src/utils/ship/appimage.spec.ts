// SPDX-License-Identifier: MIT
// The AppImage target: what appimagetool is told, what the AppDir contains, and
// the one sentence the artifact owes its user (ADR 0024 § 9, § A24,
// JumpLink/Learn6502#93).
//
// EVERYTHING HERE IS PURE EXCEPT ONE BLOCK, and the split is deliberate. The flag
// vector, the environment, the arch label, the AppRun text and the two refusals
// are decided without touching a filesystem and are wrong in ways nothing
// downstream can see — a missing `ARCH` makes appimagetool exit 1 on a payload
// that is fine, and a missing `--no-appstream` makes the pack succeed or fail
// depending on whether an unrelated package is installed. The one block that does
// touch a filesystem builds an AppDir in a temp directory and reads it back,
// because the property it holds is a LAYOUT property — the payload has to land
// under `usr/` and three files have to appear at the root — and a test that
// asserted on a returned data structure would not notice the day the writer
// stopped writing.
//
// WHAT IS DELIBERATELY NOT HERE: appimagetool itself. It is on no CI image and on
// no contributor's machine by default, so the question "does the image mount and
// run" belongs to `tests/e2e/ship-appimage`'s real tier and to
// `.github/ship-oracle/verify-appimage.py`, not to a unit file that would have to
// skip on every host that matters.

import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

import {
    APPIMAGE_TOOL,
    appDirFor,
    DIR_ICON_NAME,
    appDirPaths,
    appDirPayload,
    appImageHostRequirements,
    appImageToolArgs,
    appImageToolEnv,
    appImageToolFailureMessage,
    assertAppImageIsPackable,
    EXTRACT_AND_RUN,
    renderAppRun,
    selectAppDirIcon,
    stampAppDirTimes,
} from './appimage.js';
import {
    assertHostCanFinish,
    assertToolsInstalled,
    defaultFormatIds,
    FORMATS,
    FORMAT_IDS,
    formatIdsFor,
    resolveFormats,
} from './formats.js';
import { LAYOUTS } from './layout.js';
import type { PayloadEntry } from './payload.js';
import { SCHEMA_COMPILER } from './schemas.js';
import type { PackSettings } from './types.js';

function packSettings(overrides: Partial<PackSettings> = {}): PackSettings {
    return {
        binaryName: 'ship-demo',
        appId: 'org.example.ShipDemo',
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
        name: 'Ship Demo',
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
        ...overrides,
    };
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A minimal complete linux payload: a launcher, a desktop entry, two icons. */
function payload(extra: readonly PayloadEntry[] = []): PayloadEntry[] {
    return [
        { path: 'bin/ship-demo', mode: 0o755, data: bytes('#!/bin/sh\nexec gjs -m "$0"\n') },
        {
            path: 'share/applications/org.example.ShipDemo.desktop',
            mode: 0o644,
            data: bytes('[Desktop Entry]\nIcon=org.example.ShipDemo\n'),
        },
        {
            path: 'share/icons/hicolor/64x64/apps/org.example.ShipDemo.png',
            mode: 0o644,
            data: bytes('64px'),
        },
        {
            path: 'share/icons/hicolor/256x256/apps/org.example.ShipDemo.png',
            mode: 0o644,
            data: bytes('256px'),
        },
        ...extra,
    ];
}

/** The value appimagetool receives for a flag, so an assertion names the pair and not an index. */
function flag(name: string, vector: string[]): string | undefined {
    const at = vector.indexOf(name);
    return at === -1 ? undefined : vector[at + 1];
}

export default async () => {
    await describe('appImageToolArgs', async () => {
        const args = appImageToolArgs({ appDir: '/out/ship/appimage/AppDir', target: '/out/ship/out/x.AppImage' });

        await it('turns OFF the AppStream validation, because it is a host-dependent gate', async () => {
            // THE FLAG THIS WHOLE FILE EXISTS FOR, in the same slot `-fs HFS+J` has
            // in `dmg.spec.ts`. appimagetool otherwise runs `appstreamcli
            // validate-tree` over the AppDir — so the pack passes on a workstation
            // that happens to have `appstream` installed and fails in a container
            // that does not, over a payload that is byte-identical. That is a gate
            // whose result is about the machine, which is the same class as a check
            // that never ran. The MetaInfo has a validator of its own:
            // `gjsify flatpak check --appstream`.
            expect(args).toContain('--no-appstream');
        });

        await it('pins the compression rather than inheriting a default that can change', async () => {
            // `dmg.spec.ts`'s argument, one format over: the reader has to be able
            // to open what we ship. `unsquashfs` reads zstd only where its zstd
            // support was compiled in — measured present on Fedora 44 and on
            // ubuntu-24.04, both squashfs-tools 4.6.1. Pinning means the day
            // appimagetool's default moves, this line changes and the reader is
            // considered; inheriting means the reader silently stops reading.
            expect(flag('--comp', args)).toBe('zstd');
        });

        await it('passes the AppDir and the target, in that order and last', async () => {
            // appimagetool's positional contract is `SOURCE [DESTINATION]`, and
            // getting it backwards writes an AppImage called `AppDir` — at exit 0,
            // because both are just paths to it.
            expect(args.slice(-2)).toStrictEqual(['/out/ship/appimage/AppDir', '/out/ship/out/x.AppImage']);
        });

        await it('passes NO runtime file, which is this row’s open cost', async () => {
            // NOT because 1.9.1 embeds one. Re-measured on the build the Dockerfile
            // pins: it DOWNLOADS the type2 runtime from a rolling `continuous` tag
            // on every pack, the host's own architecture included, caches nothing,
            // and with the network gone exits 1 having written no file. So this
            // assertion records a COST rather than a property — passing a runtime
            // means deciding where a pinned one comes from (licence, and who
            // fetches it), and until then the artifact carries bytes nothing in
            // this tree pins. `status/open-todos.md` → "The AppImage pack is not
            // offline".
            expect(args).not.toContain('--runtime-file');
        });
    });

    await describe('appImageToolFailureMessage', async () => {
        const message = appImageToolFailureMessage('code 1');

        await it('names the NETWORK first, which is where an offline host actually fails', async () => {
            // The cause that was missing while the module claimed the pack was
            // offline. A message listing three LOCAL causes sends the reader of an
            // offline failure to install `file` on a machine that already has it.
            expect(message).toContain('type2-runtime');
            expect(message.indexOf('type2-runtime')).toBeLessThan(message.indexOf('file(1)'));
        });

        await it('still names the two container failures and the full disk', async () => {
            expect(message).toContain('file(1)');
            expect(message).toContain(EXTRACT_AND_RUN);
            expect(message).toContain('work directory is full');
            // The exit is the caller's `describeExit`, so the message cannot be
            // asserted without carrying it through.
            expect(message).toContain('code 1');
        });
    });

    await describe('appImageToolEnv', async () => {
        await it('sets ARCH, because appimagetool cannot read an architecture off JavaScript', async () => {
            // appimagetool derives the architecture from the ELF binaries in the
            // AppDir. A `--app gjs` payload is JavaScript and a `/bin/sh` launcher,
            // so there is nothing to read and the tool exits 1 with "Could not
            // determine architecture automatically" — on a payload that is correct.
            expect(appImageToolEnv('x86_64').ARCH).toBe('x86_64');
        });

        await it('takes the FUSE-less path by default, so a container needs no special knowledge', async () => {
            // appimagetool is itself an AppImage and mounts itself through libfuse
            // to start, which a container without `/dev/fuse` cannot do. The
            // runtime reads this variable and extracts instead; a native build
            // ignores a variable it does not read. So there is no host for which
            // this is wrong, and no flag a CI author has to discover.
            expect(appImageToolEnv('x86_64')[EXTRACT_AND_RUN]).toBe('1');
            expect(EXTRACT_AND_RUN).toBe('APPIMAGE_EXTRACT_AND_RUN');
        });
    });

    await describe('appImageHostRequirements', async () => {
        await it('names the interpreter FIRST, with the floor the .deb would declare', async () => {
            // The one requirement that is never satisfied by accident, and the only
            // one `AppRun` can check from a shell. Same floors `deriveDepends`
            // seeds `Depends: gjs (>= 1.86)` from, so the AppImage and the `.deb`
            // built from one payload cannot disagree.
            const gjs = appImageHostRequirements({ app: 'gjs', minGjsVersion: '1.86', namespaces: [] });
            expect(gjs[0]).toBe('gjs (>= 1.86)');
            const node = appImageHostRequirements({ app: 'node', minNodeVersion: '24', namespaces: [] });
            expect(node[0]).toBe('node (>= 24)');
        });

        await it('names the typelibs WITHOUT a distro package name', async () => {
            // A `.deb` says `gir1.2-gtk-4.0` and an `.rpm` says `gtk4`; an AppImage
            // has no distribution to name one in, so it names the namespace. A user
            // on Arch reading `gir1.2-gtk-4.0` learns nothing.
            const needs = appImageHostRequirements({ app: 'gjs', namespaces: ['Gtk-4.0', 'Adw-1'] });
            expect(needs).toContain('the Adw-1 typelib');
            expect(needs).toContain('the Gtk-4.0 typelib');
            expect(needs.some((need) => need.includes('gir1.2'))).toBe(false);
        });

        await it('drops what the payload CARRIES, by the same rule the .deb drops it', async () => {
            // `hostProvidedNamespaces` is shared with `deriveDepends` precisely so
            // this cannot drift: a typelib in the payload is not a host
            // requirement, and a `Gjsify*` bridge never was one. The negative
            // control is the third namespace, which must survive.
            const needs = appImageHostRequirements({
                app: 'gjs',
                namespaces: ['Gwebgl-0.1', 'GjsifyHttpSoupBridge', 'Gtk-4.0'],
                bundledTypelibs: ['lib/ship-demo/gi/Gwebgl-0.1.typelib'],
            });
            expect(needs).toStrictEqual(['gjs (>= 1.86)', 'the Gtk-4.0 typelib']);
        });
    });

    await describe('renderAppRun', async () => {
        const script = renderAppRun(packSettings(), ['gjs (>= 1.86)', 'the Gtk-4.0 typelib']);

        await it('execs the STAGED launcher under `usr/` and re-exports nothing', async () => {
            // The launcher already resolves its own prefix and exports
            // XDG_DATA_DIRS, GI_TYPELIB_PATH, GJSIFY_LOCALE_DIR and
            // GJSIFY_FONT_DIR relative to it — inside a mount that is
            // `/tmp/.mount_xxxx/usr`, measured. A second answer here would be the
            // copy that drifts, and `tests/e2e/ship-layout` compares staged trees,
            // not this script.
            expect(script).toContain('exec "$here/usr/bin/ship-demo" "$@"');
            expect(script).not.toContain('XDG_DATA_DIRS');
            expect(script).not.toContain('GI_TYPELIB_PATH');
        });

        await it('refuses with a SENTENCE when the interpreter is missing', async () => {
            // ADR 0024 § 9's objection made into a mechanism. Without this the
            // artifact answers a missing runtime with `gjs: not found` from a
            // shell, or with nothing at all when a desktop launches it — and the
            // user concludes the download is broken rather than that their system
            // is missing GJS.
            expect(script).toContain('command -v gjs');
            expect(script).toContain('This AppImage carries the application, not its runtime.');
            expect(script).toContain('  - gjs (>= 1.86)');
            expect(script).toContain('  - the Gtk-4.0 typelib');
            expect(script).toContain('exit 127');
        });

        await it('checks the interpreter the PROJECT declared, not a hardcoded gjs', async () => {
            // `settings.app` is per target (ADR 0024 § A22) and a `--app node`
            // project shipping an AppImage that probes for `gjs` would refuse to
            // start on a machine that can run it perfectly.
            expect(renderAppRun(packSettings({ app: 'node' }), [])).toContain('command -v node');
        });

        await it('does not let a display name reach the shell as an expansion', async () => {
            // `settings.name` is whatever a project called itself, and it is
            // interpolated into a double-quoted `echo`. A `$` or a backtick there
            // would produce a message with a variable expansion or a command
            // substitution in it — in the one file nobody reads until it has
            // already failed.
            const escaped = renderAppRun(packSettings({ name: 'Ship $HOME `id`' }), []);
            expect(escaped).toContain('Ship \\$HOME \\`id\\`');
        });
    });

    await describe('selectAppDirIcon', async () => {
        await it('takes the LARGEST raster, read off the hicolor path', async () => {
            // The size is in the directory name, so nothing here decodes a PNG.
            const icon = selectAppDirIcon(payload(), 'org.example.ShipDemo');
            expect(icon?.path).toBe('share/icons/hicolor/256x256/apps/org.example.ShipDemo.png');
        });

        await it('prefers a scalable SVG over every raster size', async () => {
            const icon = selectAppDirIcon(
                payload([
                    {
                        path: 'share/icons/hicolor/scalable/apps/org.example.ShipDemo.svg',
                        mode: 0o644,
                        data: bytes('<svg/>'),
                    },
                ]),
                'org.example.ShipDemo',
            );
            expect(icon?.path).toBe('share/icons/hicolor/scalable/apps/org.example.ShipDemo.svg');
        });

        await it('never picks a symbolic icon as the application’s face', async () => {
            // A symbolic icon is a 16px monochrome glyph in a context of its own,
            // and its staged basename is `<appId>-symbolic` — which is not what the
            // desktop entry's `Icon=` says. Shipping it as the root icon would put
            // a glyph in a file manager where the application's icon belongs.
            const only = selectAppDirIcon(
                [
                    {
                        path: 'share/icons/hicolor/symbolic/apps/org.example.ShipDemo-symbolic.svg',
                        mode: 0o644,
                        data: bytes('<svg/>'),
                    },
                ],
                'org.example.ShipDemo',
            );
            expect(only).toBe(undefined);
        });

        await it('refuses the symbolic CONTEXT too, not only the -symbolic name', async () => {
            // WITHOUT THIS THE TEST ABOVE PASSES FOR THE WRONG REASON, and that was
            // MEASURED rather than reasoned: deleting the `/symbolic/` guard left
            // the whole suite green, because `<appId>-symbolic.svg` is already
            // excluded by the basename match. `symbolic` is a CONTEXT in a hicolor
            // theme and not a size, so a plain-named file can sit in it —
            // `gjsify.ship.extraFiles` is the route, since `plan.ts` renames a
            // symbolic icon to `<appId>-symbolic` itself.
            //
            // ALONE, because that is the only arrangement where the guard changes
            // the answer: beside any raster the size ranking already wins. So the
            // choice being tested is "a 16px monochrome glyph is not this
            // application's face" — and an AppImage whose icon is a glyph is worse
            // than a refusal naming the key that would fix it.
            const glyphOnly = selectAppDirIcon(
                [
                    {
                        path: 'share/icons/hicolor/symbolic/apps/org.example.ShipDemo.svg',
                        mode: 0o644,
                        data: bytes('<svg/>'),
                    },
                ],
                'org.example.ShipDemo',
            );
            expect(glyphOnly).toBe(undefined);
        });

        await it('ignores a file that merely ends with the app id somewhere else', async () => {
            // The negative control for the two rules above: without the
            // `share/icons/hicolor/` requirement a `gjsify.ship.extraFiles`
            // destination called `share/doc/org.example.ShipDemo.png` would become
            // the application's icon.
            const stray = selectAppDirIcon(
                [{ path: 'share/doc/org.example.ShipDemo.png', mode: 0o644, data: bytes('x') }],
                'org.example.ShipDemo',
            );
            expect(stray).toBe(undefined);
        });
    });

    await describe('assertAppImageIsPackable', async () => {
        await it('refuses a payload with no desktop entry, and names the config key', async () => {
            // appimagetool's own answer is "Desktop file not found, aborting" —
            // true, and about a file the author never wrote. A `kind: 'cli'`
            // project stages none BY DESIGN, so the message that helps names the
            // key that decided it and the three formats that need no entry.
            let message = '';
            try {
                assertAppImageIsPackable(
                    payload().filter((entry) => !entry.path.endsWith('.desktop')),
                    packSettings(),
                );
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('gjsify.ship.kind');
            expect(message).toContain('desktop entry');
        });

        await it('refuses a payload with no icon, and names the config key', async () => {
            let message = '';
            try {
                assertAppImageIsPackable(
                    payload().filter((entry) => !entry.path.endsWith('.png')),
                    packSettings(),
                );
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('gjsify.ship.icon');
        });

        await it('passes a complete payload', async () => {
            assertAppImageIsPackable(payload(), packSettings());
        });
    });

    await describe('appDirPayload', async () => {
        // PURE, because the AppDir is one `writePayload` call away from this list —
        // `packOne` owns the writer for every format and the packer owns what goes
        // in it, the shape `msi.ts` and `dmg.ts` already have. So the layout is a
        // property of a list, and asserting on it needs no temp directory.
        const tree = appDirPayload(packSettings(), payload(), ['gjs (>= 1.86)']);
        const at = (path: string): PayloadEntry | undefined => tree.find((entry) => entry.path === path);
        const text = (path: string): string => new TextDecoder().decode(at(path)?.data ?? new Uint8Array());

        await it('puts the whole prefix under `usr/`, unchanged', async () => {
            // The one layout difference between this format and the `.deb`, and the
            // reason `prefix` can stay `/usr`. If the payload landed at the AppDir
            // root instead, the staged launcher would compute the MOUNTPOINT as its
            // prefix and every locator it exports would be one directory too high —
            // which the image would not notice until the app looked for a schema.
            expect(text('usr/bin/ship-demo')).toContain('exec gjs -m');
            expect(text('usr/share/applications/org.example.ShipDemo.desktop')).toContain('[Desktop Entry]');
            // NOTHING from the prefix is left at the root. The negative control for
            // the rule above: a `map` that forgot the prefix would satisfy every
            // root assertion below and none of these.
            expect(at('bin/ship-demo')).toBe(undefined);
        });

        await it('keeps the payload’s modes, so the launcher is executable in the image', async () => {
            // squashfs stores modes, and an AppImage whose launcher is 0644 mounts
            // fine and refuses to start. The entries carry the plan's modes through
            // `writePayload` — a directory copy of the stage would inherit whatever
            // an artifact round trip left behind.
            expect(at('usr/bin/ship-demo')?.mode).toBe(0o755);
        });

        await it('adds the files an AppDir needs at its ROOT', async () => {
            // appimagetool refuses an AppDir without a `.desktop` at the root, and
            // the file its `Icon=` names has to sit beside it. Neither is in the
            // prefix, which is why they are added here rather than staged — no
            // change to `plan.ts`, ADR 0024 § 2's claim holding for a fourth format.
            expect(text('AppRun')).toContain('#!/bin/sh');
            expect(text('org.example.ShipDemo.desktop')).toContain('[Desktop Entry]');
            expect(text('org.example.ShipDemo.png')).toBe('256px');
        });

        await it('makes AppRun executable, which is the difference between mounting and running', async () => {
            expect(at('AppRun')?.mode).toBe(0o755);
        });

        await it('copies the desktop entry rather than rendering it a second time', async () => {
            // The AppImage specification wants the same entry in two places. Two
            // RENDERS would be two answers; one render copied twice cannot
            // disagree with itself.
            expect(text('org.example.ShipDemo.desktop')).toBe(
                text('usr/share/applications/org.example.ShipDemo.desktop'),
            );
        });

        await it('writes `.DirIcon` ITSELF, because appimagetool writes it after the stamp', async () => {
            // MEASURED AS A DEFECT, not anticipated. appimagetool creates
            // `.DirIcon` when the AppDir has none — as a symlink, with the wall
            // clock, after `stampAppDirTimes` has run, and it moves the AppDir
            // root's own mtime doing it. Two packs of ONE build then differ in
            // sha256 with every listing, mode, size and content byte identical.
            // Writing it here means appimagetool finds it and touches nothing.
            expect(text(DIR_ICON_NAME)).toBe(text('org.example.ShipDemo.png'));
            expect(at(DIR_ICON_NAME)?.mode).toBe(0o644);
        });

        await it('REFUSES an incomplete payload itself, not only through the assertion above', async () => {
            // The mutation the three `assertAppImageIsPackable` tests above cannot
            // see: they call it directly, so deleting its CALL from `appDirPayload`
            // leaves them all green — and `packOne` is the only production caller.
            // What would then happen is the `as PayloadEntry` cast one line down
            // handing `undefined.data` to the root-file entries, i.e. a TypeError
            // about `data` instead of the sentence naming `gjsify.ship.kind`.
            let message = '';
            try {
                appDirPayload(
                    packSettings(),
                    payload().filter((entry) => !entry.path.endsWith('.desktop')),
                    [],
                );
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('gjsify.ship.kind');
        });

        await it('is ONE list, so the write that lays it down wipes the root once', async () => {
            // `writePayload` WIPES what it is pointed at. Two calls — one for `usr/`
            // and one for the root files — would leave a previous run's
            // `<appId>.desktop` and icon at a root the second call never cleaned,
            // and appimagetool packs an AppDir holding two desktop files without
            // complaining about either.
            expect(tree.length).toBe(payload().length + 4);
        });

        await it('names every directory above a file, deepest last, so a stamp reaches them', async () => {
            // Derived from the payload rather than from a directory walk: a walk
            // reads back whatever the writer happened to leave, which is the one
            // thing a check on the writer must not do.
            const paths = appDirPaths(tree);
            expect(paths).toContain('usr');
            expect(paths).toContain('usr/share/icons/hicolor/256x256/apps');
            expect(paths.indexOf('usr')).toBeLessThan(paths.indexOf('usr/bin/ship-demo'));
        });

        await it('stamps every path with the run’s mtime, which is what makes the pack reproducible', async () => {
            // MEASURED, and it is the ONLY difference between two packs of one
            // build: appimagetool pins the squashfs superblock time to epoch 0
            // already, and mksquashfs stores per-file mtimes. Without this stamp
            // two `gjsify ship --target appimage` runs over one build produce
            // different sha256s — which breaks a promise `ship` makes for every
            // other format. On disk, because a time is only observable there.
            const root = mkdtempSync(join(tmpdir(), 'gjsify-appimage-spec-'));
            const appDir = appDirFor(root);
            const mtime = 1_700_000_000;
            for (const entry of tree) {
                const target = join(appDir, entry.path.split('/').join(sep));
                mkdirSync(dirname(target), { recursive: true });
                writeFileSync(target, entry.data);
            }
            stampAppDirTimes(appDir, tree, mtime);
            expect(statSync(join(appDir, 'AppRun')).mtimeMs).toBe(mtime * 1000);
            expect(statSync(join(appDir, 'usr', 'bin', 'ship-demo')).mtimeMs).toBe(mtime * 1000);
            // Directories too — a squashfs directory inode carries a time of its own.
            expect(statSync(join(appDir, 'usr', 'share')).mtimeMs).toBe(mtime * 1000);
            expect(statSync(appDir).mtimeMs).toBe(mtime * 1000);
            rmSync(root, { recursive: true, force: true });
        });

        await it('assembles apart from the artifacts, so nothing rides into the image', async () => {
            // appimagetool packs EVERYTHING under the AppDir. An AppDir that was
            // also the output directory would put the previous run's `.AppImage`
            // inside this run's — and the reader that would catch it is the same
            // listing comparison that would then have to be taught to ignore it.
            // The PROPERTY, not the implementation: `join`/`sep` throughout, for
            // the reason `dmg.spec.ts` records after a red windows leg.
            const outRoot = join('build', 'ship');
            const artifacts = join(outRoot, 'out');
            const dir = appDirFor(outRoot);
            expect(dir === artifacts).toBe(false);
            expect(dir.startsWith(`${artifacts}${sep}`)).toBe(false);
            expect(dir.startsWith(`${outRoot}${sep}`)).toBe(true);
        });
    });

    await describe('the appimage format descriptor', async () => {
        await it('wraps the LINUX layout under the same prefix as the .deb', async () => {
            const appimage = FORMATS.appimage;
            expect(appimage.layoutOs).toBe('linux');
            // ADR 0024 § 2's claim, tested on the fourth linux row: nothing in the
            // payload moves. The AppDir's `usr/` IS the prefix at runtime.
            expect(appimage.prefix).toBe('/usr');
            expect(appimage.prefix).toBe(FORMATS.deb.prefix);
            expect(appimage.artifactKind).toBe('file');
        });

        await it('has no dependency FIELD, which is not the same as no dependencies', async () => {
            // The distinction this row exists to keep honest. `depends: null`
            // means there is nowhere in the artifact to write a package list —
            // and `appImageHostRequirements` plus `AppRun` are what say it anyway.
            expect(FORMATS.appimage.depends).toBe(null);
            expect(FORMATS.appimage.interpreters).toStrictEqual(['gjs', 'node']);
            expect(FORMATS.appimage.interpreterGap).toContain('AppRun');
        });

        await it('is Linux-bound the way flatpak is, and execs appimagetool alone', async () => {
            // NOT the `.dmg`'s kind of host-boundness: the container is an ELF
            // runtime for Linux, so the format is bound the way the application is.
            expect(FORMATS.appimage.host.finishOn).toStrictEqual(['linux']);
            expect(FORMATS.appimage.host.requiredTools).toStrictEqual([APPIMAGE_TOOL]);
            expect(APPIMAGE_TOOL).toBe('appimagetool');
            // The schema compiler is an ASSEMBLY tool and `assertToolsInstalled`
            // fires on the PACK path — declaring it here would refuse a
            // `--from-stage` pack whose `gschemas.compiled` already arrived.
            expect(FORMATS.appimage.host.requiredTools).not.toContain(SCHEMA_COMPILER);
        });

        await it('reads back with two tools, neither of them appimagetool', async () => {
            // ADR 0024 § A3. The artifact's own `--appimage-offset` and
            // `--appimage-extract` are the format reading what the format wrote; an
            // ELF section-header read plus `unsquashfs` are neither appimagetool
            // nor the runtime it embeds.
            const { oracle } = FORMATS.appimage.host;
            // The tools the oracle RUNS, which is what the field is for: CPython
            // does the ELF header read in twelve bytes of `struct`, and nothing
            // execs `readelf` — the spelling this row shipped with.
            expect(oracle.readWith).toStrictEqual(['python3', 'unsquashfs']);
            expect(oracle.readWith).not.toContain(APPIMAGE_TOOL);
            expect(oracle.readOn).toStrictEqual(['linux']);
            expect(oracle.selfReading).toBe(false);
        });

        await it('names a download in its install hint, because no distro packages the tool', async () => {
            // `flatpak.spec.ts` requires a hint for every tool-needing row, and
            // this is the first one that cannot answer with a package manager:
            // neither Fedora nor Debian ships `appimagetool`, so `dnf install
            // appimagetool` would send the reader to "no match for argument".
            const hint = FORMATS.appimage.host.installHint ?? '';
            expect(hint).toContain('github.com/AppImage/appimagetool');
            expect(hint.includes('dnf install appimagetool')).toBe(false);
            expect(hint.includes('apt install appimagetool')).toBe(false);
            // …and the way across for a CI image that will not grow one.
            expect(hint).toContain('--stage');
        });

        await it('labels the architecture the way appimagetool does, and refuses one it cannot', async () => {
            // `uname -m`'s vocabulary and not dpkg's: the label goes into `$ARCH`
            // and into the filename, and `amd64` is neither.
            expect(FORMATS.appimage.archName('x64', false)).toBe('x86_64');
            expect(FORMATS.appimage.archName('arm64', false)).toBe('aarch64');
            // NO `noarch`, unlike deb and rpm: the file BEGINS with an ELF runtime,
            // so a payload of pure JavaScript still ships in an x86-64 executable.
            expect(FORMATS.appimage.archName('x64', true)).toBe('x86_64');
            // Refused rather than passed through — the value ends up in a filename
            // a user is asked to download, so an unknown one would label an
            // artifact for a machine that does not exist.
            expect(() => FORMATS.appimage.archName('s390x', false)).toThrow();
        });

        await it('names the file after the binary, like every other download here', async () => {
            expect(FORMATS.appimage.fileName(packSettings(), 'x86_64')).toBe('ship-demo-1.2.3-1.x86_64.AppImage');
        });
    });

    await describe('when the AppImage is built, and when it is refused', async () => {
        await it('stays out of a bare `gjsify ship linux`, like every host-bound row', async () => {
            // The rule Flatpak established: a bare `gjsify ship` must not start
            // demanding a tool of every project that only ever packaged a `.deb` —
            // including `release-cut.yml`, which packs `@gjsify/cli` on a bare
            // runner.
            expect(defaultFormatIds('linux')).toStrictEqual(['deb', 'rpm']);
            expect(formatIdsFor('linux')).toContain('appimage');
            expect(FORMAT_IDS).toContain('appimage');
        });

        await it('resolves when it is asked for, beside the rows it shares a tree with', async () => {
            expect(resolveFormats(['appimage'], LAYOUTS.linux).map((f) => f.id)).toStrictEqual(['appimage']);
            expect(resolveFormats(['deb,appimage'], LAYOUTS.linux).map((f) => f.id)).toStrictEqual(['appimage', 'deb']);
        });

        await it('is not a darwin target, and the refusal says which layout to name', async () => {
            let message = '';
            try {
                resolveFormats(['appimage'], LAYOUTS.darwin);
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('appimage');
            expect(message).toContain('linux');
        });

        await it('refuses to pack off Linux, and names the two-phase way across', async () => {
            // Both non-linux hosts, because `finishOn` is a membership test and a
            // one-host test cannot tell an inclusive check from a `=== 'linux'`.
            for (const host of ['darwin', 'win32']) {
                let message = '';
                try {
                    assertHostCanFinish(FORMATS.appimage, host);
                } catch (error) {
                    message = (error as Error).message;
                }
                expect(message).toContain('linux');
                expect(message).toContain(host);
                expect(message).toContain('--stage');
                expect(message).toContain('--from-stage');
            }
        });

        await it('allows the pack on Linux', async () => {
            assertHostCanFinish(FORMATS.appimage, 'linux');
        });

        await it('names the missing tool, not the format, when appimagetool is absent', async () => {
            let message = '';
            try {
                assertToolsInstalled(FORMATS.appimage, () => false, 'linux');
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('appimagetool');
            expect(message).toContain('--stage');
        });

        await it('passes when appimagetool is present', async () => {
            assertToolsInstalled(FORMATS.appimage, (cmd) => cmd === APPIMAGE_TOOL, 'linux');
        });
    });
};
