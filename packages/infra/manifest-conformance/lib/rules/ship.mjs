// `gjsify.ship` — every declared packaging input exists and is well-formed.
//
// THE GAP THIS CLOSES. `gjsify ship` reads a dozen paths and identifiers out of
// `gjsify.ship` and only finds out they are wrong when someone runs it — and
// running it is the LAST step of a release, after a tag, often on a machine
// that is not the author's. A typo'd `icon` path, an `appId` that is not
// reverse-DNS, or a `binaryName` dpkg will not accept are all cheap to catch
// here and expensive to discover there.
//
// WHY THE FIELD SHAPES ARE WORTH CHECKING and not just the paths: an `appId`
// that is not reverse-DNS produces a desktop entry and an AppStream component
// that install fine and are then invisible to every app store, and a
// `binaryName` outside dpkg's grammar produces a `.deb` dpkg refuses with a
// message about the package NAME rather than about the config key that set it.
// Both are silent-until-late failures, which is the class this registry exists
// for.
//
// WHY `portable`, per the scope criterion (would this rule still be TRUE in
// another tree): it reads the package's own `gjsify.ship` block and paths
// resolved relative to that package's directory. No pillar taxonomy, no
// workflow YAML, no `refs/`. Downstream consumers are exactly who will declare
// this block, so it has to work in their trees — which is also why an absent
// key is legal everywhere: every one of them has a derived default.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineRule } from '../registry.mjs';

/** Reverse-DNS: at least three dot-separated segments, each starting with a letter. */
const APP_ID = /^[A-Za-z][\w-]*(\.[A-Za-z][\w-]*){2,}$/;
/** dpkg's package-name grammar; rpm's is looser, so satisfying dpkg satisfies both. */
const BINARY_NAME = /^[a-z\d][a-z\d+.-]+$/;
/**
 * The formats `gjsify ship` can build today.
 *
 * Held against the CLI's own `FormatId` by `scripts/check-ship-format-vocabulary.mjs` —
 * textually, because this rule is `portable` and must not import `@gjsify/cli`.
 * `flatpak` is in the set even though it needs `flatpak-builder` on the packing
 * host: a DECLARATION is legal wherever the format exists, and refusing it here
 * would tell a project its target is unsupported on the very machine that
 * assembles the stage for a different one.
 *
 * The THREE macOS members are in for the same reason one step further out, and
 * they no longer agree with each other about hosts: a `.app` tree and the zip
 * around it are `finishOn: 'any'` and a Linux workstation assembles both, while
 * `macos-app-dmg` is `['darwin']`. That difference is exactly what this rule must
 * NOT read — it sees a package's DECLARATION, and where that package is packed is
 * not its business. (This paragraph said "the two macOS members" and "neither
 * needs a macOS host" for one release after the `.dmg` landed, which is the shape
 * of every stale comment: still true of the rows it was written about.)
 *
 * `msi` is the case that closes the argument, because it fails BOTH gates rather
 * than one: `finishOn: ['linux', 'win32']` AND a compiler it execs (`wixl` or
 * WiX v3). On some machine somewhere every axis that could refuse a declaration
 * does — and it is still legal to declare, because a project says what it ships,
 * not where the shipping happens.
 *
 * `appimage` needs a tool NO distribution packages, which is a fourth way to fail
 * the same gate and changes nothing here for the same reason: a project declaring
 * it says what it ships, and the machine that reads this rule may be the one that
 * only assembles the stage.
 */
const TARGETS = new Set([
    'deb',
    'rpm',
    'flatpak',
    'appimage',
    'linux-tar',
    'linux-tar-flatpak',
    'macos-app',
    'macos-app-zip',
    'macos-app-dmg',
    'windows-dir',
    'windows-dir-zip',
    'msi',
]);
/**
 * Keys whose value is a SOURCE path that must exist relative to the package.
 *
 * `bundle` is deliberately NOT here. It is the one build OUTPUT among the path
 * keys — `gjsify ship` packages a BUILT app — so it is absent in a clean checkout
 * by definition, and requiring it here would mean no package could declare
 * `gjsify.ship` without committing its own dist. The right moment to demand it is
 * ship time, and `resolveBundle()` already does: "the bundle X does not exist.
 * Build it first (`gjsify run build`)". Asking at audit time asks a different
 * question and answers it wrong.
 */
