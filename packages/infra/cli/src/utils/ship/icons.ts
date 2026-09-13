// The application icon: one source, one raster step, and the sizes each OS
// wants — so the `.ico`, the `.icns` and the hicolor theme all come from the
// same pixels.
//
// THE DEFECT THIS CLOSES, measured on the released artifacts of one app
// (Learn6502 0.8.0, 2026-09-13). On Windows 11 the Start-menu entry showed the
// generic blank-document icon: the shortcut asks the `.exe`, and the emitted
// launcher carried no resource directory at all. On macOS 15 the bundle had no
// `CFBundleIconFile`, no `CFBundleIconName` and no `.icns` anywhere under
// `Contents/`, so the Finder drew the generic application icon. The app declares
// ONE icon, a scalable SVG under `hicolor/scalable/apps/`, which is exactly what a
// GNOME app ships — and neither OS reads an SVG. So every SVG-only app shipped to
// those two platforms with no icon, and nothing said so.
//
// WHY `gjsify ship` CONVERTS rather than asking the project for rasters. The
// alternative — refuse the pack until the author adds `16x16/… 256x256/…` PNGs —
// costs every GNOME app a project-side change to ship the icon it already has,
// and it costs it per platform: Windows wants six sizes, macOS ten elements over
// seven. A build system owns that translation the way it owns the launcher and
// the desktop entry. The author declares the icon once; each layout says which
// sizes it writes ({@link Layout.icon}); this module renders them.
//
// THE RASTERIZER IS librsvg THROUGH GJS, IN A CHILD PROCESS, and each half of
// that was measured rather than chosen:
//
//   * librsvg, not ImageMagick or `rsvg-convert`: neither binary is in the CI
//     image (`.docker/ci-fedora.Dockerfile`), and `rsvg-convert` is not on the
//     workstation either. `Rsvg-2.0.typelib` IS in the image, because GTK needs
//     it, and so is `cairo-1.0.typelib`.
//   * `Rsvg.Handle` rendered onto a cairo surface, not `GdkPixbuf.new_from_file_at_size`
//     on the SVG. The pixbuf route depends on a loader MODULE: on the workstation
//     `/usr/lib64/gdk-pixbuf-2.0/2.10.0/loaders/` holds only the xpm loader and the
//     CI image has no loaders directory at all, so whether an SVG decodes that way
//     is a property of the host's gdk-pixbuf packaging. `rsvg_handle_render_document`
//     depends on librsvg alone.
//   * a `gjs -c` child, not an in-process `gi://` import. `gjsify ship` runs under
//     GJS when installed the Node-free way and under Node (`lib/index.js`) in the
//     CI leg that assembles the Windows artifact — and the CLI's own source has no
//     `gi://` import anywhere, because Node reaches GI only through a node-gi
//     prebuild that leg does not carry. GJS is on every host that assembles (ADR
//     0024 § A2: "assemble anywhere, under GJS"), so a child process is the one
//     path that is the same on both runtimes. The script is a string constant
//     here, not a file in `lib/templates`: `dist/cli.gjs.mjs` is a single bundled
//     file and a template it would have to locate on disk is a second thing to
//     ship.
//
// DETERMINISTIC ACROSS HOSTS, as far as measured: the same SVG rendered at 16
// and 256 px on the workstation and inside `ghcr.io/gjsify/ci-fedora:44` gave
// byte-identical PNGs (one sha256, librsvg 2.62.3 on both). A different librsvg
// may antialias differently, which makes the raster a function of the assembling
// host's library like every compiled artifact — the STAGE stays reproducible, and
// repacking it (ADR 0024 § A2) renders nothing.
//
// A PROJECT'S OWN PNG WINS at its size. A hand-tuned 16 px icon is drawn for that
// size and an SVG rendered at 16 px is not, and the hicolor convention exists to
// carry exactly that distinction. The PNG's IHDR is what decides its size, not its
// path: a `32x32/apps/x.png` that is 48 px wide is refused by name rather than
// embedded under the wrong header.
//
// WHAT IS REFUSED, and why refusal is the mechanism that matters more than the
// conversion. An app with no icon source at all, or with PNGs that leave a
// required size uncovered and no SVG to render it from, fails the STAGE naming
// the file to add. The previous behaviour was a warning on Linux and silence on
// the other two, and silence is how two platforms shipped without an icon for
// every release until someone opened the Start menu.

