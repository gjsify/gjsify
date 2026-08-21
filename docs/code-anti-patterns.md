# Don't patch, and the measured anti-patterns

> Detail for the root [AGENTS.md](../AGENTS.md) § Don't patch / § Code anti-patterns.
> Every rule below was paid for in this repo — the incident IS the rule, which is why
> it lives written out here rather than compressed into a one-liner.

## Don't patch — implement at the source

We own ~every Web/Node/DOM API. First question for any new feature: *"which package owns this, can we implement it there?"* — never *"where can we monkey-patch it in?"*. Patching propagates uncertainty ("which code installed this?"); first-class methods are self-documenting.

**Hard rules:**

- **Reading globals:** prefer `import { X } from '@gjsify/<pkg>'` over `(globalThis as any).X` in impl code. Imports give bundlers tree-shaking visibility, TS real types, surface missing deps as build errors. `globalThis` reads only justified for: (1) writes in register modules; (2) existence probes in register modules (`if (typeof globalThis.X === 'undefined') { globalThis.X = X }`); (3) debug flags (`globalThis.__GJSIFY_DEBUG_X`); (4) GJS runtime bootstrap (`globalThis.imports.*` before `@girs/*` resolves); (5) genuinely soft deps (rare — fallback to `Error` if `DOMException` not registered); (6) `globals.mjs` Node adapter — re-exports native value (`export default globalThis.crypto`) so alias layer can redirect bare specifiers on Node. Only non-register file allowed to read `globalThis.X` without `as any`.
- **The legacy `imports.*` object is NOT an API — it is the GJS host, and the node target does not have it.** `gi://<Ns>` and the bare `system`/`gettext`/`cairo` built-ins resolve on BOTH gjs (externals) and node/bun/deno (aliased to `@gjsify/node-gi/*` and rewritten to `requireGi`); `imports.gi.X` / `imports.system.X` / `imports.byteArray.X` resolve on gjs ONLY, and off it they are a bare-identifier `ReferenceError` — thrown at the CALL, so the package tests green and the failure surfaces in a consumer. `@gjsify/node-gi/globals` seeds them, but it is injected only when a bundle is DETECTED to need them, so a package that reaches for `imports` is making its own correctness depend on a build-time prediction about somebody else's bundle. Three shipped bugs, all the same shape: `@gjsify/canvas2d-core`'s `_toDataURL` (`imports.gi.Gio` → `ReferenceError` at the first `toDataURL()` on node/bun/deno), `@gjsify/fetch`'s root-relative rewrite (`globalThis.imports.system.programPath` → probe `undefined` → every `fetch('/res/…')` died with `ERR_INVALID_URL`, while `@gjsify/xmlhttprequest` and `@gjsify/dom-elements` did the IDENTICAL rewrite through `import System from 'system'` and worked), and `@gjsify/crypto`'s `fillRandom` (bare `imports.gi.GLib` inside a `try`, so the `ReferenceError` was CAUGHT and silently degraded to `Math.random()`). Portable replacements exist for every one: `gi://Ns` · `import system from 'system'` · `GLib.Bytes.prototype.toArray()` (the GJS core override, mirrored by node-gi) instead of `imports.byteArray.fromGBytes` · `TextDecoder` instead of `imports.byteArray.toString`. Rule (2) above still allows the `globalThis.imports?.gi?.X` PROBE shape for a genuine runtime check — it is `undefined` off GJS instead of throwing, and the ambient-globals detector deliberately ignores it so it cannot drag the native addon into a cross-platform bundle. Never the bare form, and never a probe inside a `catch` that hides which runtime you are on. Enforced TWICE, at different layers: at the SOURCE by the `no-restricted-globals` lint rule (`.oxlintrc.json` — `imports`/`ARGV`/`print`/`printerr`/`logError` are errors across `packages/**`, with genuine GJS PROGRAM sources — examples/showcases/tests/node-gi/napi, where a bare ambient global is exactly the auto-globals-injection signal — scoped out by an override; the probe shape and an explicit in-file `declare` stay silent by construction), and at the ARTIFACT by `node-bundle-guard.ts` (§ Committed-artifact freshness), which still catches whatever reaches a `--app node` bundle by any other route. On its first run the lint rule found two more live members beyond the three shipped bugs (`@gjsify/webrtc`'s `isDeviceMonitorSafe` — a bare `imports.gi.GLib` inside a swallowing `catch`, the crypto shape again — and the `runAsync([imports.system.programInvocationName, ...ARGV])` line triplicated across `@gjsify/{adwaita-app,storybook,devtools-browser}`; portable spelling `[system.programArgs]`, which is what ARGV IS on gjs).
- **Patching classes you own:** method belongs to a monorepo class (`URL.createObjectURL`→`@gjsify/url`, `Headers.getSetCookie`→`@gjsify/fetch`) → put it on the class, NOT on `globalThis.X.method=…` in a register module. Patch only when target is genuinely external (native global we can't subclass, third-party type).
- **"No module to import from":** check again — workspace almost certainly has `@gjsify/dom-*`/`@gjsify/web-*`/`@gjsify/node-*` exporting the class. Add the dep. Legit exceptions: (a) pre-registration bootstrap; (b) values with no module form (GJS `imports`, Node's `process.argv` before `@gjsify/process` loads).
- **Pure-JS → native swap:** before replacing a pure-JS impl with a (partly) native one in any pkg, ask: *is the pure-JS path still load-bearing on browser / Node / NativeScript?* If yes — KEEP the pure-JS code, lift it into a `-core` (or `/core` subpath) package that the native pkg depends on as a fallback. Native goes in front for the runtime that has it; the core stays as the default for the others. Mirrors `@gjsify/canvas2d-core` ⇆ `@gjsify/canvas2d` (Cairo-backed). Never delete portable code just because one platform got faster; the others still need it. The `/core` SUBPATH is the DEFAULT choice over a new `-core` PACKAGE: a new published `@gjsify/*` name needs a tier, a runtime quadruplet and a MANUAL npm first-publish + Trusted Publisher bootstrap, and skipping it breaks the serialized release train for every package after it alphabetically (the `@gjsify/tls-native` v0.4.20 incident: 60+ packages stuck). Reach for a separate package only when there is a genuine package-level CYCLE to break or independent external consumers (`@gjsify/canvas2d-core`). Exemplar: `@gjsify/utils/core` (ADR 0014).

## Code anti-patterns — measured

Recurring shapes LLM-written code gets wrong (cf. GNOME reviewers' list, 2026-07). Every rule below has been paid for in THIS repo — the incident is the rule, and the linked mechanism is what keeps the class visible.

|**try/catch around a call that cannot throw.** Before wrapping, answer: *can this block throw at all?* For GI calls read the GIR — only `throws="1"` functions raise a GError→JS exception; a method that reports failure via a return code cannot throw, and "best-effort" is ignoring a return value, not wrapping a non-throwing call. A kept catch must STATE ITS REASON. Measured (#880, the `eslint/no-empty` sweep): the empty catch around the http2 teardown GOAWAY flush hid that the flush never wrote (the flag it was called after made it early-return — the peer only ever saw a bare FIN); try/catches around `GLib.Source.destroy` (no throw path) and around SessionBridge calls that report via return codes were deleted; the legitimate swallows (Gio close/shutdown on an already-dead peer, temp-cert cleanup, spec teardown) now say why. `eslint/no-empty` is `error` — a bare `catch {}` does not land. The worst variant swallows a `ReferenceError` from a missing binding into a silent wrong answer (see the `crypto` `Math.random()` incident above and § CJS-ESM rule 1).
|**paranoid probes for what the workspace guarantees.** Redundant `x?.m?.()` / `typeof x.m === 'function'` on our own classes or lockfile-pinned deps is written to span versions that don't coexist here, and it hides real bugs as silent no-calls. The SANCTIONED probes are the documented ones: register existence guards (§ Tree-shakeable globals rule 2), host-runtime detection (`isGjs()`/`isNode()` single source § Build; the `globalThis.imports?.gi` probe shape; NS `typeof java !== 'undefined'`), optional native-bridge loads (`imports.gi.GjsifyX` in try/catch — the typelib genuinely may be absent), `isNativeStreamUsable` before replacing a native stream. Each guards a REAL per-runtime/per-install variance and says so at the site. Everything else: import it and call it.
|**comments that restate the code.** Comment WHY, never WHAT — a restating comment is a second copy the reviewer must diff against the code, and their drift reads as documentation while being a bug. JSDoc for public APIs; trivial/internal code stays bare.
|**duplication instead of a helper.** The SECOND copy is where you lift a helper — copies drift, and the drifted copy fails in a CONSUMER while the owning package's tests stay green. Measured (#869): the root-relative-URL rewrite existed hand-written in three packages, and the drifted one (`fetch`) broke every root-relative fetch on node while its siblings worked; the entropy chain was two locally-defensible copies wrong in composition (webcrypto row). The literal line `app.runAsync([imports.system.programInvocationName, ...ARGV])` is currently triplicated across `storybook`/`devtools-browser`/`adwaita-app` — a consolidation target, not a pattern to extend. The lift targets exist and are the pattern: `@gjsify/utils/core`, `storybook-core`, `adwaita-app` are each "the helper the copies forced".
|**scattered lifecycle.** Init and teardown live together: cleanup beside creation, ownership in ONE place, wired to the exit the host actually HAS — and teardown must not assume the process lives long enough. Measured: the GStreamer pipeline registry (webaudio row) exists because per-call-site `set_state(NULL)` could not fix teardown spread over sites with process-lifetime assumptions; `decodeAudioDataSync` tears down in `finally` so a throw cannot leak a PLAYING pipeline. No `_destroyed`/`_enabled` boolean flags where nulling the reference says the same and cannot desync; release children BEFORE chaining up to the parent's destroy, never after.
|**shelling out where an API exists.** A spawned command line is an injection surface and a quoting-bug factory. Standing in-repo counter-example (fix at next touch, never copy): `@gjsify/fs`'s GJS `linkSync`/`link` run ``GLib.spawn_command_line_sync(`ln ${existing} ${new}`)`` — unquoted interpolation, so a path with a space or shell metachar breaks or injects (`packages/node/fs/src/{sync,callback}.ts`). When a subprocess IS the job, pass an argv array (`Gio.Subprocess`), never an interpolated command line.
|**monolithic entry points.** `index.ts` = barrel re-exports only; commands/views/features are modules composed by a thin entry. A class owning bootstrap AND business logic AND IO is three classes.
|**a side-effect import that has no side effect.** `cssAsStringPlugin` (every `--app browser` / `--app gjs` build) turns a CSS import into `export default "<css>"`, and a module whose entire body is a string literal has NO side effect — so a bare `import './x.css'`, or of a package whose `.` export IS css, is tree-shaken and the build exits 0 with the stylesheet nowhere in it. Measured on 0.41.0: a probe entry whose ONLY statement is `import '@gjsify/adwaita-fonts';` builds to a **0-byte bundle with zero `@font-face`**. `@gjsify/adwaita-web`'s entry carried exactly that line, with the comment "Registers @font-face (fontsource pattern)", for the package's whole life — so every gjsify-built browser app declared `font-family: 'Adwaita Sans'` and registered no face. Invisible because the workstation is a GNOME desktop with `adwaita-sans-fonts` installed system-wide (24 `fc-list` rows): every screenshot looked right, every computed `font-family` read back `'Adwaita Sans', …`, and both were true of a tree that shipped no font. Keeping the string alive is only half the repair — a recovered `src: url('./files/*.ttf')` resolves against the DOCUMENT, and a single-file `--app browser` bundle emits no such asset, so the rule parses and the face 404s; a `data:` URI is the form that survives both. Import the VALUE and apply it. Two mechanisms hold the class: `gjsify/no-css-side-effect-import` (oxlint, `error`) flags the import shape, and the `stylesheet-font-families` conformance rule flags the other end — a shipped stylesheet heading a stack with a family the tarball does not carry, unless `status/stylesheet-font-families.json` records why.
|**toolkit imports in shared code.** A shared/core module importing UI libraries is the layering bug `gjsify.headless` machine-checks (§ Runtime & platform model — the `canvas2d-core` `gi://Gdk` incident). Don't rely on discipline; declare the headless claim so CI holds it.

## A deferral marker that names nothing

`// TODO` with no reference is the one deferral shape in this repo that carried
neither a mandatory reason nor a retirement path. Everywhere else the pattern
holds and is machine-checked:

| Shape | Reason | Retires itself when |
|---|---|---|
| `it.failing(name, fn, reason)` | mandatory | the test starts passing |
| `unchecked-fields.mjs` | mandatory, printed every run | a conformance rule claims the field |
| `gjsify.platformsUncommitted` | mandatory, printed every run | the prebuild directory appears |
| `// fixed upstream in gjsify: …` | one line | the consumer bumps the version |
| `// TODO` | **none** | **never** |

Measured at v0.29.0, before the rule existed: 42 markers in source, 5 with a
reference and 37 without. Among them `// TODO: Fix this test`, a test documented
as broken that nothing would ever report; two `describe` blocks in
`error-handler.spec.ts` gated to `on([])`, which `runtimeMatch` can never satisfy
(`[].find(…)` is `undefined`), so they count as IGNORED forever; and four
commented-out assertions whose only trace was the marker above them.

**The rule.** A marker that OPENS a comment line must carry an anchor:

- `#123` — a GitHub issue or PR, for work needing discussion or somebody else
- a forge issue URL — an UPSTREAM defect. `error-handler.spec.ts` cites
  `gitlab.gnome.org/GNOME/gjs/-/issues/523`, which is better tracked than any
  local number; a rule that flagged it would teach people to delete the most
  useful reference in the file
- `open-todos` — an entry in `status/open-todos.md`, which the `status-data`
  conformance rule already validates on every PR and which rejects resolved-TODO
  corpses, so the ledger cannot rot
- `fixed upstream in …` — the temporary consumer-side shim note

Preferred over all four: fix it in the PR that exposed it (§ Governance,
`root-cause`). The anchor is for what genuinely outlives the PR.

**Enforced by** `gjsify/todo-needs-anchor` (`packages/infra/oxlint-plugin-gjsify/`),
at `error`. Two deliberate scope decisions, both measured rather than assumed:

- It reads the COMMENT STREAM (`sourceCode.getAllComments()`), not the source
  text, so a marker inside a string literal is not a finding. A text scan cannot
  tell the two apart — the same distinction `gjs-bundle-guard.ts` documents for
  `node:` specifiers.
- The marker must OPEN its line. Prose *about* markers is not a marker, and
  without this the rule cannot document itself: on the first run 5 of 31 findings
  were sentences discussing TODOs, three of them inside the rule's own source and
  one in the `status-data` rule that validates the ledger. The cost is a
  mid-sentence deferral going unseen; two existed (`dlx-cache.ts`,
  `fs/browser/stream.ts`) and were rewritten to open their line instead of
  loosening the rule.

Escape hatch is the ordinary `// oxlint-disable-next-line gjsify/todo-needs-anchor -- <why>`,
and `.oxlintrc.json` already fails on a disable directive that suppresses
nothing, so a stale exemption cannot sit quietly either.

## A repo-relative path spelled in the HOST separator

**Rule: a path that crosses a module boundary is forward-slash. Produce it with
`posixRelative()` / `toPosixPath()` from `@gjsify/manifest-conformance`, never
with a bare `relative()` and never with `replaceAll('\', '/')`.**

`path.relative()` and `path.join()` answer in `path.sep`, and essentially every
consumer in this tree assumes `/` — it splits the value on `/`, compiles it into
a regex, or compares it against an npm `workspaces` glob, which is forward-slash
by npm's own definition.

Two incidents, both measured, both WINDOWS-ONLY:

- `audit-runtimes.mjs`'s `classifyAxis` reads the first `/`-split segment to
  decide a package's axis. On Windows `relative()` returned `gjs\unit`, the
  split produced ONE segment, the pillar matched nothing, and five infra
  packages were reported as MISSING a `gjsify.runtimes` declaration they must
  not carry.
- `platforms-ci` compiles a package's path into a REGEX and matches it against
  `working-directory: packages/node-gi/node-gi` lines in the workflow YAML. On
  Windows it compiled `packages\node-gi\node-gi`, in which `\n` is a NEWLINE, so
  `@gjsify/node-gi`'s macOS leg — which identifies itself by path alone — was
  reported as a declared platform CI never builds.

`audit-runtimes --check` was therefore RED on win32 and GREEN on Linux for the
same commit. Nothing in CI could have caught either, because nothing in CI ran
on Windows; `windows-suites.yml` exists now, and this is one of the classes it
is there for.

**`split(sep).join('/')`, never `replaceAll('\', '/')`.** A backslash is a legal
character in a POSIX filename, so the blunt rewrite corrupts a path on Linux and
macOS instead of normalising it — it trades a Windows bug for a POSIX one. Five
sites in `scripts/` carried that spelling and now go through the helper.

The helper IS the mechanism; there is deliberately no separate check watching
for the raw call. A guard watching another mechanism is the smell the governance
rules name, and the cost of this one would be a grep over the tree that cannot
tell a display string (where the host separator is arguably right) from a value
about to be split.

## A filesystem path SPLIT on `'/'` alone

**Rule: ask `@gjsify/utils/core` where a path separates — `lastPathSeparatorIndex()`,
`splitPathComponents()`, `pathToFileUrlHref()` — or `node:path` where the HOST is
the authority. Never `path.lastIndexOf('/')`.**

The other direction of the section above. That one is about PRODUCING a path
another module will read; this one is about CONSUMING a path the host produced,
and it fails the same way for the same reason — `/` is the separator on POSIX and
one of TWO on win32.

What makes it silent is that `-1` is a legitimate answer. Every call site already
had a branch for "this path has no directory part", so a win32 path took the
no-separator path and the code carried on:

```ts
const slash = programPath.lastIndexOf('/');
if (slash <= 0) return url; // written for '' and for a bare name
return `file://${programPath.slice(0, slash)}${url}`;
```

That is `@gjsify/fetch`'s root-relative rewrite, under a comment asserting "the
program path is `/`-separated on every runtime this serves". On win32 the program
path is `C:\…\dist\main.js`, so every root-relative `fetch()` reached the
`Request` constructor unrewritten: `Invalid URL`, then SIGSEGV on bun and
`0xC0000005` on deno — measured on Windows 11, while node on the same host and
all four runtimes on Linux were green (#1143).

Four more copies were live at the same commit, none of them able to fail on Linux:

| package | what it sliced | consequence on win32 |
|---|---|---|
| `@gjsify/sqlite` | the database path | `DB_DIR` = `.`, `DB_NAME` keeping the drive letter — the file landed in the CWD under a fabricated name, and `existsSync(path)` was false for the path just opened |
| `@gjsify/fs` | a path, for per-component `NAME_MAX` | the whole path counted as ONE component, so no per-name limit was enforced |
| `@gjsify/cli` | a user-supplied template path | the basename was the entire path |
| `@gjsify/url` | `filepath[0] !== '/'` as the absoluteness test | every drive path was called relative and had the CWD prepended |

**Decide from the path's SHAPE, not from `process.platform`.** A drive-letter or
UNC prefix is positive evidence carried by the value itself, so the win32
behaviour is checkable from the Linux runner that CI actually has — the same
lesson as `check-spec-posix-literals.mjs`, one level up from constants to paths.
It is also why "contains a backslash" is NOT the test: a backslash is a legal
character in a POSIX filename (see the section above), so that reading corrupts
`/tmp/we\ird`. Where the host genuinely is the authority — CLI tooling operating
on the machine it runs on — `node:path` is the right owner instead, with the
caveat that it does not yet answer correctly under GJS (#1146).

**Why this class DOES get a check where the one above deliberately does not.**
The objection there still holds — a grep cannot tell a display string from a
value about to be split, and cannot tell a filesystem path from a `/`-separated
IDENTIFIER. This tree is full of the latter: D-Bus object paths, URL pathnames,
npm specifiers, git paths, all `/`-separated by their own specifications on every
OS. So `check-posix-path-slice.mjs` does not ban the shape; it demands a stated
reason per file in `scripts/posix-path-slice-exceptions.mjs`, saying which kind of
value it is. Seven entries, each printed on every run, and an entry whose file
stops slicing anything FAILS — so the ledger cannot outlive its cause. The
distinction the grep cannot make is made once, by a human, in a reviewable place.

## A dual-entry package reading its own manifest at a fixed depth

**Rule: `@gjsify/cli` learns its own version from `cliVersion()`
(`utils/publish-headers.ts`) and nowhere else. A
`new URL('../../package.json', import.meta.url)` read is wrong by construction
in this package — machine-checked by
[`scripts/check-cli-own-version-read.mjs`](../scripts/check-cli-own-version-read.mjs).**

The CLI ships TWO entries from one package: `npm install` runs the tsc output
under `lib/`, a globally installed `gjsify` runs the bundle at
`dist/cli.gjs.mjs`. A relative manifest read is depth-dependent, so one spelling
cannot be right for both — `../../package.json` resolves correctly from
`lib/commands/` and lands one directory ABOVE the package from `dist/`, where no
manifest exists.

It fails silently. The read sits in a `try`, so the miss is not an error; it is
the answer "no version".

Measured 2026-08-13, against published 0.38.0. `showcase` PINS the showcase
package to the CLI's own version, and a version it cannot read leaves the spec as
a bare package name — at which point `dlx` serves whatever it cached for that
name once. `gjsify showcase adwaita-storybook`, the first tab of the project's
own home page, ran a cached **0.37.0** bundle and died with
`ImportError: Unsupported URI scheme for importing: node`: that release's
`dist/gjs.js` was byte-identical to its `gjs.node.mjs`. 0.38.0 had already fixed
it. The banner told the whole story and nobody was reading it — `npx`/`bunx`
printed `[gjsify 0.38.0]`, the gjs entry printed no version at all.

**Why no CI leg saw it:** every runtime the test matrix exercises invokes the
`lib/` entry, where the fixed depth happens to be correct. The broken entry is
the one a user installs.

The resolver's own doc comment already said "deliberately NOT a fixed
`../../package.json` read", and a fourth copy grew beside it regardless. Prose
does not fail a PR; the check does.
