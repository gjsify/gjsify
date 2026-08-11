# 23. Which GTK a node-gi process uses

- Status: **Accepted**
- Date: 2026-08-08
- Deciders: Pascal Garber
- Related: [ADR 0017 (native distribution)](0017-native-package-distribution.md), [ADR 0018 (OS-axis declaration)](0018-os-axis-declaration.md), `docs/node-gi-platform-notes.md` § batteries-included GTK bundles

## Context

`@gjsify/node-gi` needs a GTK/GObject-Introspection stack at runtime. Two can be
reachable at once: the host's own, and a batteries-included bundle
(`@gjsify/gtk-runtime-<os>-<arch>`, built for `darwin-arm64`, `darwin-x64`,
`win32-x64`).

Until now the answer was implicit — **a bundle, if one is present** — and the
rule that kept it safe was *"a bundle must NEVER be a dependency of
`@gjsify/node-gi`"*. That rule exists because #910 made it one: a CI job that had
**compiled** the addon against Homebrew GTK then re-exec'd onto the *bundle's*
typelibs, producing wrong method entries and a 29-minute timeout. #920 reverted
it and the prohibition was written down.

The prohibition solved the from-source case and created a worse one at the other
end. Nothing installs the bundle, and Windows ships no system GTK, so on a clean
Windows host **every `gi://` showcase fails at addon load** (#1063):

```
Error: Das angegebene Modul wurde nicht gefunden.
\\?\C:\...\@gjsify\node-gi\prebuilds\win32-x64\node_gi.node
  code: 'ERR_DLOPEN_FAILED'
```

The file is present the whole time; its DLL closure is not. The published
`@gjsify/gtk-runtime-win32-x64` (81.6 MB, complete) would fix it and nobody pulls
it.

The platform notes recorded the unresolved half as *"the precedence question stays
open in `status/open-todos.md`"* — where it was not, so the one pointer a reader
had led nowhere.

## Decision

Separate two questions that were tangled into one implicit rule.

### 1. Who installs a bundle is not node-gi's business

`@gjsify/node-gi` continues to declare **no** bundle, in any dependency field.
Whoever **ships an application** declares it. For the showcases, the shipper is
the `gjsify` CLI, which assembles the dlx tree and already supplies
`@gjsify/node-gi` the same way; it now adds `@gjsify/gtk-runtime-<target>` on the
platforms that ship one.

This removes #910 at the source rather than catching it downstream: a
from-source build never receives a bundle it did not ask for.

### 2. Which one wins is a policy, stated per-OS and overridable

`decideGtkSource()` in `gtk-runtime.js` returns `bundle | system | none` from an
ordered preference filtered by availability.

| platform | default | rationale |
|---|---|---|
| `linux` | **system** first | `dnf`/`apt`/`pacman` resolve GTK *and* its typelibs; that is the combination the distribution tested |
| `win32` | **bundle** first | there is no system GTK; a host with gvsbuild has it deliberately and remains the fallback |
| `darwin` | **bundle** first | Homebrew is usually present yet measurably not findable (gjs's own rpath points into glib's keg alone) — the reason the darwin bundle exists |

`GJSIFY_GTK_PREFER=bundle|system` overrides. It is deliberately **not**
`GJSIFY_GTK_RUNTIME`, which names a bundle *directory*: where a bundle is and
which source wins are different questions, and one variable answering both leaves
a user unable to say "I have a bundle, use the system anyway".

Preference is an **order, not an exclusion**. "Prefer system" on a host with no
usable system GTK still falls back to a bundle — a preference that silently also
means "and nothing else" turns a working setup into a hard failure.

### 3. One hard rule above the policy

**A from-source addon does not get a bundle by default.** It was linked against
whatever GTK the builder had, so pairing it with a different one is not a
preference but an ABI error — it is #910 exactly. `addonProvenance()` answers this
before the addon is loaded, which it must: on Windows the DLL search path has to
be set *before* `dlopen`, so the question cannot wait for the loaded module.
`nativeCandidates()` is pure and ordered, so probing it cannot disagree with what
actually loads.

`GJSIFY_GTK_PREFER=bundle` can lift the veto. Building against a bundle on
purpose is legitimate, and an explicitly-set variable is consent; what #910 was is
an accident nobody chose. Only the *default* has to refuse it.

## Consequences

- Windows showcases work without the user installing anything by hand, and
  without every `npm install @gjsify/node-gi` pulling 81.6 MB.
- Linux behaviour is byte-unchanged: no linux bundle ships, and the default
  prefers the system stack even if one appears.
- The per-OS defaults are **spelled out rather than derived**. The cheaper rule
  "prefer a bundle wherever we ship one" agrees on every platform today and would
  silently flip Linux to bundle-first the day someone builds a Linux bundle
  (Flatpak, a CI image). Stating each default means a new bundle cannot move an
  existing platform.
- **On darwin the policy is only as good as the addon's own linkage** (#1120,
  found after this ADR shipped). `decideGtkSource()` returning `bundle` sets
  `DYLD_FALLBACK_LIBRARY_PATH`, and dyld consults that ONLY for a dependency path
  that fails to resolve. The published `node_gi.node` still carried the build
  runner's absolute `/usr/local/opt/glib/...`, which resolves on any Homebrew
  Mac — so the addon stayed on Homebrew's libgobject while the bundle's
  libgtk/libadwaita used the bundle's, giving two GObject type registries in one
  process and NULL from every `g_object_class_find_property`. The decision here
  is unchanged; what was missing is that node-gi's own `stage-prebuild.mjs` never
  relocated the addon to `@rpath` the way `scripts/relocate-macho.mjs` does for
  every other darwin prebuild. See `docs/prebuilds.md` § the node-gi addon.
  **Reading for the next such change: a preference expressed in environment
  variables cannot override a Mach-O load command that resolves.**
- A load failure is now diagnosed (`load-diagnostics.js`) instead of surfacing a
  raw OS string. That module is separate from `index.js` on purpose: `index.js`
  loads the addon at evaluation time, so anything living there is reachable only
  by a process that already succeeded at the thing being diagnosed.
- The policy is a pure function, so all three platforms' branches execute from a
  Linux host — the only way these branches are ever run, since no job in this
  repository has printed the Windows or macOS wording.

## Alternatives rejected

**Declare the bundle an `os`-gated optional dependency of node-gi.** This is #910
with better gating. It still hands a bundle to a from-source build on the same
platform, which is the exact pairing that failed, and it charges every Windows
consumer 81.6 MB for a decision the app author should make.

**Keep "never a dependency" and document a manual workaround.** Leaves Windows
users to install gvsbuild or set `GJSIFY_GTK_RUNTIME` by hand, i.e. keeps the
platform second-class for a problem we already ship the fix for.

**Derive the default from "does a bundle ship for this platform".** Identical
answers today, and a silent behaviour change for Linux later — see Consequences.

## Verification

`decideGtkSource` and `describeAddonLoadFailure` are covered from a Linux host
across all three platforms (`test/gtk-source-policy.test.mjs`,
`test/addon-load-failure.test.mjs`). What cannot be proven off-host — that
Windows actually resolves the closure — is the subject of the two
`cli-cross-platform.yml` steps added with this ADR (#1065), which load the addon
on a Windows runner **carrying no gvsbuild**, and assert that a bundle-less load
is diagnosed rather than merely failed.
