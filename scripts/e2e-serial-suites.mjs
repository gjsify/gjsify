// Suite directory → WHY it must run ALONE, never concurrently with anything else.
//
// `scripts/e2e-suites.mjs` discovers the e2e suite set by directory instead of a
// hand-maintained `package.json#scripts.test:e2e` line. Discovery alone cannot tell a
// suite that mutates true GLOBAL machine state (the shared ostree cache, the workspace
// on disk) from an ordinary one safe under `node --test --test-concurrency=4` — that is
// a property of what the suite DOES, not of its name or path, so it stays an explicit,
// reasoned ledger entry rather than a marker `check-e2e-suite-coverage.mjs` could infer.
//
// Same shape as `scripts/e2e-unlisted-suites.mjs`: an entry that no longer needs to be
// here is a bug (self-retiring is asserted by `check-e2e-suite-coverage.mjs`), and the
// reason must say what global state the suite touches — not that it is slow.

/** @type {Record<string, string>} */
export const E2E_SERIAL_SUITES = {
    'self-host': [
        'Rebuilds the workspace itself (`gjsify run build` against the checkout under test)',
        'while other suites are exercising the CLI against the same tree — run concurrently, a',
        'sibling suite can observe a half-written build output. Runs serially after the parallel',
        'batch, and alone on its own CI shard so no other suite shares a container with it.',
    ].join(' '),
    'flatpak-sdk-extension': [
        'Drives real `flatpak-builder` against the machine-wide ostree cache',
        '(`~/.local/share/flatpak`), which has no per-suite isolation — a concurrent',
        'flatpak-builder invocation from another suite would corrupt the shared repo. Runs',
        'serially after the parallel batch, and alone on its own CI shard so no other suite',
        'shares a container with it.',
    ].join(' '),
};
