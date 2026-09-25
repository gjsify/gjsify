---
order: 2
tier: high
---
**Make the gates prove what they claim.** A gate that passes without measuring anything is
   the most expensive defect class in this repository's history, and it keeps arriving in the
   same shape: a fixture reading state that an earlier step of the same job wrote. Adjacent and
   open on the same write path — `download-artifact` merges without pruning, so a stale artifact
   can publish silently; the `prebuild-artifacts` dlopen probe degrades to a note on the very
   runner that gates the push; nothing byte-compares a committed prebuild; bundle determinism is
   unmeasured; and 19 cmd.exe batch blocks in `windows-suites.yml` and `prebuilds.yml` are read
   by nothing, because no `cmd` has a parse-only mode — they are at least NAMED as unread now,
   which the 51 `pwsh` blocks this line used to nominate no longer are: `bash -n` was reading
   69 Windows-runner blocks with the wrong grammar and `check-workflow-run-syntax.mjs` resolves
   the effective shell instead.

   A second shape of the same class: a job that runs only AFTER the merge. It does not pass
   without measuring — it is simply absent from the PR, which reads identically.
   `pr-trigger-parity` holds every workflow's `pull_request` trigger to its `push`-to-`main`
   one, and `report-gate-history.mjs` now names, per job GitHub resolved to `skipped`, the SHA
   at which it last actually executed. What NEITHER can see is whether a filter's globs still
   cover the inputs the workflow guards (`deploy-docs.yml` is the open instance) — and the
   first thing the leg report found is a `napi.yml` Windows leg that has executed in none of
   the last seven completed `main` runs.
