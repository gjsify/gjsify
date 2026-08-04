// Unit spec for `checkTypeSkew` — the @girs-types-vs-installed-library comparison.
//
// The defect it exists for, measured on a maintainer workstation 2026-08-04: host
// GTK 4.22.4, `@girs/gtk-4.0@4.1.0` generated from GTK 4.23.0. `gjsify tsc` exits 0
// on `Gtk.RestoreReason.RECOVER` (`@since 4.24`) and the same line throws
// `TypeError: … Gtk.RestoreReason is undefined` at runtime, while `gjsify
// system-check` prints `✓ GTK4 (4.22.4)` and says nothing. GIRepository cannot catch
// it either: it matches the API version (`4.0`) only.
//
// Every case here drives INJECTED readers rather than the host, because the whole
// point is the skew branches — a host that happens to match exercises none of them,
// and the maintainer's host exercises exactly the two it happens to have.

import { describe, it, expect } from '@gjsify/unit';
import { checkTypeSkew } from './check-system-deps.js';

/** Build readers from two plain maps, so a case reads as data. */
function readers(declared: Record<string, string>, installed: Record<string, string>) {
    return {
        readDeclared: (_cwd: string, typePackage: string) => declared[typePackage] ?? null,
        readInstalled: (pkgConfig: string) => installed[pkgConfig] ?? null,
    };
}

export default async () => {
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
            // The real glib case: `@girs/glib-2.0` declares 2.88.0, the host has
            // 2.88.2. Same API set — reporting it would train people to ignore output.
            const found = checkTypeSkew('/p', readers({ '@girs/glib-2.0': '2.88.0' }, { 'glib-2.0': '2.88.2' }));
            expect(found.length).toBe(0);
        });

        await it('stays silent on an exact match', async () => {
            const found = checkTypeSkew('/p', readers({ '@girs/soup-3.0': '3.6.6' }, { 'libsoup-3.0': '3.6.6' }));
            expect(found.length).toBe(0);
        });

        await it('skips ts-for-gir’s namespace-version fallback', async () => {
            // `@girs/gdk-4.0` declares `4.0.0` because GDK's GIR carries no
            // `<package version>` — it ships INSIDE GTK. Comparing that against a host
            // GTK 4.22.4 would report an 18-minor skew that does not exist. Measured:
            // 17 of 32 installed @girs packages carry this degenerate value.
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
            // Both of these are real on the measured host, and the second was
            // invisible until the check existed.
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