const PATH_KEYS = ['icon', 'schemas', 'licenseFile'];

/**
 * The OSes `gjsify.ship.sign` may be keyed on.
 *
 * The `process.platform` spelling, because the value that resolves is chosen by
 * the LAYOUT being packed — `FormatDescriptor.layoutOs` and the stage manifest's
 * `target.os`, both of which are this vocabulary (ADR 0024 § A12). `macos` and
 * `windows` are the `gjsify ship <os>` POSITIONAL's spelling and are the typo
 * this refusal exists for: an identity under an unrecognised key resolves to
 * nothing at all, so the artifact ships unsigned with every gate green — the
 * silent-until-late class this whole rule is for, in its purest form.
 *
 * `linux` is absent on purpose and refused by name: a `.deb` and an `.rpm` carry
 * no per-file signature, so a key there would look like it did something.
 */
const SIGN_OSES = new Set(['darwin', 'win32']);

/**
 * The OSes `gjsify.ship.app` and `gjsify.ship.bundle` may be keyed on, and the
 * runtimes the first of them may name.
 *
 * ONE set for both, because they are one decision split over two keys: the
 * runtime a target execs and the entry it hands that runtime. A vocabulary that
 * drifted between them would let a project name darwin's entry under a key
 * darwin's runtime is not read from.
 *
 * The `process.platform` spelling again, for the reason `SIGN_OSES` gives: the
 * value that resolves is chosen by the LAYOUT being assembled. All three are in,
 * unlike signing — a Linux artifact very much has a runtime, and it is the one
 * that emits `Depends: gjs (>= 1.86)` or `Depends: nodejs (>= 24)`.
 *
 * THE FAILURE THIS CATCHES IS THE SILENT ONE, and it is worse here than for an
 * identity. `gjsify.ship.app.windows: "node"` — the `gjsify ship <os>`
 * POSITIONAL's spelling — resolves to nothing, so that target quietly keeps the
 * project-wide `gjsify.app`: the Windows formats stay unavailable and the author
 * reads it as gjsify not supporting the split, with every gate green. An
 * unrecognised RUNTIME is the same shape one level down; `browser` and
 * `nativescript` are refused for ADR 0024 § 4's reason — no process to launch,
 * and an APK/IPA pipeline that is not this one.
 */
const APP_OSES = new Set(['linux', 'darwin', 'win32']);
const APP_RUNTIMES = new Set(['gjs', 'node']);

/**
 * The formats `gjsify.ship.formats` may be keyed on — the CLI's `FORMAT_FILES_IDS`
 * (`packages/infra/cli/src/utils/ship/discover.ts`), restated here because this package reads
 * package.json files without loading the CLI.
 *
 * NOT the formats that have a `Depends:` field, which is the neighbouring and narrower question
 * `gjsify.ship.depends` is keyed on (`deb`, `rpm`). An AppImage declares no dependency and still
 * carries files: its payload goes through the same overlay, under the AppDir's `usr/`.
 *
 * An ARRAY and not a `Set`, because the refusal prints the list and the order it prints is this
 * one.
 */
const FORMAT_FILES_IDS = ['deb', 'rpm', 'appimage'];

