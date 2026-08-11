// SPDX-License-Identifier: MIT
// Stage the node-gyp-built addon as a portable per-platform prebuild.
//
// The addon is Node-API (NAPI_VERSION 8), so its ABI is stable across Node, Bun
// and Deno and across their versions — ONE binary per <platform>-<arch> is enough,
// no prebuildify per-ABI matrix needed. index.js#nativeCandidates() loads this
// path before a local build/, so a published tarball that ships prebuilds/ needs
// no C toolchain on the consumer (the only install path Deno supports — it runs no
// postinstall build script).
//
// Run AFTER node-gyp has built build/Release/node_gi.node (the build:prebuild
// npm script chains them). Prints the staged path.
//
// ## darwin: the copy is not enough — the addon must be RELOCATED
//
// A Mach-O records the FULL INSTALL PATH of each dependency where an ELF records a
// bare soname, so a freshly-linked darwin addon names the Homebrew prefix of the
// runner that linked it (`/usr/local/opt/glib/lib/libgobject-2.0.0.dylib` on Intel,
// `/opt/homebrew/...` on Apple silicon). That is #1102, and `scripts/relocate-macho.mjs`
// already fixes it for every OTHER darwin prebuild in this repo — the node-gi addon
// was the one artifact that only ever got `copyFileSync`.
//
// The consequence is worse here than a failed load, because those paths usually DO
// exist: on any Homebrew host the addon binds Homebrew's libgobject while the
// batteries-included bundle's libgtk/libadwaita bind the BUNDLE's copy through their
// own `@loader_path`. Two GObject type registries in one process — `g_type_from_name`
// and `g_object_class_find_property` then answer from the registry the types were NOT
// registered in, so every property lookup returns NULL and a GTK widget subclass does
// not test as a `GtkWidget` (#1120: `Adw.Application has no property 'application-id'`,
// plus a bogus "not a Gtk.Widget subclass" on a composite template). It is exactly the
// two-GTKs-in-one-process failure #910 paid for, arriving through the dependency the
// relocation pass never covered. ADR 0023 makes darwin prefer the bundle; this is what
// makes the addon actually FOLLOW that preference instead of silently staying on
// Homebrew.
//
// `relocate-macho.mjs` is deliberately NOT imported: `packages/node-gi/**` is
// `node-gi.yml`'s `paths:` trigger and the affected-classifier's ignore list, so an
// import either way makes one of the two lie (a `scripts/**` edit would change
// node-gi's build without running node-gi's CI). The ~20 lines that shell out to
// `install_name_tool` are local here for the same reason they are local there, and the
// rpath list differs on purpose — see {@link darwinAddonRpaths}.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Default Homebrew prefix per arch — the LAST-resort rpath entry.
 *
 * Hardcoded rather than read from `brew --prefix` on the builder: this entry is a
 * FALLBACK for consumers, so the only useful value is the one most consumers have,
 * and baking an unusual build-machine prefix in would help nobody. Mirrors
 * `scripts/relocate-macho.mjs`.
 */
const HOMEBREW_DEFAULT_PREFIX = {
    x64: '/usr/local',
    arm64: '/opt/homebrew',
};

/**
 * The `LC_RPATH` list the darwin addon should carry, in dyld's search order.
 * PURE — the unit-testable half (`test/darwin-prebuild-rpaths.test.mjs`).
 *
 * dyld tries `LC_RPATH` entries in the order they appear, so the list IS the
 * precedence policy, and it must come out the same as ADR 0023's: **bundle before
 * system**. An addon resolving its GLib differently from the process that loaded it
 * is the two-GTKs hazard described at the top of this file.
 *
 *   1. `@loader_path` — a dependency staged INTO the prebuild directory wins.
 *   2. `@loader_path/gtk/lib` — the bundle staged as a SIBLING of the addon inside
 *      `prebuilds/darwin-<arch>/`. This layout is node-gi's own (node-gi.yml stages
 *      it for the env-free core-conformance run, and `packages/node-gi/scripts/
 *      build-gtk-runtime-darwin.mjs` § 6 relocates a copy of the addon onto exactly
 *      this rpath) and is why node-gi cannot simply reuse `darwinPrebuildRpaths()`
 *      from `scripts/relocate-macho.mjs`.
 *   3. `@loader_path/../../../gtk-runtime-darwin-<arch>/gtk/lib` — the bundle as an
 *      npm SIBLING package: `prebuilds/<target>/` → the package → `@gjsify/`. This is
 *      the "no Homebrew at all" path and the one a `gjsify showcase` dlx tree uses.
 *   4. `<homebrew prefix>/lib` — the system stack, LAST.
 *
 * An `LC_RPATH` is fixed at link time and dyld consults no environment when expanding
 * `@rpath`, so the artifact encodes the DEFAULT; `GJSIFY_GTK_PREFER` stays a node-gi
 * loader concern (`gtk-runtime.js`). Worth stating because the two mechanisms look
 * interchangeable and are not.
 *
 * @param {string} target `darwin-x64` | `darwin-arm64`
 * @returns {string[]}
 */
