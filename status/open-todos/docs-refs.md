<!-- Authored Open-TODO sections — area: Docs and reference citations.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### What `check-doc-fences.mjs` cannot see on an Adwaita doc page

The fence gate now compiles every `blueprint` block, resolves every glyph identifier
and icon name, and refuses an `adw-` class no stylesheet declares — four arms, all
A/B-proven, and the slot rule proven in BOTH directions (a web-only glyph fails in a
`gjs` slot and passes in a `web` one). Three classes from the same audit sit outside
it, and the honest answer for each is different:

- **Whether a preview is INTERACTIVE.** `navigation.mdx` says "click **Open contact**
  to push the detail page"; the button carries no handler and `<gtk-button>` has no
  action attribute. It needs a browser to see, so no cheap static gate exists. The
  storybook wires it in JS (`navigation-view.web.ts:63-65`) and that line was dropped
  when the sample was written. The bottom sheet's "Toggle sheet" button had the same
  shape plus a `data-adw-toggle-open` attribute NOTHING in the repository read — one
  grep hit, the doc itself — and that one is gone: the preview markup is now the
  snippet, so a dead attribute would have been shipped to every reader who copied the
  tab, and it was deleted rather than documented.
- **Whether the remaining surfaces build the SAME widget set.** The `web` fence is
  gone — the preview's own markup is what the browser window shows, so preview and
  markup can no longer disagree, and `check-website-adwaita-gallery.mjs` arm 8 refuses
  a second copy unless it is ledgered (one is: `Adw.Toast`). What is left is the four
  remaining surfaces: markup, `@girs` TypeScript, Blueprint, NativeScript. A
  per-`<AdwWidget>` reader could compare the tag/class set each fence constructs and
  demand a ledger line for a difference — that catches the counts (the Preferences
  Group block builds three rows in its markup and its Blueprint, two in its TypeScript
  and its NativeScript) but not semantics: nothing static sees that
  `Adw.Clamp { maximumSize: 400 }` under a child with `widthRequest: 520` cannot
  demonstrate clamping, because the child's own minimum raises all three thresholds
  to 520.
- **Prose that inverts a shipped behaviour.** `layout.mdx` had the clamp's tightening
  region backwards; upstream tightens ABOVE the threshold. There is no gate for a
  sentence. What IS reachable is the subset the ELEMENTS already mark themselves:
  `MODIFICATION:`, `DEVIATION:` and `DELIBERATE DEPARTURE` appear in the sources, and
  requiring each to be named on the page documenting that widget would hold five or
  six of them — the same decision/gap ledger `check-storybook-widget-coverage.mjs`
  already runs, one level down from widget presence to widget behaviour.


### Website & docs follow-ups

Collected user-tracked items — every one turns existing engineering work into something visible / measurable for users.

- **Test + extend the new showcases, then embed them on the website.** Each showcase needs: (1) a manual smoke-test on GJS (`gjsify showcase <name>` end-to-end), (2) gaps turned into fixes or tracked follow-ups, (3) a `website/src/content/docs/showcases/<name>.mdx` page embedding the browser entry for live demo + describing the GJS counterpart.
- **Bridge widgets docs on website.** `@gjsify/canvas2d` / `@gjsify/webgl` / `@gjsify/iframe` / `@gjsify/video` are documented inline in AGENTS.md but there is no user-facing doc explaining the pairing matrix (DOM element ↔ Bridge class ↔ GTK widget) and the `installGlobals()`/`onReady()` lifecycle. Target one Astro page under `website/src/content/docs/framework/bridges.mdx` with a minimal worked example per bridge.
- **Web/Node compat as progress bars on the website.** The Summary table is consumed by `website/scripts/generate-coverage.mjs` → `src/data/coverage.ts`; extend the same treatment per package on the detail pages.
- **Ship `gjsify` and `ts-for-gir` themselves as Flathub CLI apps.** The `gjsify flatpak --cli-only` path already produces the right shape; take both CLIs through the full Flathub-submission flow (manifest in `flathub/<app-id>`, `flatpak-builder` validation, appstreamcli + `flatpak-builder-lint`, screenshots/release notes).