export function auditShip(ctx) {
    const failures = [];
    let declared = 0;

    for (const pkg of ctx.packages) {
        const block = pkg.manifest?.gjsify?.ship;
        if (block === undefined) continue;
        declared += 1;

        if (block === null || typeof block !== 'object' || Array.isArray(block)) {
            failures.push(`${pkg.rel}/package.json: \`gjsify.ship\` must be an object.`);
            continue;
        }

        if (typeof block.appId === 'string' && !APP_ID.test(block.appId)) {
            failures.push(
                `${pkg.rel}/package.json: \`gjsify.ship.appId\` is "${block.appId}", which is not a reverse-DNS ` +
                    `application id (e.g. "io.github.you.App"). It names the desktop entry, the AppStream component ` +
                    `and the installed icon, and a non-conforming id installs cleanly and is invisible to app stores.`,
            );
        }

        if (typeof block.binaryName === 'string' && !BINARY_NAME.test(block.binaryName)) {
            failures.push(
                `${pkg.rel}/package.json: \`gjsify.ship.binaryName\` is "${block.binaryName}", which dpkg will not ` +
                    `accept. It must be at least two characters, start with a lowercase letter or digit, and use only ` +
                    `\`[a-z0-9+.-]\`.`,
            );
        }

        for (const key of PATH_KEYS) {
            const value = block[key];
            if (typeof value !== 'string') continue;
            if (!existsSync(join(pkg.dir, value))) {
                failures.push(
                    `${pkg.rel}/package.json: \`gjsify.ship.${key}\` points at ${value}, which does not exist in this ` +
                        `package (${pkg.rel}/${value}). \`gjsify ship\` resolves exactly this path and fails there.`,
                );
            }
        }

        for (const [dest, source] of Object.entries(block.extraFiles ?? {})) {
            if (typeof source === 'string' && !existsSync(join(pkg.dir, source))) {
                failures.push(
                    `${pkg.rel}/package.json: \`gjsify.ship.extraFiles["${dest}"]\` reads ${source}, which does not ` +
                        `exist in this package.`,
                );
            }
        }

        for (const target of block.targets ?? []) {
            if (!TARGETS.has(target)) {
                failures.push(
                    `${pkg.rel}/package.json: \`gjsify.ship.targets\` names "${target}", which \`gjsify ship\` cannot ` +
                        `build. Known targets: ${[...TARGETS].join(', ')}.`,
                );
            }
        }

        // `bundle` as a TABLE, which is the only half of it this rule can judge.
        // The paths themselves stay unchecked for the reason PATH_KEYS gives —
        // they are build outputs, absent in a clean checkout — but a key nothing
        // reads is exactly as silent here as it is on `app`, and costs more: the
        // target keeps the project's entry and ships a bundle its own
        // interpreter cannot load (#1545).
        const bundle = block.bundle;
        if (bundle !== undefined && typeof bundle !== 'string') {
            if (bundle === null || typeof bundle !== 'object' || Array.isArray(bundle)) {
                failures.push(
                    `${pkg.rel}/package.json: \`gjsify.ship.bundle\` must be a path or an object keyed by OS — ` +
                        `one entry for every target, or one per target.`,
                );
            } else {
                for (const [os, entry] of Object.entries(bundle)) {
                    if (!APP_OSES.has(os)) {
                        failures.push(
                            `${pkg.rel}/package.json: \`gjsify.ship.bundle.${os}\` is not an OS \`gjsify ship\` ` +
                                `assembles for. Known: ${[...APP_OSES].join(', ')} — the \`process.platform\` ` +
                                `spelling, not the \`gjsify ship <os>\` positional's. An entry under a key nothing ` +
                                `reads leaves that target on \`gjsify.main\` with nothing to say so.`,
                        );
                    } else if (typeof entry !== 'string' || entry.length === 0) {
                        failures.push(
                            `${pkg.rel}/package.json: \`gjsify.ship.bundle.${os}\` must be a path to the built ` +
                                `bundle that target installs.`,
                        );
                    }
                }
            }
        }

        // `nodeModules` / `nodeModulesExclude` are lists of package names; a string or a path would
        // stage (or leave out) nothing and say so nowhere.
        for (const key of ['nodeModules', 'nodeModulesExclude']) {
            const names = block[key];
            if (
                names !== undefined &&
                (!Array.isArray(names) || names.some((name) => typeof name !== 'string' || name.length === 0))
            ) {
                failures.push(`${pkg.rel}/package.json: \`gjsify.ship.${key}\` must be a list of npm package names.`);
            }
        }

        // `executables`: extra launchers beside the primary one. The entry is a build output (like
        // `bundle`), so only the shape is judged here; `gjsify ship` checks it against the bundle.
        const executables = block.executables;
        if (executables !== undefined) {
            if (!Array.isArray(executables)) {
                failures.push(`${pkg.rel}/package.json: \`gjsify.ship.executables\` must be a list of objects.`);
            } else {
                for (const [index, exe] of executables.entries()) {
                    const at = `${pkg.rel}/package.json: \`gjsify.ship.executables[${index}]\``;
                    if (exe === null || typeof exe !== 'object' || Array.isArray(exe)) {
                        failures.push(`${at} must be an object with \`name\` and \`entry\`.`);
                        continue;
                    }
                    if (typeof exe.name !== 'string' || !/^[a-z0-9][a-z0-9._+-]*$/.test(exe.name)) {
                        failures.push(`${at}.name must match /^[a-z0-9][a-z0-9._+-]*$/.`);
                    }
                    if (typeof exe.entry !== 'string' || exe.entry.length === 0) {
                        failures.push(`${at}.entry must be a project-relative path to the built entry.`);
                    }
                    if (exe.gui !== undefined && typeof exe.gui !== 'boolean') {
                        failures.push(`${at}.gui must be a boolean.`);
                    }
                    for (const key of Object.keys(exe)) {
                        if (!['name', 'entry', 'gui'].includes(key)) {
                            failures.push(`${at}.${key} is not a known key. Known: name, entry, gui.`);
                        }
                    }
                }
            }
        }

        // `bundledTypelibs` as a TABLE: same silent-key failure as `bundle`, and here the cost is a
        // target that ships without the typelib it needs.
        const typelibs = block.bundledTypelibs;
        if (typelibs !== undefined && !Array.isArray(typelibs)) {
            if (typelibs === null || typeof typelibs !== 'object') {
                failures.push(
                    `${pkg.rel}/package.json: \`gjsify.ship.bundledTypelibs\` must be a list of directories or an ` +
                        `object keyed by OS.`,
                );
            } else {
                for (const [os, dirs] of Object.entries(typelibs)) {
                    if (!APP_OSES.has(os)) {
                        failures.push(
                            `${pkg.rel}/package.json: \`gjsify.ship.bundledTypelibs.${os}\` is not an OS \`gjsify ship\` ` +
                                `assembles for. Known: ${[...APP_OSES].join(', ')} — the \`process.platform\` spelling.`,
                        );
                    } else if (!Array.isArray(dirs) || dirs.some((dir) => typeof dir !== 'string')) {
                        failures.push(
                            `${pkg.rel}/package.json: \`gjsify.ship.bundledTypelibs.${os}\` must be a list of directories.`,
                        );
                    }
                }
            }
        }

        // `formats`: per-format files. Only the formats assembled from an overlay have anywhere to
        // carry them, so another key would be dropped without a word. The list is the CLI's
        // `FORMAT_FILES_IDS` (utils/ship/discover.ts) — a package.json reaching that refusal at pack
        // time should have failed here, where the manifest is.
        const formats = block.formats;
        if (formats !== undefined) {
            if (formats === null || typeof formats !== 'object' || Array.isArray(formats)) {
                failures.push(`${pkg.rel}/package.json: \`gjsify.ship.formats\` must be an object keyed by format.`);
            } else {
                for (const [id, options] of Object.entries(formats)) {
                    if (!FORMAT_FILES_IDS.includes(id)) {
                        failures.push(
                            `${pkg.rel}/package.json: \`gjsify.ship.formats.${id}\` is not a format that carries its ` +
                                `own files. Known: ${FORMAT_FILES_IDS.join(', ')}.`,
                        );
                    } else if (options === null || typeof options !== 'object' || Array.isArray(options)) {
                        failures.push(`${pkg.rel}/package.json: \`gjsify.ship.formats.${id}\` must be an object.`);
                    } else if (
                        options.bundledTypelibs !== undefined &&
                        (!Array.isArray(options.bundledTypelibs) ||
                            options.bundledTypelibs.some((dir) => typeof dir !== 'string'))
                    ) {
                        failures.push(
                            `${pkg.rel}/package.json: \`gjsify.ship.formats.${id}.bundledTypelibs\` must be a list of directories.`,
                        );
                    }
                }
            }
        }

        const app = block.app;
        if (app !== undefined) {
            if (app === null || typeof app !== 'object' || Array.isArray(app)) {
                failures.push(
                    `${pkg.rel}/package.json: \`gjsify.ship.app\` must be an object keyed by OS — it is the ` +
                        `PER-TARGET override of \`gjsify.app\`, not a second spelling of it.`,
                );
            } else {
                for (const [os, runtime] of Object.entries(app)) {
                    if (!APP_OSES.has(os)) {
                        failures.push(
                            `${pkg.rel}/package.json: \`gjsify.ship.app.${os}\` is not an OS \`gjsify ship\` ` +
                                `assembles for. Known: ${[...APP_OSES].join(', ')} — the \`process.platform\` ` +
                                `spelling, not the \`gjsify ship <os>\` positional's. A runtime under a key nothing ` +
                                `reads leaves that target on \`gjsify.app\` with nothing to say so.`,
                        );
                        continue;
                    }
                    if (!APP_RUNTIMES.has(runtime)) {
                        failures.push(
                            `${pkg.rel}/package.json: \`gjsify.ship.app.${os}\` is "${runtime}", and only ` +
                                `${[...APP_RUNTIMES].join(' and ')} can be packaged. A browser bundle has no ` +
                                `process to launch, and a NativeScript app ships as an APK/IPA through a different ` +
                                `pipeline (ADR 0024 § 4).`,
                        );
                    }
                }
            }
        }

        const sign = block.sign;
        if (sign !== undefined) {
            if (sign === null || typeof sign !== 'object' || Array.isArray(sign)) {
                failures.push(`${pkg.rel}/package.json: \`gjsify.ship.sign\` must be an object keyed by OS.`);
            } else {
                for (const [os, row] of Object.entries(sign)) {
                    if (!SIGN_OSES.has(os)) {
                        failures.push(
                            `${pkg.rel}/package.json: \`gjsify.ship.sign.${os}\` is not an OS \`gjsify ship\` signs ` +
                                `for. Known: ${[...SIGN_OSES].join(', ')} — the \`process.platform\` spelling, not ` +
                                `the \`gjsify ship <os>\` positional's. An identity under a key nothing reads is an ` +
                                `artifact that ships UNSIGNED with nothing to say so.`,
                        );
                        continue;
                    }
                    if (row === null || typeof row !== 'object' || typeof row.identity !== 'string') {
                        failures.push(
                            `${pkg.rel}/package.json: \`gjsify.ship.sign.${os}\` needs an \`identity\` string — ` +
                                `the NAME \`codesign\`/\`signtool\` looks the key up by, never a certificate or a ` +
                                `path to one (ADR 0024 § A12).`,
                        );
                    }
                }
            }
        }

        // `nestedBundles` / `helperExecutables`: darwin-only, each entry needs a
        // `source` that exists relative to the package and a usable `name`. The
        // SAME silent-key failure class as `bundle`/`app` is not reachable here —
        // there is no per-OS table to mis-key — but a missing `source` is exactly
        // as late-discovered: `gjsify ship darwin` fails on it, nothing else ever
        // reads the path.
        for (const [key, under] of [
            ['nestedBundles', 'Contents/PlugIns'],
            ['helperExecutables', 'Contents/Helpers'],
        ]) {
            const entries = block[key];
            if (entries === undefined) continue;
            if (!Array.isArray(entries)) {
                failures.push(`${pkg.rel}/package.json: \`gjsify.ship.${key}\` must be a list of objects.`);
                continue;
            }
            const seen = new Set();
            for (const [index, entry] of entries.entries()) {
                const at = `${pkg.rel}/package.json: \`gjsify.ship.${key}[${index}]\``;
                if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
                    failures.push(`${at} must be an object with \`source\` and \`name\`.`);
                    continue;
                }
                if (typeof entry.source !== 'string' || entry.source.length === 0) {
                    failures.push(`${at}.source must be a project-relative path.`);
                } else if (!existsSync(join(pkg.dir, entry.source))) {
                    failures.push(`${at}.source points at ${entry.source}, which does not exist in this package.`);
                }
                if (
                    typeof entry.name !== 'string' ||
                    entry.name.length === 0 ||
                    entry.name.includes('/') ||
                    entry.name.includes('\\')
                ) {
                    failures.push(
                        `${at}.name must be a non-empty string with no \`/\` or \`\\\` — the leaf under \`${under}\`.`,
                    );
                } else if (seen.has(entry.name)) {
                    failures.push(`${at}.name "${entry.name}" is already taken by an earlier entry.`);
                } else {
                    seen.add(entry.name);
                }
                if (
                    entry.entitlements !== undefined &&
                    (!Array.isArray(entry.entitlements) || entry.entitlements.some((key2) => typeof key2 !== 'string'))
                ) {
                    failures.push(`${at}.entitlements must be a list of strings.`);
                }
                for (const stray of Object.keys(entry)) {
                    if (!['source', 'name', 'entitlements'].includes(stray)) {
                        failures.push(`${at}.${stray} is not a known key. Known: source, name, entitlements.`);
                    }
                }
            }
        }

        // `mainExecutable`: darwin-only `{ source }` — the app's own Mach-O main.
        if (block.mainExecutable !== undefined) {
            const me = block.mainExecutable;
            const at = `${pkg.rel}/package.json: \`gjsify.ship.mainExecutable\``;
            if (me === null || typeof me !== 'object' || Array.isArray(me)) {
                failures.push(`${at} must be an object with \`source\`.`);
            } else {
                if (typeof me.source !== 'string' || me.source.length === 0) {
                    failures.push(`${at}.source must be a project-relative path.`);
                } else if (!existsSync(join(pkg.dir, me.source))) {
                    failures.push(`${at}.source points at ${me.source}, which does not exist in this package.`);
                }
                for (const stray of Object.keys(me)) {
                    if (stray !== 'source') failures.push(`${at}.${stray} is not a known key. Known: source.`);
                }
            }
        }

        for (const [namespace, row] of Object.entries(block.typelibPackages ?? {})) {
            // A half-filled row is worse than none: the format it forgot falls
            // back to the built-in table, which is what did not know the
            // namespace in the first place, so the failure returns for one
            // format only — and usually the one the author does not build.
            if (typeof row?.deb !== 'string' || typeof row?.rpm !== 'string') {
                failures.push(
                    `${pkg.rel}/package.json: \`gjsify.ship.typelibPackages["${namespace}"]\` needs BOTH a \`deb\` and ` +
                        `an \`rpm\` package name. A row with one of them makes the build fail for the other format only.`,
                );
            }
        }
    }

    return { failures, stats: { declared } };
}

export const shipRule = defineRule({
    id: 'ship',
    scope: 'portable',
    fields: ['gjsify.ship'],
    description: 'every declared `gjsify.ship` path exists and every declared identifier is one the packers accept',
    run(ctx) {
        const { failures, stats } = auditShip(ctx);
        return {
            failures,
            stats,
            summary:
                stats.declared === 0
                    ? 'ship: no package declares `gjsify.ship`'
                    : `ship: ${stats.declared} package(s) declare \`gjsify.ship\``,
        };
    },
});