export function darwinAddonRpaths(target) {
    const arch = target.slice('darwin-'.length);
    const prefix = HOMEBREW_DEFAULT_PREFIX[arch];
    if (!prefix) throw new Error(`stage-prebuild: no Homebrew prefix known for target \`${target}\``);
    return [
        '@loader_path',
        '@loader_path/gtk/lib',
        `@loader_path/../../../gtk-runtime-${target}/gtk/lib`,
        `${prefix}/lib`,
    ];
}

/**
 * Is this a dependency the BUILD HOST supplied, i.e. one that must become `@rpath`?
 *
 * DERIVED (absolute, and not an OS library), never a `/opt/homebrew` prefix grep: a
 * hardcoded prefix test is vacuously false on the other arch, so either alone passes
 * green while proving nothing — and the derived form also catches MacPorts and a home
 * directory nobody would have listed.
 *
 * @param {string} dep an `LC_LOAD_DYLIB` path
 */
const isBuildHostAbsolutePath = (dep) =>
    dep.startsWith('/') && !dep.startsWith('/usr/lib/') && !dep.startsWith('/System/');

/** @param {string} file @returns {string[]} */
function otoolDeps(file) {
    const out = execFileSync('otool', ['-L', file], { encoding: 'utf8' });
    // First line is the file itself; each dep line is "\t<path> (compatibility ...)".
    return out
        .split('\n')
        .slice(1)
        .map((line) => line.trim().split(' ')[0])
        .filter(Boolean);
}

/**
 * Rewrite the addon's build-host dependencies to `@rpath/<leaf>` and give it the
 * rpath list that resolves them. Ad-hoc re-signs afterwards: `install_name_tool`
 * invalidates the signature, and dyld on arm64 refuses a mis-signed image.
 *
 * The whole rpath list is REPLACED, order included — every pre-existing entry is
 * deleted, then the wanted ones are added in sequence. Deleting only the unwanted
 * ones is not the same thing and is how the darwin dylibs shipped an inverted order
 * once (`install_name_tool -add_rpath` APPENDS, so a linker-baked entry keeps its
 * position and the additions land behind it, making precedence a property of the link
 * line rather than of the policy — see `scripts/relocate-macho.mjs`).
 *
 * @param {string} file
 * @param {string[]} rpaths
 */
function relocateAddon(file, rpaths) {
    for (const dep of otoolDeps(file)) {
        if (!isBuildHostAbsolutePath(dep)) continue;
        const leaf = dep.slice(dep.lastIndexOf('/') + 1);
        execFileSync('install_name_tool', ['-change', dep, `@rpath/${leaf}`, file]);
    }
    for (const existing of currentRpaths(file)) {
        execFileSync('install_name_tool', ['-delete_rpath', existing, file]);
    }
    for (const rpath of rpaths) {
        // binding.gyp passes -headerpad_max_install_names on darwin so these fit; without
        // it the load commands outgrow the link-time header pad and this is where it shows.
        try {
            execFileSync('install_name_tool', ['-add_rpath', rpath, file], { stdio: 'pipe' });
        } catch (err) {
            throw new Error(
                `stage-prebuild: could not add rpath \`${rpath}\` to ${file}.\n` +
                    'If this says "larger updated load commands do not fit", the addon was linked\n' +
                    'without -headerpad_max_install_names (binding.gyp, OS=="mac" branch).\n' +
                    String(err?.stderr ?? err),
            );
        }
    }
    execFileSync('codesign', ['--force', '--sign', '-', file]);
}

/** @param {string} file @returns {string[]} */
function currentRpaths(file) {
    const out = execFileSync('otool', ['-l', file], { encoding: 'utf8' });
    // `otool -l` prints LC_RPATH as a three-line stanza whose third line is
    // "         path <value> (offset N)".
    const paths = [];
    const lines = out.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes('LC_RPATH')) continue;
        const pathLine = lines.slice(i, i + 4).find((l) => l.trim().startsWith('path '));
        if (pathLine)
            paths.push(
                pathLine
                    .trim()
                    .slice('path '.length)
                    .replace(/ \(offset \d+\)$/, ''),
            );
    }
    return paths;
}

// `import`ed by the test for the pure half; only the CLI run stages anything.
// Compared by BASENAME after `resolve()`, the same shape `scripts/relocate-macho.mjs`
// uses: a strict path equality is one symlinked checkout or one Windows drive-letter
// case away from silently staging nothing, and "the stager ran and did nothing" is the
// failure mode that ships an empty prebuilds/ dir.
if (process.argv[1] && resolve(process.argv[1]).endsWith('stage-prebuild.mjs')) {
    const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const src = join(pkgRoot, 'build', 'Release', 'node_gi.node');
    const target = `${process.platform}-${process.arch}`;
    const destDir = join(pkgRoot, 'prebuilds', target);
    const dest = join(destDir, 'node_gi.node');

    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, dest);

    if (process.platform === 'darwin') {
        if (!existsSync(dest)) throw new Error(`stage-prebuild: ${dest} missing after copy`);
        const rpaths = darwinAddonRpaths(target);
        relocateAddon(dest, rpaths);
        console.log(`node-gi: relocated ${target} addon -> @rpath + [${rpaths.join(', ')}]`);
    }

    console.log(`node-gi: staged prebuild -> prebuilds/${target}/node_gi.node`);
}
