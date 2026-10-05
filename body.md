chore: fix live count and verify oxfmt hidden-directory claim

- replaced `~120 button family elements` with `button family elements` in
  `status/open-todos/adwaita-web.md` — the number was a live count not
  re-derived when elements move; the claim (focus not delegated) stands without it
  (§ "no live counts", AGENTS.md).

- verified oxfmt 0.61.0 claim: oxfmt's walk sets `.hidden(false)` and the CLI adds
  no hidden-file filter, so hidden directories like `.worktrees` are walked.
  Confirmed by running `npx oxfmt --check` which included files in `.hiddendir/`.
  Comment in `native-skip-scan.ts` already cites oxfmt 0.61.0 / oxlint 1.72.0.

Verification:
- `node scripts/audit-runtimes.mjs --check` — status-data: OK
- `cd packages/infra/cli && node dist/test.node.mjs` — 2160 tests passed, 5323 assertions

Closes #2051