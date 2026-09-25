---
order: 1
tier: high
---
**Finish the platforms that already ship.** linux-x64 is not the frontier; the other legs
   are. Open and unowned: the gamepad backend is DECIDED (ADR 0075 + Amendment 1: SDL3 behind
   a GObject shim on every OS, replacing libmanette on Linux once proven there) and its seam has
   landed, but the shim itself — a new native package — is not built; `@gjsify/webgl` now draws WebGL2 content on darwin, but HiDPI is unproven
   there and two GLES 3.0 API spellings are still missing; two packages have no darwin target at
   all; and nothing exercises the node-free toolchain on macOS, although all three engines now
   publish darwin prebuilds. `win32-arm64` is measured as blocked upstream rather than on
   effort, so it is not on this list.

   musl is covered by two jobs asking two questions, and both are gates now.
   `check-committed-musl` asks whether the committed glibc prebuilds resolve on real Alpine; it
   is ungated and green, with `@gjsify/lightningcss-native`'s `gnu_get_libc_version` carried as a
   DECLARED accepted gap that fails the check the day it stops applying. `build-prebuilds-musl`
   asks whether the SOURCES build and load when compiled against musl: it lost its
   `workflow_dispatch` gate and its `continue-on-error`, so it now runs on every PR and push the
   workflow's paths reach and can go red. It never ran once in CI while it was dispatch-only —
   which is how it kept a staging defect for its whole life: both bridges shared one `--dest`,
   the stager REPLACES its destination, and the second erased the first, so the leg died on a
   typelib its own run had deleted. It stays out of the platform-promise audit not by being
   unrunnable but by declaring what it is: `libc: musl` on each matrix entry, dropped from
   `parseCiPlatforms()`, because `-musl` is not a `gjsify.platforms` token at all.
   What is still open is the artifact: nothing COMMITS a `-musl` sibling, so a musl host still
   receives the glibc binary and its one accepted gap. Prerequisites in `open-todos`.

   `@gjsify/webrtc` is blocked a layer below all of that and not by us: Alpine ships libnice
   0.1.22 where GStreamer 1.28's nice plugin needs 0.1.23, so `webrtcbin` is not built at all —
   the prebuild links cleanly and the element still does not exist.
