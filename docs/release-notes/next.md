<!--
THE PROSE PREAMBLE FOR THE NEXT RELEASE.

`scripts/check-changelog-references.mjs --release-notes <version>` publishes this
file ABOVE the generated changelog section in the GitHub release body. Write here
in the PR that lands the change, while you still remember why it mattered — the
generated section already says what changed.

  · Prose is OPTIONAL. No prose costs a warning in the cut's job summary and
    nothing else; the body is then the changelog section alone.
  · It counts only if git says this file changed since the last tag, so the
    previous release's text can never reappear under a new version. There is no
    version to write down and nothing to reset by hand: after a release this file
    is stale by definition, and the next prose is simply the next edit.
    So REPLACE what you find here, do not append to it — right after a release
    this file still holds the text that shipped with it, and the tag is where
    that copy lives (`git show v0.28.0:docs/release-notes/next.md`).
  · It goes through the same broken-reference detector as CHANGELOG.md, so a
    fabricated issue or repository link fails the cut. Write `#123` for a real
    issue in this repo; put anything `#`-shaped that is NOT a reference in
    backticks (`PKCS#7`), and the same for npm scopes and at-rules (`@girs`,
    `@font-face`) so they are not read as GitHub accounts.
  · No `## [x.y.z]` heading — the preamble sits above the section, not beside it.

Everything below the last comment is published verbatim. Delete this comment or
leave it; comments are stripped either way, and a file holding only comments
counts as no prose.

A worked example is the v0.28.0 release body:
https://github.com/gjsify/gjsify/releases/tag/v0.28.0
-->

## What this release is about

**The project's own documents had drifted away from the project.** Not by much in any single
place, and that is what made it expensive: a reader cannot tell a stale sentence from a current
one, so every wrong claim is load-bearing until someone measures it.

An audit of this repository found roughly twenty statements the tree measurably contradicts —
in the website, in `status/`, in `AGENTS.md` files, in source comments. This release corrects the
user-facing ones, and where a claim could regrow it is now derived instead of typed.

**If you install with `gjs -m install.mjs` on Debian, read the install hint again.** It used to
send you to Debian 13 for `gjs >= 1.86`; Debian 13 ships 1.82.3, which is the version the very
next line refuses.

---

### The install hint contradicted the check three lines above it

`install.mjs` rejects `gjs < 1.86` and then printed `Debian 13+: sudo apt install gjs`. Debian 13
is trixie, which ships **1.82.3** — the branch handed the reader the exact version it had just
refused. Verified against Debian's own package tracker: trixie 1.82.3, forky 1.88.1, sid 1.89.2;
1.84 and 1.86 were skipped entirely.

The repository already knew. `utils/ship/depends.ts` carries that measurement, dated, and
`gjsify ship` warns on it at package time. Two website pages repeated the wrong half. One fact,
one wording, everywhere now.

### `system-check` reported a Node.js that was not installed

The row was a literal — `{found: true, version: process.version}` — and `@gjsify/process` stubs
`process.version` to `"v20.0.0"` for npm compatibility. So under GJS, on a machine with no Node
at all, `gjsify system-check` printed:

```
✓  Node.js  (v20.0.0)
```

Under the **Node-free** toolchain, whose entire premise is that there is no Node. It now asks the
host and reports what is there, as an `optional` row — nothing that used to pass now fails,
because a constant could never have failed a gate.

### The platform matrix is generated, not pasted

The Platform Support page carried a hand-copied paste of `audit-runtimes --platforms --markdown`,
under a comment telling the next editor to paste it again. It had drifted to showing
`@gjsify/webgl` as **unsupported on win32-x64** — the one cell a Windows reader opens that page to
check, and wrong: declared, CI-targeted, artifact committed. It had also lost a whole package row.

The page now renders from data regenerated on every website build, and the mark rule moved into a
single exported function so the page and the CI audit answer "where does this run?" from one rule
rather than two. Both existing renderings are byte-identical.

### A struct field read returned success and nothing

`GstMapInfo.data` is a `guint8*` whose length lives in the sibling `size` field. `@gjsify/node-gi`
resolved no length for it and returned an EMPTY array — no error, no warning:

```
node-gi:  ok=true size=32 data.length=0
gjs:      ok=true size=32 data.length=32
```

An empty array is indistinguishable from a genuinely empty one, which is how this made audio
inaudible on Node for an entire investigation: every layer above reported success on nothing.
Fixed, with gjs as the oracle.

The note recording this defect had opened by calling the dependency one "GI cannot express for a
struct-field read". It can — the annotation is in the GIR, it survives into the typelib, and the
call-argument path had been resolving it all along. Only the field reader ignored it.

### Every landed commit gets a CI verdict

`concurrency.group` keyed on the branch put every push to `main` in one group, and GitHub keeps a
single *pending* run per group — so a newer run evicted a queued one regardless of
`cancel-in-progress`. A landed commit could therefore end up with **no run of its own**, showing
in the run list as `cancelled`, which reads as noise rather than as a gap.

Off a pull request the key is now per-run. Pull requests keep the branch-wide key, because there
superseding is the wanted behaviour.

---

**For contributors:** two rules earned their keep here and are worth restating. A ledger entry
that instructs the *docs* to keep saying something has no retirement trigger — one of those kept
three website pages wrong for months after the condition behind it went green. And a live count in
prose is restatement that drifts unseen; the fix is to delete the number and say what it
establishes.