### Nearly every `refs/` line citation carries no `#anchor`, and `refs/gtk` is checked out nowhere

`scripts/check-refs-citations.mjs` now reads the LINE half of a coordinate (#1529): the
cited range must exist, be ordered and not be blank, and an `#anchor` — the text after
`#` in `refs/node/lib/internal/tls/wrap.js:1305-1306#getFinished` — must appear within
it. RANGE catches a citation that DRIFTED; ANCHOR is the only arm that catches one that
was wrong when it was written, which is the shape #1529 measured. The gate's own summary
line is the count of both, per run; nothing here restates it.

ANCHOR is opt-in per citation and a handful have opted in, so it is a live arm rather
than coverage. The gate fails when the TRACKED TREE holds no anchor at all, which cannot
be emptied silently.

**The incident that shaped that rule, because a rule without it gets simplified back.**
The first version counted anchors it had READ and reported the number as a property of
the tree, so `audit-runtimes.yml` — which checks out `refs/libadwaita` and nothing else,
~13 MB against ~150 GB for the pool — found both of the tree's anchors inside `refs/node`,
counted zero and failed with "no line citation in the tree carries an `#anchor`". The
tree had two. A gate that misreports its own reason is the class this whole round is
about, and it told the author to add a thing that was already there. The two facts are
separate now: anchors IN THE TREE is read from `git ls-files`, is the same answer in
every job, and staying at zero is fatal; anchors VERIFIED HERE depends on which
submodules are on disk and is a named line in the summary. What keeps the second from
quietly reaching zero on the job that gates `main` is not a rule but a fact:
`packages/web/adwaita-core/src/accent.ts` anchors a `refs/libadwaita` coordinate, and
that is the one submodule this workflow checks out.

Retrofitting the rest is not one change: they live mostly in `packages/web/adwaita-*`
and `tests/integration/`, and each needs a human to OPEN the cited lines and write down
what is actually there — which is the work, and the point. Doing it mechanically would
write an anchor derived from whatever the line currently says, which vouches for a wrong
address as readily as a right one.

Two coverage limits worth knowing before anyone starts:

- **`refs/gtk` is checked out by no job.** `audit-runtimes.yml` inits `refs/libadwaita`
  only. So the `refs/gtk` line citations — including the three `gtkmenutrackeritem.c`
  coordinates whose wrongness IS #1529, corrected in #1528 before the merge — are
  skipped in CI and can drift again unwatched. A shallow `refs/gtk` init would cover
  them; it is a real CI cost against a handful of citations, so it is a decision rather
  than an oversight.
- **The `c:332` shorthand is invisible.** `packages/web/adwaita-core/src/menu.ts` names
  the file once as `refs/gtk/gtk/gtkmenutrackeritem.c` and then cites lines as bare
  `c:332`, `:1049`, `gtkmenutrackeritem.c:822`. The reader only sees a line attached to
  a full `refs/` coordinate, so some of the most load-bearing citations in the tree are
  not in the gate's corpus at all. Teaching it the shorthand means tracking a "current
  file" through a comment block, which is a heuristic — the cheaper fix is to spell
  those coordinates in full when they are anchored.


### The doc fences that show no imports are unread, on purpose

`check-doc-fences.mjs`'s SNIPPETS arm (#1516) typechecks a documentation fence only when
it shows at least one `import … from`, on the reasoning that such a fence is claiming to
be a program a reader can run, while one that elides its imports is an excerpt. That
selector is what makes the arm zero-false-positive: measured on this tree, a rule that
flagged every called-but-unbound identifier in EVERY js/ts fence flagged a large minority
of them and essentially none was a defect (class methods, GJS ambient globals,
deliberately elided namespace imports in `patterns/`, compiler-output samples). How many
fences the arm reads and how many it passes over is printed by the gate on every run.

So the import-less fences are unread, on purpose, and a `ReferenceError` in one of
them would ship. Closing that needs the fences to declare their own completeness — a
meta on the fence, per #1516's option 1 — which is an authoring convention to agree
before it is a checker to write.

**The bigger unread class is the API-SHAPE one, and the per-page unit is what blocks it.**
A fence that writes `import { foo } from '@gjsify/x'` where the package exports no `foo`
is a worse user-facing bug than an unbound local — the reader is told to call something
that is not there — and it surfaces as TS2305/TS2339, neither of which this arm reads.
Attempted and NOT landed, with what was measured:

- The arm compiles one unit PER PAGE, which is what makes the TS2304 half correct (a guide
  legitimately builds one program across several fences). That same concatenation makes an
  exports check WRONG: two fences on one page importing `Adw` from `gi://Adw` and from
  `@gjsify/adwaita-nativescript` collide as `TS2300 Duplicate identifier`, and the cascade
  then reports `TS2305: Module '@gjsify/adwaita-nativescript' has no exported member 'Adw'`
  — which is FALSE, `src/index.ts:192` is `export * as Adw`. Every apparent finding in a
  first pass was that artifact. Per-fence isolation is the precondition, and it is exactly
  what the TS2304 half must not have.
- It also needs `lib/types` BUILT, which `tree-checks` does not do — the whole reason this
  arm reads TS2304 only and treats an unresolved module as none of its business.

So it wants a different job and a different unit, not a wider regex on this one.

**Where that leaves a `nativescript` fence, stated because those fences now carry more.** They
are NOT typechecked in the API-shape sense above — the arm reads TS2304 only, and the port's
`lib/types` are not built in this job. What holds them instead is `check-doc-fences.mjs`'s own
NativeScript arm, which reads the port's SOURCE with no build and refuses a property a widget
does not declare, through either door: `x.p = v` and `new Adw.Avatar({ p: v })`. The bag door
is the one that TELLS the reader — an unknown assignment sticks as a dead own-property at exit
0, an unknown bag key throws (ADR 0034 § Amendment 13) — and a getter with no setter is
refused on both, because a bag refuses it by name and a bare assignment throws in strict mode,
which every NativeScript bundle is. Both directions were A/B-proven on the real gallery.

What that arm cannot see is a MISSING import: it resolves `Adw.StatusPage` through the port's
own namespace barrels, never through the fence's import list. A fence that shows at least one
import is covered anyway — the SNIPPETS arm reports the unbound `Adw` as TS2304 — so what is
left uncovered is the import-LESS fence, which that arm passes over on purpose. Every
`nativescript` fence in the gallery shows its imports today, and nothing holds that.

One measurement discipline note, because the probe repeated the defect this PR is about:
the throwaway script written to measure the class reported `0 diagnostics` twice while tsc
had never run — first on `TS2688`, then on `TS5101 baseUrl is deprecated`. Only an
injected control (an import of a deliberately non-existent export) exposed it. The shipped
arm treats a file-less `error TS…` as fatal for this reason; anything written to measure it
next must do the same, and must carry a control.


### The doc-fence typecheck lends every GJS fence the DOM's globals

`check-doc-fences.mjs`'s SNIPPETS arm compiles each page with
`lib: ["ES2024", "DOM"]`, so `window`, `document`, `location`, `event`, `self`, `top`,
`parent`, `origin`, `name`, `status`, `close`, `open` and `focus` all count as BOUND in a
fence that imports `gi://` and will not have any of them at runtime. That is the #1516
class the arm exists to catch, masked.

MEASURED with the arm's own tsconfig shape: `confirmDialog(window, …)` reports nothing
under `["ES2024","DOM"]` and `error TS2304: Cannot find name 'window'` under `["ES2024"]`.
A live instance existed while the arm was being written —
`guides/native-adwaita-app.md`'s "Ask, notify, pick a file" fence passed a bare `window`
to four `@gjsify/adwaita-app` calls as the parent `Adw.ApplicationWindow` — and is fixed.

Dropping the DOM lib globally is NOT the repair, twice over: `console` is declared by
neither `lib.es2024` nor `@girs/gjs`'s ambient globals, so every GJS fence would flag it,
and the `adwaita-web`, canvas and iframe fences legitimately use `document`,
`MessageEvent`, `ResizeObserver` and `WebGLRenderingContext`. What it wants is a per-fence
lib choice — a fence importing `gi://` gets no DOM — plus an ambient declaration of the
globals GJS really has. The second half is a curated list, which is a drift source of its
own, so it needs deciding rather than writing.


### Two reference-doc gaps found in the #1516 audit

Both are from the issue and neither is a fence defect, so neither is closed by the
SNIPPETS arm:

- **No page answers "how do I test my app?"** `gjsify test` has a row in the CLI
  reference table and nothing else — no guide, no sidebar entry. For someone evaluating
  the framework it is a first-hour question.
- **`gjsify showcase` lists no `webrtc-video`**, while the sidebar carries
  `showcases/webrtc-video`. One of the two is wrong.


### Some small API gaps are declared only in a source comment

Also from `todo-needs-anchor`'s first run. None is a defect — each is a known
edge the implementation does not cover yet, written down at the call site and
tracked nowhere, so none of them can be prioritised against anything else.

| Site | Gap |
|---|---|
| `packages/gjs/utils/src/error.ts:37,38` | `Error.stackTraceLimit` / `Error.prepareStackTrace` unimplemented |
| `packages/gjs/utils/src/fs.ts:16` | path argument does not accept `Buffer` or `URL` |
| `packages/gjs/unit/src/index.ts:1076` | `on(runtime, version)` takes no wildcard (`16.x.x`) |
| `packages/gjs/unit/src/index.ts:1091` | no `Browser` runtime in the matcher, though `tests/browser/` exists |
| `packages/gjs/unit/src/index.ts:1418` | only part of `node:assert` is wrapped |
| `packages/node/fs/src/browser/stream.ts:225` | `FSWatcher` is a stub; the in-memory volume is single-process |
| `packages/node/querystring/src/error.ts:3` | node-error classes duplicated per package instead of shared |
| `packages/framework/webgl/…/uniform.ts:117,169` | `@girs/gwebgl-0.1` types reject `Uint32Array`/`Float32Array`, worked around by a cast |

The two `uniform.ts` casts and the `webtorrent-augment.d.ts` DefinitelyTyped note
are the only ones whose repair is in ANOTHER repo (ts-for-gir and
DefinitelyTyped); the rest are ordinary in-tree work.

**The heading no longer carries a count, and that is the fix rather than a
tidy-up.** #1014 implemented two of the original ten — `config.ts`'s log-level
merge and `dlx-cache.ts`'s `cleanupStalePrepareDirs`, the latter with five tests
— and rewrote this file in the same commit without pulling the rows it had just
invalidated. A reader was then sent to two file:line references pointing at
shipped, tested code. A count in a title is a second copy of the table's length
that nothing checks; the anchor in each source comment is matched by CONTAINMENT
(`scripts/generate-status.mjs`), so a number-free heading means closing the next
gap costs one row deletion and nothing else.


### Nothing checks a `file.c:NNN` citation, and nothing checks the `refs/` pointer

Three rounds of review on one PR produced FOUR wrong line numbers, each in a comment
whose whole job was to ground a decision in the C: `adw-toggle-group.c:1058` for a
filter that is at `:1059`, `:872` for a call at `:871`, `:1065` for a function whose
name is at `:1066` (corrected in one file and left standing in another in the same
PR), and `adw-widget-utils.c:399` for `focus_sort`, which is at `:388` — that last one
inside the single paragraph carrying the argument that the previous draft had the axis
backwards. A fifth claim named `adw-inline-view-switcher.c:294` as an inner layout
container; the line resolves, and it is a `GtkImage`.

`scripts/check-refs-citations.mjs` checks that a cited FILE exists. It cannot check a
line, which is why every one of these passed. The shape that would catch them is
narrow and mechanical: for each `<file>.c:NNN` in a comment that also names a
backticked C symbol, assert the symbol occurs within a small window of that line. The
window is the whole design question — a function is cited by its `static` line as
often as by its name line, and this repo does both deliberately (`:428` and `:298` in
one sentence) — so the reader has to accept a range rather than a point, and say which
it accepted when it fails.

**A second cause, found by bumping a pin (2026-08-28).** The four above are transcription errors —
someone wrote the wrong number. This one is not, and the pointer history is the finding:

| when | `refs/gtkx` pointer | `PREFIX_FOR` sits at |
|---|---|---|
| #1180, ADR 0024 written | `83ab4cee` (v1.1.0) | 35 |
| **#1304, 2026-08-25** | `2ce19757a` (upstream `main`, between v1.3.0 and v1.4.0) | **39** |
| #1396, 2026-08-28 | `9c8293db` (v1.5.0) | 41 |

So `ADR 0024`'s `stage.ts:35` was **correct when written and made wrong by #1304**, three days and
two merged PRs before anyone looked. The 2026-08-28 bump moved it 39 → 41; it did not break it, it
found it. #1304 also relabelled the pin in prose in two ADRs at once — 0024 kept saying v1.1.0 and
0032 started saying v1.4.0, while the actual pointer predated v1.4.0 by a day. Nobody wrote a wrong
number; a pointer moved under three correct sentences.

The cheap discriminator needs no window heuristic and no symbol parsing: **a commit that changes a
`refs/<pool>` pointer must re-check every line citation into THAT pool**, and a bump touches one
pool at a time. What stops it is not the script — `check-refs-citations.mjs` exists — but its
reach. It resolves a coordinate with `statSync` (`:259`), i.e. **it asks whether the FILE exists**,
so it was green on 35, green on 39 and green on 41. And it can only ask about pools that are on
disk: it reports its own coverage honestly — `773 coordinates across 53 submodules`, and on a tree
with no pools realized it prints `0 resolved in the 0 of 95 declared submodules checked out here,
762 skipped` and exits 0.

**Adding `refs/gtkx` to that gate's checkout step was written, measured (`2 resolved in the 1 of 95`,
up from 0) and REVERTED, and the reason it was reverted is the one worth keeping.** It was not the
network: `audit-runtimes.yml:435` and `:951` already check out `refs/libadwaita` in both jobs, so
github.com is inside those required checks either way — that was a wrong reason and is corrected
here rather than deleted, because it is the second time in this entry that a true conclusion rested
on a false premise. The sound reason stands alone: the defect is a LINE moving and the gate checks
a FILE, so widening the pool set buys coordinates the gate still cannot fail on. Line-level first;
pools after.

