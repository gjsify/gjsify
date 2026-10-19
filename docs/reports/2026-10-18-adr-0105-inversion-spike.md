# ADR 0105 § 2 spike: can a GObject widget own its NativeScript `View`?

Date 2026-10-18. Verdict: **no, not without a consumer-visible change. The twin stays.**

## Question

ADR 0105 § 2 left one route open: replace the hidden twin by inverting ownership, so the widget
is a real `GObject.registerClass` subclass that owns its `View` by composition. The owner decided
to test first. "Works" meant all of: NativeScript layout accepts it, identity, properties,
signals and lifetime hold, and no consumer sees an API change.

## Method

One probe, `tests/integration/nativescript-gi/app/specs/inversion.ts`, in the real-engine leg of
the NativeScript test app (kept as a regression probe, outside every shipping package). The
widget is a `GObject.Object` subclass with a `text` property, a `tapped` signal and a `view`
field holding a NativeScript `Label`. The Gtk typelib is not in the AAR, so the subject is a
`GObject.Object` and not a Gtk widget; the question is about NativeScript's side of the door.

Devices: API 36 x86_64 emulator and a Samsung SM-G960F (arm64-v8a). Both ran 106 of 106 cases
green with the bench on. Benchmark method as in
[the gates report](2026-10-15-adr-0110-gates.md): 4000 ops, 2 warm-up rounds, 7 interleaved
rounds, median.

## Results

Same on emulator and S9 unless a column says otherwise.

- One layout pass: the owned `Label` renders (screenshot on both devices) when mounted as
  `host.addChild(widget.view)`. The widget itself is never accepted.
- `widget instanceof GObject.Object`: true. `widget instanceof View`: **false**.
- Properties, `notify::text` and the custom `tapped` signal work with no twin; a handler drives
  `view.text`. A JS `constructor() { super(); … }` works on the subclass.
- Native API identity: `Gio.ListStore` append then `get_item` returns the same JS object
  (`back === widget`, same `view`).
- Lifetime, with a `FinalizationRegistry` witness, Java and JS `gc()`, and the loop ticked
  between rounds. A removed and dropped widget is finalized together with its view. A live
  widget is not collected early, and a store-held widget keeps wrapper and view alive. A View to
  widget back-reference (pure JS cycle) is collected. **Exception:** a handler closure that
  captures `this` is never collected. node-gi roots the closure held by the C signal strongly,
  a C-JS cycle that GJS's closure tracing would break. Handlers must capture only the view and
  the emitter argument. Whether the twin has the same leak for handler-connected instances is
  untested. `WeakRef` is no witness on this runtime: a target behind one is kept until the
  embedder clears kept objects.
  **FIXED 2026-10-19** — node-gi's signal closures hold their callback weakly now and keep it
  reachable from the canonical handle instead, which is what GJS's closure tracing does; the
  `this`-capturing case re-measures as `finalized=true` on both devices and `inversion.ts`
  asserts it. The rest of this bullet stands as measured.

Why it fails, exactly:

- NativeScript's `_addView` requires `view instanceof ViewBase`. Passing the widget throws
  "`[object Object]` is not a valid View instance" and the child is already counted
  (`getChildrenCount()` is 1 afterwards), so the tree is left dirty.
- The two prototype chains cannot be merged. `GObject.registerClass(class extends Label {})`
  throws "the class must extend a node-gi GObject class". A `View` cannot be a GObject, and a
  GObject is not a `View`.
- So the only way into layout is the unwrap `widget.view`. Every consumer that today writes
  `layout.addChild(widget)` or `page.content = widget` has to change. That is the consumer-visible
  API change the owner ruled out.

## Benchmark, inverted widget versus twin

Median ns/op, 4000 ops x 7 interleaved rounds.

- Emulator: inverted bare set+notify 7268; inverted wired (drives the Label) 12666; inverted emit
  2028; twin set+notify 10160; twin emit 3357. Ratio twin/inverted: 1.40x and 1.66x.
- S9: inverted bare 44024; wired 66187; emit 14309; twin 60746 and 22324. Ratio 1.38x and 1.56x.

Inversion buys about 1.4x on set+notify and 1.6x on emit. The gap that matters is the ~20-30x
against pure JS (same run: real-gio/pure-js set+notify 20.65x, emit 18.37x on the emulator;
emit 30.59x on the S9), and the inverted widget stays inside that gap: the cost is the native
property and signal machinery, not the twin.

## Where NativeScript requires a real `View` / `ViewBase`

- `ViewBase._addView` (`ui/core/view-base`): `instanceof ViewBase` gate for every child. Hard.
- `LayoutBaseCommon._addChildFromBuilder`: `instanceof View`, the XML/builder path. Hard.
- `ContentView.content` (and so `Page.content`): goes through `_addView`. Hard.
- `view.parent`, `_parentChanged`, `_addViewCore`: called on the child and expect View internals.
- Style scope and CSS: `_inheritStyleScope`, `propagateInheritableProperties`, `view.style`.
- Gestures and events: `observe`, `on`, `nativeViewProtected`, bindings context.
- Layout: measure/arrange live on the View.

The unwrap `widget.view` is clean for a single widget (it is the real object, so all of the above
works), but it is an API change, and it makes the widget a handle that NativeScript never sees.

## Decision input

Inversion works only as composition plus an unwrap. That fails the "no consumer-visible API
change" criterion, and the performance win is small. The twin stays permanently; perf work on the
twin continues. C′ (ADR 0104) stays the answer for apps that want real GTK widgets.
