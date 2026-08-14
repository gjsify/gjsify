#!/usr/bin/env node
/**
 * Relocate a staged darwin prebuild off the BUILD HOST's Homebrew prefix.
 *
 * A Mach-O records each dependency's FULL INSTALL PATH where an ELF records a bare
 * SONAME, so every darwin prebuild this repo published named its GLib under the
 * default Homebrew prefix of whichever machine linked it (`/usr/local` Intel,
 * `/opt/homebrew` Apple silicon) — unloadable without Homebrew, under a custom
 * `HOMEBREW_PREFIX`, on MacPorts, or without those formulae (#1102, all 12 darwin
 * packages, both arches). Fix: rewrite those load commands to `@rpath/<leaf>` and
 * give the image an `LC_RPATH` list that resolves them.
 *
 * Separate from `packages/node-gi/scripts/build-gtk-runtime-darwin.mjs`, which does
 * the same to its own payload: `packages/node-gi/**` is both the affected
 * classifier's IGNORE list and `node-gi.yml`'s `paths:` trigger, so an import
 * either way leaves one of the two building without its CI. Only the binary READER
 * is shared (`readLibrary()`, the repo's ONE parser), so rewriting a load command
 * and later failing the build over one see the same bytes.
 *
 * dyld tries `LC_RPATH` in order, so the list IS the precedence policy:
 *
 *   1. `@loader_path` — a dependency staged into the prebuild dir wins. Nothing
 *      does that today; one load command reserves the option.
 *   2. `@loader_path/../../../gtk-runtime-darwin-<arch>/gtk/lib` — the
 *      batteries-included bundle as an npm SIBLING (`prebuilds/<target>/` climbs
 *      three to `@gjsify/`). The "no Homebrew" path.
 *   3. `<homebrew prefix>/lib` — the system stack, LAST.
 *
 * Bundle before system is ADR 0023's darwin policy (`decideGtkSource()`); a prebuild
 * resolving GLib differently from the process that loaded it is the two-GTKs failure
 * #910 paid for. The list cannot honour `GJSIFY_GTK_PREFER` — `LC_RPATH` is fixed at
 * link time and no environment expands `@rpath` — so the artifact encodes the
 * default and the override stays a node-gi concern. The two look interchangeable.
 *
 * Entry 3 stays an absolute build-host path ON PURPOSE: `checkPrebuildDir()` REPORTS
 * an absolute `LC_RPATH` where it FAILS an absolute `LC_LOAD_DYLIB`, because a
 * missing hard dependency aborts the load while a missing search path is skipped.
 * Dropping it would stop the artifact loading on today's Homebrew-only GJS host.
 *
 * Version-PINNED incoming rpaths (`…/Cellar/glib/2.88.2/lib`, baked in by meson) are
 * replaced rather than extended: they die at the next `brew upgrade`, and naming a
 * formula VERSION makes two CI runs of one commit produce different bytes. Homebrew
 * symlinks every keg into `<prefix>/lib`, so one entry replaces all.
 *
 * Usage: node scripts/relocate-macho.mjs <prebuild-dir> --target darwin-<arch>
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { isBuildHostAbsolutePath, readLibrary } from '../packages/infra/manifest-conformance/lib/binary.mjs';

/**
 * Homebrew's default prefix, keyed by the TARGET arch — not `brew --prefix`. This
 * also repairs an ALREADY-COMMITTED prebuild, so an Intel Mac editing the
 * `darwin-arm64` image must write `/opt/homebrew`: the prefix of the machine that
 * will RUN it. A custom `HOMEBREW_PREFIX` is likewise not consulted — the entry is a
 * consumer FALLBACK, so the only useful value is the one most consumers have.
 */
const HOMEBREW_DEFAULT_PREFIX = {
    x64: '/usr/local',
    arm64: '/opt/homebrew',
};

