# The GObject vectors against node-gi's GObject (2026-10-10)

[ADR 0105](../adr/0105-real-gobject-backs-the-nativescript-subset-on-android.md) stage 0: the ADR
proposes putting **real GObject** behind adwaita-core's hand-written GObject subset on Android,
reached through node-gi. The subset is already pinned by `GOBJECT_VECTORS`, and those vectors
already run against real `gi://GObject` on GJS — the oracle that decides what the subset owes.
Nothing had ever run them against the *other* real binding. So: does node-gi's GObject hold the
vectors GJS holds?

**Not as it stood — five of seventeen failed.** Every one was node-gi's defect, not a wrong
vector: GJS holds all seventeen, and a vector that fails on GJS is a wrong vector by
construction. Four of the five rows are green now, from four fixes with a node-gi test each —
one fix covers two rows, and the fourth narrows the fifth row without closing it. That fifth,
`$gtype.name`, is a representation change too large to carry here and is filed as
[gjsify/gjsify#2151](https://github.com/gjsify/gjsify/issues/2151); its vector is marked
`it.failing` so the leg stays green and the defect stays visible.

Measured on Fedora 44, `x86_64`: gjs 1.88.1, Node 24.19.0, GTK 4.22.5, GLib 2.88.3, node-gi built
in-tree with `node-gyp` (`NODE_GI_NATIVE=build`), X11 display present so the template rows run.

## The result

- **17 of 24 rows run.** The subject declares `isOracle: true`, so the seven `holds: 'subset'`
  rows are skipped: those are REFUSALS the pure-JS subset owes (`Children`, `Implements`,
  `Requires`, `GTypeFlags`, `vfunc_*`, an out-of-subset signal param type, a missing template
  handler as a throw). Real GObject *accepts* all seven, which is the point of the subset's
  refusal, so asserting them against a real binding would assert the opposite of the truth.
- **Before the fixes: 12 pass, 5 fail.** After: **16 pass, 1 known-divergent.**
- **GJS passes all 17**, measured locally in the same session (`gobject.gjs.spec.ts` on gjs
  1.88.1, with a display, so its template rows ran too). It skips the same seven refusal rows,
  for the same reason: the driver's rule is `holds === 'subset' && subject.isOracle`, which is a
  property of being an oracle, not of being GJS. The seven are measured by the pure-JS subject.
- The leg lives in `packages/web/adwaita-core` next to the GJS leg it mirrors, not in a new
  package — see [Where the subject lives](#where-the-subject-lives), which is a finding for
  stage 1, not a free choice.
- **The Android legs were not run here.** Nothing in *this* leg measured node-gi or the pure-JS
  subset on Android. Both ran the same day on a real `arm64-v8a` device —
  [the arm64 report](2026-10-10-gobject-oracle-arm64.md) — and see
  [Not done](#not-done) for what is still missing after it.

## Per-vector, per-subject

`GJS` = `gobject.gjs.spec.ts` on gjs 1.88.1. `node-gi` = this PR's
`gobject.node-gi.spec.ts` on Node 24.19.0. `before` = the same vectors against node-gi with none
of this PR's four fixes, measured by restoring `gi.js` and `src/` to `51045aa0c0` (the branch
point), rebuilding the addon with `node-gyp` and rerunning the identical bundle.

Rows 1-17 (`holds: 'oracle'`), as `before → after`:

1. ParamSpec, a generated accessor notifies once per change and not on an equal value — GJS pass;
   node-gi **fail → pass** (fix 2).
2. ParamSpec, a property reads as its ParamSpec default until it is set, for all five kinds — GJS
   pass; node-gi pass → pass.
3. ParamSpec, a class-defined accessor is kept and decides when to notify — GJS pass; node-gi
   pass → pass.
4. ParamSpec, a dashed name is reachable as `dash-name`, `dash_name` and `dashName`, one
   `notify::dash-name` serving all three — GJS pass; node-gi **fail → pass** (fix 2: it measured
   two notifies where GJS measures one, because the three spellings wrote the same value).
5. ParamSpec, a CONSTRUCT_ONLY property gets no accessor on the class and keeps its built value —
   GJS pass; node-gi pass → pass.
6. Signals, emit reaches a handler as `(emitter, …params)`, disconnect stops it, an undeclared
   name or wrong arity throws — GJS pass; node-gi **fail → pass** (fix 3).
7. instance API, `signal_stop_emission_by_name` stops the emission in progress — GJS pass;
   node-gi pass → pass.
8. instance API, it stops only the innermost emission of ITS signal, and with none in progress
   does nothing — GJS pass; node-gi pass → pass.
9. field-form, meta as static symbol fields registers like the meta object — GJS pass; node-gi
   **fail → fail**, now `it.failing`, but the failure shrank: before fix 4 the three meta symbols
   did not exist on the namespace at all, so the field form could not even be expressed and
   registration diverged wholesale; after it, registration is right and only the `.name` read
   differs. The one remaining divergence: #2151.
10. type_ensure, `$gtype` is a token and `type_ensure` accepts it — GJS pass; node-gi pass → pass.
11. binding engine, SYNC_CREATE transfers once at bind time — GJS pass; node-gi pass → pass.
12. binding engine, the target follows every change of the source — GJS pass; node-gi pass → pass.
13. binding engine, BIDIRECTIONAL makes the source follow back without echoing — GJS pass;
    node-gi pass → pass.
14. binding engine, INVERT_BOOLEAN negates what crosses — GJS pass; node-gi pass → pass.
15. template, construction order: the template is built, construct properties are set (`this._x`
    undefined inside a setter), then `this._x` is installed — GJS pass; node-gi **fail → pass**
    (fix 1).
16. template, `bind template.x bidirectional` follows both ways — GJS pass; node-gi pass → pass.
17. template, a handler on the template instance runs bound to it and receives the emitter — GJS
    pass; node-gi pass → pass.

Rows 18-24 (`holds: 'subset'`, refusals): **skipped on both real bindings**, before and after.
The driver drops them for every `isOracle` subject, so there is no GJS column to compare against
here either — these rows measure the pure-JS subject alone, in `gobject.spec.ts`. 18 template
missing handler; 19-22 `registerClass` refusing `Children`, `Implements`, `Requires`,
`GTypeFlags`; 23 `vfunc_*`; 24 an out-of-subset signal param type.

## The five divergences, classified

Each was cross-checked against gjs 1.88.1 directly before being called a defect.

1. **node-gi bug — construct properties were set after the template children.** Row 15. node-gi
   ran `assignTemplateChildren` before `flushPropertiesToJsSetters`, so a construct-property
   setter could already see `this._x`; on GJS it is `undefined` there. Fixed by swapping the two
   (`a7f59938ab`), with `test/gtk-template-construct-order.test.mjs`.
2. **node-gi bug — a custom property notified on an equal value.** Rows 1 and 4. gjs's generated
   accessor compares against the private field and skips `notify` when the value is unchanged:
   assignment measures `[1, 1, 2]`. node-gi measured `[1, 2, 3]`, and row 4 measured two notifies
   where GJS measures one. Fixed in the **L1 `gi.js` set trap**, not
   in the C++ `NodeGiSetProperty` vfunc (`9ba0e28f66`), with
   `test/custom-property-notify.test.mjs` — because gjs's guard lives in the *accessor*, so a
   direct `set_property` must keep notifying unconditionally, and gjs measures exactly that:
   `[1, 2, 3]`. The guard tracks **materialisation** (has this property been written or read yet),
   mirroring gjs's private-field presence, rather than comparing against the ParamSpec default;
   it is seeded from `native.storedPropertyNames()` and degrades to "always notify" when that
   export is absent.
3. **node-gi bug — `emit` did not check arity.** Row 6. gjs throws on both too few and too many
   arguments; node-gi accepted any count. Fixed in `EmitSignal` (`c8751e9682`) with gjs's message
   verbatim and `args.Length() != n`, with `test/signal-emit-arity.test.mjs`.
4. **registerClass meta-key mismatch — the symbol field form was not accepted.** Row 9. gjs
   accepts class meta either as the object passed to `registerClass` or as static fields keyed
   by `GObject.GTypeName` / `.properties` / `.signals`; node-gi exposed none of the three symbols
   (`G.GTypeName` was `undefined`), so it read only the object. Fixed by
   folding the symbol fields into the meta (`9d5650d426`) with
   `test/register-class-field-form.test.mjs`. Only those three symbols are exposed — not
   `interfaces` or `requires`, which the vectors do not reach and the subset refuses.
5. **node-gi bug, not fixed here — `$gtype.name` is `undefined`.** Row 9's remainder. node-gi's
   GType is a napi `External`, which is not extensible, so it has no name slot;
   `G.type_name(Field.$gtype)` answers correctly, only the `.name` read differs, and registration
   itself is right. Giving the handle a name means changing the GType representation across 18
   `IsExternal()` sites and 10 GType-handle readers — out of proportion to a stage-0 oracle run,
   so: [gjsify/gjsify#2151](https://github.com/gjsify/gjsify/issues/2151), and the vector carries
   `it.failing` with that reason.

**No divergence was a subset divergence,** and none was a wrong vector: nothing in the 17 rows
had to be weakened, and the pure-JS subset was not touched by this work.

## How a known divergence is marked

The full 24-row list is always driven. A divergence is **not** filtered out of the vector list
and **not** `it.skip`ped — either would delete the measurement. Instead the subject passes a
harness whose `it` delegates to `@gjsify/unit`'s `it.failing(name, fn, reason)` for a prefix
table (`KNOWN_DIVERGENT`, keyed by the row prefix `'field-form:'`). The vector still runs, the
reason prints in the output, and the day node-gi gains a name slot the row turns red as an
unexpected *pass* and the entry gets deleted.

## Where the subject lives

`packages/web/adwaita-core/src/gobject.node-gi.spec.ts`, with `src/test.node-gi.mts` as the entry
and a `test:gjs-on-node` script — the shape `packages/web/gamepad` already uses for a web-pillar
node-gi leg. **ADR 0105 § 7 says the subject should live in a new tier-3 package**, and this
deviates from that; recording it rather than editing the ADR, because it is a finding stage 1
should decide on:

- The driver (`driveGObjectVectors`), the vectors and the GJS leg are all in adwaita-core. A
  tier-3 package would import the vectors across a package boundary to add one subject, and the
  two legs that must stay in step would sit in different packages.
- `@gjsify/node-gi` enters as a `file:` **devDependency**, so nothing about adwaita-core's
  published surface or its all-`polyfill` runtime declaration changes.
- A new package costs a workspace member, a tsconfig, a CI matrix entry and a release slot, for
  one spec file.

What a tier-3 package *would* buy, and what stage 1 should weigh: it keeps a Node-and-Linux-only
leg out of a package that otherwise builds for browser, gjs and NativeScript. If stage 1's engine
interface brings more node-gi-side surface, that is the moment to move.

### How the spec reaches node-gi, and the two CI rules that decided it

`requireGi` is imported **in `src/test.node-gi.mts`** and handed to the suite as a parameter; the
spec itself imports nothing from `@gjsify/node-gi`. Three constraints leave no other shape, and
the first two were each found by a red required check rather than by reading:

- **`@gjsify/node-gi` is not a workspace member.** It resolves only where a job links it — the
  `test:gjs-on-node` legs do, through a `file:` devDependency. A static `import … from
  '@gjsify/node-gi/gi'` in a file this package **type-checks** therefore fails `build:types` with
  `TS2307` on every other job. That is what turned `Build Fedora 44` and `Build Documentation` red
  (and `CI gate (GJS)` with them, since it rolls the Fedora job up). The entry is in
  `tsconfig.json`'s `exclude`, next to `src/test.mts` and `src/test.browser.mts`, so the import
  lives in the one file that is bundled but never type-checked. What the spec needs of the bridge
  is one function type, declared locally as `RequireGi`.
- **A dynamic `gi://` load — the GJS leg's shape — is not available either.**
  `scripts/audit-runtimes.mjs` skips only the `.gjs.spec.*` suffix, so a `.node-gi.spec.ts` IS
  walked for runtime signals, and `DYNAMIC_GI_RE` sets `dynamic_gi`, which flips
  `suggestRuntimes`' design-identity branch from the all-`polyfill` triplet this package declares
  to `{gjs:none, node:none, browser:polyfill, nativescript:none}`. **And the walk is textual, over
  the raw file: the regex matched `await import('gi://GObject')` written inside a COMMENT
  explaining why the file does not do that.** One prose example cost three required checks —
  `Detect runtime-triplet drift`, `Manifest checks (Windows)` and the win32 `GTK OS suites`
  conformance-audit step, all three the same `audit-runtimes` drift under different names. The
  rule is right to be textual (a commented-out `gi://` import is one uncomment away from being
  real); what it means is that this repo's `gi://` spellings cannot appear in prose inside a
  walked source file. The reasoning now names the specifier without writing the call.
- **The bare `print(...)` banner the sqlite and gamepad entries use is not needed.** A STATIC
  import of `@gjsify/node-gi/*` is what `detectNodeGiModuleImports` counts as bridge-bound, so
  `nodeGiGlobalsInject` flips on the entry's own import — a second reason the bridge is reached
  statically and from the entry, since a dynamic `import()` would not count.

`--app node` keeps the specifier external, pinned by
`packages/infra/cli/src/node-gi-externals.spec.ts`.

## CI

New steps in the **existing `gtk-host-node` job** in `.github/workflows/node-gi.yml`: it already
has the workspace, this checkout's CLI, the node-gyp addon and GTK under xvfb, so the leg needs
one `run:`. The job name still says "framework suites" though adwaita-core is a web-pillar
package — the name is a required check and a merge-queue gate, and renaming it costs more than
the stale word; the same call iframe made when it joined.

Under `xvfb-run` for the **template** rows, and that is not shared-recipe convenience: the
subject gates them on `Gtk.init_check()`, so headless they would be skipped in silence — and the
template rows are the ones that found divergences 1 and 4.

## Not done

**Both Android legs were done the same day, on real arm64 hardware rather than the emulator —
[the arm64 report](2026-10-10-gobject-oracle-arm64.md).** What that leg found, and what the three
items below got wrong, in short: the harness gap was smaller than estimated (`@gjsify/unit` needs
no logcat reporter — on NativeScript its `print` is `console.log`, which lands under logcat tag
`JS`), and the real cost was three core defects only an Android host surfaces (liblog not linked,
a RegExp in rolldown's `external` under the native engine, and a missing VOID arm in node-gi's IN
marshaller). The items as they stood when this report was written:

- **The `x86_64` emulator legs, both of them.** ADR 0105 stage 0 asks for the vectors on the
  emulator against node-gi *and* against the pure-JS subset. Neither ran. What is missing is a
  test harness, not a fix: there is no `ns` app target in `@gjsify/cli`, `@gjsify/unit` has no
  NativeScript awareness (no `run()` path that reports to logcat), and no package has a `test:ns`
  or `test:android` script. The route is the ADR 0104 stage-4 shape — `~/.cache/gjsify-android/ns/
  napiprobe` for the node-gi leg (plain GObject needs no display, so the three template rows
  would be skipped there as they are without a display) and a second entry for the pure-JS subset
  — but each cycle is bundle → APK → install → logcat, and the stage-4 and stage-5 spikes each
  spent a cycle per defect. It is stage-1 infrastructure with its own measurement, not a step
  inside this one. — **Superseded:** done on `arm64-v8a` hardware, not the emulator; the
  `x86_64` emulator is still unmeasured, and the `@gjsify/unit` claim was wrong.
- The three template rows on a device, for the same reason: they need GTK with a display, which
  on Android is the ADR 0104 track-C′ worker setup. — **Still open**, and the arm64 leg records it
  as a real gap: the subject now skips the rows instead of failing on a host with no Gtk typelib,
  so node-gi's composite-template path is unmeasured on arm64.
- node-gi on `arm64-v8a` against these vectors. — **Done:** 14 rows run, 13 pass, row 9
  `it.failing` for #2151, no arm64-only divergence.

## Limits

- The 17 oracle rows are what two real bindings can be *compared* on. The seven refusal rows are
  the pure-JS subject's alone by construction — no real binding witnesses them, GJS included —
  so ADR 0105's engine will have to keep refusing in the subset layer, above whichever GObject
  sits underneath.
- "node-gi holds 16 of 17" is a statement about node-gi's `registerClass`, properties, signals,
  bindings and composite templates — the surface the vectors cover. It is not a statement that
  node-gi's GObject is interchangeable with GJS's across GI as a whole.
- The equal-value notify guard degrades to "always notify" when `native.storedPropertyNames` is
  absent, so a node-gi build older than `9ba0e28f66`'s native side still diverges on rows 1 and 4
  without failing loudly. The vectors catch it; nothing else does.