One thing the line-level check will hit immediately, said now so it is a requirement rather than a
surprise: **this entry cites `stage.ts` at line 35 on purpose, and that citation is deliberately
wrong.** `check-refs-citations.mjs` already knows the shape of this problem — `SELF` (`:89`) exists
because "a ledger entry that spells the coordinate it excuses becomes that coordinate's last
citer" — but `SELF` covers only the gate's own file. Today the harvest is harmless: `CITATION`
(`:108`) stops at the path and never takes the `:NNN`. The first version of a line-level check has
to either widen that exclusion or read this paragraph as its own first failing case.

The second half is smaller and equally invisible: the worktree's `refs/libadwaita`
sat FIVE commits ahead of the pointer recorded in `HEAD` during that review. Citations
are only meaningful against the pin, and checking it took a hand-run `md5sum` over
three files to establish that the drift happened to be harmless. `check-refs-pin.mjs`
does NOT cover it, checked: it dispatches to the `refs-pin` rule, which reads
`gjsify.refsLockstep` — declared by exactly two packages, `rolldown-native` and
`oxfmt-native`, both pinning Rust sources they compile. No package declares a
lockstep for `refs/libadwaita`, so the tree every Adwaita citation is measured
against is the one thing about them nothing holds.

Both halves are worth one script, because the cost is already paid: four of these
survived adversarial review by finding them one at a time, and the one that mattered
most was the last one found.


