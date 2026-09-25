<!-- Authored Open-TODO sections — area: Packaging (`gjsify ship`, Flatpak, AppImage).
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### Three of the four AppImage architectures have no pinned runtime

`.docker/ci-fedora.Dockerfile` pins `runtime-x86_64` from type2-runtime's dated `20251108`
release under a `sha256sum -c`, so an `x86_64` pack is offline and byte-reproducible
(ADR 0024 § A26.1). `aarch64`, `i686` and `armhf` have no pinned file, so a `--arch` pack for one
of them still asks appimagetool to fetch `runtime-<arch>` from the ROLLING `continuous` tag — the
pack needs a network and embeds ~940 KB that no checksum in this tree covers.

That is ANNOUNCED rather than silent (`appImageRuntimeNotice`, printed on every pack) and not
refused, because those packs do produce correct containers. What closes it is one `curl` + digest
each in the image, beside the `x86_64` one — cheap, and deliberately not done blind: the image is
`linux/amd64` only, so nothing here would run what those three produce, and a pinned runtime
nobody exercises is a digest guarding an untested path.

Do it together with the arch entry below, whose blocker is the same `platforms:` line.


### The AppImage row names four architectures and one of them is exercised

`APPIMAGE_ARCH` (`utils/ship/formats.ts`) maps `x64`, `arm64`, `ia32` and `arm` to `x86_64`,
`aarch64`, `i686` and `armhf`, and that is a PROMISE about a label a user downloads. Only
`x86_64` is behind a run: `.docker/ci-fedora.Dockerfile` bakes the `x86_64` appimagetool release
and `build-ci-image.yml` publishes `linux/amd64` only, so `tests/e2e/ship-appimage`'s real tier
can never see the other three.

The table is short on purpose — an arch it does not know is REFUSED rather than guessed — but
"refused rather than guessed" is not the same as "produced and run". PRODUCED is now measured, and
it is better than this entry first claimed: because appimagetool fetches its runtime per `$ARCH`
(see the entry above), `--arch` packs from ONE x86_64 host produced a correct-arch container for
all four labels — `file(1)` reports x86-64, AArch64, Intel i386 and ARM EABI5 respectively, from
`runtime-{x86_64,aarch64,i686,armhf}`. So `i686`/`armhf` are not "a runtime nobody has looked for";
they are runtimes nothing here has RUN. What stays unexercised is exactly that: no leg starts one
of the three, and the payload's own arch-dependence is a separate question from the container's.

What would close it: widening `build-ci-image.yml`'s `platforms:` (which three other jobs already
wait on — see *"runs on arm64, ghcr.io/gjsify/ci-fedora is built for amd64 only"* in
`check-ci-image-packages.mjs`), plus an `aarch64` appimagetool pin beside the `x86_64` one. Until
then, treat `aarch64` as declared-and-unproven and `ia32`/`armhf` as declared-and-unlikely.

### The payload is "the directory the entry lives in", and that ships a scratch tree

