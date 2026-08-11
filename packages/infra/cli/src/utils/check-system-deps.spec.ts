// The defect `checkTypeSkew` exists for, measured on a maintainer workstation: host
// GTK 4.22.4, `@girs/gtk-4.0@4.1.0` generated from GTK 4.23.0. `gjsify tsc` exits 0
// on `Gtk.RestoreReason.RECOVER` (`@since 4.24`) and the same line throws
// `TypeError: … Gtk.RestoreReason is undefined` at runtime, while `gjsify
// system-check` prints `✓ GTK4 (4.22.4)` and says nothing. GIRepository cannot catch
// it either: it matches the API version (`4.0`) only.
//
// Every case drives INJECTED readers rather than the host, because a host that
// happens to match exercises none of the skew branches.

import { describe, it, expect } from '@gjsify/unit';
import type { DepCheck } from './check-system-deps.js';
import { resolveBlueprintCompiler } from '@gjsify/vite-plugin-blueprint/resolve';
import {
    buildInstallCommand,
    checkBlueprintCompiler,
    checkTypeSkew,
    missingSystemDepsFor,
    OPTIONAL_DEPS,
    PACKAGE_DEPS,
} from './check-system-deps.js';

/** Build readers from two plain maps, so a case reads as data. */
function readers(declared: Record<string, string>, installed: Record<string, string>) {
    return {
        readDeclared: (_cwd: string, typePackage: string) => declared[typePackage] ?? null,
        readInstalled: (pkgConfig: string) => installed[pkgConfig] ?? null,
    };
}

