# ADR 0013 — `@gjsify/sab-native` stays address-keyed; Linux ships, macOS is the one reachable port, Windows is blocked

- **Status:** Accepted (2026-07-26)
- **Scope:** `@gjsify/sab-native` (Tier 1, Node pillar) and its only consumer `@gjsify/worker_threads`. Binds the published `SharedBuffer` / `atomics` / `hasNativeSab()` contract and the `prebuilds/` platform matrix.

## Context

`@gjsify/sab-native` exists because stock GJS has no usable `SharedArrayBuffer`.
Two independent reasons, not one:

1. SpiderMonkey gates the `SharedArrayBuffer` constructor behind
   COOP/COEP-equivalent opt-in, which GJS does not flip.
2. Even with the constructor available it would not help. SpiderMonkey allocates
   SAB backing stores from the per-runtime heap, and a `@gjsify/worker_threads`
   `Worker` is a **`Gio.Subprocess`**, not a thread — GJS has no worker threads,
   one SpiderMonkey runtime per process. There is no in-process heap to share.

This second point is the whole reason this package is unusual. Node, Deno, Bun and
browsers all implement `SharedArrayBuffer` + `Atomics.wait` across **threads inside
one process**, where the wait primitive is trivially available and no descriptor
passing or shared-memory naming is needed (`refs/bun/src/threading/Futex.rs` is the
reference: Linux `FUTEX_*_PRIVATE`, Darwin `__ulock_wait2` with
`ULOp::COMPARE_AND_WAIT`, Windows `RtlWaitOnAddress` — all three the *process-local*
flavours). gjsify is the only one of them that needs the **cross-process** flavour of
every single primitive. That is what makes this the one native bridge in the
workspace with a genuine portability wall rather than a missing CI leg.

The shipping implementation (`src/vala/sab-helpers.c` + two Vala wrappers) is built
on three Linux-specific mechanisms:

| Concern | Linux mechanism today |
|---|---|
| Region | `memfd_create(2)` + `ftruncate` + `mmap(MAP_SHARED)` |
| Cross-process wait/notify | `syscall(SYS_futex, FUTEX_WAIT / FUTEX_WAKE)` — deliberately **not** `*_PRIVATE`, so the kernel keys on the physical page and matches across processes that mapped the region at different virtual addresses |
| Descriptor transfer | `AF_UNIX` `SOCK_SEQPACKET` socketpair + `sendmsg`/`recvmsg` with `SCM_RIGHTS` |

It ships `prebuilds/linux-{x86_64,aarch64,ppc64,s390x,riscv64}/` and nothing else. On
macOS and Windows the typelib is simply absent, so `@gjsify/worker_threads`'
cross-process `SharedBuffer` support silently does not exist — and until this ADR no
document said so. The package is **Tier 1**, which makes an undocumented
platform-conditional capability a contract defect regardless of whether the port ever
lands.

## Decision

### 1. The wait/notify primitive stays address-keyed on every platform — reject the condvar unification

The tempting unification is: replace `memfd_create` with `shm_open` and replace the
futex with a `PTHREAD_PROCESS_SHARED` mutex + condition variable placed *inside* the
shared region, giving Linux and macOS **one** implementation instead of two. That is
rejected. A single portable path is worth more than two platform paths, but this
particular "one path" is not the same contract:

- **It requires in-band state, so it changes the region layout.** A futex needs
  nothing but the 4 bytes being waited on; a condvar needs a real `pthread_cond_t` +
  `pthread_mutex_t` (64 B each on both glibc and Darwin) living at a fixed offset in
  the region. `SharedBuffer.create(16)` today yields 16 caller-owned bytes and
  `wait32(sb, offset, …)` works at **any** 4-byte-aligned offset. With a condvar
  either the region grows a reserved header (published-contract break) or waiting is
  restricted to offsets the header covers.
- **`notify32(offset, count)` stops being per-address.** One condvar per region means
  every waiter — on unrelated offsets — is a candidate for every wake: spurious
  wakeups become the norm and the returned "number woken" stops meaning what it says.
  Per-offset condvars are not expressible, because you cannot overlay a 64-byte
  object on an arbitrary caller-chosen 4-byte slot.
- **It introduces a lock where the JS contract has none.** `Atomics.wait` semantics
  are "compare and sleep atomically, holding nothing". A condvar can only do that
  with its mutex held across the compare, which the JS surface does not expose. Worse,
  a worker killed while holding that mutex wedges every other process in the group.
  Linux has `PTHREAD_MUTEX_ROBUST` for exactly this; **macOS does not**, so the
  "portable" path would be least robust on the platform it was introduced for.
