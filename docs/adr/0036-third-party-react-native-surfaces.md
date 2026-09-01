# 36. Third-party React Native surfaces: one registry, one package, one subpath each

- Status: **Proposed**
- Date: 2026-08-31
- Deciders: Pascal Garber
- Related: [ADR 0032 (React Native on the GTK host)](0032-react-native-on-the-gtk-host.md), [ADR 0027 (GTK host layer)](0027-gtk-host-layer.md), [ADR 0016 (status as data)](0016-status-as-data.md), [ADR 0003 (package tiering)](0003-package-tiering.md), [ADR 0008 (release versioning policy)](0008-release-versioning-policy.md), [ADR 0022 (WebKit on darwin)](0022-webkit-on-darwin.md), [ADR 0024 (`gjsify ship`)](0024-ship-installable-artifacts.md)

## Context

ADR 0032 answered `react-native` and the five `expo-router` names, and a real
application still does not build — because a real React Native application does not
only import `react-native`.

### The measurement

Re-read on the same production-shaped Expo / React Native application ADR 0032
measured, and it is the same measuring stick with the same caveat: it is not a
commitment, it is what makes "would this build a real application" answerable. Its
non-local imports, beyond `react` itself:

| import source | uses | what of it |
|---|---:|---|
| `@expo/vector-icons` | 24 | `Ionicons` only |
| `expo-router` | 22 | answered by ADR 0032 § 10 |
| `react-native` | 67 named | answered by ADR 0032 |
| `react-native-safe-area-context` | | `SafeAreaView`, `useSafeAreaInsets` |
| `@react-native-async-storage/async-storage` | | the default export |
| `react-native-gesture-handler` | | `GestureHandlerRootView` |
| `react-native-webview` | | `WebView` |
| `expo-audio`, `expo-video` | | playback |
| `expo-image` | | `Image` |
| `expo-font` | | `useFonts` |
| `expo-status-bar` | | `StatusBar` |
| `expo-splash-screen` | | the module |
| `expo-linking`, `expo-web-browser` | | URL handling |
| `expo-constants`, `expo-system-ui` | | app metadata, window background |
| `react-redux` | | `Provider`, `useSelector`, `useDispatch` |
| a Tailwind-for-RN runtime | 3 names | `className` support |

**Sixteen of these are not answered at all**, and what happens today is worse than a
refusal: the bundler cannot resolve the package, so the error names npm rather than
this layer, and a porter learns nothing about whether a desktop answer exists.

### What the existing machinery cannot absorb

Two structures in `@gjsify/react-native` are written for exactly two surfaces:

1. **The alias and the gate name their specifiers as constants.**
   `react-native-alias.ts` holds `REACT_NATIVE_SPECIFIER`, and
   `react-native-gate.ts` watches a two-element `WATCHED_SPECIFIERS`.
2. **The support tables are keyed by NAME, and the spec asserts the two key sets are
   DISJOINT** — because a name in both gives `explainUnsupported` two answers and
   `isImportable` whichever it looked in first, silently, since both lookups succeed.

Disjointness cannot survive more surfaces, and not marginally: `StatusBar` is a
`react-native` export **and** the whole of `expo-status-bar`. `SafeAreaView` is a
`react-native` export **and** `react-native-safe-area-context`'s. `Image` is
`react-native`'s and `expo-image`'s. The collision is the normal case, not the edge.

## Decision

### 1. One package. One subpath per surface.

Each answered surface becomes a subpath of `@gjsify/react-native` —
`@gjsify/react-native/expo-status-bar`, `@gjsify/react-native/async-storage`,
`@gjsify/react-native/vector-icons`, and so on. Not a package per surface, and not one
new package holding all of them.

**Why not a new package.** Adding a `@gjsify/*` name costs a manual npm first-publish
plus a Trusted Publisher bootstrap **before** the release that ships it, and skipping
it stalls the release train for every alphabetically later package
([docs/publishing.md](../publishing.md)). That is a real recurring cost and it would be
paid once per surface. Sixteen surfaces is sixteen bootstraps, sixteen `exports` maps
and sixteen version ranges inside one release train that guarantees compatibility only
within a release (ADR 0008).

