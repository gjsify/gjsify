// Suite directory → WHY it is deliberately absent from `package.json#scripts.test:e2e`.
//
// `scripts/e2e-shard.mjs` parses that script rather than globbing `tests/e2e/*`, which is
// correct — a suite can need setup the shared batch does not do — but left no record of
// which omissions were meant: 12 of 112 suites ran nowhere, eleven by oversight, among
// them `release-bundle-gate`, written to cover the gate that let v0.28.0 publish half its
// packages and named by no script at all.
//
// Enforced by `scripts/check-e2e-suite-coverage.mjs` (see its header); same shape as
// `scripts/manifest-conformance/unchecked-fields.mjs` and the retired `PREBUILD_GIR_GAPS` — an honest
// "not covered" must be available, a silent one must not.
//
// The reason must say what the suite NEEDS that `test:e2e` does not provide — not that
// it is slow, and not that it fails. A failing suite is a finding, not an exemption.

/** @type {Record<string, string>} */
export const E2E_UNLISTED_SUITES = {
    'devtools-export': [
        'Needs a session-bus environment in which an Adwaita GApplication completes startup and',
        'KEEPS its well-known name. The containerised runner does not provide one. This suite had',
        'never run in CI before being listed, and its first run there measured: `APP_ON_BUS=yes`',
        '(the app DID own org.example.reprotest), then `INSTALL_RETURNED=null` and `EXPORT_LOG=no`',
        '(devtools never installed), then `ServiceUnknown` for every later call — with',
        '`org.freedesktop.portal.Desktop` activating in between and `xdg-desktop-portal` failing on',
        '"Document portal fuse mount point unknown". It passes on a normal desktop session.',
        'WHY the name is lost in the container is NOT yet understood, so this entry records a',
        'measured environmental dependency together with an OPEN QUESTION — it is not a settled',
        'exemption, and the right fix is a precondition in the suite’s own SKIP gate so it skips',
        'there and still runs where it can. Tracked in status/open-todos.md.',
    ].join(' '),
    'react-native-devtools': [
        'Needs a DISPLAY as well as a session bus. The suite asserts that the application window',
        'is MAPPED and that `Screenshot` returns real PNG bytes, and a GTK window cannot map',
        'without a display — so its own SKIP gate checks for one, which under `test:e2e` (no',
        'display, no bus) would make it SILENT rather than red. A suite that reports nothing is',
        'the state this ledger exists to keep visible, so listing it there would buy exactly the',
        'wrong thing. The environment it needs already exists in main.yml’s `examples` job',
        '(`xvfb-run … dbus-run-session` around the showcase smoke launch); moving it there is the',
        'repair, and it needs that job’s `packages/framework/*/lib` set confirmed first, because',
        'the same SKIP gate goes quiet without it. Tracked in status/open-todos.md beside',
        '`devtools-export`, which needs the same kind of environment for a different and still-open',
        'reason. Measured GREEN on a desktop session: 2 vectors, 2 passing.',
    ].join(' '),
    'terminal-native': [
        'Needs its own `gjsify run build` first: the suite drives a probe binary that only',
        'exists after the terminal-native prebuild is staged, and `test:e2e` does not build',
        'per-suite fixtures. Running it in the shared batch fails on a missing probe rather',
        'than on anything about the code. Covered instead by the package’s own build +',
        '`prebuilds.yml`; listing it here would need `test:e2e` to grow a per-suite build step.',
    ].join(' '),
};