/**
 * The `LC_RPATH` list a darwin prebuild for `target` should carry, in dyld's
 * search order.
 *
 * @param {string} target `darwin-x64` | `darwin-arm64`
 * @returns {string[]}
 */
export function darwinPrebuildRpaths(target) {
    const arch = target.slice('darwin-'.length);
    const prefix = HOMEBREW_DEFAULT_PREFIX[arch];
    if (!prefix) throw new Error(`relocate-macho: no Homebrew prefix known for target \`${target}\``);
    return [
        '@loader_path',
        // `prebuilds/<target>/` → the package → `@gjsify/` → the sibling bundle.
        `@loader_path/../../../gtk-runtime-${target}/gtk/lib`,
        `${prefix}/lib`,
    ];
}

/** @param {string[]} argv */
const run = (argv) => execFileSync(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Run one `install_name_tool` edit, translating its ONE expected failure into
 * something actionable.
 *
 * Load commands live in a header pad fixed at LINK time, so growing them can simply
 * not fit. Cargo leaves no spare pad on x86-64 while the arm64 twins happen to have
 * room, which is what makes it look like a flake. The fix is a LINK FLAG
 * (`-Wl,-headerpad_max_install_names`), and a raw stack trace does not say so.
 *
 * @param {string[]} argv
 * @param {string} file
 */
function edit(argv, file) {
    try {
        run(argv);
    } catch (err) {
        const stderr = /** @type {{stderr?: Buffer}} */ (err).stderr?.toString() ?? '';
        if (stderr.includes('do not fit')) {
            throw new Error(
                `relocate-macho: ${basename(file)} has no room in its Mach-O header for\n` +
                    `  \`${argv.slice(1, -1).join(' ')}\`.\n` +
                    '  The load-command pad is fixed when the image is LINKED, so this cannot be\n' +
                    '  repaired after the fact: add `-Wl,-headerpad_max_install_names` to the darwin\n' +
                    "  link args in this package's meson.build (or `RUSTFLAGS` for a cargo cdylib)\n" +
                    '  and rebuild.',
                { cause: err },
            );
        }
        throw err;
    }
}

/**
 * Relocate ONE Mach-O image in place.
 *
 * @param {string} file
 * @param {string[]} rpaths the list {@link darwinPrebuildRpaths} produced
 * @returns {{changed: string[], id: string|null}} the load commands rewritten
 */
export function relocateImage(file, rpaths) {
    const info = readLibrary(file);
    if (!info || info.format !== 'macho') return { changed: [], id: null };

    /** @type {string[]} */ const changed = [];

    // A Mach-O BUNDLE has no LC_ID_DYLIB and `-id` on one is an error, so this
    // keys on what the parser read, not on the file extension.
    let newId = null;
    if (info.id !== null && isBuildHostAbsolutePath(info.id)) {
        newId = `@rpath/${basename(file)}`;
        edit(['install_name_tool', '-id', newId, file], file);
        changed.push(`id ${info.id} → ${newId}`);
    }

    const rewritten = info.needed.filter(isBuildHostAbsolutePath);
    for (const dep of rewritten) {
        const to = `@rpath/${basename(dep)}`;
        // `-change` matches VERBATIM, so the loop reads the recorded strings
        // rather than reconstructing them from a prefix.
        edit(['install_name_tool', '-change', dep, to, file], file);
        changed.push(`${dep} → ${to}`);
    }

    // ONLY an image with something to resolve gets a search path. `@rpath` in an
    // image's OWN id is not a dependency but a template the CONSUMER expands, so an
    // id of `@rpath/<leaf>` with no `@rpath/` dependency needs no `LC_RPATH`. Both
    // Rust cdylibs are that shape, where three rpaths would be dead weight that also
    // does not fit cargo's header pad. Deriving the need from the dependencies makes
    // both arches produce the same bytes, which a blanket rule did not.
    const needsRpath = rewritten.length > 0 || info.needed.some((d) => d.startsWith('@rpath/'));
    if (needsRpath) {
        // Replace the list AND ITS ORDER: delete EVERY existing entry, including one
        // already wanted, then add the wanted ones in sequence. Keeping the wanted
        // ones is wrong INVISIBLY — `-add_rpath` APPENDS, so a kept entry holds its
        // position and additions land behind it, making precedence a property of
        // whatever the linker baked in. A freshly-linked `libgwebgl.dylib` carries
        // `<brew>/lib` from the Homebrew link line, so keeping it put the SYSTEM
        // prefix ahead of the bundle — ADR 0023 inverted, and #910's two-GLibs hazard
        // on any host with both. The committed artifacts hid it, their version-pinned
        // Cellar rpaths all being deleted anyway. Re-adding costs zero header bytes.
        for (const existing of info.searchPaths) {
            edit(['install_name_tool', '-delete_rpath', existing, file], file);
            changed.push(`-rpath ${existing}`);
        }
        for (const want of rpaths) {
            edit(['install_name_tool', '-add_rpath', want, file], file);
            changed.push(`+rpath ${want}`);
        }
    }

    // Re-sign what was signed, and ONLY that. `install_name_tool` invalidates a
    // signature and Apple-silicon dyld refuses a mis-signed dylib. An image that had
    // NONE must not get one: the signature lands on a fresh page-aligned
    // `__LINKEDIT` tail, so signing an unsigned 20,288-byte
    // `libgjsifylightningcss.dylib` produced 38,720 — ~18 KB × 9 x64 artifacts of
    // growth in COMMITTED files that every `commit-prebuilds` run rewrites (Mach-O
    // output is not byte-reproducible).
    //
    // Derived from the image, not the arch: the two agree today (arm64
    // `adhoc,linker-signed`, x64 unsigned, ld64 requiring a signature on arm64 only)
    // and a toolchain that starts signing x64 needs no edit here.
    // `build-gtk-runtime-darwin.mjs` signs unconditionally — correct THERE, where the
    // output is a fresh tarball payload rather than a committed file.
    if (changed.length > 0 && info.signed) {
        run(['codesign', '--force', '--sign', '-', file]);
        changed.push('re-signed (ad-hoc)');
    }
    return { changed, id: newId };
}

/**
 * Relocate every Mach-O in a staged prebuild directory.
 *
 * @param {string} dir
 * @param {string} target `darwin-<arch>`
 * @param {{verbose?: boolean}} [options]
 * @returns {number} images actually rewritten
 */
export function relocateDarwinPrebuildDir(dir, target, { verbose = true } = {}) {
    const note = verbose ? console.log : () => {};
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        throw new Error(`relocate-macho: ${dir} is not a directory`);
    }
    const rpaths = darwinPrebuildRpaths(target);
    let touched = 0;
    for (const leaf of readdirSync(dir).sort()) {
        if (!leaf.endsWith('.dylib') && !leaf.endsWith('.so')) continue;
        const { changed } = relocateImage(join(dir, leaf), rpaths);
        if (changed.length === 0) continue;
        touched++;
        note(`[relocate-macho] ${leaf}`);
        for (const c of changed) note(`    ${c}`);
    }
    return touched;
}

function main() {
    const args = process.argv.slice(2);
    const dir = args.find((a) => !a.startsWith('--'));
    const ti = args.indexOf('--target');
    const target = ti >= 0 ? args[ti + 1] : undefined;
    if (!dir || !target) {
        console.error('usage: node scripts/relocate-macho.mjs <prebuild-dir> --target darwin-<arch>');
        process.exit(2);
    }
    if (!target.startsWith('darwin-')) {
        console.error(`[relocate-macho] ${target} is not a darwin target — nothing to relocate.`);
        process.exit(2);
    }
    const touched = relocateDarwinPrebuildDir(resolve(dir), target);
    console.log(`[relocate-macho] ${touched} image(s) relocated in ${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('relocate-macho.mjs')) main();
