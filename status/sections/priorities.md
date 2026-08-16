## Priorities / Next Steps

The tracked list of open work is [`status/open-todos.md`](status/open-todos.md), rendered below
under Open TODOs. This section says only how that list is ORDERED. It deliberately does not
restate individual entries: the second copy is the one that goes stale, and this file is the
proof — it sat unchanged for months naming "add more real-world examples" and "increase test
coverage" as the top two priorities, while the examples had grown past sixty and every network
package it named had reached `full`.

### High priority

1. **Finish the platforms that already ship.** linux-x64 is not the frontier; the other legs
   are. Open and unowned: no darwin gamepad backend (the only route to macOS support, and a
   separate project); `@gjsify/webgl` renders on darwin-x64 but no WebGL2 *content* can; two
   packages have no darwin target at all; nothing exercises the node-free toolchain on macOS,
   although all three engines now publish darwin prebuilds; and the musl legs are blocked on
   named symbols (`@gjsify/lightningcss-native` references `gnu_get_libc_version`,
   `@gjsify/webrtc` finds no `webrtcbin` on Alpine). `win32-arm64` is measured as blocked
   upstream rather than on effort, so it is not on this list.

2. **Make the gates prove what they claim.** A gate that passes without measuring anything is
   the most expensive defect class in this repository's history, and it keeps arriving in the
   same shape: a fixture reading state that an earlier step of the same job wrote. Adjacent and
   open on the same write path — `download-artifact` merges without pruning, so a stale artifact
   can publish silently; the `prebuild-artifacts` dlopen probe degrades to a note on the very
   runner that gates the push; nothing byte-compares a committed prebuild; bundle determinism is
   unmeasured; and 51 `pwsh` blocks are never syntax-checked, eleven of them in `release.yml`.

   A second shape of the same class, and the one to look for next: a job that runs only AFTER
   the merge. It does not pass without measuring — it is simply absent from the PR, which reads
   identically. `pr-trigger-parity` now holds every workflow's `pull_request` trigger to its
   `push`-to-`main` one; what it deliberately cannot see is whether a filter's globs still cover
   the inputs the workflow guards (`napi.yml` is the open instance).

3. **Keep the ledger measurable — the guards are exhausted, the reading pass is not.** Entries
   here and in `open-todos.md` describe a tree that moves faster than prose, and a stale entry
   reads exactly like live work, because it was. THREE guards have now been measured against
   the file and all three are worse than nothing: closed-issue references, non-existent paths,
   and — measured 2026-08-16 — the quote-anchor check this item used to nominate, which flags
   42 of 98 pairs because it cannot distinguish a QUOTE from a MENTION. Stop proposing guards.
   Both stale entries found in that round were found by reading the tree, and both are deleted;
   the record of what was tried, and why each attempt fails, is the last section of
   `open-todos.md`. The only machinery still worth building is the narrow one: an entry that
   pastes a JSON or YAML fragment verbatim can be held to it, because a pasted structure cannot
   be a mention. That is roughly one entry, so build it small or not at all.

   Note for whoever reads this next: **this section is itself the failure mode.** Its previous
   point 3 asked for a licence declaration that had already been corrected, in a rule that
   already existed — the file warning about second copies going stale had gone stale.

### Low priority

4. **cluster** — multi-process via a Gio.Subprocess pool. `isPrimary`/`isMaster`/`isWorker`
   exist; `fork()` throws. High effort: it needs a real multi-process architecture.
5. **inspector** — GJS debugger integration (`gjs --debugger`). `Session.post()` and
   `open`/`close` exist and are empty. V8-specific, and hard to port because of it.

These two are the only packages still unimplemented by omission. The tree's third `stub`,
`@gjsify/domain`, is a deprecated Node API and is intentionally minimal.
