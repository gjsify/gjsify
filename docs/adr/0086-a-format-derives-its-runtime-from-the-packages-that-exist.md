# 86. A format's runtime capability is DERIVED from the runtime packages that exist, and a project may override it per (OS, format)

- Status: **Proposed**
- Date: 2026-10-01
- Deciders: Pascal Garber
- Amends [ADR 0024](0024-ship-installable-artifacts.md) § 4 (*a runtime policy per OS*) — and does
  not supersede it. ADR 0024 keeps the per-OS policy and this ADR records what happens where the
  FORMAT disagrees with it, which is the half § 4 leaves to the format table and that table has
  been carrying by hand.
- Related: [ADR 0017](0017-native-package-distribution.md) (runtime closures ship as npm packages),
  [docs/ship-formats.md](../ship-formats.md) (*which format's answer differs from the layout's*),
  `packages/infra/cli/src/utils/ship/{formats,depends,node-runtime,app-runtime,entry-interpreter}.ts`,
  issues #1936's sibling blockers as filed alongside this record.

## Context

**ADR 0024 § 4 chose the runtime per OS, and that was the right cut.** Linux declares `gjs >= 1.86`
because every distribution ships one; macOS and Windows carry Node from `@gjsify/node-runtime-<target>`
because neither ships anything (`depends.ts:360-368`, and the module header of `node-runtime.ts`, which
states the rule as its own opposite). Learn6502's release is the proof and it is a one-line argument:
a 1 MB `.deb` beside a 251 MB `.app`.

**What § 4 does not cover is a format that cannot use what its OS was given.** A `.deb` can *depend* on
the distro's Node; an AppImage has nobody to depend on, so it must *carry* one. § 4 assigns the
runtime, the format table decides separately whether it can provide that runtime, and ADR 0024 § 4's
own text says so: *"the two questions are asked in two places and give two different answers for one
project"*. That sentence has been load-bearing since #1486 — it is why a project whose darwin target
resolves to `gjs` stages the darwin layout and is then refused, by name, at pack time.

**The table's answers are ASSERTED, and one of them is wrong.** Measured 2026-10-01 by reading the
`FORMATS` record rather than trusting the row comments:

| Format | OS | `interpreters` | Can it actually provide `node`? |
|---|---|---|---|
| `deb`, `rpm` | linux | `['gjs', 'node']` | yes — `Depends: nodejs >= 24` (`depends.ts:106`, `:367`) |
| `appimage` | linux | `['gjs', 'node']` | **no** — nothing to depend on, and `@gjsify/node-runtime-linux-x64` does not exist on npm |
| `flatpak` | linux | `['gjs']` | yes — `org.gnome.Platform` supplies GJS |
| `macos-app`, `-zip`, `-dmg` | darwin | `['node']` | yes — runtime package exists, and correctly so |
| `windows-dir`, `-zip`, `msi` | win32 | `['node']` | yes — runtime package exists; **and no relocatable GJS exists at all** (`docs/ship-formats.md:537`) |

So the Linux AppImage row advertises an interpreter it has no way to ship. It is not a wrong *refusal* —
it is a wrong *promise*, and it fails late, in the format that assembles the artifact, with a package
name the author has never heard of. `node-runtime.ts`'s header justifies leaving Linux out
(*"Every Linux distribution ships a Node"*), and for a `.deb` that is exactly right; the AppImage row
inherited the assumption without carrying the exception.

**And the two runtime worlds are asymmetric in a way that makes "every runtime everywhere" harder than
it sounds.** `ShipInterpreter` is a closed union — `'gjs' | 'node'` (`entry-interpreter.ts:53`) — and it
is closed in the right places: `renderLauncher` branches on it, `deriveDepends` seeds the dependency from
it, and `assertLauncherMatchesInterpreter` exists because a package whose launcher and dependency
disagree is the defect that field was introduced to kill. Widening the union is therefore not a type
change; it is a new branch in each of those three, plus a CI leg per runtime per OS, because none of
them is provable without a host.

