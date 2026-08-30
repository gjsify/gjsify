// The Windows PROJECT both windows suites ship, and the fake runtime packages it
// resolves through.
//
// Extracted when `tests/e2e/ship-msi` needed the same subject `tests/e2e/ship-windows`
// packs. A second copy would be a second definition of "a shippable Windows app":
// the closure layout, the `node.exe` name and the `prebuilds/<target>/` shape are all
// contracts the CLI reads, and a suite carrying its own copy of a contract is a suite
// that only agrees with itself. Same reason `ship/fixture.mjs` exists one level up.
//
// `ship/` and not `ship-windows/` for the home, because a fixture that two suites
// import out of ONE of them makes that one look like the owner of the other.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { pe, SUBSYSTEM } from '../pe.mjs';
import { NODE_BUNDLE, scaffold } from './fixture.mjs';

/** The display name the shared scaffold declares — and therefore the program directory. */
export const APP_NAME = 'Ship Demo';
export const BINARY = 'ship-demo';

/**
 * The one architecture this layout has.
 *
 * Not a fixture choice: `wingtk/gvsbuild` hardcodes `self.platform = "x64"` and
 * publishes no arm64 GTK, so there is nothing to build
 * `@gjsify/gtk-runtime-win32-arm64` out of (#1117). `Layout.arches` carries that
 * refusal and `ship-windows` drives that refusal.
 */
export const ARCH = 'x64';
export const TARGET = `win32-${ARCH}`;
/** The `--app node` project both phases of the windows suites pack. */
export function scaffoldNodeApp(dir) {
    return scaffold(dir, (pkg, at) => {
        pkg.gjsify.app = 'node';
        pkg.gjsify.main = 'dist/app.node.mjs';
        pkg.main = 'dist/app.node.mjs';
        writeFileSync(join(at, 'dist', 'app.node.mjs'), NODE_BUNDLE);
    });
}

/**
 * The closure a relocated `@gjsify/gtk-runtime-win32-x64` carries, as
 * bundle-relative paths.
 *
 * `bin/` and not `lib/` for the loadable code, which is node-gi's own
 * `nativeSubdir` split (`gtk-runtime.js`: "`bin` on win32, `lib` everywhere
 * else") and the directory `resolveGtkRuntimeBundle()` probes for. The pixbuf
 * loaders sit four levels down under `lib/` and `loaders.cache` addresses them
 * TOPLEVEL-relative, which is #996's fix: gdk-pixbuf 2.44.6's
 * `build_module_path()` joins a relative cache entry with the bundle toplevel, so
 * a bare-leaf cache resolved every loader to `<bundle>\<leaf>` and no SVG icon
 * ever decoded from a win32 bundle. Flattening this tree reproduces exactly that.
 */
export function closureFiles(arch = ARCH) {
    const dll = () => pe({ arch, dll: true });
    return {
        'gtk/bin/libglib-2.0-0.dll': dll(),
        'gtk/bin/libgtk-4-1.dll': dll(),
        'gtk/lib/gdk-pixbuf-2.0/2.10.0/loaders/libpixbufloader-svg.dll': dll(),
        'gtk/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache': Buffer.from(
            '"lib\\\\gdk-pixbuf-2.0\\\\2.10.0\\\\loaders\\\\libpixbufloader-svg.dll"\n"svg" 4 "gdk-pixbuf" "" ""\n',
        ),
        'gtk/girepository-1.0/Gtk-4.0.typelib': Buffer.from('GOBJ\nMETA'),
        'gtk/share/glib-2.0/schemas/gschemas.compiled': Buffer.from('GVariant fixture'),
        'gtk/etc/fonts/fonts.conf': Buffer.from('<fontconfig/>\n'),
        'gtk/manifest.json': Buffer.from(JSON.stringify({ platform: TARGET, windowing: true }, null, 2)),
        'node_gi.node': dll(),
    };
}

/**
 * Plant the packages a self-contained program directory needs in a project's own
 * `node_modules`, and nothing else.
 *
 * BY NAME, through the consumer's tree — the contract `docs/publishing.md` states:
 * `@gjsify/gtk-runtime-*` and `@gjsify/node-runtime-*` carry no
 * `optionalDependencies` edge anywhere, so whoever SHIPS declares them. A fixture
 * reaching into this monorepo's own packages would prove the resolution works HERE
 * and say nothing about a stranger's project.
 *
 * The interpreter is a SYNTHETIC PE, not the real `node.exe`: this suite asserts
 * that the staging put the right MACHINE in the right place, which is two `u16`
 * fields, and a 90 MB download per run buys nothing for it. The real binary is
 * what `.github/workflows/node-gi.yml`'s assemble leg fetches, and the console
 * subsystem it reports there is the measurement that matters.
 */
export function installRuntimePackages(projectDir, { closure = true, interpreter = true, addon = true, arch = ARCH } = {}) {
    const modules = join(projectDir, 'node_modules', '@gjsify');
    const manifest = (dir, name, exports) => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({
                name,
                version: '0.44.0',
                type: 'module',
                main: './index.js',
                ...(exports ? { exports } : {}),
            }),
        );
        writeFileSync(join(dir, 'index.js'), 'export default {};\n');
    };
    const write = (root, rel, data) => {
        const target = join(root, ...rel.split('/'));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
    };

    // The closure and the addon come out of ONE package here, which is node-gi's
    // own `prebuilds/<target>/` sibling layout and the shape `node-gi.yml`'s
    // windows legs stage by hand before every conformance run.
    const nodeGi = join(modules, 'node-gi');
    manifest(nodeGi, '@gjsify/node-gi', { '.': './index.js', './gi': './gi.js', './globals': './globals.js' });
    writeFileSync(join(nodeGi, 'gi.js'), 'export const requireGi = () => ({});\n');
    writeFileSync(join(nodeGi, 'globals.js'), 'export default {};\n');
    for (const [rel, data] of Object.entries(closureFiles(arch))) {
        if (!closure && rel.startsWith('gtk/')) continue;
        if (!addon && rel === 'node_gi.node') continue;
        write(nodeGi, `prebuilds/${TARGET}/${rel}`, data);
    }

    if (interpreter) {
        const runtime = join(modules, `node-runtime-${TARGET}`);
        manifest(runtime, `@gjsify/node-runtime-${TARGET}`);
        // `node.exe`, and the name is the assertion: `nodeRuntimeBinaryName`
        // derives it from the TARGET, so a stage that copied it to `node` would be
        // a launcher execing a file nothing wrote.
        write(runtime, 'bin/node.exe', pe({ arch, subsystem: SUBSYSTEM.console }));
        write(runtime, 'bin/LICENSE', Buffer.from('Node.js is licensed for use as follows:\n'));
    }
    return projectDir;
}
