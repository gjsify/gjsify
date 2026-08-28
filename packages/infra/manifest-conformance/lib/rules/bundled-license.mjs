/**
 * Rule `bundled-license` — a package that ships OTHER projects' binaries may not
 * declare only its own licence.
 *
 * THE DEFECT. The three `@gjsify/gtk-runtime-*` packages each declared
 * `"license": "MIT"` while their published tarball carries 37–45 relocated
 * LGPL/MPL/GPL libraries — GTK, GLib, Pango, cairo, freetype, fontconfig,
 * harfbuzz and the rest. MIT is the correct licence of the three source files in
 * those packages and the wrong answer for the artifact npm hands a user.
 *
 * That mattered in a way a prose note could not fix. `bundle-licenses.mjs`
 * already ships the licence TEXTS and a `THIRD-PARTY-NOTICES.md` that states
 * plainly which half is which — but a licence scanner, an SBOM generator or a
 * corporate policy gate reads `package.json#license` and nothing else. So the
 * one machine-readable field said MIT-only about a tarball that is not, while
 * everything a human would read was already correct.
 *
 * WHAT THIS CHECKS, and why it is shaped as a QUESTION rather than a list. The
 * trigger is not a hard-coded package set — it is the same signal the licence
 * bundler keys on: a package whose `files` ship a payload directory built from a
 * third-party prefix. Hard-coding the three names would pass the day a fourth
 * bundle is added, which is the failure mode this rule exists to prevent.
 *
 * The accepted answer is deliberately NOT a specific SPDX expression:
 *
 *   • On darwin the attribution is exact — every bundled dylib resolves into a
 *     Homebrew keg, and `parseBrewLicenseStanza()` reads the terms out of the
 *     keg's own formula. An expression is derivable there.
 *   • On win32 it is NOT. The gvsbuild prefix is one flat `bin/`, the VERSIONINFO
 *     resource is present in some DLLs and absent in others, and the builder says
 *     so itself. An expression there would be a GUESS — and a guessed licence
 *     expression is worse than an incomplete one, because it makes a specific
 *     false claim instead of an unspecific one.
 *
 * So the rule requires either a compound SPDX expression or npm's own documented
 * form for exactly this case, `SEE LICENSE IN <file>` — and, when that form is
 * used, that the file it names is one the package actually ships.
 */

import { defineRule } from '../registry.mjs';

/**
 * Directories whose presence in `files` means "this tarball carries a payload
 * built from a third-party prefix". Kept as a list of NAMES rather than of
 * packages: a new bundle that ships `gtk/` is caught the day it is added.
 *
 * `'bin'` is here for the `@gjsify/node-runtime-*` packages, which ship one Node
 * binary plus Node's `LICENSE` as `files: ["bin"]`. It had to be ADDED — a set
 * that only knew `'gtk'` would have let a package redistributing a 120 MB
 * interpreter declare `"license": "MIT"` at exit 0, which is verbatim the defect
 * this rule exists to close, one payload directory over. That is the failure to
 * expect from a literal set: the day a package ships a third-party payload under
 * some other directory name, its name goes here in the same commit.
 *
 * Measured before adding it, because `bin` is a far more ordinary name than
 * `gtk`: across all 337 manifests in this repository, ZERO list `bin` in `files`
 * apart from the three added with it. And the trigger is `files`, not the `bin`
 * MANIFEST FIELD — a package declaring executables via `"bin": {…}` is untouched.
 */
const PAYLOAD_DIRS = new Set(['gtk', 'bin']);

/** `SEE LICENSE IN <file>` — npm's documented form for a licence too complex to express. */
const SEE_LICENSE_IN = /^SEE LICEN[CS]E IN\s+(.+)$/;

/**
 * Does this licence value acknowledge more than one project's terms?
 *
 * A bare identifier (`MIT`) does not. A compound SPDX expression (`A AND B`) does.
 * `SEE LICENSE IN` does, and is handled by the caller because it also has a file
 * to verify.
 */
