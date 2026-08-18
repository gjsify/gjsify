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

**This release deletes things from your machine, and it is the first one that does.** `gjsify install`, `gjsify install -g`, `gjsify self-update` and the `install.mjs` bootstrap now end in a prune pass that permanently removes every installed package whose npm `os`/`cpu`/`libc` says this host cannot use it.

Four things to do before or right after upgrading:

- **Run `gjsify prune -g --dry-run` first.** It is the only preview of what the automatic pass will take. The removal is an `rmSync(recursive, force)` — no prompt, no trash, no undo; recovery is a reinstall.
- **If your gjsify came from a `.deb`, an `.rpm`, a Flatpak or `npm install -g`, `gjsify self-update` now exits 1** without writing anything, and names the command that owns your install instead.
- **If you write GJS programs, audit every line that sits after a `process.exit()` call** — that code no longer runs, which is the Node semantics it was always supposed to have.
- **If you scaffolded a project with `gjsify create` or `npm create @gjsify/app`, change its application id.** Every project ever scaffolded shipped the same one, and two of them cannot run side by side.

---

### `install` and `self-update` prune the prefix they write

The user-global prefix accumulated every install ever done (#1074): the installer filters candidates by platform, but nothing ever removed what an earlier install had already placed. Measured on the real prefix on this workstation — `du -sh ~/.local/share/gjsify/global` → **638M**, of which the `@rolldown` scope alone is **258M**. Replaying the planner's rule read-only against that same prefix:

```
scanned 409 package(s) / prunable 75 package(s)  420.5 MB (apparent)
```

Every `install`, `install -g`, `self-update` and `install.mjs` run now ends in that pass. It is silent when it removes nothing and prints exactly one line when it removes something:

```
gjsify: pruned 75 package(s) this host cannot use, freeing 420.5 MB (gjsify prune -g --dry-run to review)
```

It runs **before** `linkGlobalBins`, so a launcher cannot bake in a directory the pass is about to delete, and a failed removal is collected and reported rather than thrown — an install that succeeded is not turned into a failure. Pass `--no-prune` to keep a tree that deliberately holds foreign-platform packages (a cross-platform build cache, a tree assembled with `--force`); project installs under `--immutable` skip the pass automatically; `dlx`'s throwaway cache prefix is deliberately not hooked. Oracle: `tests/e2e/prune-prefix/run.mjs` asserts `/pruned 1 package\(s\)/` on the stdout of a plain `install -g`, and that the usable sibling is untouched (#1226).

### `gjsify prune` — the repair half

The automatic pass alone can never reach what a prefix already accreted: the release shipping it is installed *by* the previous CLI. So there is a command. `gjsify prune` cleans the project's `node_modules`, `-g`/`--global` cleans the user-global XDG prefix, `--dry-run` reports and touches nothing, `--verbose` lists every package instead of the first ten, and `--os`/`--cpu`/`--libc` decide as if the host were that target. The report, from a read-only replay against the real 638 MB prefix (rows elided for length — it prints ten before the trailer):

```
…/.local/share/gjsify/global · target linux-x64-glibc · scanned 409 package(s)
  @rolldown/binding-linux-ppc64-gnu@1.2.2   21.0 MB  requires {"os":["linux"],"cpu":["ppc64"],"libc":["glibc"]}
  @rolldown/binding-win32-x64-msvc@1.2.2    19.9 MB
  […eight further rows…]
  … and 65 more (--verbose to list them)
would free 420.5 MB across 75 package(s) (apparent size)
```

That this is accretion and not a live filter defect is provable from the versions on disk: the foreign `@rolldown/binding-*` directories sit at 1.2.2 beside a `rolldown` and a usable `binding-linux-x64-gnu` at 1.2.4.

The rule is a pure manifest read through the same `checkPlatform` the installer filters with, so a pruned prefix converges on what a fresh install would have placed. A package that declares **no** platform is never touched, however unusable it looks — `@rolldown/binding-wasm32-wasi` is the worked example, kept on purpose, because inferring platform from a package *name* is how a prune starts deleting what it cannot justify. Symlinked workspace sources are never pruned and never descended, an unreadable manifest makes a package un-prunable, only *dangling* `.bin` symlinks are cleaned up, and the command takes the same install lock every other writer of the prefix takes. Removing nothing is exit 0; it exits 1 only when a removal you asked for failed. Sizes are apparent, summed from the files, so `du` — which counts allocated blocks — will disagree slightly (#1226).

### An install never prunes against a target you typed

`--os`/`--cpu`/`--libc` are legal on `gjsify install -g`. Inherited by the automatic pass, `gjsify install -g foo --os=darwin` would have deleted every Linux package in the user's real shared prefix: the GJS engine set, the bundler bindings, the CLI's own. So the automatic pass reads the **measured** host and refuses outright when any of those overrides is present, and declines under `--immutable`. Typing `gjsify prune --os=darwin` stays legal, because asking is a request, not a side effect — that asymmetry is the whole difference between housekeeping and data loss.

`automaticPruneRefusal(env, immutable)` returns a reason string for any of `npm_config_os` / `npm_config_cpu` / `npm_config_libc`. Three spec rows pin it (an empty override string is not an override), plus an e2e case that asserts `doesNotMatch(r.stdout, /pruned \d+ package/)` and that the Linux package the host still needs survives. Cross-target installs are therefore safe by construction (#1226).

### `self-update` refuses where a package manager owns the install

`self-update` re-runs the `install -g` pipeline, which writes the user-global XDG prefix. That is right for an `install.mjs` install and wrong for one apt, dnf, flatpak or npm owns: it lays a second copy that shadows the tracked one, and the user's report is "I updated and nothing changed" (#1064 is the same lesson one layer down). It used to warn and continue. It now exits 1 without writing:

```
gjsify self-update: this gjsify is managed by something else — <evidence>.
Updating it from here would write <prefix> and leave you running two installs.

Update with: <command>
```

Five classes, checked in a load-bearing order: flatpak (`FLATPAK_ID`, or a tree under `/app/`) → `flatpak update <id>`; xdg-global (proceeds); system-package (`/usr/`, `/opt/`, `/snap/`, POSIX only) → your distribution's package manager or the newer package from the releases page; npm-global (**any** `node_modules` tree, including a project-local `node_modules/@gjsify/cli`) → `npm install -g @gjsify/cli@latest`; unknown (proceeds). It names no single package manager on purpose — one path serves apt and dnf both, and guessing sends the user to one that does not know the file. Ten tests, each a real layout, because a false "managed elsewhere" bricks self-update for the users it exists for and a false "xdg-global" writes over a package manager. The refusal deliberately does **not** fetch and install the `.deb` itself: that needs root and installs behind the package manager's back, which is the harm it exists to prevent (#1209).

### The release carries gjsify as a `.deb` and an `.rpm`

`gjsify ship` has produced Linux packages since #1193, but no package in the tree declared `gjsify.ship`, so the feature's only subjects were synthetic fixtures. `@gjsify/cli` now declares it — with `binaryName: 'gjsify'`, because the default strips the npm scope and would have produced a distro package literally called `cli` — and `release-cut.yml` attaches the artifacts. `gh release view v0.40.0` lists exactly three assets (`cli.gjs.mjs`, its `.sha256`, `install.mjs`), so this is the first release to carry packages.

```bash
sudo dnf install ./gjsify-0.41.0-1.noarch.rpm     # Fedora, RHEL, openSUSE
sudo apt install ./gjsify_0.41.0-1_all.deb        # Debian, Ubuntu
```

The package lands `gjsify` in `/usr/bin`, depends on the distribution's own `gjs` (nothing about gjsify has to be on the machine first), and `dnf remove` / `apt remove` takes it away. Built at 0.40.0 on Fedora 44 the two artifacts measured 6489730 and 6491756 bytes, read back by independent parsers (`rpm -qip` → Name gjsify, Version 0.40.0, License MIT; `rpm -K`; `ar t`). The workflow step is `ship --skip-build`, re-reading the same `dist/cli.gjs.mjs` the other assets carry, so no release can hold two different bundles.

**Caveat worth stating:** the derived floor is `Depends: gjs (>= 1.86)` and Debian trixie ships 1.82.3, so apt **refuses** the `.deb` on Debian 13 stable. It installs on forky, on sid, and on distributions with a newer GJS; on trixie use the `install.mjs` bootstrap. `ship` warns about that at package time rather than lowering the floor, because a lower floor buys an install that succeeds and an app that dies on a syntax error. And if you install from these packages, update with your package manager — `self-update` refuses there by design (#1209).

### `process.exit()` under GJS scheduled the exit and came back

Under GJS, `process.exit(code)` used to schedule `imports.system.exit()` on a `GLib.idle_add` source and return a forever-pending Promise cast to `never`. A Promise is not a `never`, so a synchronous caller carried straight on: `if (bad) process.exit(3)` ran every statement after it and only then died with the right code. A/B on gjs 1.88.1 with one probe — replaying the old implementation faithfully prints `BEFORE`, `AFTER  <-- ran anyway`, `AND SO DID THIS` and exits 3; against the shipped module it prints `BEFORE` and exits 3.

It now schedules the same idle source and then drives the default `GLib.MainContext` itself until the syscall fires, so the exit happens from inside a dispatch and the call never returns. Only the GJS branch changes — `@gjsify/process` declares `node: "native"`, so on Node the host's own `process.exit` was already terminal. The repo's `return process.exit(...)` idiom (96 call sites in `@gjsify/cli`'s source alone) stays correct but is no longer load-bearing; code that *depended* on execution continuing — cleanup, a final log line, a second build step — must move above the exit. One new failure mode is documented in the source: if the scheduled idle can never dispatch, the call blocks instead of continuing, which is the honest failure for a termination request and the reverse of the old one. `node --test tests/e2e/process-exit-terminates/run.mjs` → 5 tests, 5 pass, including a discriminator that must keep *failing* to terminate, and an assertion that `GLib.main_depth()` is measurably **not** a usable discriminator: 0 for a plain script where a direct exit works, 0 for the hanging shape, and 1 inside a dispatched callback where it works again, with the suite asserting both depths to pin that (#1221).

### Scaffolded GTK apps could not start — one application id for every project

Every project `gjsify create` / `npm create @gjsify/app` scaffolded shipped `org.gjsify.example`. A GApplication id is a session-bus name and the first claimant owns it, so starting a second scaffolded project while the first ran made GTK treat it as a **remote instance**: it forwarded `activate` to the other project's window and exited 0 — no window, no error. At v0.40.0, `git grep -l org.gjsify.example -- templates` returns the literal in the four GTK templates' `src/index.ts`.

Two more startup defects went with it. `npm create @gjsify/app 2048` failed outright, because a D-Bus name element may not begin with a digit and `Gtk.Application` refuses to construct with an invalid id. And the `cli` template had no `$0` default command, so `npm run dev` and `npm start` — the very scripts the scaffolder prints — exited 1 with "Pass --help to see available commands." on a project created seconds earlier. `applicationIdFor()` now derives the id: `2048` → `org.gjsify.app-2048`, `my-app` → `org.gjsify.my-app`, `hello.world` → `org.gjsify.hello-world`. The e2e went from asserting `node --check` on the build output to actually launching each template — 53 tests, 53 pass, 0 skipped, with no default in the launch table so an unlisted template is an error rather than a skip. **Projects created before 0.41.0 all carry the old id; re-scaffold, or change it by hand** (#1215).

### Three Adwaita templates failed outright under pnpm and Deno

`adw-canvas2d`, `adw-game` and `adw-webgl` build with `--globals auto,dom`, which injects `@gjsify/dom-elements/register/*` into the bundle — and none of the three declared that package. It resolved only where the package manager hoists a transitive copy to the project root: npm built fine, pnpm and Deno failed with `UnresolvedWorkspaceImportError`. Worse than the hard failure was the quiet one — under pnpm and Deno the gjs path exited 0 while shipping a **75 KB** bundle against npm's **220 KB**, silently missing the DOM surface it had asked for, because the gjs auto path skips an unresolvable register with a warning where the node path, routing through `resolveGlobalsInject` without `filterResolvableRegisterPaths`, fails hard.

All three now declare `"@gjsify/dom-elements": "workspace:^"` in devDependencies (the registers are bundled into the output, whose only external imports are `@gjsify/node-gi/*`). A static e2e case resolves every template's `--globals` list through the same maps the bundler uses, imported from `@gjsify/resolve-npm` rather than respelled. **If you scaffolded an `adw-*` template before 0.41.0 and install with pnpm or Deno, add the dependency or re-scaffold; if you used npm, rebuild and compare bundle size.**

In the same release scaffolding stopped assuming npm. `gjsify create` now asks for the runtime after the template — offering only what that template declares, defaulting to the runtime gjsify is itself running on — then for a package manager that runtime can actually use (`gjs → gjsify`, `node → npm|yarn|pnpm|gjsify`, `bun → bun`, `deno → deno`), and does not prompt where there is only one. The four GTK templates stopped being gjs-only; all seven templates now expose `build:gjs`, `build:node`, `start:node`, `start:bun` and `start:deno`. In a non-TTY you must now pass `--runtime` as well as `--template`, mirroring the existing rule that a non-interactive run may not be defaulted into a choice nobody made (#1228).

### `@gjsify/gtk-runtime-*` no longer declares MIT over GTK's binaries

The three prebuilt runtime packages declared `"license": "MIT"` while their published tarball carries 37–45 relocated LGPL/MPL/GPL libraries. MIT is the correct licence of the three source files in each package and the wrong answer for the artifact npm hands a user. `npm view @gjsify/gtk-runtime-darwin-arm64@0.40.0 license` → `MIT` today, same for `-darwin-x64` and `-win32-x64`. They now declare `SEE LICENSE IN gtk/THIRD-PARTY-NOTICES.md`; no binary, no file and no code changed, and everything a human reads was already right.

**If an SBOM generator, licence scanner or policy gate consumes these packages, re-run it** — a gate that accepts only SPDX identifiers may now flag the field as unresolved rather than silently pass. A new `bundled-license` rule in `@gjsify/manifest-conformance` keys on the *signal* (a package whose `files` ship a payload directory built from a third-party prefix) rather than on a package list: `node scripts/audit-runtimes.mjs --check` prints `bundled-license: 3 bundling package(s) — 3 defer to a shipped notice, 0 declare a compound expression` and exits 0. Deliberately not an SPDX expression — on darwin the attribution is exact, on win32 it is not recoverable, and a guessed expression makes a specific false claim instead of an unspecific one (#1208).

### A struct field read returned success and nothing

On `@gjsify/node-gi`, a struct field annotated `array length=<n>` — where the length lives in a sibling field, as `GstMapInfo.data` does in `size` — marshalled to an **empty** array with no error and no warning. On a 32-byte GstBuffer, before the fix:

```
node-gi:  ok=true size=32 data.length=0
gjs:      ok=true size=32 data.length=32
```

An empty array is indistinguishable from a genuinely empty buffer, which is how this made audio inaudible on Node for an entire investigation: every layer above reported success on nothing. `FieldArrayLength()` now resolves the annotation against the owning struct or union, with gjs as the oracle. `ElementsAreReadable()` restricts resolution to element types the C reader can actually walk — without that guard, resolving a length for an inline-record element turns the silent wrong answer into a SIGSEGV (`Pango.GlyphString.glyphs`, exit 139), so the crash case runs in a subprocess and asserts on exit status. Suite: 541 tests, 528 pass, 0 fail, 13 skipped. **If you worked around empty struct buffers through `gi://` on Node, Bun or Deno, remove the workaround** (#1204).

### Three more you may have hit

- **`gjsify ship` failed for every project bundling an `@gjsify/http` server.** `ship` derives `Depends:`/`Requires:` from the typelib namespaces a bundle reaches and fails on any it cannot map to a distro package — correct for a system library nobody declared, wrong for a typelib the payload itself carries. `@gjsify/http`'s server imports `gi://GjsifyHttpSoupBridge`, and no distribution has ever packaged `gir1.2-gjsifyhttpsoupbridge` or can: the file is inside the tarball being built. `deriveDepends('deb', {namespaces: ['GjsifyHttpSoupBridge-1.0','Gtk-4.0']})` now returns `['gjs >= 1.86', 'gir1.2-gtk-4.0', 'hicolor-icon-theme']`; the guard is anchored on `/^Gjsify[A-Z]/`, so a real system namespace merely starting with those letters still throws. Re-run `ship` if it failed on 0.40.0 (#1221, #1193).
- **A typo'd `BLUEPRINT_COMPILER` blamed your `.blp` file.** `@gjsify/vite-plugin-blueprint` returned the override unchecked, so a path that does not exist went to execa and its ENOENT surfaced through the branch whose whole premise is "the compiler exists and refused the file". A set-but-unusable override now resolves to null and gets its own sentence; a bare override name still goes through the PATH walk. The Linux install hint named only dnf and apt, though pacman, zypper and apk package it under the same name, and the message now says what the compiler is *for*. `BlueprintCompilerNotFoundError` and `BlueprintCompileError` are exported from the root so a vite-config author can `instanceof` them. The package had no test runner at all; the new suite runs 17 tests and 44 assertions, and was mutation-checked rather than merely run — forcing the PATH separator to `:` and letting a broken override fall through each turn it red. The second half of #1098 — porting blueprint-compiler rather than requiring it — stays open (#1224).
- **`gjsify build --app nativescript` could not build any bridge package.** A package declaring `runtimes.<target> = "native"` but shipping no `globals.mjs` was rewritten to `@gjsify/empty`, an export-less module, so the bundler hit MISSING_EXPORT and the build died — and every package under `packages/nativescript-bridge/` is in exactly that state. It went unnoticed because no CI job built any NativeScript code, while 44 packages declare a nativescript slot. The alias now warns once and leaves the specifier alone; a new e2e builds every bridge (five bridges, 6 tests, 6 pass) and asserts the bundle parses, leaks no `gi://` or `@girs/*` import, and that `@nativescript/core` **survives** rather than being tree-shaken away. What the leg does not prove — module evaluation on V8 — is written down rather than implied (#1214).

### `@gjsify/adwaita-web`: header bars, toolbar views and tab strips, against the C source

Five defects in the published widget package, each traced to the widget rather than the page showing it. `Adw.HeaderBar` puts its three sections in a `GtkCenterBox`, which centres its middle child in the **whole box**; the port was a flex row with `flex: 1` on the centre, so any bar whose two sides differ in width drew its title measurably off-centre — about 30px left of where native puts it. Now `1fr minmax(0, auto) 1fr`, matching `gtk_center_layout_distribute` with shrink-center-last false. Separately, `justify-self: center` on the centre item was replaced by stretching it into its track: at 260px with a back button and two end buttons that centre section had measured 277px starting 6.6px *outside* the bar, painting over all three buttons with the ellipsis never reached.

Toolbar view content did not fill its rect: measured on the docs Navigation Split View, a 293px sidebar pane holding a 176px `adw-sidebar` left 117px of window-coloured dead strip. The tab strip did not follow the selection and focusing a tab scrolled the **window** instead of the strip (`window.scrollY` 0 → 3335 on one ArrowRight, 0 → 7374 on one End); close buttons vanished on any tab view the host page had indented; and the scroll-edge shade was unconditional, drawing a permanent hairline under every flat header bar where GTK draws nothing until you scroll, with the overshoot glow missing entirely. **If you shipped a per-consumer workaround for a toolbar-view child not filling its pane, delete it** — the storybook's own `.sb-sidebar-scroll { flex: 1 1 auto }` is gone, because the widget rule exists now (#1228).

### The documentation site was rewritten, and fifteen links that left the site were fixed

Nine page groups rewritten, and the section a reader lands in changed name: Widgets is now **Adwaita**, under `/adwaita/`, with all nine old URLs redirected so no bookmark breaks (`astro.config.mjs` carries nine redirect entries under `/widgets`). `gjsify ship` had shipped in v0.40.0 with no page at all; there is now a Ship-your-app section leading with it.

Real broken things a reader would have hit: fifteen links left the site entirely, because `../../` on a page one level deep drops the `/gjsify` base and `./sibling/` self-nests under `trailingSlash: always`; `#known-identifiers` was a `<summary>` inside `<details>` and generated no id while three pages linked to it; one heading spelled three flatpak subcommands at once and broke the anchors both flatpak guides pointed at; a showcase table promised a browser demo for two showcases that have none; and the homepage scrolled 156px sideways at a 390px viewport. The dist link resolver now reports **0 broken targets across 3640 hrefs**.

The install guide is per-runtime rather than GJS-first, and the correctness fix inside that reorganisation matters most: the page had presented `gjsify self-update` as *the* update path for everyone. **If you installed the CLI via npm, Bun or Deno, use your package manager's own update command.** Deno users installing a second time need `-f` as well as `-n gjsify`; Bun blocks two transitive postinstalls and says so loudly, and the CLI works regardless, so the page says that rather than leaving people to guess. One claim is left open and explicitly not papered over: `platform-support.mdx` asserts Windows showcases run on Bun and Deno, which no CI leg proves (#1228).

### Three older corrections land with it

The `install.mjs` Debian hint no longer sends readers to a release shipping the version the very next line refuses — it rejected `gjs < 1.86` and then printed `Debian 13+: sudo apt install gjs`, and trixie ships 1.82.3 (#1203). `gjsify system-check` asks the host instead of reporting `@gjsify/process`'s stubbed `process.version` as an installed Node — under the Node-free toolchain, on a machine with no Node at all, it used to print `✓  Node.js  (v20.0.0)`; it is now an `optional` row that reports what is actually there. And every landed commit gets a CI verdict of its own: `concurrency.group` keyed on the branch put every push to `main` in one group, and GitHub keeps a single *pending* run per group, so a newer run evicted a queued one regardless of `cancel-in-progress` and a landed commit could end up with no run at all, showing as `cancelled` — which reads as noise rather than as a gap. Off a pull request the key is now per-run (#1205).

---

**For contributors:** two rules earned their keep. `windows-suites.yml` and `macos-suites.yml` ran on push to `main` and on a `pull_request` trigger path-filtered onto their own file — a filter satisfiable only by editing the filter. In the `on:` block they read as PR-covered; in a PR's check list they were simply *absent*, which is indistinguishable from a check that passed. #1209 changed the CLI's install classifier, showed "all checks passed" with no Windows suite among them, merged, and left the Windows leg red across eight further merges until #1217 corrected `classifyInstall` — which had accepted a `platform` argument and then read `resolve`, `isAbsolute` and `sep` from the host, making every POSIX-shaped case unanswerable on a Windows runner. Both triggers are now unfiltered, held by a new `pr-trigger-parity` conformance rule that needed no exception list because every other workflow already complied (#1218). And the documentation rewrite ran an adversarial second pass told to distrust the first, which caught the rewriters repeatedly shrinking GJS so the Node route would read as the wider one: "GJS exists on Linux only" is false — this project's own CI does `brew install gjs` and runs six curated `--app gjs` bundles on both darwin arches. Balancing two things by making the bigger one smaller reads as fairness and is a lie (#1228).

In the same spirit, 21 integration suites now run on an event rather than none, the gjs showcase column is launched in CI — which immediately found a real leak of three unhandled rejections in `webrtc-loopback` — and the committed prebuilds are checked on musl and swept for renamed debris that `files: ["prebuilds"]` had been publishing forever (#1220, #1213, #1219).
