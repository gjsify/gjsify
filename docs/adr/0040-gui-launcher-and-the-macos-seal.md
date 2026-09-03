# ADR 0040 — A GUI-subsystem launcher `gjsify ship` writes itself, and the three macOS steps that were refused for a wrong reason

- **Status:** Proposed (2026-09-02)
- **Scope:** `gjsify ship`'s windows layout and its darwin signing path — `packages/infra/cli/src/utils/ship/{pe-launcher,layout,msi,signing,formats,plist}.ts`. Amends [ADR 0024](0024-ship-installable-artifacts.md) § M3 (the console-window gap) and § A16 (what a signature does not settle).
- **What is measured and what is not:** the Windows half is measured end to end, by hand, on the `win11-gjsify` VM in session 1 — the numbers are in § *The measurement*, and they were reproduced independently on a second run of the same instrument. The macOS half is measured only as far as the ad-hoc CI leg reaches: the seal is MADE and CONFINED on a real macOS host (§ *The measurement* → *macOS*), while the bundle-level verify, the ZIP round trip, notarisation, stapling and `signtool` have not run. Every unrun claim is marked UNVERIFIED where it lives in the code.

## Context

ADR 0024 stages 4 and 5 produce artifacts a stranger can install: a `.deb`, an
`.rpm`, a Flatpak, a `.app` + `.dmg` + `.zip`, a Windows program directory + `.zip`
+ `.msi`. Two things stood between that and "a stranger can *start* it".

### 1. Every GUI launch on Windows opened a console window

ADR 0024 § M3 records the mechanism and the reason no CI leg can see it:

> `node.exe` is a CONSOLE-subsystem PE: `Subsystem` = 3, at offset 0xD4, measured
> on `node-v24.20.0-win-x64.zip`'s `node.exe` … And there is no `nodew.exe` to swap
> in … So a user who double-clicks the `.cmd` — or a shortcut an `.msi` writes —
> gets a console window behind the GUI. **Every Windows CI leg starts the app from
> a shell and therefore already has a console**, so none of them can observe it.

It names three candidate fixes: a GUI-subsystem stub of our own, `Subsystem`-patching
the staged `node.exe`, or an `.msi` shortcut that starts the app detached.

**Two of the three do not work, and the reason is the same one.** The console is
allocated for whichever image Windows starts *first*, and that image is `cmd.exe` —
which is a console-subsystem program no matter what `node.exe` is. So patching
`node.exe` changes a field on a process that is started *inside* a console that
already exists. Microsoft's rule, stated for both subsystems in one place:

> If the program is marked as running in the console subsystem, then the kernel will
> connect the program's console to the console of its parent, creating a new console
> if the parent doesn't have a console. … if the program is marked as running as a
> GUI application, then the kernel will run the program without any console at all.
> — [Old New Thing, 2009-01-01](https://devblogs.microsoft.com/oldnewthing/20090101-00/?p=19643)

The `.msi`-shortcut option fixes only the installed copy and leaves the `.zip`,
which is the artifact most people download.

**And patching `node.exe` throws diagnosis away, which is worse than the window.**
A console-less Node discards stdout and stderr silently — libuv's `uv_guess_handle`
returns `UV_UNKNOWN_HANDLE` for an invalid handle, Node's
`createWritableStdioStream` answers that with a *"dummy black-hole output for e.g.
non-console Windows applications"* (`lib/internal/bootstrap/switches/is_main_thread.js`),
and `PlatformInit` has already reopened fds 0-2 on `nul` before any JS runs
(`src/node.cc`). The uncaught-exception trace is worse still: it is printed from
C++ `FWrite` in `src/debug_utils.cc`, so **replacing `process.stderr` from JS cannot
capture it**. [nodejs/node#12036](https://github.com/nodejs/node/issues/12036) is
this exact scenario, reported as *"incredibly difficult to track down"*. Node's
maintainers declined to ship a `nodew.exe` for related reasons
([#556](https://github.com/nodejs/node/issues/556)), and patching one byte also
invalidates node.exe's Authenticode signature: the Authenticode digest skips the
CheckSum at optional-header offset 64-67 and the Certificate Table entry, and
`Subsystem` sits at offset 68 — inside the hashed range. Measured: pristine
`node.exe` hashes to the digest embedded in its own `SpcIndirectDataContent`, and
flipping `0xd4` from 3 to 2 does not.

### 2. The macOS delivery was never finished, and one of its stated reasons was wrong

`utils/ship/signing.ts` refused three steps. Two of the three refusals were
correct-and-provisional. The third was a factual error:

> It does not seal the `<App>.app` BUNDLE. `codesign` on a bundle writes
> `Contents/_CodeSignature/CodeResources` and — for a main executable that is a
> shell script, which every layout's launcher is — stores that script's own
> signature in an extended attribute … the payload round trip … carries no extended
> attributes at all, so a bundle seal made now would not survive into the `.zip`.

The extended-attribute rule is Apple's, and it is about a **loose file**, not a
bundle. TN3126 gives four cases in order:

> If the item is a Mach-O image, or is a bundle wrapped around a Mach-O image, the
> code signature is stored within the image using the LC_CODE_SIGNATURE load command
> — **If the item is a bundle without a Mach-O image, the code signature is stored in
> the bundle's _CodeSignature directory** … — If the item exists within a bundle,
> it's covered by the bundle's code signature. — Otherwise, the code signature is
> stored in extended attributes (EAs) on the item.

A `.app` whose `CFBundleExecutable` is a shell script is the **second** case, not the
fourth. TN2206 says the same from the other side: *"a properly-signed app that has
all of its files in the correct places will not contain any signatures stored as
extended attributes."* Those are ordinary 0644 files, and a plain zip carries them.

So the seal was reachable the whole time, and what was actually blocking it was
`signPayload`'s own rule that the payload's file set may not change — a guard whose
comment named `_CodeSignature/` as exactly the thing it was there to catch.

## Decision

### D1. `gjsify ship windows` emits its own GUI-subsystem launcher, and the layout owns it

`utils/ship/pe-launcher.ts` writes a complete PE32+ image — DOS header, COFF header,
optional header with `Subsystem` = 2, a `.text` section of hand-assembled x86-64 and
a `.data` section holding one import descriptor for `KERNEL32.dll`, its thunks, four
UTF-16 strings and five buffers. 13 824 bytes, no CRT, no third-party byte.

It is staged by the **windows layout's `metadata` row**, which is the seam ADR 0024
§ M1 left for exactly this (*"if a fourth row ever needs a file, THIS is where it
goes — not a branch in the stager"*), as `<binaryName>.exe` beside
`<binaryName>.cmd`.

**It runs the `.cmd`; it does not replace it.** Every environment decision — the
prefix, `XDG_DATA_DIRS`, `GJSIFY_GTK_RUNTIME`, `NODE_GI_NATIVE`, `GI_TYPELIB_PATH`,
`PATH`, the interpreter — stays in `launcher.ts`, where
`assertLauncherMatchesInterpreter` and `.github/ship-oracle/verify-program-dir.py`
already read it back. A second copy of that logic in machine code would be a second
truth, and the one nobody can read.

### D2. It is GENERATED, not vendored — which is what keeps the licence question from existing

The alternative is a prebuilt stub committed to the repository, and it costs three
things a generated image costs nothing:

1. **a toolchain to reproduce it.** ADR 0024 § A1 puts assembly on Linux, and neither
   MSVC nor mingw is present on the machine that assembles Windows artifacts. A
   committed binary would need a CI job whose only job is to prove the committed
   bytes are the ones the source produces.
2. **a licence row.** A stub linked against mingw's CRT carries mingw's terms into
   every artifact `gjsify ship` writes. This one imports documented `kernel32`
   exports and NOTHING else — `IMPORTS` in `pe-launcher.ts` is the whole list, and
   `pe-launcher.spec.ts` reads the emitted image's own strings back and asserts
   that `KERNEL32.dll` is the ONLY `.dll` among them — so the only licence in it is
   this repository's. (It said "twelve" and the list is thirteen:
   a live count, unheld by any check, drifting exactly the way root AGENTS.md says
   a live count drifts. What the number was there to establish is "one DLL, no
   CRT", and that is what it now says.)
3. **review.** The bytes of a checked-in binary are not reviewable; the function that
   emits them is, and `pe-launcher.spec.ts` reads the result back on any host.

This is the same argument `deb.ts`, `rpm.ts`, `cpio.ts`, `ar.ts`, `zip.ts` and
`msi.ts` already make — ADR 0024 § A3 — applied to a program rather than to a
container.

### D3. The stub preserves diagnosis, and that is what decided its two branches

A GUI-subsystem image is not a detached one, but it is also not automatically
attached to its parent's console: Microsoft is explicit that *"GUI applications can
be started without the standard handles and they will not be automatically filled"*,
with the exception that decides everything here — *"if the application is launched
with handle inheritance by its parent process"* (`GetStdHandle`, `AttachConsole`).
So the stub asks **two independent questions**, and collapsing them into one is the
mistake the first draft made:

| question | probe | decides |
|---|---|---|
| does this process own a console? | `GetConsoleCP() != 0` | whether `cmd.exe` may be given one of its own (`CREATE_NO_WINDOW`) |
| can this process write anywhere? | `GetStdHandle` usable for `STD_OUTPUT_HANDLE` **and** `STD_ERROR_HANDLE` | whether the child's output needs a file, and for which stream |

They come apart in both directions, and both were measured on the VM. A scheduled
task has a console with **no window**, so `GetConsoleWindow` — the obvious probe, and
the first one written — answered "no console" and sent a run whose caller had
redirected `> file` into a `%TEMP%` log instead. A GUI process started with
`Start-Process -RedirectStandardOutput` has a usable handle and no console at all.

**The second question is asked of BOTH output handles, and the first version asked
it only of stdout.** That version reads as the branch that keeps everything and is
the one place where this design broke its own rule: `fd 2` is where an uncaught
exception's trace comes out, Node prints it from C++, and a launch with a live
stdout and a dead stderr therefore passed the child a handle nothing could be
written to. Measured — see § *The measurement* — and it is the only defect in this
ADR that was found by reading the code against its own principle rather than by
running it.

The result is that output is never lost: a terminal launch writes to the terminal, a
redirected launch writes to the redirect, a launch with one live stream keeps that
stream and puts the other in the log, and only a launch with nowhere to write at
all — a double-click — sends both to `%TEMP%\<binaryName>.launch.log`. The log
replaces exactly the handles that are dead, so a caller's surviving redirect is
never overwritten. The stub waits for the child and exits with its status, so
`%ERRORLEVEL%` stays truthful.

### D4. The `.msi` shortcut points at the `.exe`

A Start-Menu shortcut to a batch file starts `cmd.exe`. Pointing it at the GUI
launcher is the installer's half of the same fix, and `windowsGuiLauncherPath` is the
one place either name is spelled.

### D5. The darwin signer seals the bundle, hardens the runtime, and staples what can hold a ticket

Three changes, in the order a signature is made:

- **the seal.** After every Mach-O in the closure is signed, `codesign` is run once
  on `Layout.root` — the `<App>.app` directory. The order is structural rather than
  stylistic: a seal hashes what it seals, so sealing first would record digests of
  images the run is about to replace. `signPayload` now permits exactly the additions
  under `<root>/Contents/_CodeSignature/` and refuses every other one, which is the
  guard it always had with the one hole the seal needs.
- **the hardened runtime.** `--options runtime` on both identities — the flag is a bit
  in the code directory, which an ad-hoc signature has — plus `--entitlements` over
  four keys, and `--timestamp` **only for a named identity**: a timestamp is a CMS
  countersignature over a certificate, and *"ad-hoc signing does not use an identity
  at all"* (`codesign(1)`). Apple documents nothing about `--sign - --timestamp`, and
  `codesign(1)` promises that a TSA that cannot be reached **fails the signing
  operation** — not a failure worth inventing for a signature that could not carry
  the result.
- **and both flags go to EVERY Mach-O in the closure, not only to a main
  executable.** `refs/node/tools/osx-codesign.sh:21` signs exactly one path,
  `"$PKGDIR"/bin/node`, so the reference has no per-image decision to make and this
  one does. It is deliberate: the `.app`'s `CFBundleExecutable` is a SHELL SCRIPT,
  so the process that actually runs under a hardened runtime is the staged
  interpreter inside the closure — an entitlement granted only to "the main
  executable" would land on a file the kernel never consults. Entitlements on a
  plain dylib are inert rather than wrong (the loader reads the main executable's),
  and the signer has no rule for telling the interpreter apart from the rest, so the
  blanket application is the shape that cannot grant them to the wrong file.
  **Its measured consequence, which is what made this worth writing down:** an image
  pre-signed WITHOUT these flags cannot re-sign to byte-identical, because both live
  in the code directory. `tests/e2e/ship-signing` pre-signs one of its two fixtures
  plainly and expected `1 signature-only`; with the hardened runtime every image
  differs, the darwin legs reported **2**, and the suite went red on its own
  arithmetic rather than on a defect. ADR 0024 § A21's `--identifier` marker is
  therefore no longer the only thing guaranteeing an observable re-sign.
- **the ticket.** `xcrun stapler staple` after a successful notarisation, on the
  formats whose container can hold one. `stapler(1)`: *"stapler works only with UDIF
  disk images, signed \"flat\" installer packages, and certain code-signed executable
  bundles such as \".app\"."* And the exception that decides ours: *"While you can
  notarize a ZIP archive, you can't staple to it directly. Instead, run stapler
  against each item that you added to the archive."* So the `.dmg` is stapled and the
  `.zip` prints Apple's remedy instead of a claim.

### D6. Two entitlements are deliberately NOT granted, and § A16 stays open

`refs/node/tools/osx-entitlements.plist` grants six keys. Four are granted here:
`allow-jit`, `allow-unsigned-executable-memory`, `disable-executable-page-protection`
(what a shipped V8 needs under a hardened runtime) and
`allow-dyld-environment-variables` (node-gi's `maybeReexecForGtkRuntime` sets `DYLD_*`
for its child on darwin). The two omissions are decisions:

- **`get-task-allow`** is a debugging entitlement, and Apple's notarisation rules
  refuse a Developer-ID artifact carrying it. The reference signs its own build; we
  sign what a stranger downloads.
- **`disable-library-validation`** is ADR 0024 § A16's open question and stays open.
  § A4's design of record is that every image in the closure is re-signed with the
  same identity as the launcher, so library validation has nothing to object to —
  and granting the entitlement anyway would make that re-sign look optional the first
  time somebody read the list.

## The measurement

**Windows, `win11-gjsify`, session 1 (2026-09-02).** A real `gjsify ship windows
--stage` program directory, copied to `C:\src\d3stage\stage`, started with
`Start-Process` (ShellExecute — what Explorer does) from a `Register-ScheduledTask`
action with `-LogonType Interactive`, because SSH lands in session 0. The instrument
is the **visible top-level window list**, diffed around each launch via
`EnumWindows` + `IsWindowVisible` + `GetWindowThreadProcessId` + `GetClassName`, and
counted separately for the three console-host window classes.

| case | new visible windows | new **console** windows | exit | app output |
|---|---|---|---|---|
| control — nothing started | 1 (`explorer` / `Xaml_WindowedPopupClass`) | **0** | — | — |
| `ship-demo.exe` | 0 | **0** | 7 | `%TEMP%\ship-demo.launch.log` |
| `ship-demo.cmd` | 2 | **2** (`WindowsTerminal` / `CASCADIA_HOSTING_WINDOW_CLASS` titled `C:\WINDOWS\system32\cmd.exe`, and `cmd` / `PseudoConsoleWindow`) | 7 | — |
| `ship-demo.exe` (repeat) | 1 (the same Explorer popup) | **0** | 7 | `%TEMP%\ship-demo.launch.log` |

The control row is what makes the Explorer popup noise rather than a finding, and
running the `.exe` on both sides of the `.cmd` is what makes the zero a property of
the launcher rather than of the order. The `.cmd` row is the defect, still present,
still the console entry point — and the exit code is 7 in every row, so nothing was
traded for the window.

Three more behaviours, measured the same day:

- `cmd.exe /c "ship-demo.exe > file"` in session 1 → output in `file`, **no**
  `%TEMP%` log. The caller's redirect survives.
- `Start-Process -RedirectStandardOutput file` → output in `file`, **no** `%TEMP%`
  log. No console anywhere, and still nothing lost.
- a program directory at `C:\src\d3 space\my app.exe` with arguments → correct argv,
  correct exit code. `cmd.exe /s /c ""<path>" <args>"` is the quoting that survives a
  space in the path.

**And the whole point of the exercise, on a real crash.** The `.cmd` replaced with
one that runs `node.exe -e` (v24.18.1, the VM's own), printing to stdout and stderr
and then throwing from a timer, started by ShellExecute with no console: the
`%TEMP%` log carries the `console.log` line, the `process.stderr.write` line, and
the **complete uncaught-exception report** — source line, caret, `Error: boom from
the app`, three stack frames and the `Node.js v24.18.1` banner. That report is
printed by C++ `FWrite`, which is exactly the output § *Context* says a
`Subsystem`-patched `node.exe` discards and no JS can recapture. Exit 1 propagated.

**The stderr probe, red before green** (2026-09-02, § D3's second question). The
branch needs a process with NO console and a live stdout beside a dead stderr, which
`Start-Process` cannot produce — it is constructible with `CreateProcessW` +
`DETACHED_PROCESS` and `STARTF_USESTDHANDLES`, `hStdOutput` = an inheritable file,
`hStdError` = NULL:

| stub | caller's stdout file | `%TEMP%` log | exit |
|---|---|---|---|
| stdout-only probe (before) | `console.log` line | **none — never opened** | 1 |
| both probed (after) | `console.log` line, unchanged | stderr line **plus the whole backtrace** | 1 |
| both probed, `hStdError` = `INVALID_HANDLE_VALUE` | `console.log` line | same as above | 1 |

So the loss was real, the fix does not touch the surviving redirect, and both
spellings of a dead handle take the same path.

**One rig trap worth the sentence, because it made the case look unreachable.**
PowerShell coerces `$null` to `""` for a `[string]` P/Invoke parameter, so
`CreateProcessW` refused **every** invocation with `ERROR_INVALID_NAME` (123) —
including `cmd.exe` — until `lpApplicationName` was passed as `[NullString]::Value`.
A harness that fails identically for every input reads as "this state cannot be
constructed", which is the shape of a measurement that never happened.

**macOS: the seal ran, and nothing past it did.** The macOS VM is shut down and
this repository holds no Apple credential — but `macos-suites.yml`'s ad-hoc leg
(ADR 0024 § A21) is a real macOS host, and it is where § D5's first half was
measured on the first push of this branch: run 33677262483, job 100404973432,
`macos-26-arm64` / darwin-arm64, `/usr/bin/codesign`, 2026-09-02.

- **`codesign` accepted `--options runtime --entitlements` with `--sign -`.** Both
  staged dylibs and the `<App>.app` root were signed, exit 0. § D5's reasoning
  that the hardened runtime is a code-directory bit an ad-hoc signature can carry
  is therefore measured and not inferred.
- **The seal exists and is confined.** `Contents/_CodeSignature/` arrived with
  **four** components — `CodeDirectory`, `CodeRequirements`, `CodeResources`,
  `CodeSignature`; `CodeRequirements-1` is in Apple's superset and not in this
  one, which is exactly why the declaration is a DIRECTORY. The arrival
  comparator over the packed `.app` read **11 identical, 2 signature-only, 5
  declared-added, 0 problem(s)**: the seal wrote where it was declared to and the
  rest of the tree arrived byte-identical.
- **Apple's own reader passed on the images**, `codesign --verify --strict` on
  both dylibs inside the artifact.
- **The run was still RED, and the expectation was the wrong half.** § A21's
  fixture pre-signs with a plain `codesign --force --sign -`, so its assertion of
  `1 signature-only` encoded a signer that re-signed with the same options. With
  `--options runtime` and `--entitlements` in the code directory, an image whose
  old blob lacked them cannot re-sign to byte-identical: **both** images come back
  `signature-only`, and § A21's `--identifier` marker is no longer the only thing
  guaranteeing an observable difference. The assertion now names both images and
  the count, because 2 is a property of our own argv — drop the hardened runtime
  and `libplain` reverts to `identical`.

**And on the second push, with the count fixed, the leg went green on both
architectures** (run 33686518418, `darwin-arm64` and `darwin-x64`, 21 of 21). That
matters beyond the colour: the two strongest assertions in that test sit AFTER the
one that had been failing, so they had never executed. They have now.
`Contents/_CodeSignature/CodeResources` is present in the packed `<App>.app`, and
**`codesign --verify --strict` accepts the BUNDLE** — Apple's own reader, answering
the question our comparator cannot: the comparator says the mutation was confined,
this says the seal is valid over the tree it shipped with. Both on both arches.

**What is still UNVERIFIED on darwin, narrowed to what it actually is.** Not the
seal, and no longer its verification — both are measured above. What is left is
**the ZIP round trip**: this amendment's whole correction to the old refusal is that
`_CodeSignature/` are ordinary 0644 files a plain zip carries, and that is argued
from TN3126 rather than measured, because the darwin leg signs `--target macos-app`
only and nothing signs `macos-app-zip`, unzips it and re-verifies. It needs no
credential and is the next measurement. Past it: `notarytool`, which needs an Apple
account; `xcrun stapler`, which needs a ticket; `signtool`, which needs a
certificate; and § A16 in both directions. `status/open-todos.md` carries all of
them.

## Consequences

- The windows layout now owns a file with an ARCHITECTURE, which is new: its
  `metadata` row is a function of `--arch`, and `LayoutMetadataInput` carries it. For
  any arch but `x64` the row emits nothing, so a stage for an architecture
  `Layout.arches` already refuses stays assemblable — turning "this layout has no
  arm64 runtime" (a warning with something to act on) into "your payload is
  mislabelled" (a refusal about our own file) would have been a worse message.
- `StagedFile.source` gains a third kind, `bytes`. A layout that owns a binary cannot
  express it as `text` — that would round-trip every byte above 0x7f through UTF-8.
- `.github/ship-oracle/verify-program-dir.py` now **judges** the GUI launcher's
  subsystem instead of printing the interpreter's. The interpreter's field is still
  printed and is still 3, which is still not a defect: `node.exe` never becomes the
  thing a user starts.
- The signed darwin payload can grow, in one enumerated place. Everything else about
  the file-set rule is unchanged, and `partitionSignedFileSet` is the pure function
  that decides it — the only half of the seal that can be checked without macOS.
- **Still open, and named rather than implied:** `signtool` has still never run
  (ADR 0024 § A5 — no ad-hoc mode on Windows, so it needs a certificate);
  `notarytool` has still never run; and § A16's library-validation question is still
  unmeasured in both directions. `status/open-todos.md` carries all three.

## Implementation

- `packages/infra/cli/src/utils/ship/pe-launcher.ts` — the emitter, with the
  instruction stream commented as the program it is.
- `packages/infra/cli/src/utils/ship/layout.ts` — the windows `metadata` row,
  `windowsGuiLauncherPath`, `windowsLaunchLogLeaf`, `LayoutMetadataInput.arch`.
- `packages/infra/cli/src/utils/ship/msi.ts` — the shortcut target.
- `packages/infra/cli/src/utils/ship/signing.ts` — `SignArgs`, the entitlements, the
  seal, `partitionSignedFileSet`, `stapleArtifact`.
- `packages/infra/cli/src/utils/ship/formats.ts` — `canCarryTicket`.
- `packages/infra/cli/src/utils/ship/plist.ts` — `renderEntitlements`.
- Tests: `pe-launcher.spec.ts`, `signing.spec.ts`, `msi.spec.ts`;
  `tests/e2e/ship-layout` (the arch-conditional stub, read back as a PE),
  `tests/e2e/ship-windows` (six PE images, and two new oracle discriminators —
  the subsystem rewritten back to 3, and the launcher deleted),
  `tests/e2e/ship-signing` (the seal's declared directory, and the arrival by
  name), `tests/e2e/ship-msi` (the shortcut's component, and the negative half
  that the `.cmd` is still installed and is NOT what the shortcut hangs on).
- **`tests/e2e/ship-msi` runs in CI ONLY**, and that is where § D4 first went red:
  it needs `wixl`, the workstation this was written on has none, and the suite
  FAILS rather than skips there — so the stale `.cmd` expectation was invisible to
  every local run and visible only on shard 4. Worth knowing before changing
  anything in `msi.ts`: the unit spec next to it is the only reader of that file
  a local run exercises.