**Why not one sibling package either.** Every one of these surfaces sits on the
substrate the React Native surface already has: L1's style partition, L2's primitive
descriptors, `gi://`. A sibling would either duplicate that dependency edge or invert
the tier, and `@gjsify/react-native` would still have to depend on it for
`expo-status-bar` to reuse `StatusBar`'s own answer — which is § 4's rule.

**Why not a documented per-consumer alias table**, which is the third option and the
one that looks cheapest: it moves the decision into every consumer's build config,
where nothing checks it, and it leaves the ADR 0032 § 8 gate with nothing to say about
a surface. A build that resolves `expo-font` to a stub the consumer wrote is exactly
the silent no-op the whole layer is built against.

**The subpath is the npm package's last path segment** (`expo-status-bar`,
`async-storage`, `vector-icons`, `react-native-safe-area-context`). It is not derived
at runtime: the registry in § 2 carries the pair, so there is one place that says
which npm name maps to which subpath and no second table to drift.

### 2. A surface registry replaces the two hard-coded tables

`support-table.ts` grows `SURFACES`: an ordered list of
`{ module, target, label, table }`, one row per surface, where `module` is the npm
specifier an application writes and `target` is the subpath that answers it.
`react-native` and `expo-router` become the **first two rows** rather than two special
cases — and that unification pays for itself immediately: `import { Stack } from
'expo-router'` works, where today only `@gjsify/react-native/router` does.

Everything downstream is the same machinery pointed at a longer list, which is why
this is a registry and not a copy:

- the **generator** already takes a `TABLES` array (`scripts/generate-exports.mjs`) —
  it gains rows, not code;
- the **alias plugin** reads the registry instead of one constant, and its
  "target does not resolve" error becomes per surface;
- the **gate** watches every declared specifier;
- the **generated documentation** gains one section per surface — in a
  `SUPPORT.md` beside the README rather than inside it, which is a change this ADR
  makes necessary rather than a preference: `react-native`'s own section is about a
  hundred table rows, and eighteen surfaces together are several hundred. Putting them
  in the README would bury the two paragraphs a reader came for. The whole file is
  generated, so there are no markers to lose and `check-rn-surface.mjs` compares it
  byte for byte.

`scripts/check-rn-surface.mjs` keeps holding `react-native`'s key set against the
committed snapshot of react-native's own `index.js`, and it now also asserts that
every registry row has a table, a target that the package's `exports` map really
declares, and a distinct module specifier. The provenance of the other rows is
weaker than the first one's and that is stated per row, exactly as the router table
already states its own.

### 3. The lookup becomes module-scoped

`isImportable(name, module?)` and `explainUnsupported(name, module?)`. This is a
change to a published contract — `@gjsify/react-native/support-table` is what the
bundler plugin imports — so it is here rather than in a commit message.

The gate always knows the module: it scans the import statement. The one-argument form
stays, for the runtime backstop and for consumer tooling, and it resolves in registry
order — `react-native` first, which is what it did before. `explainUnsupported`
**prints the module it answered from**, so an answer that came from a surface the
reader did not mean is visible rather than plausible.

What replaces the disjointness invariant: a name may appear in several tables, and
`support-table.spec.ts` asserts instead that every row's entry produces a sentence
naming both the export and its module.

### 4. A shared answer is REUSED, never re-decided

`expo-status-bar`'s `StatusBar` is `react-native`'s `StatusBar`. `expo-linking`'s
`openURL` is `Linking.openURL`. `react-native-safe-area-context`'s `SafeAreaView` is
the `SafeAreaView` primitive. Each of those already carries a measured answer and its
limits, and a second implementation would be a second truth about one question — the
shape ADR 0027 rule 1 exists to prevent one layer down.

So a surface module re-exports the existing implementation and its **table entry
points at the original's**. Where the third-party surface adds names of its own
(`SafeAreaProvider`, `useSafeAreaInsets`), those are new entries with their own
reasons.

### 5. Which surfaces belong here — three classes, stated per surface

**(a) A platform surface with a GTK answer → a subpath here.**