### A renamed element attribute is read for by nothing outside the website gallery

`check-website-attr-samples.mjs` arm 3 fails when a gallery PREVIEW writes an attribute
its element does not observe — the direction arm 2 is structurally blind to, and the one a
rename breaks. It reads the 39 preview fences and nothing else.

The consumers that actually broke when ADR 0046 renamed `options`/`items` to `model` were
not fences. Four were imperative and silent: `setAttribute('items', …)` on an
`<adw-combo-row>` in `packages/web/adwaita-storybook/src/controls.ts` and in three
`showcases/gtk/adwaita-storybook/src/browser/**` stories, each leaving an EMPTY combo row,
because an attribute is a string and no type reads it. Three more were property writes in
`showcases/dom/adwaita-storybook-nativescript/**`, which is excluded from the npm
workspaces on purpose — it carries NativeScript's own `typescript ~5.4` against the
repo-wide `^6.0.3` invariant — and is therefore type-checked by nothing at all. The eighth,
`packages/nativescript-bridge/storybook/src/controls.ts`, IS in a workspace, and types DID
catch it: `TS2339` on the win32 leg, which is what turned #1566 red.

A reader for the imperative shape is measurable. Over
`showcases/gtk/adwaita-storybook/src/browser` and `packages/web/adwaita-storybook/src`,
matching `<var>.setAttribute('<name>')` back to the nearest preceding
`const <var> = document.createElement('<tag>')`, plus `el('<tag>', { … })` keys, finds all
four with zero false positives once the platform-global names and the six elements that
observe NOTHING are excepted. It is NOT built here because the same scan over the whole
tree is 384 findings of which about ten are real: `packages/framework/gtk-host` JSX and the
`*.gtk.tsx` React Native widgets spell the same tags with a different vocabulary. So the
useful version is scoped by a hand-kept list of two directories, and a gate whose scope is
a hand-kept list goes blind the first time a fifth showcase is added — the failure mode
`coreListParsers` was just rewritten to avoid one file away. What closes it properly is a
tag → attribute type surface the imperative call sites can be checked against. The
`observedAttributes` half of that derivation is `scripts/adwaita-elements.mjs`, which arm 3 of
`check-website-attr-samples.mjs` still reads; the generator that once emitted it as website
data went with the attribute pane (ADR 0034 § Amendment 16), and it emitted names, not types,
so it was never the missing half anyway.


### An in-repo `path:line` citation is checked by nothing

`scripts/check-refs-citations.mjs` holds every `refs/<submodule>/<path>` cited as provenance
against the filesystem. A citation of a path **inside this repository** is covered by no gate at
all, and #1433 proved it costs something: moving `website/src/content/docs/adwaita/controls.mdx`
to `gtk/` left ADR 0034 § Context pointing at a file that no longer exists, plus two reproduction
commands whose glob had silently narrowed. Nothing failed; the ADR simply stopped being
re-runnable, which is the failure this repository cares about most.

Both were repaired by hand (the glob now names both directories and reproduces the same `36 Adw`
/ `4 Gtk`). The gate was NOT written, deliberately: it was found during a release window, and a
new check landing hours before a cut is the change nobody can price. The shape is already
available — `check-refs-citations` resolves with `statSync` and would extend to repo-relative
paths cheaply — and the harder half is the same one it already declines: it asks whether the FILE
exists, never whether the LINE says what the citation claims. A moved file is caught by the cheap
half; a moved line is not, and that is the case that bit `stage.ts:35` three times.

