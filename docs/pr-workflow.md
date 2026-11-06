# PR workflow

## PR size — prefer few large ones

A full CI pass is ~25 minutes, and that cost is per PR, not per commit: **land one large feature PR rather than several small stacked ones**. The measurement (four stacked PRs → three main-merge rounds, two bundle rebuilds before anything landed) is in [`governance.md`](governance.md).

When a stack is unavoidable, make it a **native** one (`gh stack`), not hand-chained bases: GitHub then rebases the rest after each squash. Merge one via:

```bash
gh api -X PUT repos/<owner>/<repo>/pulls/<n>/merge-async
```

Do not pass `merge_method` — `gh pr merge` is refused.

## Drafts and batches

Open PRs as draft, push in batches, mark ready when done (`gh pr ready`). Heavy CI skips on drafts and runs on `ready_for_review` (see [`ci-selective.md`](ci-selective.md)). Lint, format and the three required checks still run on every push.

## Do not idle on CI

A green run gates **merging**, not writing the next commit — push, keep going, check back. Watch the **workflow** status, not the check list: a workflow that has not spawned its jobs contributes zero checks, so "no pending checks" reads as green before anything has started.
