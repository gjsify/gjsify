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
 * The two macOS members are in for the same reason one step further out. Neither
 * needs a macOS host — a `.app` tree and the zip around it are `finishOn: 'any'`
 * and a Linux workstation assembles both — but even if they did, this rule reads
 * a package's DECLARATION, and where that package is packed is not its business.
 */
const TARGETS = new Set(['deb', 'rpm', 'flatpak', 'macos-app', 'macos-app-zip']);
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
