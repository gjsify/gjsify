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

3. **Correct the one licence claim a machine reads.** The three `@gjsify/gtk-runtime-*` bundles
   declare `"license": "MIT"` while shipping several dozen relocated LGPL/MPL/GPL libraries. The
   notice TEXTS are generated and gated; the manifest field is not, so a scanner or SBOM
   generator reads a declaration the tarball contradicts. It wants the same treatment as the
   texts: emitted from what the builder measured, held to the manifest by a rule, never a
   hand-edited string.

4. **Keep the ledger measurable.** Entries here and in `open-todos.md` describe a tree that moves
   faster than prose, and a stale entry reads exactly like live work — because it was. Two
   guards (closed-issue references, non-existent paths) were measured against the file and are
   worse than nothing. The one signal that would have caught the known instances is a QUOTE: an
   entry that quotes a source fragment from a file it names, held to that fragment still
   occurring there. Whether enough entries make a quotable claim is the next measurement, not
   another guard.

### Low priority

5. **cluster** — multi-process via a Gio.Subprocess pool. `isPrimary`/`isMaster`/`isWorker`
   exist; `fork()` throws. High effort: it needs a real multi-process architecture.
6. **inspector** — GJS debugger integration (`gjs --debugger`). `Session.post()` and
   `open`/`close` exist and are empty. V8-specific, and hard to port because of it.

These two are the only packages still unimplemented by omission. The tree's third `stub`,
`@gjsify/domain`, is a deprecated Node API and is intentionally minimal.
