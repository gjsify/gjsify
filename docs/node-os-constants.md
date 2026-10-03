# `os.constants` — the tables that are the HOST's, not Node's

Node does not write `os.constants.signals` out. `DefineSignalConstants`
(`refs/node/src/node_constants.cc`) wraps every entry in `#ifdef SIGxxx` and
`NODE_DEFINE_CONSTANT`, so what a Node build reports is **the `<signal.h>` of
the machine that compiled it**, intersected with Node's own fixed list of 37
names. The intersection is load-bearing on its own: Linux keeps `SIGLOST` and
`SIGUNUSED` out of glibc's user-facing header, so a Linux Node reports neither —
even though `asm-generic/signal.h` defines both — and Darwin defines `SIGINFO`
(29) while carrying no `SIGSTKFLT` at all.

Three consequences, each measured rather than reasoned:

- **The name set is per-OS.** 33 names on Linux, 31 on darwin, 7 on win32. A
  missing name is `undefined` where Node has a number; an extra one answers a
  question the host was never asked.
- **The numbers are per-OS**, and not by a little: `SIGUSR1` is 10 on Linux and
  30 on darwin, `SIGCHLD` 17 against 20, `SIGSTOP` 19 against 17, `SIGBUS` 7
  against 10. `win32` is not "the POSIX seven" either — Windows has no signal
  numbers, and the CRT's `SIGABRT` is **22**, not the ISO C 6.
- **`Object.freeze` is part of the contract.** `lib/os.js` calls
  `ObjectFreeze(constants.signals)`, so a consumer's
  `constants.signals.SIGTERM = 1` throws `TypeError` instead of silently
  rewriting the table every later reader sees.

## What this was in this repo

One table — Linux's — in `packages/node/os/src/constants.ts`, served to every OS.
A POSIX literal that cannot fail on Linux and does not announce itself on macOS:
code mapping a raw signal number, or a shell's `128 + n` exit status, back to a
name got a plausible wrong name and nothing anywhere reported it. That is the
ADR 0018 § 5 failure mode in its purest form — a change that is green everywhere
its author can see — and it is why the fix's test had to be split by leg rather
than written as one Linux assertion.

## Where the tables live

`packages/node/os/src/signals.ts`: `SIGNALS.linux` / `.darwin` / `.win32`, all
frozen, plus `signalsFor(os)` which answers `linux` for a host outside the
`gjsify.os` target set. `os.constants.signals` is a **getter** over that table,
selected from `getOs()` — a module-scope read would spend a `uname` subprocess in
every GJS bundle that imports `@gjsify/os`, and `@gjsify/process`'s `platform` is
a lazy getter that can land on the byte-1 banner stub if read during init.

`browser.ts` takes `SIGNALS.linux` directly, not the selector: a tab has no
`uname` to ask, and the reference browser shims all ship the same integers.

### The second copy, and why there are two

`@gjsify/child_process` (`src/platform/{posix,linux,darwin}.ts`) holds these same
numbers, and the two agree on every key they share — read `posix.ts` before
changing either. They are not one table and must not be merged: that one resolves
`child.kill(name)` on **any** POSIX host, so it is a common-plus-overrides shape,
it carries `SIGEMT` (in Darwin's `<sys/signal.h>`, in none of Node's), and it
keeps a generic-POSIX fallback for hosts `mapSysname` knows but ADR 0018 does not
declare. `os.constants` has no such requirement: it is exactly what the host's
header says, or it is wrong.

## How the tables are checked

`packages/node/os/src/signals.spec.ts`, in three tiers, because no single tier is
enough:

| tier | runs on | proves |
|---|---|---|
| the darwin / win32 / linux tables against their headers | **Linux CI** | the data — a row copied from the linux table fails on any host |
| `signalsFor` and the frozen-ness of what it hands out | every leg, every OS | the selection and the `Object.freeze` contract |
| `on('Node.js')`: ours against `node:os` on THIS host | `test:node` on linux, **darwin**, **win32** | that the real thing agrees on a real host |

The third tier is the only one that could have caught #2001 on the OS it was
about, and it reaches darwin and win32 only because `macos-suites.yml` and
`windows-suites.yml` both run `test:node`. Everything in the first tier is
assertable from Linux **as long as it is stated against the header** — which is
why the header is quoted next to each table rather than left implicit.

## Still wrong on the same file

`constants.errno` is libuv's `UV__E*` set and `constants.dlopen` is the dynamic
linker's `RTLD_*`. Both are Linux builds served to every host, for the same
reason and with the same fix available, and neither has a system header to read:
libuv's `uv-errno.h` is GENERATED per platform (`autogen.sh`) and absent from the
`refs/uv` submodule, so the numbers have to come from the libuv version Node
bundles. `status/open-todos/runtime-apis.md` carries the full entry;
`@gjsify/util`'s `osNotes.win32` already records a live consequence
(`getSystemErrorName` answering with the Linux errno table on Windows).