| surface | the desktop answer |
|---|---|
| `expo-status-bar` | `react-native`'s `StatusBar`: renders nothing, statics refuse |
| `expo-font` | fontconfig/Pango. A desktop application does not load a font file per screen — fonts are installed and discovered. `useFonts` reports ready; `isLoaded` is a real `Pango.FontMap` lookup |
| `expo-linking` | `Gtk.UriLauncher`, through `Linking` |
| `expo-web-browser` | `Gtk.UriLauncher` again — the desktop counterpart of an in-app browser is the user's own browser, and it cannot report a dismissal |
| `react-native-safe-area-context` | the inset has no desktop meaning, the layout does (`SafeAreaView`'s own entry) |
| `react-native-gesture-handler` | `GestureHandlerRootView` is a `View`. Everything else needs a Babel worklet transform that is not in this chain — ADR 0032's `not-reachable` |
| `@react-native-async-storage/async-storage` | a real store over `Gio`, in the application's data directory |
| `@expo/vector-icons` | GTK symbolic icon names, validated against the installed icon theme |
| `expo-image` | `Gtk.Picture`, i.e. `Image`'s own answer plus caching and transitions |
| `expo-constants` | mostly refusals: it is the Expo config object, and a desktop application's identity is its `Gio.Application` id |
| `expo-system-ui` | the window background is the theme's and the application stylesheet's |
| `expo-splash-screen` | refused, for the reason the router table already gives `SplashScreen`: a GTK application maps its window when it is ready |

**(b) Another track's, declared but not built here.** These get registry rows whose
entries are `planned` or `not-reachable` with a pointer, so the gate refuses the
import with a reason instead of the bundler failing on module resolution:

- `expo-audio`, `expo-video` — playback is `Gtk.MediaFile` / `Gtk.Video` / GStreamer,
  which is a media question and not a view-layer one. It belongs with whatever package
  ends up owning media, not with the vocabulary translation.
- `react-native-webview` — WebKitGTK. The webkit surface has its own history in this
  repository (ADR 0022) and its own platform matrix.
- the **Tailwind-for-RN runtime** — ADR 0032 § 12 already decided this one: the class
  vocabulary is *consumed* and none of its toolchain is. Its three names therefore
  refuse **by name**, pointing at `className`, because a build that resolved them
  would pull NativeWind's bindings to `StyleSheet`, `Appearance`, `Dimensions` and
  `PixelRatio` into the critical path — the two-lossy-mappings-stacked shape § 3
  rejects.

**(c) The consumer's own business — no row, no alias, and this is the part that has to
be written down.** `react-redux` is React plus a store: pure JavaScript, no platform
surface, and it works unmodified. Adding an entry for it would claim ownership of
something this layer does not own, and the gate would then have an opinion about a
library whose behaviour has nothing to do with GTK. The rule is: **a surface earns a
row only if it reaches a platform** — a native module, a native view, or a device
capability. Everything else is a dependency the application installs, and the honest
answer is silence.

### 5a. The criterion is not "is it a platform surface" — it is "can a consumer answer it"

That is sharper than the class boundaries above, and it comes from a port rather than
from reasoning. A consumer-side wrapper was written for the measured application, and
what it could and could not do settles which side of the boundary a thing is on:

| what the consumer met | outcome | what that establishes |
|---|---|---|
| `accessibilityLabel`, 46 sites | **implemented outside** — `Gtk.Accessible.update_property()` through a `ref` | answerable from outside; the layer's absence is an inconvenience |
| `accessibilityRole`, 41 sites | **impossible outside** — GTK's `accessible-role` is CONSTRUCT-ONLY, so by the time a `ref` fires the widget exists and the role can no longer be set | **only the layer that constructs the widget can answer it** |
| `hitSlop`, 13 sites | dropped, correctly | wants no answer at all: an 8 px expansion of a *touch* target on a platform whose pointer has single-pixel precision |

`accessibilityRole` is the argument this ADR needs, and it is not a convenience
argument about where code should live. **The layer constructs the widget; only the
layer can set a construct-only property.** A consumer can carry the label and not the
role, so 41 call sites degrade silently with no repair available at any effort level.

So the question to ask of a candidate surface is not "does it touch a platform" but
**"is there anything here a consumer cannot do for themselves?"** — and the three
answers are *build it*, *let them*, and *neither*. `hitSlop` is the reminder that the
third one is real: not every refusal wants implementing.

### 5b. Four expected surfaces are DECLARED and never imported

Also measured on the port, and it is the finding that trims this ADR's own scope:
`expo-linking`, `expo-web-browser`, `expo-constants` and `expo-system-ui` appear in the
application's dependency list and are **imported from nowhere in its source**.

A shim for a surface nobody imports is dead code that looks like coverage — it makes a
support table longer, a README section fuller and a porter no better off. It is the
same defect as an untriggered CI guard, one layer up: the mechanism exists, the report
says it is covered, and nothing was ever asked of it.

That does not delete their rows. A row costs a table entry and buys a build error with
a reason instead of npm's "cannot find package", which is exactly what § 5b's
declared-not-built class is for. What it changes is the ORDER: a surface earns
implementation when an application is measured importing it, and a declared dependency
is not that measurement.

### 6. Every surface gets the same three readers

Non-negotiable, and it is what makes a row a promise rather than a folder: the
**gate** refuses an unsupported import at build time, the **runtime** exports a value
that throws the table's own sentence, and the **documentation section is generated**.
A surface that skipped any of the three would be the hand-maintained table beside the
data that ADR 0016 and ADR 0032 § 8 both exist to prevent.

A fourth reader arrived with the implementation and is worth recording, because it is
the one that caught a real defect: the generated refusal carries the MODULE as well as
the name. `explainUnsupported('Image')` with no module answers from the first surface
that has the name, so `expo-image`'s planned `Image` reported `react-native`'s "is
available" until the generator started passing it.

## Consequences

- **`@gjsify/react-native`'s `exports` map grows one key per surface**, and its `files`
  entry already ships `lib`. No new npm name, no new bootstrap, no new tier decision:
  it stays tier 3.
- **The gate's cheap text prefilter changes shape.** It skips a module today with one
  `code.includes('react-native')`; with N specifiers it needs "mentions any watched
  specifier". That is a loop over a short list per module and it must stay a prefilter —
  a gate that parses every file in a project is a gate people turn off.
- **`isImportable`'s one-argument form is now ambiguous by construction.** It answers,
  in registry order, and says which module it answered from. Consumer tooling that
  needs the exact answer passes the module.
- **A surface can be added without touching any reader.** That is the point, and it is
  also the risk: a row with no implementation behind it is a build refusal a porter
  reads as "this project has considered it", which is true and is not the same as
  "this project will build it". Hence § 5's classes are stated per surface rather than
  left to the status field.
- **`expo-router` is now reachable under its own specifier**, so an unmodified
  application's route files resolve. Its table is unchanged.

## What this does not decide

- **The media surfaces.** `expo-audio` and `expo-video` get a row and a pointer, not a
  design. Which package owns playback, and whether it is `Gtk.MediaFile` or GStreamer
  directly, is its own decision with its own measurement.
- **`react-native-webview`.** Same: a row and a pointer. WebKitGTK's platform story is
  ADR 0022's and ADR 0024's, not this one's.
- **How a consumer interposes their own module between `react-native` and this layer.**
  The alias plugin is composed `pre` — ahead of the substitution table and the externals
  policy, because a redirect after `externalsPlugin` would find the specifier already
  externalised — so it wins over a consumer's own exact-match redirect, and a consumer
  who needs to interpose has to drop `--dialect react-native` and with it ADR 0032 § 8's
  build gate. The measured application reproduced the gate in its own test suite against
  the same published table, which works and is a copy of a gjsify-owned rule living in a
  consumer. Making the alias target configurable, or exporting the gate as something
  composable without the alias, are both real answers and neither is decided here.

- **Whether a surface's *type* declarations should mirror the upstream package's.**
  Today each subpath declares its own types, and an application that also has the real
  `@types` installed will type-check against those instead. Making the alias apply to
  types as well is a `tsconfig` `paths` question in the consumer's tree, and nothing
  here measures it.
- **A `.web` export.** Unchanged from ADR 0032: still out of scope.