function acknowledgesThirdParty(license) {
    if (typeof license !== 'string') return false;
    return /\b(AND|OR|WITH)\b/.test(license);
}

/**
 * Packages whose `files` list names a payload directory. `files` rather than the
 * filesystem on purpose: the payload is gitignored and built on a runner, so the
 * directory is absent in a checkout and present in the tarball — and it is the
 * TARBALL the licence field describes.
 */
export function collectBundlingPackages(ctx) {
    const out = [];
    for (const pkg of ctx.allPackages) {
        const files = Array.isArray(pkg.manifest.files) ? pkg.manifest.files : [];
        const payload = files.filter((f) => PAYLOAD_DIRS.has(String(f).replace(/\/+$/, '')));
        if (payload.length === 0) continue;
        out.push({ name: pkg.manifest.name, path: pkg.rel, license: pkg.manifest.license, files, payload });
    }
    return out;
}

/**
 * @returns {{failures: string[], notes: string[], stats: Record<string, number>}}
 */
export function auditBundledLicense(packages) {
    const failures = [];
    const notes = [];
    let compound = 0;
    let seeLicenseIn = 0;

    for (const pkg of packages) {
        const license = pkg.license;
        if (typeof license !== 'string' || license.trim() === '') {
            failures.push(
                `${pkg.name} (${pkg.path}): ships a third-party payload (${pkg.payload.join(', ')}) and declares no \`license\`. ` +
                    "A package that redistributes other projects' binaries must say so in the one field a scanner reads.",
            );
            continue;
        }

        const seeIn = SEE_LICENSE_IN.exec(license.trim());
        if (seeIn) {
            const named = seeIn[1].trim();
            // The file must be one the tarball carries, or the field points at nothing
            // for every consumer — the failure mode being fixed, one level down.
            const shipped = pkg.files.some((f) => {
                const entry = String(f).replace(/\/+$/, '');
                return named === entry || named.startsWith(`${entry}/`);
            });
            if (!shipped) {
                failures.push(
                    `${pkg.name} (${pkg.path}): \`license\` is "${license}" but \`files\` does not ship "${named}". ` +
                        `\`files\` lists: ${pkg.files.join(', ')}. A licence that names an unshipped file is unreadable ` +
                        'by the consumer it exists for.',
                );
                continue;
            }
            seeLicenseIn++;
            notes.push(`${pkg.name}: licence deferred to ${named} (shipped)`);
            continue;
        }

        if (!acknowledgesThirdParty(license)) {
            failures.push(
                `${pkg.name} (${pkg.path}): declares \`"license": "${license}"\` while shipping a third-party payload ` +
                    `(${pkg.payload.join(', ')}). That is the licence of this package's own sources and not of the ` +
                    'tarball npm hands a user, which also carries relocated LGPL/MPL/GPL libraries. Use a compound ' +
                    'SPDX expression, or `SEE LICENSE IN <file>` naming a notice the package ships.',
            );
            continue;
        }
        compound++;
        notes.push(`${pkg.name}: compound SPDX expression`);
    }

    return {
        failures,
        notes,
        stats: { bundling: packages.length, compound, seeLicenseIn },
    };
}

export const bundledLicenseRule = defineRule({
    id: 'bundled-license',
    scope: 'portable',
    fields: ['license'],
    description: "a package shipping another project's binaries declares a licence that says so, not just its own",
    run(ctx) {
        const packages = collectBundlingPackages(ctx);
        const result = auditBundledLicense(packages);
        return {
            failures: result.failures,
            notes: result.notes,
            stats: result.stats,
            summary:
                packages.length === 0
                    ? 'bundled-license: no package ships a third-party payload'
                    : `bundled-license: ${packages.length} bundling package(s) — ` +
                      `${result.stats.seeLicenseIn} defer to a shipped notice, ${result.stats.compound} declare a compound expression`,
        };
    },
});