export default async () => {
    // An id with no OPTIONAL_DEPS entry is not a runtime error: `runOptionalChecks`
    // has nothing to look up, so the dependency is silently never checked. That is
    // how @gjsify/rolldown-native's json-glib could be missing entirely — nothing
    // forced the two tables to agree.
    await describe('dependency declarations', async () => {
        await it('every id a package names exists in OPTIONAL_DEPS', async () => {
            // `gwebgl` is deliberately absent: an npm package, checked by
            // `checkGwebgl` rather than pkg-config, and mapped only so its presence
            // in a project's dep tree triggers that check.
            const NPM_HANDLED = new Set(['gwebgl']);
            const unknown: string[] = [];
            for (const [pkg, ids] of Object.entries(PACKAGE_DEPS)) {
                for (const id of ids) {
                    if (NPM_HANDLED.has(id)) continue;
                    if (!OPTIONAL_DEPS[id]) unknown.push(`${pkg} -> ${id}`);
                }
            }
            expect(unknown.join(', ')).toBe('');
        });

        await it('every OPTIONAL_DEPS entry carries a pkg-config name', async () => {
            const bad = Object.entries(OPTIONAL_DEPS)
                .filter(([, dep]) => !dep.pkgName)
                .map(([id]) => id);
            expect(bad.join(', ')).toBe('');
        });

        await it('the bundler engine declares its load-time library', async () => {
            // Measured on fedora:43 with a consumer baseline (gjs + libsoup3 only):
            // libjson-glib-1.0.so.0 does not resolve, so libgjsifyrolldown.so does
            // not load and construction dies with "Unsupported type void, deriving
            // from fundamental void" — while install said "System dependencies OK."
            expect(PACKAGE_DEPS['@gjsify/rolldown-native']?.includes('json-glib')).toBe(true);
            expect(OPTIONAL_DEPS['json-glib']?.pkgName).toBe('json-glib-1.0');
        });

        await it('every package manager can spell the engine library', async () => {
            // A declaration a consumer cannot ACT on is not a declaration.
            // `detectPackageManager()` used to probe with `which`(1), which the Fedora
            // minimal containers do not ship — so it answered `unknown`,
            // `buildInstallCommand` returned null, and the hint printed NOTHING on
            // exactly the hosts that had to find the library by hand (ts-for-gir#437
            // json-glib, bauplaner#40 libsoup3). Each of the six real managers must
            // produce a command; `unknown` must keep producing none.
            const missing: DepCheck[] = [{ id: 'json-glib', name: 'JSON-GLib', found: false, severity: 'optional' }];
            const silent: string[] = [];
            for (const pm of ['apt', 'dnf', 'pacman', 'zypper', 'apk', 'brew'] as const) {
                if (!buildInstallCommand(pm, missing)) silent.push(pm);
            }
            expect(silent.join(', ')).toBe('');
            expect(buildInstallCommand('unknown', missing)).toBe(null);
        });

        await it('missingSystemDepsFor answers nothing for a package it cannot know', async () => {
            // The caller is `diagnoseNativeEngine()`, which runs while explaining
            // ANOTHER failure: a probe that throws there replaces the diagnosis with
            // its own stack, so both "no declared deps" and "package not in the
            // table" must come back as an empty list.
            expect(missingSystemDepsFor('@gjsify/not-a-real-package').length).toBe(0);
            // `@gjsify/fs` is real and declares no optional system deps.
            expect(missingSystemDepsFor('@gjsify/fs').length).toBe(0);
        });

        await it('missingSystemDepsFor only ever reports declared ids', async () => {
            // Its output is printed as a MEASURED cause, so it must not invent a
            // library the package never declared.
            const declared = new Set(PACKAGE_DEPS['@gjsify/rolldown-native'] ?? []);
            const undeclared = missingSystemDepsFor('@gjsify/rolldown-native')
                .map((d) => d.id)
                .filter((id) => !declared.has(id));
            expect(undeclared.join(', ')).toBe('');
        });

        await it('every package manager can spell blueprint-compiler', async () => {
            // A `.blp` build that could not find the compiler rethrew execa's error,
            // which names the failed command and nothing to install; on the
            // win11-gjsify VM that was read as "blueprint-compiler is a GNOME Python
            // tool, unavailable on Windows" — wrong, and it reached a docs file. It is
            // pure Python and MSYS2 ships it prebuilt; only PyGObject (no Windows
            // wheel) makes plain pip impossible.
            const missing: DepCheck[] = [
                { id: 'blueprint-compiler', name: 'blueprint-compiler', found: false, severity: 'optional' },
            ];
            const silent: string[] = [];
            for (const pm of ['apt', 'dnf', 'pacman', 'zypper', 'apk', 'brew'] as const) {
                if (!buildInstallCommand(pm, missing)) silent.push(pm);
            }
            expect(silent.join(', ')).toBe('');
        });

        await it('the win32 blueprint hint is MSYS2, never a winget package', async () => {
            // winget has no blueprint-compiler, so the hint must not be `winget
            // install`-shaped: putting it in the PM_PACKAGES table would print a line
            // that looks right and installs nothing.
            if (process.platform !== 'win32') return;
            const missing: DepCheck[] = [
                { id: 'blueprint-compiler', name: 'blueprint-compiler', found: false, severity: 'optional' },
            ];
            const hint = buildInstallCommand('winget', missing) ?? '';
            expect(hint.includes('mingw-w64-ucrt-x86_64-blueprint-compiler')).toBe(true);
            expect(hint.includes('winget install')).toBe(false);
        });

        await it('the blueprint check agrees with the resolver the BUILD uses', async () => {
            // On win32 the compiler is normally an MSYS2 script deliberately kept OFF
            // PATH, so a PATH-only check would report "missing" on a host where every
            // `.blp` builds.
            const check = checkBlueprintCompiler(['@gjsify/vite-plugin-blueprint']);
            expect(check.id).toBe('blueprint-compiler');
            expect(check.severity).toBe('optional');
            expect(check.found).toBe(resolveBlueprintCompiler() !== null);
        });
    });

    await describe('checkTypeSkew', async () => {
        await it('reports the measured GTK skew as ahead', async () => {
            const found = checkTypeSkew('/p', readers({ '@girs/gtk-4.0': '4.23.0' }, { gtk4: '4.22.4' }));
            expect(found.length).toBe(1);
            expect(found[0]?.typePackage).toBe('@girs/gtk-4.0');
            expect(found[0]?.relation).toBe('ahead');
            expect(found[0]?.declared).toBe('4.23.0');
            expect(found[0]?.installed).toBe('4.22.4');
        });

        await it('reports types older than the host as behind', async () => {
            const found = checkTypeSkew('/p', readers({ '@girs/harfbuzz-0.0': '13.2.1' }, { harfbuzz: '14.1.0' }));
            expect(found.length).toBe(1);
            expect(found[0]?.relation).toBe('behind');
        });

        await it('stays silent when only the micro version differs', async () => {
            // The real glib case: declared 2.88.0, host 2.88.2. Same API set, and
            // reporting it would train people to ignore output.
            const found = checkTypeSkew('/p', readers({ '@girs/glib-2.0': '2.88.0' }, { 'glib-2.0': '2.88.2' }));
            expect(found.length).toBe(0);
        });

        await it('stays silent on an exact match', async () => {
            const found = checkTypeSkew('/p', readers({ '@girs/soup-3.0': '3.6.6' }, { 'libsoup-3.0': '3.6.6' }));
            expect(found.length).toBe(0);
        });

        await it('skips ts-for-gir’s namespace-version fallback', async () => {
            // `@girs/gdk-4.0` declares `4.0.0` because GDK's GIR carries no `<package
            // version>` — it ships INSIDE GTK — so comparing it against a host GTK
            // 4.22.4 reports an 18-minor skew that does not exist. Measured: 17 of 32
            // installed @girs packages carry this degenerate value.
            const found = checkTypeSkew(
                '/p',
                readers(
                    { '@girs/gtk-4.0': '4.0', '@girs/adw-1': '1.0.0' },
                    { gtk4: '4.22.4', 'libadwaita-1': '1.9.2' },
                ),
            );
            expect(found.length).toBe(0);
        });

        await it('skips a type package that is not installed', async () => {
            const found = checkTypeSkew('/p', readers({}, { gtk4: '4.22.4' }));
            expect(found.length).toBe(0);
        });

        await it('skips a library the host does not have', async () => {
            // Absence is the presence check's job; reporting it here would double the
            // message for one cause.
            const found = checkTypeSkew('/p', readers({ '@girs/webkit-6.0': '2.52.1' }, {}));
            expect(found.length).toBe(0);
        });

        await it('ignores an unparseable version rather than guessing', async () => {
            const found = checkTypeSkew('/p', readers({ '@girs/gtk-4.0': 'unknown' }, { gtk4: '4.22.4' }));
            expect(found.length).toBe(0);
        });

        await it('finds every skewed binding, not just the first', async () => {
            // Both are real on the measured host; the second was invisible until the
            // check existed.
            const found = checkTypeSkew(
                '/p',
                readers(
                    { '@girs/gtk-4.0': '4.23.0', '@girs/adw-1': '1.10.0' },
                    { gtk4: '4.22.4', 'libadwaita-1': '1.9.2' },
                ),
            );
            expect(found.length).toBe(2);
            expect(found.every((skew) => skew.relation === 'ahead')).toBeTruthy();
        });

        await it('compares across a major boundary', async () => {
            const found = checkTypeSkew('/p', readers({ '@girs/gst-1.0': '1.28.1' }, { 'gstreamer-1.0': '2.0.0' }));
            expect(found.length).toBe(1);
            expect(found[0]?.relation).toBe('behind');
        });
    });
};