- **`shm_open` is strictly weaker than `memfd_create` on Linux.** It needs a mounted
  `/dev/shm` (absent in minimal containers and some sandboxes; memfd needs no
  filesystem at all) and it publishes a name in a global namespace, so a crash between
  `shm_open` and `shm_unlink` leaks an object until reboot. `memfd` is anonymous and
  leak-free by construction.
- **The cost lands on the only platform that currently works.** The Linux path has 26
  green GJS specs including a real cross-process `SCM_RIGHTS` round-trip. Rewriting it
  buys nothing for Linux users.

So: **the seam is the C shim, not the primitive.** Each platform supplies an
address-keyed compare-and-wait; the Vala/GI surface, the TS façade, `hasNativeSab()`
and the `SharedBuffer`/`FdChannel` contract are identical everywhere.

### 2. Linux (shipping) is unchanged

`memfd_create` + non-private `FUTEX_WAIT`/`FUTEX_WAKE` + `SCM_RIGHTS`, five
architectures. No change is made to `sab-helpers.c` by this ADR.

### 3. macOS is the one reachable port; its design is fixed now, its implementation is gated on a macOS prebuild leg

macOS is reachable because a GJS host demonstrably exists there: ADR 0011's
`@gjsify/napi` already builds and runs against Homebrew `gjs` 1.88.x / `spidermonkey`
140 on `darwin-arm64` and stages `prebuilds/darwin-arm64/`. The backend shape:

| Concern | macOS mechanism |
|---|---|
| Region | `shm_open(unique_name, O_CREAT\|O_EXCL\|O_RDWR, 0600)` → `ftruncate(size)` → **`shm_unlink(name)` immediately** → `mmap(MAP_SHARED)`. The fd stays valid and the object dies with the last reference, which is the closest portable equivalent of an anonymous memfd. There is no `memfd_create` and, unlike FreeBSD, **no `SHM_ANON`** on Darwin — `shm_open`+`shm_unlink` is the only option. |
| Descriptor transfer | **Unchanged.** `SCM_RIGHTS` over an `AF_UNIX` socketpair exists on Darwin and a `shm_open` fd is an ordinary descriptor, so `FdChannel` ports as-is. |
| Cross-process wait/notify | `os_sync_wait_on_address` / `os_sync_wake_by_address_any` / `_all` with the `OS_SYNC_WAIT_ON_ADDRESS_SHARED` (resp. `OS_SYNC_WAKE_BY_ADDRESS_SHARED`) flag — Apple's public futex, added in **macOS 14.4**. The `_SHARED` flag is precisely "this address is in a shared memory region, allow the wake to come from another process", i.e. the exact semantics of Linux's non-private `FUTEX_WAIT`. |

Consequences that are accepted as part of this decision:

- **Minimum supported macOS is 14.4** (March 2024). That is not a real narrowing:
  Homebrew — the only way a GJS host gets onto macOS — supports the three most recent
  macOS releases, all of which are ≥ 14.4 in practice.
- **No fallback to the private `__ulock_wait`.** The `UL_COMPARE_AND_WAIT_SHARED`
  private syscall would extend reach back to 10.12 (it is what Bun uses), but it is an
  unstable private libSystem ABI. A Tier-1 package does not ship one. The macOS
  version floor is the honest trade.
- **The shm name is a race window, not an invariant.** Between `shm_open(O_EXCL)` and
  `shm_unlink` the name is visible in a global namespace (and capped at
  `SHM_NAME_MAX` ≈ 31 bytes on Darwin, so names must be short/random, not descriptive).
  A crash inside that window leaks one object until reboot. Linux's memfd path has no
  such window; this is a real, documented behavioural difference between the backends.

**Implementation is deliberately not part of this ADR's change.** A Tier-1 native
package must not carry a backend that cannot be compiled or executed by anyone on the
team, and shipping the C branch without a `prebuilds/darwin-arm64/` artifact changes
nothing observable — `hasNativeSab()` would still be `false` on macOS. The port lands
when a macOS prebuild job exists (the `napi.yml` `macos` job is the precedent), and it
is then **CI-validated only**, exactly like the `@gjsify/napi` macOS tsfn gate.

### 4. Windows is out of scope — blocked, not merely deferred

Two independent blockers, either of which is sufficient:

- **There is no host.** GJS does not run on Windows. Per STATUS.md (re-checked
  2026-07-25 for `@gjsify/napi`): no prebuilt `libgjs` for Windows exists, GNOME's gjs
  CI is Linux-only, and the one prebuilt MSVC mozjs-140 that does exist (servo/mozjs)
  is a patched Rust static-lib layout, not the `pkg-config mozjs-140` shared library
  gjs's meson expects. `@gjsify/worker_threads` declares
  `runtimes: {node: "none", browser: "none"}` — it is GJS-only, so there is no
  alternative runtime to fall back to either.
- **Even given a host, `wait32`/`notify32` would need a different contract, not a
  port.** Windows has no cross-process address-keyed wait. `WaitOnAddress` /
  `WakeByAddressSingle` are documented as process-local — the wake must come from
  "another thread **in the same process**" — and Bun uses their `Rtl*` equivalents for
  exactly that, in-process thread parking. `SRWLOCK` and `CONDITION_VARIABLE` are
  likewise explicitly not usable across processes. A Windows backend would have to
  re-specify wait/notify over **named kernel objects** (an `Event`/`Semaphore` per wait
  slot), which is a different synchronisation model with different wake, timeout and
  crash semantics.

The region and transfer layers *would* port cleanly
(`CreateFileMapping`/`MapViewOfFile`; `DuplicateHandle` instead of `SCM_RIGHTS`, which
additionally needs the peer's process `HANDLE` and `PROCESS_DUP_HANDLE` rights and so
replaces the inherited-fd model wholesale) — but a portable region with a
non-portable wait primitive is not a port. **If GJS ever runs on Windows, Windows
`SharedBuffer` gets its own ADR**, because it changes the `wait32`/`notify32`
contract; it does not get bolted onto this one.

### 5. Until §3 ships, "Linux-only" is a documented contract, and every other platform degrades honestly

This is the part that lands now. The rule is:

- `hasNativeSab()` returns `false` whenever the native module is not loadable **for
  any reason** — typelib absent, load throws, or the loaded module does not have the
  expected shape. It is the single documented gate.
- `SharedBuffer.create()` / `.fromFd()` throw an error that names the actual situation
  (Linux-only capability, this platform has no prebuild) rather than implying a failed
  install.
- `@gjsify/worker_threads` stays fully functional without it: no `FdChannel` means the
  `SCM_RIGHTS` side-channel is simply not created and `postMessage` passes values
  through untouched. Only `SharedBuffer` itself is unavailable.
- Both READMEs state which platforms have cross-process `SharedBuffer` and what
  happens where they do not.

## Consequences

- The published contract becomes explicit: cross-process `SharedBuffer` is a
  **Linux-only** capability of an otherwise cross-arch Tier-1 package, gated by
  `hasNativeSab()`.
- No churn on the shipping path: `sab-helpers.c`, the Vala wrappers and the committed
  `prebuilds/linux-*` binaries are untouched, so no prebuild needs rebuilding.
- The macOS port is now a bounded, pre-decided piece of work (one `#if defined(__APPLE__)`
  branch in the C shim, a `darwin` branch in `meson.build`, a macOS prebuild job) rather
  than an open design question — but it carries a permanent second code path and a
  macOS 14.4 floor.
- Two backends means the spec suite must eventually run on both; until the macOS leg
  exists, the macOS backend is unvalidated by construction, which is why it is not
  landed.
- Windows is closed with a reason. Nobody re-litigates it until a prebuilt `libgjs`
  for Windows exists, at which point the wait-primitive question is reopened as a new
  ADR.

## Implementation

1. **(this change)** Honest degradation + contract documentation:
   `resolveNativeSab()` normalises every unavailable case to `null` (including a
   loaded-but-wrong-shape module, which previously could leave `hasNativeSab()`
   returning `true` and then fail with an obscure `TypeError` at first use); a
   platform-accurate unavailability message; specs pinning the degradation contract,
   including a real `gjs` subprocess with the typelib hidden; `README.md` for both
   `@gjsify/sab-native` and `@gjsify/worker_threads` state the platform matrix.
2. **(follow-up, gated on CI)** macOS prebuild job in `.github/workflows/prebuilds.yml`
   (`macos-14`+ runner, Homebrew `gjs`/`vala`/`meson`), producing
   `prebuilds/darwin-arm64/`.
3. **(follow-up, after 2)** The `__APPLE__` branch in `sab-helpers.c` per §3 plus the
   `meson.build` darwin branch (`.dylib` leaf, `-exported_symbols_list`), and
   `package.json#gjsify.platforms` gains `darwin-arm64`. Re-run the sab-native spec
   suite on the macOS leg; the cross-process specs are the acceptance gate.
4. Windows: no work item. Revisit only via a new ADR.