import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

import { spawnToCompletion } from '../spawn.js';

/** The runtime that renders. On `PATH`, like `glib-compile-schemas` — a GJS host has it by definition. */
export const RASTERIZER = 'gjs';

/**
 * How to get the typelib the script imports, in the two distributions' words.
 *
 * `librsvg2` on Fedora carries the typelib itself (measured: `rpm -qf
 * /usr/lib64/girepository-1.0/Rsvg-2.0.typelib` → `librsvg2-2.62.3`); Debian
 * splits it into `gir1.2-rsvg-2.0`.
 */
export const RASTERIZER_HINT =
    'Fedora: `sudo dnf install gjs librsvg2`, Debian/Ubuntu: `sudo apt install gjs gir1.2-rsvg-2.0`';

/**
 * The pixels of the app icon, one PNG per square edge length.
 *
 * A MAP keyed by size and not an array, because every consumer asks "the PNG for
 * N" — the `.ico` writer for its six entries, the `.icns` writer for its ten
 * elements over seven sizes — and an array would make each of them search.
 */
export interface AppIconRasters {
    /** Where the pixels came from, for the log line: the SVG's path, or how many sized PNGs. */
    readonly source: string;
    readonly png: ReadonlyMap<number, Uint8Array>;
}

/**
 * Whether an icon belongs in the theme's SYMBOLIC context rather than at a size.
 *
 * `symbolic` is a directory of its own in a hicolor theme and NOT a size value.
 * Measured in `refs/adwaita-icon-theme/index.theme`, which lists `symbolic/apps`
 * in `Directories=` beside `scalable/apps` and `16x16/apps` and gives it its own
 * section — `Context=Applications`, `Size=16`, `MinSize=8`, `MaxSize=512`,
 * `Type=Scalable` — against the scalable row's `Size=128`. The freedesktop icon
 * theme specification has no notion of `symbolic` at all: a theme expresses it by
 * giving the directory a section, which is exactly why reading the EXTENSION
 * cannot see it, and why this question has to be asked before the size one.
 *
 * TWO SIGNALS, the same pair `iconThemeDir` already reads for a size: the
 * directory an author put the file in, and the name they gave it. GTK resolves a
 * symbolic icon by the `-symbolic` name suffix, so an author who wrote the name
 * has said as much as one who wrote the path.
 *
 * SVG ONLY, because the symbolic directory is declared `Type=Scalable`: the
 * raster form GTK's own `gtk-encode-symbolic-svg` produces
 * (`<name>-symbolic.symbolic.png`) is installed at a SIZE instead. So a PNG keeps
 * answering the size question, and one that cannot answer it stays refused rather
 * than quietly becoming a scalable icon that does not scale.
 */
export function isSymbolicIcon(iconPath: string): boolean {
    if (extname(iconPath).toLowerCase() !== '.svg') return false;
    if (/(?:^|[\\/])symbolic[\\/]/.test(iconPath)) return true;
    return basename(iconPath, extname(iconPath)).endsWith('-symbolic');
}

/**
 * The hicolor subdirectory for an icon: the `symbolic` CONTEXT, else `scalable`
 * for an SVG, else the pixel size read from a `<n>x<n>` path component or a
 * trailing number in the filename.
 *
 * Named for the theme DIRECTORY rather than a size from the moment the first of
 * those answers stopped being one: `iconSizeDir` returning `symbolic` would be a
 * name every caller has to read past.
 */