`discoverPayload` stages every file beside the resolved entry, minus the locale tree and minus
the entries other targets declared (#1545). Everything else in that directory is payload by
definition, and nobody declared it.

**Measured on the application #1545 was filed from**: `Contents/Resources/lib/` was the project's
`dist/` verbatim — the two bundles plus **20 PNG screenshots, a `sweep/` directory, four
debug-probe bundles and a `node_modules`**. The `.app` came to 12 007 054 bytes and most of it is
not the application. `--verbose` lists the files without commenting on them.

**Why this is not simply "add an ignore list".** The obvious exclusions are wrong in both
directions. `node_modules` beside the entry is REQUIRED for a `--app node` artifact —
`utils/ship/app-runtime.ts` stages `@gjsify/node-gi`'s JavaScript into exactly such a directory,
because the bundle keeps that package external and a `.app` has no consumer `node_modules` to
resolve it against. And a bundle's own shared chunks are indistinguishable from a project's stray
files by any rule this tree can write, which is why the foreign-entry exclusion is deliberately
limited to the DECLARED entries and nothing around them.

So the question is what a payload IS, and the honest answers are a declaration
(`gjsify.ship.include`/`exclude`, keyed like the two per-target tables) or a build that writes its
artifacts somewhere the project does not also use as scratch. Both are config surface, so both want
the ADR treatment rather than a filter someone adds in passing. Until then the fat is visible only
to a reader of `--verbose`, which is how it stayed unnoticed in the first place.


### `gjsify ship --sign`: three things M6 did not prove, each with what WAS measured

The signing interface landed whole (ADR 0024 § A12-§ A17) and its darwin half is
proven ad-hoc in CI with no certificate anywhere. Three gaps are left, and each is
here rather than in a comment because each has a plausible wrong answer:

1. **Windows is UNVERIFIED.** `signtool` has no ad-hoc mode, so the flag, the
   config default, the loud skip and every refusal are covered while the
   INVOCATION has never run. `SIGNERS.win32.args` is unit-tested and that is all
   it is: an argv nobody has executed. § A5 already records that Gatekeeper
   genuinely blocks while SmartScreen only WARNS until per-file-hash reputation
   accrues, signed or not — so the cost of the gap is smaller here than the
   darwin one would have been, which is why it is a gap and not a blocker.
   Closing it needs a certificate on a Windows runner and nothing else. No
   timestamp URL is passed either (`/tr` + `/td`), so an Authenticode signature
   made here expires with the certificate — the URL is a vendor choice and a
   network dependency, and neither has been decided.

2. **Notarisation has no end-to-end run**, for the reason § A17 makes M6 possible
   at all: it needs an Apple account, and ad-hoc signing does not.
   `--notarize <keychain-profile>` builds
   `xcrun notarytool submit --keychain-profile <p> --wait <artifact>`, the guard
   tests exactly the value that line reads (§ A15's rule, as a unit test), and
   the two refusals are e2e-covered. What has never happened is the submission.
   The App Store Connect API-key form is NOT implemented: measured on `refs/node`
   at the pinned `0618e9f0`, `--key-id`, `--issuer` and `store-credentials` return
   0 files each against a control of 16 files for `codesign`, so there is nothing
   to copy and § A15 says not to invent a spelling.

3. **Stapling is implemented and UNVERIFIED** (ADR 0040). `stapleArtifact` runs
   `xcrun stapler staple <artifact>` after a successful notarisation, on the
   formats `canCarryTicket` says can hold one. The question this entry used to
   leave open — whether `stapler` accepts our container — is answered by
   `stapler(1)` itself: *"stapler works only with UDIF disk images, signed
   \"flat\" installer packages, and certain code-signed executable bundles such as
   \".app\"."* So the `.dmg` is stapled and the `.zip` is not, and Apple's
   remedy for the zip is printed rather than a ticket claimed: *"you can't staple
   to it directly. Instead, run stapler against each item that you added to the
   archive."* Doing that FOR the author — staple the `.app`, then re-create the
   zip from it — needs `packOne` to order two format rows against each other, and
   nothing does today; whoever has a notarised artifact should measure the
   sequence before that ordering is invented.

**The `.app` IS sealed now, and the reason it was not was wrong** (ADR 0040). This
entry used to say a bundle seal "would not survive into the zip" because a script
main executable's signature lives in an extended attribute. That is Apple's rule
for a LOOSE file: TN3126 puts a *"bundle without a Mach-O image"* — which is what a
script-launcher `.app` is — in `Contents/_CodeSignature/`, as regular files a plain
zip carries, and TN2206 says *"a properly-signed app that has all of its files in
the correct places will not contain any signatures stored as extended
attributes."* What was actually blocking it was `signPayload`'s own file-set rule,
which now permits exactly the seal's directory. `--options runtime` and four
entitlements are passed too.

**MEASURED, on the ad-hoc leg, on the first push of ADR 0040** (run 33677262483,
`macos-26-arm64`): `codesign` accepted `--options runtime --entitlements` with
`--sign -`; the seal arrived as **four** files under `Contents/_CodeSignature/`
(`CodeRequirements-1` is in Apple's superset and not in this run's); the arrival
comparator read *11 identical, 2 signature-only, 5 declared-added, 0 problem(s)*;
and `codesign --verify --strict` passed on both images. **Then the count was fixed
and the leg went green on both arches** (run 33686518418, arm64 + x64, 21 of 21),
which is what finally executed the two assertions sitting behind the failing one:
`Contents/_CodeSignature/CodeResources` is in the packed `<App>.app`, and
`codesign --verify --strict` accepts the BUNDLE — Apple's reader answering what the
comparator cannot, the seal being valid over the tree it shipped with rather than
merely confined.

**One thing is still unrun that needs no credential**, which makes it the next
measurement rather than a gap to live with: **the ZIP round trip** — the claim this
whole correction rests on. The darwin leg signs `--target macos-app` only; nothing
signs `macos-app-zip`, unzips it and re-verifies. Until it does, "a plain zip
carries `_CodeSignature/`" is TN3126 plus mode-0644 reasoning, not a measurement.

Everything past those two — a Developer ID, `notarytool`, `xcrun stapler`,
`signtool` — is UNVERIFIED for the reasons the entries above give, and the ad-hoc
leg over TWO images (§ A21, not 106) remains the only thing that has ever run
`codesign` here.

**§ A16 is still open in both directions.** `disable-library-validation` is not
granted — § A4's re-sign of every image in the closure is the design of record, and
granting the entitlement would make that re-sign look optional — and nothing has
measured whether the entitlement route would work instead.


### ADR 0024 §8, second half: `gjsify flatpak <sub>` + `generate-installer` move under `ship`

The FORMAT half is DONE (stage 6): `gjsify ship --target flatpak` builds a bundle
out of the staged payload, its module is `buildsystem: simple` + `cp -a stage/.`,
meson is gone from the sandbox, and the six `gjsify.flatpak` BUILD keys have their
deprecation window into `gjsify.ship.flatpak`. **Do not redo any of that** — the
window, what is deliberately NOT in it, and the measured flatpak-builder facts are
`docs/ship-formats.md`.

What is left is the COMMAND rename, which turned out to be independent of the
format: `flatpak ci`, `deps`, `sources`, `diff`, `release` and `sync-flathub` are
Flathub-submission tooling with nothing to do with a staged payload, so moving
them buys consistency with the website's channel table and costs an alias.

Scope, as decided 2026-08-17:

- The nine subcommands under `packages/infra/cli/src/commands/flatpak/` (build,
  check, ci, deps, diff, init, release, scaffold, sources, sync-flathub) become
  `gjsify ship flatpak <sub>`.
- `gjsify generate-installer` becomes `gjsify ship installer`. The ADR does not
  cover it, and it is not a packer: it scaffolds an `install.mjs` INTO the
  consumer's repo, which they commit, rather than reading the staged payload. It
  moves anyway because it is one of the six distribution channels the website's
  "Pick your distribution channel" table lists, and the CLI should agree with that
  table. Same category as `flatpak init` / `flatpak scaffold`, which §8 also moves.
- `gjsify build --shebang` does NOT move. It is a build output mode, not a
  packaging channel, so the line is: `ship` owns the channels, `build` owns the
  bundle shapes.

One cost §8 names and this must still pay:

- `gjsify flatpak …` is in published releases and in the Flathub sync automation,
  so the old command path needs a warning ALIAS, not a removal.

Already done, so do not redo it: the AppStream and desktop-entry renderers moved
out of `commands/flatpak/scaffold.ts` into `utils/app-metadata.ts`, and
`ConfigDataFlatpak` extends a shared base (§8's "the metadata half is the app's,
not Flatpak's"); the runtime/SDK/finish-args resolution moved to
`utils/flatpak-runtime.ts` when `ship` became its second caller; and the
`gjsify.flatpak` config-key window exists. What that window does NOT cover, on
purpose, is the toolchain keys these very subcommands read — `lockfile`,
`ciContainer`, `ciBranches`, `flathubRepo`, `modules`, `extraModules`, `command`.
Deprecating them before their commands moved would warn on every invocation of a
command with nowhere else to read from, so they are this item's job, not the
format's.


### gjsify on Flatpak — remaining roadmap

The `org.freedesktop.Sdk.Extension.gjsify` SDK extension (toolchain under `/usr/lib/sdk/gjsify`, no network and no Node at app-build time, x86_64 + aarch64, `gjsify-tsc` included, e2e-gated incl. a real `flatpak-builder` tier) and the Node-free self-build (the committed GJS bundle rebuilds the CLI itself via native rolldown; e2e `tests/e2e/self-host`) have both landed. Open:

- **Flathub-grade offline-sources build** — vendor via `gjsify flatpak sources` instead of `../` file paths; only needed for an actual Flathub submission, which is itself gated on Flathub's Generative-AI policy (extensions/runtimes are in scope → discretionary "mature, well-maintained" exception; a gjsify-owned OSTree remote sidesteps it).
- **Remaining Node touchpoints for a FULLY Node-free self-build** — oxc lint (oxlint's JS-plugin host needs Node — see the oxlint entry above) + switching the build-orchestrator entry from the Node CLI to `gjs -m cli.gjs.mjs`.
- **`gjsify install --offline`** — a fail-fast-on-cache-miss flag so a no-network sandbox install errors clearly instead of attempting (and slowly failing) a network fetch. Complements `gjsify flatpak sources`.


### `gjsify ship` — remaining roadmap (ADR 0024, amended 2026-08-21)

Stages 2, 3 and 6 have landed: one staged payload, `.deb` and `.rpm` packed by hand-written writers (no `dpkg-deb`, no `rpmbuild`, no vendored `nfpm`), proven end to end by `tests/e2e/ship` against `rpm`, GNU `ar` and GNU `tar`; and `--target flatpak` packing a single-file bundle out of the same stage, proven by `tests/e2e/ship-flatpak` reading it back with `flatpak build-import-bundle` + `ostree ls -R`. Host-boundness is now a declared `HostRequirement` on the format descriptor — the field ADR 0024 § A3 asked for, written because Flatpak needed it first.

**The framing changed.** A format this Linux workstation cannot produce is not a format to defer — it is produced on the host that owns it, in CI, the way this repo already builds per-platform prebuilds (ADR 0024 § A1-A7). Host-boundness becomes a declared `HostRequirement` on the format descriptor, with the independent oracle as a REQUIRED field: `selfReading: true` is legal to declare and illegal to release.

**Four claims this section carried that are measured FALSE** — corrected here rather than deleted, because three separate design passes reasoned from them:

- ~~"Assembly is cross-platform … so a Linux host can build both."~~ True of the `.app` tree, false of the `.dmg`: no HFS+/APFS writer exists anywhere in this tree and `hdiutil` is macOS-only. The line falls between assembly and CONTAINER.
- ~~"No in-tree app declares `gjsify.ship` yet, so the rule is vacuous."~~ `packages/infra/cli/package.json` declares it (`{binaryName: "gjsify", bundle: "dist/cli.gjs.mjs", targets: ["deb","rpm"]}`) and `release-cut.yml:349` runs `ship --skip-build` against it on every cut. The same sentence is in `tests/e2e/ship-declaration/run.mjs`'s header and is wrong there too.
- ~~"an unsigned file that Gatekeeper or SmartScreen will refuse."~~ Gatekeeper blocks; SmartScreen only WARNS until per-file-hash download reputation accrues, signed or not.
- The two certificates are not one open question. **Apple is the binding constraint**: Developer ID has no OIDC route, so stage 4 introduces this repo's first long-lived signing secret. (And the "no long-lived credential today" baseline is itself false — `PREBUILDS_DEPLOY_KEY` is a repo-write SSH key on the ruleset bypass list.)

**Measured, so nobody re-runs it** (2026-08-21, from Linux, `manifest-conformance/lib/binary.mjs`'s `readLibrary()` over the published `@gjsify/gtk-runtime-darwin-arm64@0.41.0` + `@gjsify/node-gi@0.41.0` tarballs): **106 of 106** Mach-O images already carry `LC_CODE_SIGNATURE`; **0** non-system dependencies unresolved inside the closure; **2** images carry an absolute rpath (`/opt/homebrew/lib`), which `checkPrebuildDir` already rules a working fallback. Consequence: a stage digest set cannot survive a Developer-ID re-sign, so arrival must be checked with a Mach-O-aware comparator (identical outside `LC_CODE_SIGNATURE`/`LC_UUID`), not with `sha256`.

Open, in order — each independently mergeable, each with its proof:

1. ~~**`fail_on_unmatched_files` on the release upload.**~~ **DONE (#1252).** `release-cut.yml` globbed the `.deb`/`.rpm` onto the release with the flag absent, so a glob matching nothing uploaded nothing and left the cut green — while the gate that follows checked only `install.mjs` and `cli.gjs.mjs`, and `gjsify self-update` sends system-prefix installs to exactly those assets. Landed: the flag, an install-URL gate that COUNTS what `ship` wrote (the names carry the version and the arch label, so they are read off disk), and `scripts/check-workflow-release-globs.mjs`, wired into both `audit-runtimes` jobs because `release-cut.yml` never runs on a pull request. Correcting a number this list carried: `if-no-files-found: error` appears **33** times, not 37 — the 37 was inherited from a draft and never remeasured.
2. ~~**`kind: 'app'` was dead under the shipped GJS bin, and the cause was TWO gates deep.**~~ **DONE (#1257).** one of its six sites was already fixed at the call site by #1251, which moved that template into source. What the first reading of this entry got right: `rewrite-node-modules-paths.ts`'s `shouldRewrite()` returns false unless the path contains `node_modules`, and it guards the only production call site of `inlineStaticReads`, so the CLI never offered its own reads to the inliner. What it MISSED, and what makes opening that gate insufficient on its own: the inliner parsed with acorn, **which cannot read TypeScript**, and its `catch` returns `inlined: 0` — a value indistinguishable from "this file has no static reads". An installed package ships JS, so the scope kept the parser limitation invisible; measured, the same expression returned 1 as `.js` and 0 as `.ts`. Also worth keeping: the obvious repair is a trap. Rolldown's own oxc parser links npm `rolldown` into a module that must load under GJS, and the CLI bundle then died at startup with `createRequire: Cannot require builtin module "fs" synchronously in GJS`. Fixed with `acorn-typescript`, which is pure JS. **Correcting the reason this list gave for that trap, because the wrong reason makes it look unfixable:** npm `rolldown` does not fail under GJS because it is "a napi crate that cannot run under GJS". It fails one layer higher, in JS: `rolldown/dist/shared/binding-*.mjs` evaluates `createRequire(import.meta.url)` at module scope and its platform-detection preamble calls `__require('node:fs')` / `__require('node:child_process')` — the error quoted above is that require, and no `.node` is ever opened. So the blocker is a module-loading strategy, not an ABI. The published 0.41.0 still ENOENTs on `generate-installer`, `flatpak scaffold` and the two oxc config templates until 0.42.0 ships.
3. ~~**Pack from a stage alone** (`--from-stage` + `.gjsify-ship-stage.json`).~~ **DONE (#1268).** The sidecar is a closure — `{settings (arch resolved at stage time), staged, overlay, namespaces, mtime}` — not a settings dump: measured, dropping `staged` packs the launcher 0644, dropping the overlay omits the Debian-Policy copyright file, dropping `namespaces` loses `gir1.2-gtk-4.0` and `gir1.2-adw-1` from `Depends`, all silently at exit 0. `readStage` must fail on a staged path the plan does not name AND on a planned path the stage lacks (its `?? 0o644` fallback inherits the open `download-artifact` MERGE hazard). Never `writeStage` onto an arriving stage — it opens with `rmSync(root, {recursive: true})`. *The proof, and the deletion IS the discriminator:* `tests/e2e/ship-from-stage` stages into a tmpdir, **deletes the project tree**, packs from the stage and asserts byte-equality with the single-host artifact.
4. ~~**`ship-pack-linux` on a bare `ubuntu-latest`** (no container), downloading a stage and packing deb+rpm.~~ **DONE (#1268)** — `main.yml:1914`, with the `FORMAT_IDS` binding included — it was folded in rather than opened as a third PR once the CI queue, not review capacity, turned out to be the scarce resource. It is the first real `dpkg --install` this project has ever run — `--force-depends` and deliberately NOT `--dry-run`, per `.github/ship-oracle/verify-deb.sh:239`: *"the run worth having is the one that lays bytes down"* — followed by `dpkg --verify` against the package's own md5sums and `dpkg --purge`. Plus `lintian` as a third reader and `rpm` via `docker run --rm fedora:44`, on a free runner. It closed the `dpkg` gap below and exercises the whole cross-host handoff with formats that already exist, before any darwin runner is involved. The vocabulary turned out to have SIX copies, not two: `FormatId`, `FORMATS`, `FORMAT_IDS`, two `extraDepends` reads, the packer dispatch, two ternaries in `depends.ts`, `manifest-conformance`'s `TARGETS`, and a `--target deb,rpm` in `main.yml`. Seven are now compiler-bound or derived, `TARGETS` is bound by `scripts/check-ship-format-vocabulary.mjs` (an import would break the rule's `portable` scope), and the workflow flag is gone. The two `depends.ts` ternaries were the ones that mattered: a third format silently took rpm's package name into a Debian `Depends:`, at exit 0.
5. **What the non-Linux layouts do with the files only a Linux install step makes correct** — the residue of stages 4/5, and READ THE FIRST SENTENCE BEFORE PLANNING ANY OF IT: every container those stages promised has SHIPPED. `FORMATS` carries `macos-app`, `macos-app-zip`, `macos-app-dmg`, `windows-dir`, `windows-dir-zip` and `msi` beside `deb`/`rpm`/`flatpak`, each behind its own suite (`tests/e2e/ship-macos`, `ship-msi`, `ship-windows`, `ship-signing`), and `website/src/content/docs/ship/` documents them for users. Signing (M6) is DONE. What is genuinely LEFT is (a)'s tail and (b) below — the mime, icon and desktop-entry halves of the install-dependent set, and the loose `.typelib` under `Contents/Frameworks`. Everything else in this entry is kept because three design passes reasoned from it, not because it is open. **The LAYOUT half is DONE (#1354 M1):** `gjsify ship <linux|darwin|windows>` is § A2's positional, `utils/ship/layout.ts` holds the three rows plus the map from the (still single) prefix-relative plan, the launcher has three forms, `STAGE_LAYOUT_OS` is gone and the manifest's `target.os` is the layout's. Proven by `tests/e2e/ship-layout`, which stages one project three ways and asserts set + bytes modulo a map written out in the suite, and reads every staged Mach-O back from Linux with `manifest-conformance`'s `readLibrary()`. **Do not redo any of that.** What is left is the CONTAINER per layout — `Info.plist`, the zip, the `.dmg`, the `.msi` — and each is a `FORMATS` row with `layoutOs` set, not a second staging path. Three decisions the container forces and M1 deliberately did NOT make, each already named in code so it cannot be missed: (a) **what the Linux-install-dependent files become.** Both new trees carry `share/glib-2.0/schemas/*.gschema.xml`, `share/mime/packages/*.xml` and `share/icons/hicolor/**`, correct on Linux only because a `.deb`/`.rpm` scriptlet compiles or reindexes them at install (`utils/ship/scripts.ts`), plus a `.desktop` entry and an AppStream component neither OS reads. An uncompiled schema makes GSettings abort at runtime. `linuxInstallDependent()` in `utils/ship/payload.ts` is the list — EXHAUSTIVE over `share/` rather than an allow-list, keyed on the shared `SHARE` constant in `utils/ship/share-dirs.ts` that `plan.ts`, `readPayloadFacts` and `cacheRefreshCommands` also import, and split by `ShareVerdict` so the schema entry (which makes `g_settings_new()` ABORT, because every launcher points XDG_DATA_DIRS at the staged `share/`) is printed first and marked rather than ranked with four that merely do nothing. The e2e calls the function instead of re-deriving a regex. All three of those replace a comment that CLAIMED the rules could not drift and was measured false: five independent string literals, and pointing one rule at nothing dropped a file from the warning at exit 0, suite green. The file-set equality is structurally blind to the whole class, because sameness IS the defect. ~~Candidate answers: a compiled `gschemas.compiled` inside the bundle, `Info.plist` `CFBundleDocumentTypes`, a Windows registry association, or simply dropped.~~ **ANSWERED for the schema half (#1354 M2a):** `utils/ship/schemas.ts` compiles the cache into every non-Linux stage at ASSEMBLY time, with `--strict` (measured: without it a malformed schema is skipped at exit 0 and a cache is written without it, so the stage looks compiled and the app still aborts on the schema that was dropped). Linux still gets none, because there the postinst compiles the SYSTEM directory where our schemas merge with every other package's. `SHARE_VERDICTS`'s schema row became a FUNCTION of the payload so the warning stops saying ABORTS without the rule becoming unreachable — take the cache back out and it says ABORTS again, which `tests/e2e/ship-layout` asserts in both directions. The mime, icon and desktop-entry halves are still open and still `inert`. (b) **a loose `.typelib` in `Contents/Frameworks`** is the classic codesign/notarization complaint — that directory is expected to hold code — so stage 4 may have to move it or wrap it; flagged, not measured. (c) **the interpreter.** ~~Every staged launcher execs `gjs -m` today~~ — the launcher execs whatever `gjsify.app` names, which for the audience this command has today is `gjs`; that is truthful about the payload and is not what § 4 derives; `Layout.shippedRuntime` + `Layout.runtimeGap` carry the derived answer and the reason it is unmet, and item 6 below is what closes it. Open question 3 (`DEFAULT_FORMAT_IDS` versus the positional) is answered with BOTH: the positional picks the layout, `defaultFormatIds(os)` filters on `layoutOs` AND `finishOn`, so a bare `gjsify ship` on Linux still emits exactly `deb` + `rpm`. ~~(d) **the arch label is unchecked for a PE payload.**~~ **CLOSED (#1354 M3):** `readBinaryArch` reads the COFF machine now — `e_lfanew` at 0x3C, then `Machine` four bytes past the `PE\0\0` signature — so `assertPayloadMatchesArch` fires on the one layout whose native format IS PE, and `tests/e2e/ship-windows` drives it red (an arm64 closure reached through `GJSIFY_GTK_RUNTIME` under an x64 label) and green. The windows e2e leg no longer reuses a Mach-O: `tests/e2e/pe.mjs` is the synthetic PE writer, sibling to `macho.mjs`. **The console-window gap is CLOSED by ADR 0040 and still cannot be observed by CI** — see the paragraph below the M3 entry.
6. ~~**Bundled Node for `--app node`** — still undecided between a ship-time fetch and a platform package (ADR 0017's shape). Stages 4/5 need it: an unsigned artifact is a legitimate output, an artifact with no interpreter is not.~~ **DONE for macOS (#1354 M2b) and Windows (#1354 M3)** — `@gjsify/node-runtime-<target>` is the platform package, `utils/ship/app-runtime.ts` stages it into `Contents/MacOS/node` or beside the program directory's `.cmd` as `node.exe` (the leaf comes from `nodeRuntimeBinaryName(target)`, the same function that named the SOURCE, so the two cannot drift), with Node's LICENSE, and the launcher execs `"$here/node"` / `"%HERE%node.exe"`. ⚠️ **None of the three `@gjsify/node-runtime-*` packages is published yet** — all 404 on npm at 0.44.0 — so both assemble legs populate one with `packages/node-runtime/scripts/fetch-node-runtime.mjs`, which verifies the release's own SHA-256. `@gjsify/gtk-runtime-win32-x64` IS published (0.44.0). The original entry, kept because its diagnosis is what the staging was built against: **it was the live blocker rather than a later one (#1354 M2b):** the `.app` exists and is a real bundle, and the only thing between it and "a stranger double-clicks it" is that nothing stages an interpreter or a GTK closure into it. `resolveNodeRuntime` still has no caller outside its own spec, and `plan.ts` flattens `bundledTypelibs` with `basename()` — pointed at a `gtk-runtime-darwin-*` tree it would destroy `lib/gdk-pixbuf-2.0/2.10.0/loaders/`, `girepository-1.0/`, `etc/fonts/` and every relative relation `build-gtk-runtime-darwin.mjs`'s `@loader_path/../../..` install names depend on. So M2b is a TREE-PRESERVING staging path plus the launcher's runtime locators, and it carries a core fix in `node-gi`: an app with its own typelib+dylib in `Contents/Frameworks` gets `GI_TYPELIB_PATH` from the launcher and has no way to make GI find the backing dylib, because `activateGiLibraryPath` only ever prepends the GTK bundle's `libDir`. On Linux `LD_LIBRARY_PATH` covers it; on macOS nothing does, and a launcher-set `DYLD_FALLBACK_LIBRARY_PATH` stops working the day the bundle is signed.
7. ~~**`dpkg` is on no CI runner this project uses**, so the `.deb` is never verified by a real `dpkg -i`.~~ **DONE (#1268)** — `ship-pack-linux` runs on a bare `ubuntu-latest`, and the tool question is settled in two steps rather than one assumption. `main.yml:1962` PRINTS which of `dpkg dpkg-deb apt-cache apt-get lintian docker gjs` are present and does not fail on an absent one; the step below then installs `lintian` and `gjs` outright, so absence becomes a download rather than a skipped check. What actually GATES is `.github/ship-oracle/verify-deb.sh:58`, whose `require` list fails the run if any of them is missing at use time. The Fedora-side readers are unchanged: GNU `ar` and GNU `tar` as independent readers of the container and of both inner tars, every `md5sums` digest recomputed, and the data member unpacked and compared byte-for-byte against the staged tree. **What is still open is the other half of this entry, and it is undeclared rather than unverified:** `tests/e2e/ship` makes `ar` required on Linux, but `binutils` appears nowhere in `.docker/ci-fedora.Dockerfile` — it is present only transitively via `gcc`. The failure would be LOUD, not silent: `fixture.mjs`'s `probe()` throws a named error for a missing `ar` on Linux rather than skipping, exactly so the suite cannot go green having read nothing. What is missing is the DECLARATION, so a base-image change that drops the compiler reds the deb oracle for a reason nobody wrote down.
8. ~~**Two docs sentences become false** with host-bound formats.~~ **HALF DONE.** The "run anywhere" claim in `website/src/content/docs/ship/index.mdx` was made false by `--target flatpak` in the same PR and is replaced there: the page now states per format where it can be packed and what reads it back, and `docs/ship-formats.md` carries the model. Still open: *"no packaging file to keep in your repo"*, which only `gjsify ship ci` makes false — it scaffolds a workflow the consumer commits.
**What #1354 M2a landed, and what it deliberately left.** `gjsify ship darwin` now emits two artifacts: the `<App>.app` itself (`macos-app`, a DIRECTORY artifact — the first in `FORMATS`, which is why `FormatDescriptor.artifactKind` exists: `statSync` on a directory answers 4096 and a 20 MiB bundle would be reported as "4096 bytes") and a deterministic zip around it (`macos-app-zip`, written in-tree by `utils/ship/zip.ts`, `requiredTools: []`, STORE-only, mtime from the stage manifest and never `Date.now()`). `Contents/Info.plist` carries eleven keys, each cited to a file in `refs/node`; `Contents/PkgInfo` is eight bytes and no terminator. Both readers are independent and both are watched RED: `.github/ship-oracle/verify-app-plist.py` (CPython `plistlib` — NOT `plistutil`, which accepts a `<dict>` whose `<key>` has no value and prints `<dict/>` at exit 0, and NOT `xmllint --valid`, which exits 4 on a correct plist) and `.github/ship-oracle/verify-app-zip.sh` (`zipinfo -l` — NOT `unzip -Z1`, which prints names only and cannot see the one failure this format has). `tests/e2e/ship-macos` drives both, green and red, on every PR; unlike the deb/rpm readers they are not yet wired into a `main.yml` pack leg, because there is no darwin pack job to wire them into and the e2e already runs them on the CI image, which bakes `python3` and `unzip`. Three things NOT done: ~~no `.icns` and no `CFBundleIconFile` (ADR 0024 § A6 — `png2icns`, `icnsutil` and `iconutil` are absent here and in the image, so an icon written here would be `selfReading`)~~ **done 2026-09-13 (ADR 0024 § A26): the `.icns` and the key are written from rasters `gjsify ship` renders itself, read back by a CPython walk in CI and by `iconutil` on a Mac**, ~~no interpreter or GTK closure in the bundle (item 6, M2b)~~ **done in M2b**, and ~~no macOS CI leg~~ **added in M2b** — M2a was entirely Linux-verifiable by construction, which is what made it separable from M2b at all.


**What #1354 M3 landed.** `gjsify ship windows` emits two artifacts: the program directory (`windows-dir`, a DIRECTORY artifact like `macos-app`) and a deterministic zip around it (`windows-dir-zip`). Both `layoutOs: 'win32'`, `finishOn: 'any'`, assembled on Linux, unsigned — and SmartScreen only WARNS on an unsigned download where Gatekeeper BLOCKS one, so this is a usable artifact in a way an unsigned `.app` is not (ADR 0024 § A5). The `.cmd` runs `"%HERE%node.exe"` and sets `GJSIFY_GTK_RUNTIME` + `NODE_GI_NATIVE`; it does NOT set `PATH` for the closure, because node-gi's `maybePrependGtkRuntimeDllPath()` does that in-process above its own `loadNative()` and a second copy would drift. Runtime staging is M2b's module unchanged — `Layout.dirs` is what makes the same four pieces land in `lib\node-gi\prebuilds\win32-x64\` instead of `Contents/Frameworks/`. Three defects this closed, each measured red first: `readLauncherInterpreters` read a `.cmd` with the POSIX rules and found NOTHING (batch has no `exec`, `%~dp0` carries its own separator, the file is `node.exe`), so `assertLauncherMatchesInterpreter` passed over a launcher running `gjs` under `gjsify.app: "node"`; `readBinaryArch` stopped at `MZ`, so `assertPayloadMatchesArch` was vacuous on the one PE layout; and the zip had no top level, because the windows stage carries none for it to inherit. Oracles: `.github/ship-oracle/verify-program-dir.py` (CPython `struct` over every staged PE, plus the launcher's bytes and the interpreter it names) and the existing `verify-app-zip.sh` with a third argument naming the kind. `tests/e2e/ship-windows` drives both green and red — 22 of its 27 cases fail against the pre-M3 CLI. Two CI jobs in `node-gi.yml`: `windows-dir-assemble` (Linux, real `node.exe` + the FULL-windowing gvsbuild bundle + the MSVC addon) and `windows-dir-selfcontained` (`windows-latest`), which asserts gvsbuild is ABSENT and that `PATH` reduced to `%SystemRoot%\system32;%SystemRoot%` has no `node`, then unzips the artifact and opens a window. `win32-arm64` stays refused and the blocker is upstream — gvsbuild hardcodes `self.platform = "x64"` (#1117).

**What #1354 M5 landed.** `gjsify ship windows --target msi` emits a Windows installer — the third row over the windows layout and the first format in this table whose producer is not this tree. `utils/ship/msi.ts` renders ONE authored `.wxs` in WiX v3's schema and hands it to a host-selected compiler: `wixl` (`msitools`) on Linux, `candle.exe`+`light.exe` (WiX Toolset 3.14.1.8722, preinstalled on `windows-latest`) on Windows. So `finishOn: ['linux', 'win32']` — ADR 0024 § A5 wrote that as an either/or and the third option is what makes an independent reader possible on both legs, because **each backend's output is read by the OTHER family**: `msiexec` installs the wixl-built file on `windows-msi-install`, RUNS the installed launcher and then uninstalls it, asserting no file, no Add/Remove Programs entry and no Start-Menu shortcut survives; `msiinfo` reads back on Linux (`windows-msi-crossread`) the file WiX compiled from the same document. `verify-msi.sh` takes the expected producer as an argument — `msitools` or `!msitools` — and refuses a file whose `msiinfo suminfo` says otherwise, so a job pointed at the wrong artifact fails instead of passing as a self-oracle. `requiredTools` became a union (`readonly string[] | Partial<Record<HostOs, …>>`) for this one row, resolved by `requiredToolsOn(tools, host)`: a flat list demands `wixl` of a Windows host in one direction and says the other OS needs nothing in the other. The artifact is DETERMINISTIC — `ProductCode` is a UUIDv5 over app id + version + release + arch and `UpgradeCode` one over the app id alone, which is exactly the pair `MajorUpgrade` needs, where WiX's documented `Id="*"` would reroll the code every build. A prerelease version is REFUSED rather than truncated, because `1.2.0~rc.1` and `1.2.0` would become one `ProductVersion` and both would end up installed. `msitools` had to go into `.docker/ci-fedora.Dockerfile` in its OWN PR first: `build-ci-image.yml` publishes the image only on a push to `main`, so a PR adding a package AND a test that hard-requires it can never go green. **What M5 does not claim:** `tests/e2e/ship-msi` compiles with `wixl` and reads with `msiinfo`, two programs out of one package — that is a second implementation VALIDATING the authored document plus a byte round trip out of the embedded cabinet, not verification, and the suite header says so. **A hand-written MSI stays rejected** (§ A6: the three constraints that forced the hand-written deb/rpm writers have no subject here, because there is no GJS host on Windows at all), and **MSIX stays rejected** until a certificate exists. The console-window gap below is NOT closed by the shortcut.

**What #1354 M6 landed.** `--sign <identity>` and `--notarize <credential>` on the FINISH phase (ADR 0024 § A12-§ A17, plus this PR's § A18-§ A21). An identity is a NAME `codesign`/`signtool` resolves a key by, never a certificate — there is no `--certificate`, no `--p12`, no `--password`, and `gjsify.ship.sign.<darwin|win32>.identity` is the project default. Absent identity SKIPS loudly at exit 0, from the flag and from the config alike. `SIGNERS` in `utils/ship/signing.ts` is a per-OS table BESIDE `FORMATS`, because § A14 measured that a format declares where it can be packed and never what it can be signed with; linux has no row and `--sign` there is refused with the mechanism (`debsigs`/`rpmsign` sign the artifact as a whole, with the repository's key). Signing is a payload MUTATION and the ORDER is structural: `readStage` refuses a size-changed file — measured, *"is 6 bytes in the stage and 5 in its manifest"* — so `signPayload` takes its OUTPUT and returns the packer's INPUT, mutating `<outRoot>/signed/<format>/` and never the arriving stage, which is what makes a `--from-stage --sign` run repeatable. The oracle is `.github/ship-oracle/verify-signed-arrival.mjs` over `compareMachOAfterResign` in `manifest-conformance/lib/binary.mjs` (extended, not duplicated — that file's header forbids a second parser), with a third exempt region § A17 did not list and this one derives: `__LINKEDIT`'s size fields, because the blob lives inside that segment by construction. Proven ad-hoc on `macos-suites.yml` with NO secret in the repository, guarded by `GJSIFY_SHIP_SIGNING_REQUIRE_CODESIGN=1` so the leg cannot pass on a host with no `codesign`; `tests/e2e/ship-signing` drives everything else green and red from Linux. What it did NOT prove is its own section above (`gjsify ship --sign`: three things M6 did not prove) — Windows, notarisation, stapling — each with what WAS measured.

**What #1354 M4 landed.** `gjsify ship darwin --target macos-app-dmg` emits a UDIF image around the same `<App>.app` the other two macOS rows produce — `hdiutil create -format UDZO -fs HFS+J -srcfolder <volume> -volname "<display name>" -ov`, on darwin, because `hdiutil` is the only UDIF writer there is and it is macOS-only. It is the FIRST row that is host-bound in `HostRequirement`'s sense (`finishOn: ['darwin']`, `requiredTools: ['hdiutil']`); flatpak is Linux-bound because flatpak runs on Linux, this one is bound by its container while the tree it wraps assembles anywhere. A hand-written UDIF writer stays rejected (ADR 0024 § A6). The packer takes the STAGE and never the `.app` artifact beside it: a `--target macos-app-dmg` run alone must produce an image, and § A17 fixes the seam for a later `--sign` between `readStage` and the container. The row declares `hdiutil` and NOT `glib-compile-schemas`, unlike its two siblings — the compiler is an ASSEMBLY tool and `assertToolsInstalled` fires on the pack path, so declaring it would refuse a `--from-stage` pack on a Mac with no GLib, a pack that works because the compiled cache is already in the stage that arrived.

**The `.dmg` oracle is a chain of four on LINUX, and `hdiutil verify` is deliberately not in it** (ADR 0024 § A3 names this format as the case the field exists for). `.github/ship-oracle/verify-dmg.py`: `7z l -slt` over the UDIF container; `7z t`, which DECOMPRESSES what the container stores and is therefore the only link that can see a byte flipped inside a compressed run; `dmg2img`, a second and unrelated UDIF decoder, which writes the raw volume out; `fsck.hfsplus -f -n` over that volume, which walks the catalog, the extents overflow file and the volume bitmap; then 7-Zip's HFS handler for the listing, compared against `.gjsify-ship-stage.json` by name and size. Three CI jobs in `main.yml`: `ship-stage` gained a darwin half (a second FIXTURE, `tests/e2e/ship-macos/fixtures/dmg-app`, because `packages/infra/cli` is `--app gjs` and every macOS row is `interpreters: ['node']`), `ship-pack-dmg` runs on `macos-latest` with NO checkout — the CLI arrives as the `bootstrap-bundles` GJS bundle and runs under a `brew install gjs`, so the Mac leg costs no workspace install — and `ship-read-dmg` runs on a BARE `ubuntu-latest`. Bare, and that is what kept M4 out of the Dockerfile-then-test ordering trap: `build-ci-image.yml` publishes the image only on a push to `main`, so a PR that adds a package to the image AND a test hard-requiring it can never go green. The three readers arrive by `apt-get install -y 7zip dmg2img hfsprogs` instead. Measured on `ubuntu:24.04`: 7zip `23.01+dfsg-11` (`7z i` lists `Dmg`, `HFS`, `APFS`), dmg2img `1.6.7-1build4`, hfsprogs `540.1.linux3-5build3`. Note `scripts/check-ci-image-packages.mjs` could not have caught the alternative — its "does a job use a tool the image lacks" question covers `NODE_TOOLS` only, and it skips a job with no `container:` outright.

**"Flip a byte" is not a negative control, and WHERE it lands decides more than that (#1354 M4).** One byte flipped at each offset of the real 31715-byte artifact (data fork 0-22939, XML plist 22939-31203, koly 31203-31715) — exit codes `7z l` / `7z t` / `dmg2img -p 4`: at 0·256·512·1024·2048·4096 all three answer 0 (the data fork opens with the GPT partitions' `Zero0`/`Zero2` runs, which store and checksum nothing); at 8192·12288·15000 all three refuse; at 16000·20000 `7z l` is BLIND while the other two refuse; at 24000 `dmg2img` is blind while both 7-Zip reads refuse; at 28000·31000 nothing notices. Three consequences: `--mutate payload` derives its offset from the koly trailer's own `dataForkOffset`/`dataForkLength` and flips the fork's MIDDLE, because its first version used the constant 512, landed in padding and reported "the readers are not doing their job" about a working chain; NO SINGLE READER covers everything, which is a better argument for the chain than "`7z t` is the link that sees the payload"; and roughly the leading 4 KB plus the trailing 3.7 KB of the file is covered by none of them, which is a limit rather than a feature and is not papered over. The discriminator is three mutants — the `koly` magic, the data-fork midpoint, the HFS+ signature in the extracted volume — plus a positive control on the untouched volume, so a branch that refused everything could not pass as a discriminator. Two other measurements worth not re-running: `7z l -slt` on an HFS+ volume roots every path at the VOLUME NAME (so the comparison prepends it), and a journaled volume carries `.journal` and `.journal_info_block` at its root — a CLOSED allowance in the oracle rather than a dotfile glob, because a glob would also swallow a real `.DS_Store` in a user's download.

**A measurement taken on a stand-in (#1354 M4).** This entry first said the `.dmg` listing was blind to POSIX modes, because `7z l -slt` reports `Mode = 0---------` on an empty `mkfs.hfsplus` volume. Against a real `hdiutil` image the same reader prints `-rwxr-xr-x` for `Contents/MacOS/<binary>` and `-rw-r--r--` for the other seven (run 33283043393), so the oracle compares modes against `staged[].mode` — the field that matters most here, because the artifact upload flattens every staged file to 0644 and the sidecar is the only surviving record of what each mode should be. The wrong claim was the expensive direction: it would have REMOVED a check. Three more things the real image settled that a `mkfs` volume could not: **`dmg2img in.dmg out.img` writes the whole GPT-partitioned DISK** — `hdiutil` produces a primary GPT header and table, the `Apple_HFS` volume, an `Apple_Free` run and the backup table, and dmg2img decompressed all eight into one file — so the HFS+ volume header is not at offset 1024 of the result and `fsck.hfsplus` exits 8 on a correct artifact. The fix is dmg2img's own vocabulary rather than a GPT parser of ours: `-l` prints `partition <n>: <name>` and `-p <n>` extracts one, so the oracle names the `Apple_HFS` partition and refuses an image with anything but exactly one. And: `7z l -slt` on a `.dmg` AUTO-NESTS (two archive headers, `Type = Dmg` then `Type = HFS` with `Method = HFS+`, and the ten-dash separator appears only after the second — partitioning on the FIRST occurrence made the type check read `HFS` and refuse a correct image), and an `hdiutil` volume carries two HFS+ hard-link stores, `.HFS+ Private Directory Data` and `[HFS+ Private Data]`, which need no allowance because both are directories.

**What M4 does not claim.** Nothing mounts the image or drags the bundle out of it. The image is unsigned and unnotarised; that is M6. And the fixture the `.dmg` legs wrap is the small one (no interpreter, no GTK closure) — what the heavy tree does is `node-gi.yml`'s `macos-app-selfcontained` leg, and what lets the small payload stand for it here is `tests/e2e/ship-macos`'s assertion that the staged tree is byte-identical across all three macOS containers.

**The console-window gap is CLOSED (ADR 0040), and here is what it cost to be sure.** `node.exe` is a CONSOLE-subsystem PE: `Subsystem` = 3, at offset 0xD4, measured on `node-v24.20.0-win-x64.zip`'s `node.exe` (`e_lfanew` 0x78, so 0x78 + 4 + 20 + 68 = 0xD4), and that release ships no `nodew.exe` (`unzip -Z1` lists exactly ONE `.exe`; the `nodewin` hits are corepack shim DIRECTORIES, the control string proving the grep was live). Two of the three fixes #1354 M3 listed do not work, for one reason: **the console is allocated for `cmd.exe`, which is a console image whatever `node.exe` is**, so `Subsystem`-patching the interpreter changes a field on a process started inside a console that already exists — and it would also discard every byte the app writes, because a console-less Node black-holes stdout/stderr and prints its uncaught-exception trace from C++ (`src/debug_utils.cc`), where no JS replacement of `process.stderr` can reach it (nodejs/node#12036). The `.msi`-shortcut fix reaches only the installed copy, not the zip. So the answer is the first of the three: the windows LAYOUT stages a GUI-subsystem launcher `gjsify ship` EMITS itself (`utils/ship/pe-launcher.ts`, 13 824 bytes, twelve kernel32 imports, no CRT and no vendored binary), the `.msi` shortcut points at it, and it runs the same `.cmd` — so no environment decision is duplicated in machine code. It preserves diagnosis: a terminal launch writes to the terminal, a redirected launch writes to the redirect, and only a launch with nowhere to write at all falls back to `%TEMP%\<binaryName>.launch.log`. **Still no CI leg can observe any of it** — every Windows job starts the app from a shell and already has a console. `verify-program-dir.py` now JUDGES the stub's subsystem (a claim about a file we write) and still PRINTS the interpreter's, and `tests/e2e/ship-windows` drives both refusals. The window measurement was made by hand on `win11-gjsify`, session 1, over a real staged program directory: the `.cmd` adds two visible console-host windows, the `.exe` adds none, both exit 7, and the control run with nothing started adds none. Instrument and method are in ADR 0040 § The measurement.
**What #1354 M2b landed.** `utils/ship/app-runtime.ts` stages four things into the darwin layout, each resolved BY NAME and each `null`-not-throw: the interpreter (`@gjsify/node-runtime-darwin-<arch>` → `Contents/MacOS/node` + its LICENSE), the relocated GTK closure (`@gjsify/gtk-runtime-darwin-<arch>` → `Contents/Frameworks/node-gi/prebuilds/darwin-<arch>/gtk/**`, TREE-PRESERVING), the addon (`@gjsify/node-gi`'s `prebuilds/<target>/node_gi.node`, SIBLING to that closure because its `@rpath` is `@loader_path/gtk/lib`), and — the one nobody predicted — **node-gi's JavaScript**, because `@gjsify/node-gi/*` is external in every `--app node` bundle by design, so a `gi://Gtk` import compiles to `require('@gjsify/node-gi/gi')` and a `.app` has no consumer `node_modules`. Measured on a bundle staged the M2a way, run from an unrelated directory: `Error: Cannot find module '@gjsify/node-gi/gi'`. The launcher execs `"$here/node"` and exports `GJSIFY_GTK_RUNTIME`, `NODE_GI_NATIVE` and (when the app carries GI libraries of its own) `GJSIFY_GI_LIBRARY_PATH` — all read by node-gi in JS, none by dyld, so § A4's signing rule survives. Two CI jobs in `node-gi.yml`: `macos-app-assemble` (Linux) and `macos-app-selfcontained` (`macos-latest` + `macos-15-intel`), which asserts brew gtk4/libadwaita are ABSENT and `PATH` reduced to the system directories has no `node`, then unzips the artifact and opens a window.



### Two zlibs can compress one `gjsify ship` artifact, and they disagree

Found while closing the `.deb` changelog's `gzip -9` gap, which is DONE: `@gjsify/zlib`
honours `options.level` now (it was spelled `_options` and dropped on the floor, on the sync
and the async path alike), `@gjsify/tar`'s `gzip()` takes one and routes a levelled request
through `node:zlib` because `CompressionStream` has no level to give, and `plan.ts`
compresses `changelog.Debian.gz` at `POLICY_MAX_COMPRESSION`. Measured with `lintian` 2.117
on ubuntu-24.04 against gjsify's own `.deb`, before and after: `W: gjsify:
changelog-not-compressed-with-max-compression [usr/share/doc/gjsify/changelog.Debian.gz]`
present, then absent, with no error-severity tag in either run. `verify-deb.sh` gates the tag
by name, so it cannot return quietly. **The file also settles the "just stamp XFL" argument
with a number rather than a principle:** the two members differ in EXACTLY ONE BYTE —
position 9, XFL, 0 against 2 — and are 1152 bytes either way, so for that input stamping
would have produced the identical artifact. It is identical by coincidence of a small input;
over the full `CHANGELOG.md` the same two levels differ by thousands of bytes.

**What is open is what the work uncovered.** `gzipDeterministic` is deterministic for a
given HOST, not for a given artifact, and its name says otherwise. `@gjsify/tar` compresses
on the platform's zlib, and the two platforms this CLI runs on do not ship the same one:
Fedora's `libz.so.1` is `zlib-ng-compat` 2.3.3, Node bundles `1.3.2.1-motley`. Measured
2026-09-11 over this repo's `CHANGELOG.md` (876 192 bytes), gio-via-GJS against Node, output
bytes per level — 0: 876 280 / 876 340 · 1: 295 057 / 297 789 · 6: 272 003 / 272 000 ·
8: 270 255 / 270 260 · 9: 277 974 / 270 289. They agree at NO level on that input, including
the default, and **zlib-ng's level 9 is worse than its own level 8** (~2.9 %), which is why
the level is asked for only where a reader demands it and is not blanket-applied to
`data.tar.gz` / `control.tar.gz`. Consequences: a `.deb` packed under GJS and one packed
under Node differ in the two payload tarballs — those are compressed at PACK time — while
`changelog.Debian.gz` is immune because `plan.ts` compresses it once at ASSEMBLY time and it
travels as base64 in the sidecar. `tests/e2e/ship-from-stage` asserts byte-equality between a
direct pack and a `--from-stage` pack and holds only because both run on one host; it is
structurally blind to this, and a cross-host pack is the thing `--from-stage` exists for.
Closing it means pinning ONE deflate implementation for the packers, which is a real
decision (a vendored deflate, or declaring the packing host part of the artifact's identity)
and not a patch.


### The `.rpm` has no `%changelog`, and the blocker is the oracle rather than the writer

Checked while doing the `.deb` half, so the next session does not re-derive it. `rpm.ts`
writes no `CHANGELOGTIME` (1080) / `CHANGELOGNAME` (1081) / `CHANGELOGTEXT` (1082), so
`rpm -qp --changelog` on a `gjsify ship` artifact prints nothing and `rpmlint` 2.8.0 raises
`no-changelogname-tag` ("There is no changelog"). The entry text is NOT the missing piece —
`changelogEntriesFor()` in `utils/ship/changelog.ts` already extracts the bullets per version
and both formats would share it. Two things actually block it. **(a) `rpmlint` appears
nowhere in this repository** — not in `.docker/ci-fedora.Dockerfile`, not in
`.github/ship-oracle/verify-rpm.sh` — so the tag has no gate, and adding the package plus a
test that hard-requires it in one PR is the ordering trap `build-ci-image.yml` imposes
(the image publishes only on a push to `main`); `msitools` went in as its own PR first for
exactly this, and this should too. The system `rpm`'s own `-qp --changelog` is a usable
independent reader in the meantime and is already required by that suite. **(b) the RPM
changelog is HEADER data built at PACK time, not an overlay file compressed at assembly
time**, so `--from-stage` needs the entries inside `.gjsify-ship-stage.json` — a schema 6 → 7
bump, which that file's own rules say must be justified in its header and which `readStage`
must then validate. That is the whole cost, and it is why this is ledgered instead of folded
into the changelog PR.


### Flatpak helper subcommands — downstream adoption (PR3–PR6)

`gjsify flatpak {init,build,deps,ci}` and the bundler-side primitives they lean on have landed. Remaining downstream work: PR3 (ts-for-gir-cli adopts `defineFromPackageJson`), PR4 (app-gnome Vite → `gjsify build`), PR5 (app-gnome flatpak workflow on top of `gjsify flatpak`), PR6 (CLI-flatpak example docs page — the documented `org.gjsify.TsForGir` shape: GNOME Platform runtime + read-only `/usr/share/gir-1.0` mounts).


### `gjsify flatpak check` has never run the real appstreamcli

`flatpak check` shells out to `appstreamcli validate --strict`, and no test has ever
fed it a component this repo actually GENERATED. `tests/e2e/flatpak/run.mjs` drives the
command through `writeShim(stubBinDir, 'appstreamcli', 'APPSTREAMCLI_CALLS')` and hands
it the string `<component/>` as the metainfo file, so the suite asserts the CALL SHAPE
(`validate --strict …metainfo.xml.in`) and nothing about the XML. Both linters are
stubbed the same way, and `appstreamcli` was absent from `.docker/ci-fedora.Dockerfile`
until the commit that added this entry, so no CI job could have run the real one either.
And no gate could have said so: `scripts/check-ci-image-packages.mjs` asks "does a job USE
a tool the image never carries" only for `NODE_TOOLS = ['node', 'npx', 'npm', 'corepack']`,
so a suite reaching for `appstreamcli` is outside what it looks at. Widening that question
past the node tools is the mechanism this class wants; it needs a way to derive tool use
from the SUITES rather than from the workflow `run:` lines, which is why it is a ledger
entry and not a one-line change.

What the gap is NOT, so the next reader does not over-buy the fix: an image missing one of
these tools is a RED e2e run, never a green vacuous one. `tests/e2e/ship/fixture.mjs`'s
`probe()` throws for every name in `REQUIRED_ON_LINUX`, and the two `cli-only` cases assert
`hasCommand(...)` instead of branching on it, so no assertion behind them can quietly stop
running. What is missing is only the EARLIER answer — at image-build time rather than at
e2e time. That also names the shape of the fix: `REQUIRED_ON_LINUX` already IS the
declaration, so a check reads it (the way `fixture.mjs` imports `STAGE_MANIFEST_FILE` out
of the CLI rather than restating it) instead of growing a second list beside it. What it
still needs is a binary→package answer that is not a hand-kept table — most plausibly a
smoke step in `build-ci-image.yml` running `command -v` over that same imported set, which
asks the built IMAGE and therefore cannot drift from what the image contains.

The gap is not theoretical. Measured against a component `renderMetainfoApp` produced
for the `ship` e2e fixture, using the flag the command actually passes:

    appstreamcli validate --strict --no-net <stage>/share/metainfo/org.example.ShipDemo.metainfo.xml
    I: org.example.ShipDemo:10: description-first-para-too-short
    ✘ Validation failed: infos: 1, pedantic: 2      # exit 3

`--strict` fails on anything above pedantic severity, so an INFO-level hint is enough.
The same file passes plain `appstreamcli validate --no-net` at exit 0. Two things are
therefore unknown: whether `gjsify flatpak check` passes on any real project, and
whether `--strict` is the severity this command wants — a first description paragraph
under a certain length is a house-style hint, not a defect that should block a build.

Also worth folding in: the command validates the `.in` TEMPLATE rather than the merged
output. Since `gjsify gettext --format=xml` now produces a real translated component
(`msgfmt --xml`, per-catalogue `--locale=` chaining), the file worth validating is the
merged one — the template is missing every `xml:lang` attribute the merge adds.

Fix: drop the appstreamcli shim from that suite, scaffold a project through the real
`flatpak init` renderer, and run the real binary with `--no-net` (its absence otherwise
makes the assertion depend on resolving every `<url>`). Then decide `--strict` on the
evidence that produces.


### `gjsify ship` does not localise the MIME package it generates

The freedesktop-metadata localisation added in `packages/infra/cli/src/utils/ship/localize-metadata.ts`
covers the two files `commands/ship.ts` renders into `StageInputs` — the `.desktop` entry
and the AppStream component. It does NOT cover the third generated file a user sees a
string from: `renderMimePackage()` writes a shared-mime-info document whose `<comment>` is
what a file manager shows in place of the raw type string (`mime.ts` refuses an empty one
for exactly that reason), and it stays English for every language.

It is not blocked on anything gettext cannot do. Measured with the same tools:

    msgfmt --xml --template=mime.xml --locale=de --output-file=mime-de.xml po/de.po   # exit 0
    →  <comment>A test application</comment>
       <comment xml:lang="de">Eine Testanwendung</comment>

Note the plain `.xml` name: `shared-mime-info.loc` pairs `pattern="*.xml"` with
`localName="mime-info"`, so this file needs none of the `*.metainfo.xml` suffix care the
AppStream template does. The `.its`/`.loc` pair belongs to the `shared-mime-info` package
(`rpm -qf /usr/share/gettext/its/shared-mime-info.its`), which `.docker/ci-fedora.Dockerfile`
does NOT install — so this cannot be tested in CI until that package is added, and adding a
package for a capability nothing yet uses would be a dependency with no assertion behind it.

Left out of the localisation change on scope: the MIME document is produced inside
`utils/ship/plan.ts` (`source: { kind: 'text', text: renderMimePackage(...) }`) rather than
passed through `StageInputs`, so folding it in means moving where that text is rendered —
in the file that neighbours the layout/stage-writer work. Doing it later costs one call
site; doing it in the same change would have crossed into a tree being rewritten.


### The bundled icon theme is not wired into the `create-app` templates

`@gjsify/adwaita-app` ships the Adwaita subset in the app's own GResource and registers it
on `startup` (ADR 0009 § Amendment 1), so `icon-name` no longer depends on the host having
Adwaita installed. That amendment also records the DECIDED divergence that comes with the
default — on GTK a host theme that defines the name still wins, deliberately — so it is not
repeated here.

What is genuinely open is reach. Measured rather than assumed: all four templates
(`gtk-minimal`, `adw-canvas2d`, `adw-game`, `adw-webgl`) construct `Adw.Application` /
`Gtk.Application` by hand instead of through `runAdwaitaApp`, and **none of them names an
icon anywhere** — no `icon-name` in any `.ts` or `.blp`. Adding the dependency today would
ship 26.5 KiB and a startup call to apps with no icons. The day a template draws one, the
change is one line: `runAdwaitaApp` already defaults this on, and a hand-built application
calls `installBundledIconTheme()`.