**What there is NOT to build, so this record does not imply it:**
- **GJS on macOS and Windows are already decided** (ADR 0024 § 4 and `docs/ship-formats.md:537`). The
  blocker is a **relocatable GJS** — `@gjsify/gjs-runtime-darwin-<arch>`, published for neither target
  (checked on npm 2026-10-01). ADR 0024 scopes the work: *"the same `otool`/`@loader_path` walk the
  script already performs, seeded with `gjs` and its SpiderMonkey, plus the ad-hoc re-sign arm64
  requires — a contained extension, not a new mechanism"*.
- **There is no single-executable build anywhere.** No `node:sea` in this tree, for Node or for
  anything else. `app-runtime.ts`'s *"self-contained"* means *carries its interpreter beside the
  bundle* — file copying. A SEA-shaped artefact is a separate capability question, and this ADR does
  not settle it.

## Decision

**1. What a format can provide is DERIVED, not declared.** The `interpreters` list stops being a
hand-written field and becomes the answer to *which runtime packages exist for this (OS, CPU)*, read
at pack time by the same by-name resolution `app-runtime.ts` already uses (`node-runtime.ts`'s
`null`-not-throw contract, so a missing package produces a name and not a throw). A row that promises
an interpreter it cannot ship is then unreachable by construction, and the Linux AppImage's `node`
promise disappears with the hand-written list rather than with a patch.

**2. A project may override the runtime per (OS, format).** `gjsify.ship.app` stays per OS and keeps
its meaning as the payload's language. A new per-format override answers only *which artifact carries
which runtime* — so one project ships a GJS `.deb` from the distro's GJS, a Node `.rpm` because its
CI has Node, and a Node AppImage carrying `@gjsify/node-runtime-linux-x64`, all from three bundles and
one file. **This is the smallest change that makes "any runtime in any format" true**, and it is
additive: a project declaring nothing gets today's behaviour unchanged.

**3. The derivation is per (OS, CPU), never per OS.** A format that can carry a runtime on `linux-x64`
and not on `linux-arm64` is a real state, and the refusal has to name the pair. The macOS floor
(ADR 0074) already established that a declared floor is a per-target question.

**4. Widening `ShipInterpreter` past `gjs` and `node` is explicitly OUT OF SCOPE here**, and the reason
is recorded so the next reader does not mistake this for an oversight: `bun` and `deno` are not a union
widen but a second capability axis, because each needs its own dependency spelling, its own launcher
branch and its own CI leg on every OS, and none of that can be proven from a Linux runner. The shape in
decisions 1–3 is what makes that addition cheap **later**; it does not perform it now.

## Consequences

- **A format table that lies becomes impossible rather than fixed.** The cost is that pack time now
  resolves packages it did not before, so a missing runtime surfaces as a refused pack with a package
  name in the message — which is the failure mode `node-runtime.ts` already chose on purpose.
- **Per-(OS, format) override is a second place a runtime is chosen**, and the repo has already been
  burned by that shape once (§ 4's own warning). It is contained by decision 2's scope: the override
  changes only which artifact carries which runtime, never what the bundle is, so
  `assertLauncherMatchesInterpreter` still has a single field to check.
- **A project can ask for a runtime no format can provide**, and the answer is a refusal naming the
  (OS, format, runtime) triple. That is the same refusal #1486 introduced for darwin, now general.
- **`gjsify ship` gains the ability to fail on a project that was previously packable in principle and
  un-packable in practice.** Linux AppImage with `app: 'node'` is exactly such a project today.

## Implementation

Three blockers, filed as issues alongside this record rather than tracked here — this ADR is
**Proposed**, and an accepted ADR's follow-up work moves to `status/open-todos/` (see `docs/adr/README.md`):

1. **Publish `@gjsify/node-runtime-linux-x64` and `-linux-arm64`**, or make the Linux AppImage row's
   refusal say which package would fix it. Until one of those, `app: 'node'` + `appimage` on Linux is
   a promise the table cannot keep.
2. **`@gjsify/gjs-runtime-darwin-<arch>`** — the relocatable GJS ADR 0024 § 4 already scopes, and the
   first thing it unblocks is `gjsify.ship.app.darwin: 'gjs'` (already a settable knob since #1486).
3. **GJS on Windows**, same shape as (2) and harder: the macOS CI leg runs `test:gjs` on both arches
   and the Windows leg cannot, so the capability would ship unproven unless a runner appears first.