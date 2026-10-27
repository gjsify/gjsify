# Where the JS↔Wasm boundary cost of node-gi goes

Follow-up to the [GObject-in-Wasm prototype](2026-10-27-gobject-wasm-prototype.md), which
measured a property `set` at ~12 µs, `emit` at ~3.7 µs and `get` at ~1.7 µs in Chromium
(~200× a plain JS property) against 88 ns for a C-level emit. This report splits those
numbers into layers, tries the cheap fixes one at a time, and says whether the factor can
fall to the 10–20× range. Harness: `docs/poc/gobject-wasm/harness/profile-boundary.mjs`
(calls `native.*` below the `gi.js` Proxy and compares with the wrapped call).

All numbers are ns per operation, 100k iterations, warmed, same machine, same session.
Run-to-run noise is about ±10 % on Node and larger in browsers, so differences under that
are not findings.

## Breakdown (Node, wasm build, then native node-gi)

A wrapped `obj.caption = x` on a registered class makes three crossings, not one: the
Proxy `set` trap asks `native.hasProperty`, then reads the value back through
`native.getProperty` for the equal-value guard, then calls `native.setProperty`.

- trivial crossing (`getTypeName`): 430 wasm, 90–200 native
- `hasProperty`: 600 wasm, 150–300 native
- `getProperty` (custom string property): 1,150 wasm, 500 native
- `setProperty` on a custom property: 2,700 wasm, 1,150 native
- `setProperty` on a built-in property (no engine store, no JS setter callback): 1,250
  wasm, 450–870 native
- wrapped `set`: 5,800–6,100 wasm, 2,200 native
- wrapped `get`: 2,200–2,500 wasm, 950 native
- wrapped `emit`: 4,300 wasm, 1,600 native; native `emitSignal` alone 3,500 wasm, with
  no handler connected 1,750 wasm

Reading it:

- Roughly half of a wrapped `set` is the `gi.js` Proxy layer (three crossings plus
  `unwrapArg`/`wrapReturn`), half is `setProperty` itself.
- Inside `setProperty`, the custom-property path costs ~1.5 µs more than a built-in one: the
  engine store (GHashTable plus GValue copy) and `MaybeRunJsPropertySetter`, which crosses
  back into JS through `runJsPropertySetter` on every store.
- A `notify::caption` handler is the expensive part in Wasm: wrapped `set` with one handler
  connected is **~21–22 µs on wasm against ~5 µs native**. The closure marshal path
  (HandleScope, GValue→JS, `napi_call_function` through emnapi) costs ~15 µs per signal
  crossing back into JS on Wasm and ~1.5 µs natively. This is the largest single item and
  it is a Wasm-specific one, not a shared N-API tax.
- Name copy and lookup are small. The property name is a short string; its copy is part of
  the 430 ns trivial crossing.

## Fixes tried, each measured alone

1. **Memoise positive `hasProperty` answers per wrapper (`gi.js`).** A class never loses a
   property, so a hit is final; a miss stays a live lookup. Removes one crossing from every
   get and set. Wasm Node: set 5.8 → 5.0 µs, get 2.2 → 1.5 µs. Chromium: set 15.9–20.3 →
   14.7–17.3 µs, get 2.2–2.4 → 1.5–1.7 µs. Firefox: set 50.1 → 47.5 µs, get 8.1 → 6.3 µs.
   Native Node: set 2.28 → 2.08 µs, get 0.95 → 0.89 µs. **Kept**, and it helps natively too.
2. **Stack buffer instead of `Utf8Value()` for property names (`object.cc`).** One N-API
   call instead of two and no heap `std::string`. Wasm `setProperty` 2,786 → 2,702 ns,
   `getProperty` 1,140 → 1,031 ns, which is inside the noise. **Dropped**: no measurable
   gain, so not worth touching C++.
3. **ParamSpec cache per (class, name).** Not implemented. `g_object_class_find_property` is
   a GHashTable lookup in C; the whole `hasProperty` crossing costs 600 ns and almost all
   of that is the crossing, so the lookup is not where the time is.
4. **Batching several property changes into one crossing.** Not implemented. `gi.js` sets
   properties through a Proxy trap one at a time, and the equal-value guard and notify
   ordering are per property, so a batch would need a new API surface, not a cleanup.

## Verdict

The factor does **not** reach 10–20×. After the one fix that worked, wasm `set` is ~5 µs
(roughly 60–80× plain JS) and `get` ~1.5 µs (~150×). The floor is the crossing itself, ~430 ns
per N-API call on Wasm, times at least two for a set. Getting to 10–20× would need ~1 µs per
set, i.e. one crossing and no JS setter callback, which means moving the property fast path
into C++ rather than trimming `gi.js`.

What would move the numbers, in order of size:

- the signal/notify crossing back into JS on Wasm (~15 µs): look at the closure marshal
  path and emnapi's `napi_call_function` and handle-scope cost
- skip `MaybeRunJsPropertySetter` for a class that declares no JS accessor (currently a
  JS call per store just to learn there is nothing to run)
- fold the equal-value `getProperty` into `setProperty` so a set is one crossing

## What landed and what is a todo

Landed in node-gi (`packages/node-gi/node-gi/gi.js`): the positive `hasProperty` memo. No
behaviour change; `custom-property-js-setter`, `custom-property-notify`, `gobject`,
`registerclass-construct-property-accessor` and `interface-props` pass (35/35) on Node.

Todos are in `status/open-todos/node-gi.md`.

PoC build fixes found while rebuilding from a clean tree: `30-emnapi.sh` looked for
`@emnapi/core-*.tgz` but `npm pack` writes `emnapi-core-*.tgz`; `40-node-gi.sh` compiled
without `-fPIC`, which `-sMAIN_MODULE=2` rejects at link time. `env.sh` must be sourced
from bash (under zsh `BASH_SOURCE` is unset and `POC_REPO` resolves to an empty path).