export function iconThemeDir(iconPath: string): string {
    if (isSymbolicIcon(iconPath)) return 'symbolic';
    if (extname(iconPath).toLowerCase() === '.svg') return 'scalable';
    const square = /(?:^|[\\/])(\d{1,4})x\1(?:[\\/]|$)/.exec(iconPath);
    if (square) return `${square[1]}x${square[1]}`;
    const tokens = basename(iconPath, extname(iconPath)).split(/[-_.]/);
    for (let i = tokens.length - 1; i >= 0; i--) {
        const token = tokens[i];
        if (token !== undefined && /^\d{1,4}$/.test(token)) return `${token}x${token}`;
    }
    throw new Error(
        `gjsify ship: cannot tell what size ${iconPath} is. ` +
            'Put it in a `<size>x<size>/` directory, end its name with the size (`icon-128.png`), or ship an SVG.',
    );
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** `IEND` with its zero length and its fixed CRC — the last twelve bytes of every whole PNG. */
const PNG_IEND = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

/**
 * A PNG's pixel size, read from its IHDR — with the file's two ends checked.
 *
 * The signature and the IHDR say what the file CLAIMS to be; the `IEND` trailer
 * says it is all there. A PNG truncated by a half-written copy still has a valid
 * header, and an icon container built around one embeds a picture that decodes
 * to nothing on the target OS with no error at pack time. Twelve bytes at the end
 * is the cheapest check that catches that whole class.
 */
export function readPngSize(bytes: Uint8Array, what: string): { width: number; height: number } {
    if (bytes.length < 33 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
        throw new Error(`gjsify ship: ${what} is not a PNG — it does not start with the PNG signature.`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // The first chunk must be IHDR: 13 bytes, type `IHDR`, then width and height big-endian.
    if (view.getUint32(8) !== 13 || Buffer.from(bytes.subarray(12, 16)).toString('latin1') !== 'IHDR') {
        throw new Error(`gjsify ship: ${what} is not a PNG this command can read — its first chunk is not IHDR.`);
    }
    const tail = bytes.length - PNG_IEND.length;
    if (PNG_IEND.some((byte, index) => bytes[tail + index] !== byte)) {
        throw new Error(
            `gjsify ship: ${what} is truncated — it does not end with an IEND chunk, so it would embed as a ` +
                'picture that decodes to nothing.',
        );
    }
    return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * The program the child GJS runs. `ARGV` is the SVG path followed by the sizes;
 * stdout is one JSON object mapping each size to the PNG, base64.
 *
 * Legacy `imports`, deliberately: `gjs -c` takes a script, not a module, and the
 * legacy namespace is the one a script can reach synchronously. `imports.cairo`
 * is GJS's own cairo binding — `ImageSurface` and `writeToPNG` are its, not the
 * typelib's, which has no constructors.
 *
 * `render_document` scales the document to the viewport, so each size is a
 * fresh vector render and never a resample of a larger one — the difference
 * between a crisp 16 px icon and a blurred one, which is the whole reason to
 * render per size rather than once.
 *
 * Through a file rather than a memory surface's bytes: `writeToPNG` is the PNG
 * ENCODER, and cairo is the one this process has. Base64 on stdout because it is
 * the transport both runtimes' `child_process` read the same way.
 */
export const RASTERIZE_SCRIPT = `
imports.gi.versions.Rsvg = '2.0';
const { Rsvg, GLib } = imports.gi;
const Cairo = imports.cairo;
const [svg, ...sizes] = ARGV;
const handle = Rsvg.Handle.new_from_file(svg);
const out = {};
for (const text of sizes) {
    const size = Number(text);
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, size, size);
    const cr = new Cairo.Context(surface);
    handle.render_document(cr, new Rsvg.Rectangle({ x: 0, y: 0, width: size, height: size }));
    cr.$dispose();
    surface.flush();
    const path = GLib.build_filenamev([GLib.get_tmp_dir(), \`gjsify-ship-icon-\${GLib.get_monotonic_time()}-\${size}.png\`]);
    surface.writeToPNG(path);
    const [, bytes] = GLib.file_get_contents(path);
    GLib.unlink(path);
    out[size] = GLib.base64_encode(bytes);
}
print(JSON.stringify(out));
`.trim();

export interface RasterizeInput {
    /** Absolute path of the SVG. */
    svg: string;
    /** Square edge lengths to render, each one a separate vector render. */
    sizes: readonly number[];
}

/**
 * Render an SVG at every size through librsvg, in a child GJS.
 *
 * Every PNG that comes back is read for its IHDR before it is returned: the size
 * the child rendered is the size the caller asked for or the whole batch is
 * refused, because the writer that would embed it trusts the map's key.
 */
export async function rasterizeSvg(input: RasterizeInput): Promise<Map<number, Uint8Array>> {
    if (input.sizes.length === 0) return new Map();
    // THE CLI'S OWN SPAWN WRAPPER, not `promisify(execFile)`. Measured under the
    // GJS-built CLI (`dist/cli.gjs.mjs`, gjs 1.88): `node:util`'s `promisify` over
    // `@gjsify/child_process`'s `execFile` resolves with the bare stdout string —
    // the polyfill has no `promisify.custom` producing Node's `{ stdout, stderr }`
    // — so a destructured `stdout` was `undefined` on that runtime and only that
    // one. `schemas.ts` uses the same pattern and never noticed, because it ignores
    // the result. `spawnToCompletion` captures on both paths and picks the blocking
    // one under GJS per its teardown contract; `'return'` is what every packer here
    // declares, for the reason `msi.ts` gives at its own call.
    const result = await spawnToCompletion(
        RASTERIZER,
        ['-c', RASTERIZE_SCRIPT, input.svg, ...input.sizes.map(String)],
        {
            completion: 'return',
            stdio: 'capture',
            // A 1024 px PNG of a detailed icon is a few hundred kilobytes; base64 adds
            // a third. Node's default 1 MiB is within reach of one large element.
            maxBuffer: 64 * 1024 * 1024,
            notFound: () =>
                new Error(
                    `gjsify ship: \`${RASTERIZER}\` is not on PATH, and it is what renders ${input.svg} into the ` +
                        `sizes an icon needs on this OS. ${RASTERIZER_HINT}.`,
                ),
        },
    );
    const stdout = result.stdout ?? '';
    if (result.code !== 0) {
        const stderr = (result.stderr ?? '').trim();
        // The two typelib-shaped failures GJS reports, spelled by their symptom
        // rather than by GJS's wording, which is translated and changes.
        const hint = /Rsvg|Typelib|cairo/i.test(stderr)
            ? ` The Rsvg typelib or GJS's cairo binding is missing. ${RASTERIZER_HINT}.`
            : '';
        throw new Error(
            `gjsify ship: rendering ${input.svg} through ${RASTERIZER} failed (exit ${result.code ?? result.signal}).` +
                `${hint}${stderr === '' ? '' : `\n    ${stderr.split('\n').join('\n    ')}`}`,
        );
    }
    let parsed: Record<string, string>;
    try {
        parsed = JSON.parse(stdout) as Record<string, string>;
    } catch {
        throw new Error(
            `gjsify ship: ${RASTERIZER} printed something other than the rendered icon while rendering ` +
                `${input.svg}: ${stdout.slice(0, 200)}`,
        );
    }
    const out = new Map<number, Uint8Array>();
    for (const size of input.sizes) {
        const encoded = parsed[String(size)];
        if (encoded === undefined) {
            throw new Error(`gjsify ship: ${RASTERIZER} rendered no ${size} px image of ${input.svg}.`);
        }
        const png = new Uint8Array(Buffer.from(encoded, 'base64'));
        const { width, height } = readPngSize(png, `the ${size} px render of ${input.svg}`);
        if (width !== size || height !== size) {
            throw new Error(
                `gjsify ship: asked ${RASTERIZER} for a ${size} px render of ${input.svg} and got ${width}×${height}.`,
            );
        }
        out.set(size, png);
    }
    return out;
}

export interface ResolveAppIconInput {
    /** Absolute paths of the project's icons — `ShipSettings.iconFiles`. */
    iconFiles: readonly string[];
    appId: string;
    /** The square sizes the layout's writer needs, from {@link Layout.icon}. */
    sizes: readonly number[];
    /** What the sizes are FOR, in the refusal: "the Windows launcher's icon". */
    target: string;
    /** The renderer, injectable so the selection is testable without a GJS. */
    rasterize?: (input: RasterizeInput) => Promise<Map<number, Uint8Array>>;
}

/**
 * The raster set a layout needs, from whatever the project declares.
 *
 * Sized PNGs the project ships are used at their (IHDR-read) size; every size
 * they leave uncovered is rendered from the scalable SVG; a size neither can
 * answer is a refusal that names the file to add. The `-symbolic` icon is never
 * a source: it is the monochrome status-bar glyph, and an app icon drawn from it
 * would be a grey silhouette on both platforms.
 */
export async function resolveAppIcon(input: ResolveAppIconInput): Promise<AppIconRasters> {
    const scalable = input.iconFiles.filter((file) => extname(file).toLowerCase() === '.svg' && !isSymbolicIcon(file));
    const rasters = input.iconFiles.filter((file) => extname(file).toLowerCase() === '.png' && !isSymbolicIcon(file));
    const suggestedSvg = `data/icons/hicolor/scalable/apps/${input.appId}.svg`;

    if (scalable.length === 0 && rasters.length === 0) {
        throw new Error(
            `gjsify ship: ${input.target} needs the app's icon and the project declares none. Add a scalable SVG ` +
                `at ${suggestedSvg} (or point \`gjsify.ship.icon\` at one) and \`gjsify ship\` renders every ` +
                'size from it. An app with no icon here ships with the generic one, and nothing on the target ' +
                'OS says so.',
        );
    }

    // The SVG the sizes are rendered from. More than one non-symbolic SVG is
    // possible (a `scalable/` and a stray `data/icons/logo.svg`); the one under a
    // `scalable/` directory is the hicolor convention's answer, else the first by
    // path order — and the choice is printed by `source` either way.
    const svg = scalable.find((file) => /(?:^|[\\/])scalable[\\/]/.test(file)) ?? scalable[0];

    const png = new Map<number, Uint8Array>();
    const providedBy = new Map<number, string>();
    for (const file of rasters) {
        const bytes = new Uint8Array(readFileSync(file));
        const { width, height } = readPngSize(bytes, file);
        if (width !== height) {
            throw new Error(
                `gjsify ship: ${file} is ${width}×${height}, and an app icon is square on every platform that ` +
                    'reads one — Windows and macOS both index icon images by one edge length.',
            );
        }
        const claimed = iconThemeDir(file);
        if (claimed !== `${width}x${width}`) {
            throw new Error(
                `gjsify ship: ${file} is ${width}×${height} but its path says ${claimed}. The theme looks the file ` +
                    'up by the path, so this icon would be served at the wrong size — move it or resize it.',
            );
        }
        if (!input.sizes.includes(width)) continue;
        const previous = providedBy.get(width);
        if (previous !== undefined) {
            throw new Error(`gjsify ship: ${file} and ${previous} are both ${width} px icons. Keep one.`);
        }
        providedBy.set(width, file);
        png.set(width, bytes);
    }

    const missing = input.sizes.filter((size) => !png.has(size));
    if (missing.length > 0) {
        if (svg === undefined) {
            throw new Error(
                `gjsify ship: ${input.target} needs the app's icon at ${missing.join(', ')} px and the project ` +
                    `ships PNGs only for ${[...png.keys()].sort((a, b) => a - b).join(', ') || 'no size'}. Add a ` +
                    `scalable SVG at ${suggestedSvg} and the rest is rendered from it, or add ` +
                    `${missing.map((size) => `data/icons/hicolor/${size}x${size}/apps/${input.appId}.png`).join(', ')}.`,
            );
        }
        const rendered = await (input.rasterize ?? rasterizeSvg)({ svg, sizes: missing });
        for (const size of missing) {
            const bytes = rendered.get(size);
            if (bytes === undefined) throw new Error(`gjsify ship: ${svg} rendered no ${size} px image.`);
            png.set(size, bytes);
        }
    }

    const source =
        providedBy.size === 0
            ? `rendered from ${svg}`
            : missing.length === 0
              ? `${providedBy.size} sized PNG(s) the project ships`
              : `${providedBy.size} sized PNG(s) the project ships, the rest rendered from ${svg}`;
    return { source, png };
}

/** The sizes in a raster set, ascending — for log lines and error messages. */
export function iconSizes(icon: AppIconRasters): number[] {
    return [...icon.png.keys()].sort((a, b) => a - b);
}
