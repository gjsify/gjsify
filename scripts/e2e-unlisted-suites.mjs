// Suite directory → WHY it is deliberately absent from `package.json#scripts.test:e2e`.
//
// `scripts/e2e-shard.mjs` parses that script rather than globbing `tests/e2e/*`, and
// that is correct: a suite can need setup the standard e2e environment does not do, and
// a glob would run it anyway. What was missing is the other half — a record of WHICH
// omissions are deliberate.
//
// Without it, 12 of 112 suites ran nowhere and were indistinguishable from each other:
// eleven were oversights (all eleven pass unchanged; they are listed now) and exactly
// one was intentional. Among the eleven were `gjs-less-host` — the Node-free host path,
// which is where a released regression in `gjsify lint` had just been found — and
// `release-bundle-gate`, written days earlier to cover the release gate that let
// v0.28.0 publish half its packages. Its PR body claimed the suite WAS the pre-release
// coverage. It was in no script.
//
// So an omission now costs a sentence. `scripts/check-e2e-suite-coverage.mjs` fails on a
// suite that is neither listed nor named here, on an entry that IS listed (self-retiring
// — the deferral cannot outlive its cause), and on an entry whose directory is gone.
// Same shape as `scripts/manifest-conformance/unchecked-fields.mjs` and
// `PREBUILD_GIR_GAPS`, for the same reason: an honest "not covered" must be available,
// a silent one must not.
//
// The reason must say what the suite NEEDS that `test:e2e` does not provide — not that
// it is slow, and not that it fails. A failing suite is a finding, not an exemption.

/** @type {Record<string, string>} */
export const E2E_UNLISTED_SUITES = {
    'terminal-native': [
        'Needs its own `gjsify run build` first: the suite drives a probe binary that only',
        'exists after the terminal-native prebuild is staged, and `test:e2e` does not build',
        'per-suite fixtures. Running it in the shared batch fails on a missing probe rather',
        'than on anything about the code. Covered instead by the package’s own build +',
        '`prebuilds.yml`; listing it here would need `test:e2e` to grow a per-suite build step.',
    ].join(' '),
};
