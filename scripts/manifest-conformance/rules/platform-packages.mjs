/**
 * Rule `platform-packages` (ADR 0017) — REPO-SCOPED. The ADR splits every native
 * bridge's prebuilds into one npm package per `<os>-<arch>` target so a consumer
 * downloads only the binary their machine can load, with `gjsify.platforms` still the
 * single declaration. For every declared target this checks that a platform package
 * exists, that the parent carries an `optionalDependencies` entry for it, and that its
 * `os`/`cpu` MATCH the target token.
 *
 * Without that, the split trades one silent drift for another: before it, a wrong
 * declaration was caught by a missing `prebuilds/<target>/` directory; after it the
 * failure moves to install time and gets QUIETER, because a platform mismatch on an
 * OPTIONAL dependency is not an error — the package manager skips it silently and the
 * bridge fails at run time looking for a sibling never installed.
 *
 * It also holds the generated set to the GENERATOR. Dozens of manifests are not a
 * surface a reviewer keeps correct by reading, and every field is derived (name from
 * parent + token, `os`/`cpu` from the token, version and tier from the parent, glibc
 * floor from the ELF), so `auditPlatformPackages()` re-emits each manifest and
 * compares — the same function `scripts/generate-platform-packages.mjs --check` runs,
 * imported rather than reimplemented.
 *
 * REPO-SCOPED because both halves must be in one tree: a consumer installs a bridge
 * and ONE platform package, so "every declared target has a package" is unanswerable
 * there and would report failures for a correct install. The portable half is covered
 * where it belongs — each platform package declares its own one-element
 * `gjsify.platforms` + `gjsify.prebuilds`, putting the published tarball under the
 * PORTABLE `prebuild-artifacts` rule. See ADR 0017 and `lib/platform-packages.mjs`.
 *
 * `gjsify.platforms`/`gjsify.prebuilds` are claimed here AND by
 * `platforms-ci`/`prebuild-artifacts`: a field may have several owners, and after the
 * split the pair means something new in combination (which package owns the artifact).
 * `optionalDependencies`, `os` and `cpu` are plain npm fields, listed so the registry's
 * "say what you govern" contract covers what this rule reads.
 */

import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';
import { auditPlatformPackages } from '../../generate-platform-packages.mjs';

export const platformPackagesRule = defineRule({
    id: 'platform-packages',
    scope: 'repo',
    fields: ['gjsify.platforms', 'gjsify.prebuilds', 'optionalDependencies', 'os', 'cpu'],
    description:
        'every declared `<os>-<arch>` target has a generated platform package plus a matching `optionalDependencies` entry (ADR 0017)',
    run(ctx) {
        const { failures, notes, stats, summary } = auditPlatformPackages(ctx);
        return { failures, notes, stats, summary };
    },
});
