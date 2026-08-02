/**
 * Rule `platform-packages` (ADR 0017) — REPO-SCOPED.
 *
 * WHAT IT HOLDS
 *
 * ADR 0017 splits every native bridge's prebuilds into one npm package per
 * `<os>-<arch>` target, so a consumer downloads only the binary their machine can
 * load. `gjsify.platforms` stays the single declaration; step 2 of the decision
 * then requires an audit that, for every declared target, verifies
 *
 *   · a platform package exists, and
 *   · the parent carries an `optionalDependencies` entry for it, and
 *   · that package's `os`/`cpu` MATCH the target token,
 *
 * "otherwise we trade one silent drift for another". That sentence names the real
 * risk precisely: before the split, a wrong declaration was caught by a missing
 * `prebuilds/<target>/` directory. After it, the failure moves to install time
 * and gets quieter, because a platform mismatch on an OPTIONAL dependency is not
 * an error — the package manager skips it and says nothing, and the bridge then
 * fails at run time looking for a sibling that was never installed.
 *
 * The rule also holds the generated set to the GENERATOR: 51 manifests are not a
 * surface a reviewer can keep correct by reading, and every field in them is
 * derived (name from the parent + token, `os`/`cpu` from the token, version and
 * tier from the parent, glibc floor from the ELF). So `auditPlatformPackages()`
 * re-emits each manifest and compares — the same function
 * `scripts/generate-platform-packages.mjs --check` runs, imported rather than
 * reimplemented, because "the generator and the audit agree" has to be a fact
 * and not a hope.
 *
 * WHY REPO-SCOPED
 *
 * Both halves of the relation have to be in one tree for the question to mean
 * anything: a consumer installs a bridge and ONE platform package, so "every
 * declared target has a package" is unanswerable there and would report 5
 * failures for a correct install. It also imports this repository's generator
 * from `scripts/`. The portable half of the contract is already covered where it
 * belongs — each platform package declares its own one-element
 * `gjsify.platforms` + `gjsify.prebuilds`, which puts the published tarball under
 * the PORTABLE `prebuild-artifacts` rule (machine matches directory, every
 * typelib-named library staged, host-target `dlopen`). That is the whole reason
 * the split packages carry the declaration; see ADR 0017's resolved open
 * question and `lib/platform-packages.mjs`.
 *
 * FIELDS
 *
 * `gjsify.platforms` and `gjsify.prebuilds` are claimed here as well as by
 * `platforms-ci`/`prebuild-artifacts` — a field may have several owners, and
 * after the split these two declarations mean something new in combination (which
 * package owns the artifact). `optionalDependencies`, `os` and `cpu` are plain
 * npm fields, listed so the registry's "say what you govern" contract covers what
 * this rule actually reads.
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
